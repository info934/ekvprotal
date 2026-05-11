import React, { useState } from 'react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Eye, FileWarning, MoreHorizontal } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import PayoutApprovalAuditLog from './PayoutApprovalAuditLog';
import { EmptyPayoutState, formatCurrency, PayoutPanel, PayoutStatusBadge } from '@/components/payouts/PayoutShared';

const PayoutTable = ({ data, loading }) => {
  const [selectedAuditPayout, setSelectedAuditPayout] = useState(null);

  if (loading) {
    return (
      <PayoutPanel>
        <div className="p-10 text-center text-sm text-slate-500">Načítám historii výplat...</div>
      </PayoutPanel>
    );
  }

  if (!data || data.length === 0) {
    return (
      <EmptyPayoutState
        title="Žádné žádosti o výplatu"
        description="Zatím nebyla podána žádná úkolová žádost, která odpovídá aktuálním filtrům."
      />
    );
  }

  return (
    <PayoutPanel
      title="Úkolové výplaty"
      description="Jednotný workflow: žádost, schválení, faktura a uzavření jako vyplaceno."
    >
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow className="border-slate-200">
              <TableHead className="h-11 px-5 text-xs font-bold uppercase tracking-wide text-slate-500">Datum</TableHead>
              <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Pracovník</TableHead>
              <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Položky</TableHead>
              <TableHead className="h-11 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Částka</TableHead>
              <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Stav</TableHead>
              <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Poznámka</TableHead>
              <TableHead className="h-11 px-5 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id} className="border-slate-100 hover:bg-slate-50/70">
                <TableCell className="px-5 font-medium text-slate-600">
                  {format(new Date(item.created_at || item.request_date), 'dd. MM. yyyy', { locale: cs })}
                </TableCell>
                <TableCell>
                  <div className="font-semibold text-slate-950">{item.members?.name || 'Neznámý pracovník'}</div>
                  {item.variable_symbol && <div className="mt-0.5 text-xs text-slate-500">VS {item.variable_symbol}</div>}
                </TableCell>
                <TableCell className="max-w-[360px]">
                  {item.payout_items?.length ? (
                    <div className="space-y-1">
                      {item.payout_items.slice(0, 2).map((payoutItem) => (
                        <div key={payoutItem.id} className="truncate text-sm text-slate-600">
                          {payoutItem.projects?.name || payoutItem.realizations?.name || 'Položka výplaty'}
                        </div>
                      ))}
                      {item.payout_items.length > 2 && (
                        <div className="text-xs text-slate-400">+ {item.payout_items.length - 2} další položky</div>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-slate-400">Bez položek</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="font-bold tabular-nums text-slate-950">{formatCurrency(item.total_amount || item.amount)}</div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    <PayoutStatusBadge status={item.status} />
                    {item.approved_without_invoice && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="h-7 cursor-help gap-1.5 rounded-full border-amber-200 bg-amber-50 px-2.5 text-amber-700">
                              <FileWarning className="h-3.5 w-3.5" />
                              Bez faktury
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>Tato výplata byla schválena bez nutnosti přiložit fakturu.</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </TableCell>
                <TableCell className="max-w-[260px]">
                  {item.admin_note ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="link" className="h-auto max-w-full justify-start p-0 text-left text-xs text-slate-600">
                          <span className="truncate">{item.admin_note}</span>
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-80 text-sm">
                        <div className="mb-1 font-semibold text-slate-950">Poznámka administrátora</div>
                        <p className="text-slate-600">{item.admin_note}</p>
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <span className="text-xs text-slate-400">Bez poznámky</span>
                  )}
                </TableCell>
                <TableCell className="px-5 text-right">
                  <Popover open={selectedAuditPayout === item.id} onOpenChange={(open) => setSelectedAuditPayout(open ? item.id : null)}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950" title="Historie schválení">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 p-0" align="end">
                      <div className="flex items-center gap-2 border-b bg-slate-50 p-4 font-semibold text-slate-950">
                        <Eye className="h-4 w-4 text-primary" />
                        Historie schválení
                      </div>
                      <div className="max-h-[300px] overflow-y-auto p-4">
                        <PayoutApprovalAuditLog payoutId={item.id} />
                      </div>
                    </PopoverContent>
                  </Popover>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </PayoutPanel>
  );
};

export default PayoutTable;
