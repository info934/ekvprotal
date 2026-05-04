import React, { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { FileText, Clock, CheckCircle2, AlertTriangle, AlertCircle, FileWarning, Eye } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from '@/components/ui/button';
import PayoutApprovalAuditLog from './PayoutApprovalAuditLog';

const getStatusBadge = (status) => {
  switch (status) {
    case 'pending': return <Badge variant="warning" className="bg-amber-100 text-amber-800 border-none hover:bg-amber-100"><Clock className="w-3 h-3 mr-1"/> Čeká</Badge>;
    case 'approved': return <Badge variant="success" className="bg-blue-100 text-blue-800 border-none hover:bg-blue-100"><CheckCircle2 className="w-3 h-3 mr-1"/> Čeká na fakturu</Badge>;
    case 'invoice_uploaded': return <Badge variant="secondary" className="bg-slate-200 text-slate-800 border-none"><FileText className="w-3 h-3 mr-1"/> Faktura nahrána</Badge>;
    case 'paid': return <Badge variant="success" className="bg-emerald-100 text-emerald-800 border-none hover:bg-emerald-100"><CheckCircle2 className="w-3 h-3 mr-1"/> Vyplaceno</Badge>;
    case 'rejected': return <Badge variant="destructive" className="bg-red-100 text-red-800 border-none"><AlertTriangle className="w-3 h-3 mr-1"/> Zamítnuto</Badge>;
    default: return <Badge variant="outline">{status}</Badge>;
  }
};

const PayoutTable = ({ data, loading, onRefresh }) => {
  const [selectedAuditPayout, setSelectedAuditPayout] = useState(null);

  if (loading) {
    return <div className="p-8 text-center text-slate-500 animate-pulse">Načítání historie...</div>;
  }

  if (!data || data.length === 0) {
    return <div className="p-8 text-center text-slate-500 border rounded-lg bg-slate-50">Zatím nebyly podány žádné žádosti o výplatu.</div>;
  }

  return (
    <div className="rounded-md border border-slate-200 bg-white overflow-hidden shadow-sm">
      <Table>
        <TableHeader className="bg-slate-50">
          <TableRow>
            <TableHead>Datum</TableHead>
            <TableHead>Pracovník</TableHead>
            <TableHead>Částka</TableHead>
            <TableHead>Stav</TableHead>
            <TableHead>Poznámka / Detaily</TableHead>
            <TableHead>Historie</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => (
            <TableRow key={item.id} className="hover:bg-slate-50/50 transition-colors">
              <TableCell className="font-medium text-slate-600">
                {format(new Date(item.created_at || item.request_date), 'dd. MM. yyyy')}
              </TableCell>
              <TableCell>
                <div className="font-semibold text-slate-800">{item.members?.name || 'Neznámý'}</div>
                {item.projects?.name && <div className="text-xs text-slate-500">{item.projects.name}</div>}
              </TableCell>
              <TableCell>
                <div className="font-bold text-slate-900">
                  {Number(item.total_amount || item.amount || 0).toLocaleString('cs-CZ')} Kč
                </div>
              </TableCell>
              <TableCell>
                <div className="flex flex-col gap-2 items-start">
                  {getStatusBadge(item.status)}
                  {item.approved_without_invoice && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] cursor-help">
                            <FileWarning className="w-3 h-3 mr-1" />
                            Bez faktury
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          Tato výplata byla administrátorem schválena bez nutnosti přiložit fakturu.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              </TableCell>
              <TableCell className="max-w-[200px]">
                {item.admin_note ? (
                  <Popover>
                    <PopoverTrigger asChild>
                      <span className="text-xs text-slate-600 truncate block cursor-pointer hover:text-primary hover:underline border-b border-dashed border-slate-300 w-fit pb-0.5">
                        {item.admin_note}
                      </span>
                    </PopoverTrigger>
                    <PopoverContent className="w-80 text-sm">
                      <div className="font-semibold mb-1 text-slate-800">Poznámka administrátora:</div>
                      <p className="text-slate-600">{item.admin_note}</p>
                    </PopoverContent>
                  </Popover>
                ) : (
                  <span className="text-slate-400 text-xs">-</span>
                )}
              </TableCell>
              <TableCell>
                 <Popover open={selectedAuditPayout === item.id} onOpenChange={(open) => setSelectedAuditPayout(open ? item.id : null)}>
                    <PopoverTrigger asChild>
                      <Button variant="ghost" size="sm" className="h-8 text-slate-500 hover:text-primary">
                        <Eye className="w-4 h-4 mr-1.5" /> Logy
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-96 p-0" align="end">
                       <div className="p-4 border-b bg-slate-50 font-semibold text-slate-800 flex justify-between items-center">
                          Detail schválení
                       </div>
                       <div className="p-4 max-h-[300px] overflow-y-auto">
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
  );
};

export default PayoutTable;
