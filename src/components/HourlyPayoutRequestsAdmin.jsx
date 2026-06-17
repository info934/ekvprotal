import React, { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import {
  AlertTriangle,
  CheckCircle,
  Download,
  Eye,
  FileWarning,
  Loader2,
  Search,
  Wallet,
  XCircle
} from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { sendHourlyPayoutPaidEmail, sendPayoutApprovalEmail } from '@/lib/email';
import { logPayoutAction } from '@/lib/payoutLogger';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import { auditInvoiceUrls } from '@/lib/invoiceAudit';
import {
  approveHourlyPayoutRequestWorkflow,
  getHourlyPayoutDiscrepancies,
  markHourlyPayoutPaid,
  rejectHourlyPayoutRequestWorkflow,
} from '@/lib/hourlyPayoutWorkflowService';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import HourlyPayoutRequestDialog from './HourlyPayoutRequestDialog';
import AdminHourlyPayoutApprovalDialog from './AdminHourlyPayoutApprovalDialog';
import HourlyPayoutApprovalAuditLog from './HourlyPayoutApprovalAuditLog';
import { sendAdminPayoutNotification } from '@/lib/payoutEmailService';
import {
  formatCurrency,
  formatHours,
  PayoutPanel,
  PayoutStatusBadge
} from '@/components/payouts/PayoutShared';
import PayoutRequestsTable from '@/components/payouts/PayoutRequestsTable';

const InvoiceLink = ({ url, onDownload, isDownloading }) => {
  if (!url) {
    return <span className="text-xs text-slate-400">Faktura zatím není nahraná</span>;
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => onDownload(url)}
      disabled={isDownloading}
      className="h-8 gap-2 border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100"
    >
      {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
      {isDownloading ? 'Stahuji...' : 'Stáhnout'}
    </Button>
  );
};

const requestTypeLabels = {
  regular: 'Běžná',
  supplement: 'Doplatek',
  correction: 'Oprava',
};

const HourlyPayoutRequestsAdmin = () => {
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [processingId, setProcessingId] = useState(null);
  const [selectedAuditRequest, setSelectedAuditRequest] = useState(null);
  const [downloadingInvoiceUrl, setDownloadingInvoiceUrl] = useState(null);

  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);

  const [isApprovalDialogOpen, setIsApprovalDialogOpen] = useState(false);
  const [approvalRequest, setApprovalRequest] = useState(null);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const [requestsResult, discrepancies] = await Promise.all([
        supabase
          .from('hourly_payout_requests')
          .select(`
            *,
            members:members!hourly_payout_requests_member_id_fkey(name, email, auth_user_id),
            projects(name)
          `)
          .order('created_at', { ascending: false }),
        getHourlyPayoutDiscrepancies().catch((error) => {
          console.warn('Hourly payout discrepancy load failed:', error);
          return [];
        })
      ]);

      const { data, error } = requestsResult;
      if (error) throw error;

      const discrepancyById = new Map(discrepancies.map((item) => [item.request_id, item]));
      setRequests((data || []).map((request) => ({
        ...request,
        discrepancy: discrepancyById.get(request.id) || null,
      })));
    } catch (error) {
      console.error('Error fetching hourly payout requests:', error);
      toast({ title: 'Chyba', description: 'Nepodařilo se načíst hodinové žádosti.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    const channel = supabase
      .channel('hourly_admin_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_payout_requests' }, fetchRequests)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const filteredRequests = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return requests.filter((request) => {
      const statusMatches = statusFilter === 'all' || request.status === statusFilter;
      const searchMatches =
        !normalizedSearch ||
        request.members?.name?.toLowerCase().includes(normalizedSearch) ||
        request.projects?.name?.toLowerCase().includes(normalizedSearch) ||
        `${request.payout_month || ''}/${request.payout_year || ''}`.includes(normalizedSearch);

      return statusMatches && searchMatches;
    });
  }, [requests, searchTerm, statusFilter]);

  const handleDownloadInvoice = async (invoiceUrl) => {
    if (!invoiceUrl) return;
    setDownloadingInvoiceUrl(invoiceUrl);

    const { success, error } = await downloadInvoiceFromStorage(invoiceUrl);
    if (success) {
      toast({ title: 'Staženo', description: 'Soubor faktury byl stažen.' });
    } else {
      toast({ title: 'Chyba stahování', description: error || 'Nepodařilo se stáhnout fakturu.', variant: 'destructive' });
    }

    setDownloadingInvoiceUrl(null);
  };

  const openApprovalDialog = (request) => {
    setApprovalRequest(request);
    setIsApprovalDialogOpen(true);
  };

  const handleApproveConfirm = async (requestId, adminNote, approvedWithoutInvoice) => {
    setProcessingId(requestId);

    try {
      const approvedRequest = await approveHourlyPayoutRequestWorkflow(requestId, adminNote, approvedWithoutInvoice);
      const memberName = approvalRequest?.members?.name || 'Pracovník';
      const amount = approvedRequest?.total_amount || approvalRequest?.total_amount || 0;
      const memberEmailResult = await sendPayoutApprovalEmail({
        memberId: approvalRequest?.member_id,
        amount,
        approved_without_invoice: approvedWithoutInvoice
      });
      const adminEmailResult = await sendAdminPayoutNotification({
        memberName,
        amount,
        action: 'Schválení hodinové žádosti'
      });

      if (!memberEmailResult.success || !adminEmailResult.success) {
        toast({
          title: 'Notifikace se nepodařilo odeslat',
          description: 'Žádost byla schválena, ale emailový krok selhal.',
          variant: 'warning'
        });
      } else {
        toast({ title: 'Schváleno', description: 'Hodinová žádost byla schválena.' });
      }
      fetchRequests();
    } catch (error) {
      toast({ title: 'Chyba', description: `Nepodařilo se schválit žádost: ${error.message}`, variant: 'destructive' });
    }

    setProcessingId(null);
    setIsApprovalDialogOpen(false);
    setApprovalRequest(null);
  };

  const openRejectDialog = (request) => {
    setSelectedRequest(request);
    setIsRejectDialogOpen(true);
  };

  const handleRejectConfirm = async (reason) => {
    if (!selectedRequest) return;
    setProcessingId(selectedRequest.id);
    await logPayoutAction('reject_attempt', selectedRequest.id, { reason });

    try {
      await rejectHourlyPayoutRequestWorkflow(selectedRequest.id, reason);
      await logPayoutAction('reject_success', selectedRequest.id);
      toast({ title: 'Zamítnuto', description: 'Hodinová žádost byla zamítnuta.' });
      fetchRequests();
    } catch (error) {
      await logPayoutAction('reject_failure', selectedRequest.id, { error: error.message });
      toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
    } finally {
      setProcessingId(null);
      setIsRejectDialogOpen(false);
      setSelectedRequest(null);
    }
  };

  const handleMarkAsPaid = async (request) => {
    const canMarkAsPaid = request.invoice_url || request.approved_without_invoice;

    if (!canMarkAsPaid) {
      toast({
        title: 'Chybí faktura',
        description: 'Nelze označit jako vyplacené bez nahrané faktury nebo schválení bez faktury.',
        variant: 'warning'
      });
      return;
    }

    setProcessingId(request.id);
    await logPayoutAction('mark_paid_attempt', request.id);

    try {
      const paidRequest = await markHourlyPayoutPaid(request.id);
      const paidDate = paidRequest?.paid_at || new Date().toISOString();

      await sendHourlyPayoutPaidEmail({
        email: request.members?.email,
        memberName: request.members?.name || 'Pracovník',
        amount: paidRequest?.total_amount || request.total_amount,
        hours: paidRequest?.total_hours || paidRequest?.hours || request.total_hours || request.hours,
        paidAt: paidDate
      });

      await logPayoutAction('mark_paid_success', request.id);
      toast({ title: 'Vyplaceno', description: 'Žádost byla uzavřena a zaměstnanec byl informován emailem.' });
      fetchRequests();
    } catch (err) {
      console.error('Error marking hourly payout as paid:', err);
      await logPayoutAction('mark_paid_failure', request.id, { error: err.message });
      toast({ title: 'Chyba', description: 'Nepodařilo se označit žádost jako vyplacenou.', variant: 'destructive' });
    } finally {
      setProcessingId(null);
    }
  };

  const handleRunAudit = async () => {
    toast({ title: 'Spouštím audit URL', description: 'Kontroluji cesty faktur v databázi.' });
    const result = await auditInvoiceUrls();
    if (result.success) {
      toast({
        title: 'Audit dokončen',
        description: `Zkontrolováno ${result.total} URL. Varování: ${result.warnings}.`,
        variant: result.warnings > 0 ? 'warning' : 'default'
      });
    } else {
      toast({ title: 'Chyba auditu', description: result.error, variant: 'destructive' });
    }
  };

  const columns = [
    {
      key: 'date',
      header: 'Datum',
      headerClassName: 'h-11 px-5 text-xs font-bold uppercase tracking-wide text-slate-500',
      cellClassName: 'px-5 font-medium text-slate-600',
      render: (request) => format(new Date(request.created_at), 'dd. MM. yyyy', { locale: cs }),
    },
    {
      key: 'worker',
      header: 'Pracovník',
      render: (request) => (
        <>
          <div className="font-semibold text-slate-950">{request.members?.name || 'Neznámý pracovník'}</div>
          {request.members?.email && <div className="text-xs text-slate-500">{request.members.email}</div>}
        </>
      ),
    },
    {
      key: 'period',
      header: 'Období / projekt',
      cellClassName: 'text-sm text-slate-600',
      render: (request) => request.payout_month && request.payout_year
        ? `Žádost za ${request.payout_month}/${request.payout_year}`
        : request.projects?.name || 'Měsíční žádost',
    },
    {
      key: 'hours',
      header: 'Hodiny',
      headerClassName: 'h-11 text-right text-xs font-bold uppercase tracking-wide text-slate-500',
      cellClassName: 'text-right',
      render: (request) => (
        <>
          <div className="font-semibold tabular-nums text-slate-950">{formatHours(request.total_hours || request.hours)}</div>
          <div className="text-xs text-slate-500">{formatCurrency(request.hourly_rate)}/h</div>
        </>
      ),
    },
    {
      key: 'amount',
      header: 'Celkem',
      headerClassName: 'h-11 text-right text-xs font-bold uppercase tracking-wide text-slate-500',
      cellClassName: 'text-right font-bold tabular-nums text-slate-950',
      render: (request) => formatCurrency(request.total_amount),
    },
    {
      key: 'status',
      header: 'Stav',
      render: (request) => (
        <div className="flex flex-col items-start gap-1">
          <PayoutStatusBadge status={request.status} />
          <Badge variant="outline" className="h-7 rounded-full border-slate-200 bg-slate-50 px-2.5 text-slate-600">
            {requestTypeLabels[request.request_type] || 'Běžná'}
          </Badge>
          {request.discrepancy?.has_discrepancy && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="h-7 cursor-help gap-1.5 rounded-full border-red-200 bg-red-50 px-2.5 text-red-700">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    Nesoulad
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>
                  Snapshot {formatHours(request.discrepancy.snapshot_total_hours)} / aktuálně {formatHours(request.discrepancy.current_total_hours)}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
          {request.approved_without_invoice && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Badge variant="outline" className="h-7 cursor-help gap-1.5 rounded-full border-amber-200 bg-amber-50 px-2.5 text-amber-700">
                    <FileWarning className="h-3.5 w-3.5" />
                    Bez faktury
                  </Badge>
                </TooltipTrigger>
                <TooltipContent>Schváleno bez nutnosti faktury</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      ),
    },
    {
      key: 'invoice',
      header: 'Faktura',
      render: (request) => (
        <div className="space-y-2">
          <InvoiceLink
            url={request.invoice_url}
            onDownload={handleDownloadInvoice}
            isDownloading={downloadingInvoiceUrl === request.invoice_url}
          />
          {request.admin_note && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="link" className="h-auto p-0 text-xs text-slate-600">Poznámka administrátora</Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 text-sm">
                <div className="mb-1 font-semibold text-slate-950">Poznámka</div>
                <p className="text-slate-600">{request.admin_note}</p>
              </PopoverContent>
            </Popover>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Akce',
      headerClassName: 'h-11 px-5 text-right text-xs font-bold uppercase tracking-wide text-slate-500',
      cellClassName: 'px-5 text-right',
      render: (request) => (
        <div className="flex items-center justify-end gap-2">
          <Popover open={selectedAuditRequest === request.id} onOpenChange={(open) => setSelectedAuditRequest(open ? request.id : null)}>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:bg-slate-100 hover:text-slate-950" title="Historie schválení">
                <Eye className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-96 p-0" align="end">
              <div className="border-b bg-slate-50 p-4 font-semibold text-slate-950">Detail schválení</div>
              <div className="max-h-[300px] overflow-y-auto p-4">
                <HourlyPayoutApprovalAuditLog requestId={request.id} />
              </div>
            </PopoverContent>
          </Popover>

          {request.status === 'pending' && (
            <>
              <Button size="sm" variant="outline" className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" onClick={() => openApprovalDialog(request)} disabled={processingId === request.id}>
                {processingId === request.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="mr-1 h-4 w-4" />}
                Schválit
              </Button>
              <Button size="icon" variant="outline" className="h-8 w-8 border-red-200 bg-red-50 text-red-700 hover:bg-red-100" onClick={() => openRejectDialog(request)} disabled={processingId === request.id}>
                <XCircle className="h-4 w-4" />
              </Button>
            </>
          )}
          {['approved', 'invoice_uploaded'].includes(request.status) && (
            <Button
              size="sm"
              onClick={() => handleMarkAsPaid(request)}
              disabled={processingId === request.id || (!request.invoice_url && !request.approved_without_invoice)}
              className="bg-emerald-600 text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {processingId === request.id ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Wallet className="mr-1 h-4 w-4" />}
              Vyplatit
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PayoutPanel
        title="Schvalování hodinové mzdy"
        description="Stejný princip jako u úkolových výplat: schválení, faktura, vyplacení."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={handleRunAudit} className="gap-2 bg-white">
              <Search className="h-4 w-4 text-slate-500" />
              Audit URL
            </Button>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full bg-white sm:w-[220px]">
                <SelectValue placeholder="Filtr stavu" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechny žádosti</SelectItem>
                <SelectItem value="pending">Čeká na schválení</SelectItem>
                <SelectItem value="approved">Čeká na fakturu</SelectItem>
                <SelectItem value="invoice_uploaded">Faktura nahrána</SelectItem>
                <SelectItem value="paid">Vyplaceno</SelectItem>
                <SelectItem value="rejected">Zamítnuto</SelectItem>
              </SelectContent>
            </Select>
          </>
        }
      >
        <div className="border-b border-slate-200 p-4">
          <div className="relative max-w-md">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Hledat pracovníka, projekt nebo období..."
              className="pl-9"
            />
          </div>
        </div>

        <PayoutRequestsTable
          columns={columns}
          emptyDescription="Aktuální filtry nevrátily žádný záznam."
          emptyTitle="Žádné hodinové žádosti"
          getRowKey={(request) => request.id}
          items={filteredRequests}
          loading={loading}
          loadingLabel="Načítám hodinové žádosti..."
        />
      </PayoutPanel>

      <AdminHourlyPayoutApprovalDialog
        isOpen={isApprovalDialogOpen}
        onClose={() => setIsApprovalDialogOpen(false)}
        request={approvalRequest}
        onConfirm={handleApproveConfirm}
      />

      <HourlyPayoutRequestDialog
        isOpen={isRejectDialogOpen}
        onClose={() => setIsRejectDialogOpen(false)}
        onConfirm={handleRejectConfirm}
        isSubmitting={processingId !== null}
      />
    </div>
  );
};

export default HourlyPayoutRequestsAdmin;
