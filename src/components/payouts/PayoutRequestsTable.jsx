import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyPayoutState } from '@/components/payouts/PayoutShared';
import { Button } from '@/components/ui/button';

const isInteractiveRowTarget = (target) => {
  if (!(target instanceof Element)) return false;

  return Boolean(target.closest('a, button, input, select, textarea, label, [role="button"], [role="menuitem"]'));
};
const mobileOrder = { expand: 'order-1', worker: 'order-2', amount: 'order-3', items: 'order-4', context: 'order-4', hours: 'order-5', status: 'order-6', invoice: 'order-7', actions: 'order-8' };

const PayoutRequestsTable = ({
  columns,
  emptyDescription,
  emptyTitle,
  getRowClassName,
  getRowAriaLabel,
  getRowKey,
  items,
  loading,
  loadingLabel,
  error,
  onRowClick,
  renderExpandedRow,
}) => {
  const [page, setPage] = useState(1);
  useEffect(() => { setPage(1); }, [items]);
  const pageCount = Math.max(1, Math.ceil((items?.length || 0) / 20));
  const visiblePage = Math.min(page, pageCount);
  const visibleItems = items?.slice((visiblePage - 1) * 20, visiblePage * 20);
  if (loading) {
    return (
      <div className="flex flex-col items-center p-12 text-center text-slate-500">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-slate-300" />
        {loadingLabel}
      </div>
    );
  }

  if (error) return <div role="alert" className="p-6 text-sm text-red-800">Seznam se nepodařilo načíst. {error}</div>;

  if (!items?.length) {
    return (
      <div className="p-5">
        <EmptyPayoutState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div><div className="overflow-x-auto">
      <Table className="block min-w-0 lg:table lg:min-w-full">
        <TableHeader className="hidden bg-slate-50 lg:table-header-group">
          <TableRow className="border-slate-200">
            {columns.map((column) => (
              <TableHead
                key={column.key}
                className={column.headerClassName || 'h-11 text-xs font-bold uppercase tracking-wide text-slate-500'}
              >
                {column.header}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody className="block divide-y divide-slate-200 lg:table-row-group lg:divide-y-0">
          {visibleItems.map((item) => {
            const rowKey = getRowKey(item);
            const expandedContent = renderExpandedRow?.(item);
            const isClickable = typeof onRowClick === 'function';
            const baseRowClassName = getRowClassName?.(item) || 'border-slate-100 hover:bg-slate-50/70';
            const rowClassName = isClickable ? `${baseRowClassName} cursor-pointer` : baseRowClassName;

            const handleRowClick = (event) => {
              if (!isClickable || isInteractiveRowTarget(event.target)) return;
              onRowClick(item, event);
            };

            const handleRowKeyDown = (event) => {
              if (!isClickable || event.target !== event.currentTarget) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;

              event.preventDefault();
              onRowClick(item, event);
            };

            return (
              <React.Fragment key={rowKey}>
                <TableRow
                  aria-label={isClickable ? getRowAriaLabel?.(item) : undefined}
                  className={`grid grid-cols-2 gap-x-4 px-4 py-4 lg:table-row lg:p-0 ${rowClassName}`}
                  onClick={handleRowClick}
                  onKeyDown={handleRowKeyDown}
                  aria-expanded={isClickable ? Boolean(expandedContent) : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key} className={`block min-w-0 px-0 py-2 lg:table-cell lg:p-4 lg:order-none ${mobileOrder[column.key] || ''} ${['worker', 'amount'].includes(column.key) ? '' : 'col-span-2'} ${column.cellClassName || ''}`}>
                      {column.header && <span className="mb-1 block text-xs font-medium text-slate-500 lg:hidden">{column.header}</span>}
                      {column.render(item)}
                    </TableCell>
                  ))}
                </TableRow>
                {expandedContent && (
                  <TableRow className="block border-slate-100 bg-slate-50/60 hover:bg-slate-50/60 lg:table-row">
                    <TableCell colSpan={columns.length} className="block px-4 py-0 lg:table-cell">
                      {expandedContent}
                    </TableCell>
                  </TableRow>
                )}
              </React.Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
    {pageCount > 1 && <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3"><p className="text-sm text-slate-500">{(visiblePage - 1) * 20 + 1}–{Math.min(visiblePage * 20, items.length)} z {items.length}</p><div className="flex gap-2"><Button variant="outline" disabled={visiblePage <= 1} onClick={() => setPage(visiblePage - 1)}>Předchozí</Button><Button variant="outline" disabled={visiblePage >= pageCount} onClick={() => setPage(visiblePage + 1)}>Další</Button></div></div>}
    </div>
  );
};

export default PayoutRequestsTable;
