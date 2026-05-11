import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { FileText, Clock, CheckCircle2, AlertTriangle, FileWarning, Eye, MoreHorizontal } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import PayoutApprovalAuditLog from './PayoutApprovalAuditLog';

const statusBadgeClass = {
  pending: 'bg-amber-50 text-amber-700 border-amber-200',
  approved: 'bg-blue-50 text-blue-700 border-blue-200',
  invoice_uploaded: 'bg-slate-100 text-slate-700 border-slate-200',
  paid: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-700 border-red-200'
};

const getStatusBadge = (status) => {
  const config = {
    pending: { label: 'Čeká na schválení', icon: Clock },
    approved: { label: 'Čeká na fakturu', icon: FileText },
    invoice_uploaded: { label: 'Faktura nahrána', icon: FileText },
    paid: { label: 'Vyplaceno', icon: CheckCircle2 },
    rejected: { label: 'Zamítnuto', icon: AlertTriangle }
  }[status] || { label: status || 'Neznámý stav', icon: AlertTriangle };

  const Icon = config.icon;

  return (
    <Badge variant="outline" className={`h-7 gap-1.5 rounded-full px-2.5 font-semibold ${statusBadgeClass[status] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </Badge>
  );
};

const PayoutTable = ({ data, loading }) => {
  const [selectedAuditPayout, setSelectedAuditPayout] = useState(null);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-slate-500 shadow-sm">
        Načítání historie...
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500 shadow-sm">
        Zatím nebyly podány žádné žádosti o výplatu.
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-white px-5 py-4">
        <div className="text-sm font-semibold text-slate-900">Historie úkolových výplat</div>
        <div className="text-xs text-slate-500">Stejný workflow jako u hodinové mzdy: schválení, faktura, vyplacení.</div>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow className="border-slate-200">
              <TableHead className="h-11 px-5 text-xs font-bold uppercase tracking-wide text-slate-500">Datum</TableHead>
              <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Pracovník</TableHead>
              <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Částka</TableHead>
              <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Stav</TableHead>
              <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Poznámka</TableHead>
              <TableHead className="h-11 px-5 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Akce</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((item) => (
              <TableRow key={item.id} className="border-slate-100 hover:bg-slate-50/70">
                <TableCell className="px-5 font-medium text-slate-600">
                  {format(new Date(item.created_at || item.request_date), 'dd. MM. yyyy')}
                </TableCell>
                <TableCell>
                  <div className="font-semibold text-slate-900">{item.members?.name || 'Neznámý'}</div>
                  {item.projects?.name && <div className="mt-0.5 text-xs text-slate-500">{item.projects.name}</div>}
                </TableCell>
                <TableCell>
                  <div className="font-bold tabular-nums text-slate-900">
                    {Number(item.total_amount || item.amount || 0).toLocaleString('cs-CZ')} Kč
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap items-center gap-2">
                    {getStatusBadge(item.status)}
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
                        <div className="mb-1 font-semibold text-slate-900">Poznámka administrátora</div>
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
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-900" title="Historie schválení">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 p-0" align="end">
                      <div className="flex items-center gap-2 border-b bg-slate-50 p-4 font-semibold text-slate-900">
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
    </div>
  );
};

export default PayoutTable;
