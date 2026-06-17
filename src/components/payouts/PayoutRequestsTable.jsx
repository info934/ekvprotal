import React from 'react';
import { Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyPayoutState } from '@/components/payouts/PayoutShared';

const isInteractiveRowTarget = (target) => {
  if (!(target instanceof Element)) return false;

  return Boolean(target.closest('a, button, input, select, textarea, label, [role="button"], [role="menuitem"]'));
};

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
  onRowClick,
  renderExpandedRow,
}) => {
  if (loading) {
    return (
      <div className="flex flex-col items-center p-12 text-center text-slate-500">
        <Loader2 className="mb-4 h-8 w-8 animate-spin text-slate-300" />
        {loadingLabel}
      </div>
    );
  }

  if (!items?.length) {
    return (
      <div className="p-5">
        <EmptyPayoutState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader className="bg-slate-50">
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
        <TableBody>
          {items.map((item) => {
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
              if (!isClickable || isInteractiveRowTarget(event.target)) return;
              if (event.key !== 'Enter' && event.key !== ' ') return;

              event.preventDefault();
              onRowClick(item, event);
            };

            return (
              <React.Fragment key={rowKey}>
                <TableRow
                  aria-label={isClickable ? getRowAriaLabel?.(item) : undefined}
                  className={rowClassName}
                  onClick={handleRowClick}
                  onKeyDown={handleRowKeyDown}
                  role={isClickable ? 'button' : undefined}
                  tabIndex={isClickable ? 0 : undefined}
                >
                  {columns.map((column) => (
                    <TableCell key={column.key} className={column.cellClassName}>
                      {column.render(item)}
                    </TableCell>
                  ))}
                </TableRow>
                {expandedContent && (
                  <TableRow className="border-slate-100 bg-slate-50/60 hover:bg-slate-50/60">
                    <TableCell colSpan={columns.length} className="px-4 py-0">
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
  );
};

export default PayoutRequestsTable;
