import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Columns, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

const normalizeColumns = (columns) => columns.filter(Boolean).map((column) => ({
  hideable: true,
  ...column,
}));

export const useManagedColumns = (storageKey, columns) => {
  const normalizedColumns = useMemo(() => normalizeColumns(columns), [columns]);
  const defaultOrder = useMemo(() => normalizedColumns.map((column) => column.id), [normalizedColumns]);
  const defaultVisibility = useMemo(() => (
    normalizedColumns.reduce((acc, column) => {
      acc[column.id] = column.defaultVisible !== false;
      return acc;
    }, {})
  ), [normalizedColumns]);

  const [order, setOrder] = useState(defaultOrder);
  const [visibility, setVisibility] = useState(defaultVisibility);

  useEffect(() => {
    if (!storageKey) {
      setOrder(defaultOrder);
      setVisibility(defaultVisibility);
      return;
    }

    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      const known = new Set(defaultOrder);
      const savedOrder = Array.isArray(saved?.order) ? saved.order.filter((id) => known.has(id)) : [];
      setOrder([...savedOrder, ...defaultOrder.filter((id) => !savedOrder.includes(id))]);
      setVisibility({ ...defaultVisibility, ...(saved?.visibility || {}) });
    } catch {
      setOrder(defaultOrder);
      setVisibility(defaultVisibility);
    }
  }, [defaultOrder, defaultVisibility, storageKey]);

  useEffect(() => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify({ order, visibility }));
  }, [order, storageKey, visibility]);

  const columnMap = useMemo(() => new Map(normalizedColumns.map((column) => [column.id, column])), [normalizedColumns]);
  const orderedColumns = useMemo(() => order.map((id) => columnMap.get(id)).filter(Boolean), [columnMap, order]);
  const visibleColumns = useMemo(() => orderedColumns.filter((column) => visibility[column.id] !== false), [orderedColumns, visibility]);

  const moveColumn = (id, direction) => {
    setOrder((current) => {
      const index = current.indexOf(id);
      const nextIndex = direction === 'up' ? index - 1 : index + 1;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const toggleColumn = (id, nextValue) => {
    const column = columnMap.get(id);
    if (!column?.hideable) return;
    setVisibility((current) => ({ ...current, [id]: nextValue }));
  };

  const resetColumns = () => {
    setOrder(defaultOrder);
    setVisibility(defaultVisibility);
  };

  return {
    columns: orderedColumns,
    visibleColumns,
    visibility,
    moveColumn,
    toggleColumn,
    resetColumns,
  };
};

export const ManagedTableToolbar = ({
  columns,
  visibility,
  onMoveColumn,
  onToggleColumn,
  onReset,
  className,
}) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="outline" size="sm" className={cn('h-9 gap-2 bg-white', className)}>
        <Columns className="h-4 w-4" />
        Sloupce
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" className="w-72">
      <DropdownMenuLabel>Nastavení sloupců</DropdownMenuLabel>
      <DropdownMenuSeparator />
      <div className="max-h-[360px] overflow-y-auto p-1">
        {columns.map((column, index) => (
          <div key={column.id} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-slate-50">
            <DropdownMenuCheckboxItem
              checked={visibility[column.id] !== false}
              disabled={!column.hideable}
              onCheckedChange={(value) => onToggleColumn(column.id, Boolean(value))}
              onSelect={(event) => event.preventDefault()}
              className="min-w-0 flex-1"
            >
              <span className="truncate">{column.label}</span>
            </DropdownMenuCheckboxItem>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={index === 0}
              onClick={(event) => {
                event.preventDefault();
                onMoveColumn(column.id, 'up');
              }}
            >
              <ArrowUp className="h-3.5 w-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              disabled={index === columns.length - 1}
              onClick={(event) => {
                event.preventDefault();
                onMoveColumn(column.id, 'down');
              }}
            >
              <ArrowDown className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        onSelect={(event) => {
          event.preventDefault();
          onReset();
        }}
      >
        <RotateCcw className="mr-2 h-4 w-4" />
        Obnovit výchozí sloupce
      </DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);

export const ManagedTableSection = ({
  title,
  count,
  toolbar,
  minWidth = '1180px',
  children,
  className,
}) => (
  <div className={cn('overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_10px_28px_rgba(15,23,42,0.05)]', className)}>
    <div className="overflow-x-auto">
      <div
        className="flex items-center gap-2 border-b border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-950"
        style={{ minWidth }}
      >
        <span className="relative pl-3 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-1 before:-translate-y-1/2 before:rounded-full before:bg-primary">{title}</span>
        {typeof count !== 'undefined' && (
          <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700">{count}</span>
        )}
        {toolbar && <div className="ml-auto">{toolbar}</div>}
      </div>
      <div className="[&>div]:rounded-none [&>div]:border-0 [&>div]:shadow-none">
        {children}
      </div>
    </div>
  </div>
);
