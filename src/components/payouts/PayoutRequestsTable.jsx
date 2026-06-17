import React from 'react';
import { Loader2 } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EmptyPayoutState } from '@/components/payouts/PayoutShared';

const PayoutRequestsTable = ({
  columns,
  emptyDescription,
  emptyTitle,
  getRowClassName,
  getRowKey,
  items,
  loading,
  loadingLabel,
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

            return (
              <React.Fragment key={rowKey}>
                <TableRow className={getRowClassName?.(item) || 'border-slate-100 hover:bg-slate-50/70'}>
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
