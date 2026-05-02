import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { sendHourlyPayoutPaidEmail } from '@/lib/email';
import { updateHourlyPayoutRequestStatus } from '@/lib/hourlyPayoutService';
import { logPayoutAction } from '@/lib/payoutLogger';
import { approveHourlyPayoutRequest } from '@/lib/PayoutApprovalService';
import { downloadInvoiceFromStorage } from '@/lib/downloadInvoiceFromStorage';
import { auditInvoiceUrls } from '@/lib/invoiceAudit';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { CheckCircle, XCircle, Clock, DollarSign, Wallet, Loader2, FileText, FileWarning, Eye, Download, Search } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import HourlyPayoutRequestDialog from './HourlyPayoutRequestDialog';
import AdminHourlyPayoutApprovalDialog from './AdminHourlyPayoutApprovalDialog';
import HourlyPayoutApprovalAuditLog from './HourlyPayoutApprovalAuditLog';

const getStatusBadge = (status) => {
  switch (status) {
    case 'pending': return <Badge variant="warning" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100 border-none"><Clock className="w-3 h-3 mr-1"/> Čeká</Badge>;
    case 'approved': return <Badge variant="success" className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 border-none"><CheckCircle className="w-3 h-3 mr-1"/> Schváleno</Badge>;
    case 'paid': return <Badge variant="info" className="bg-blue-100 text-blue-800 hover:bg-blue-100 border-none"><DollarSign className="w-3 h-3 mr-1"/> Vyplaceno</Badge>;
    case 'rejected': return <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1"/> Zamítnuto</Badge>;
    default: return <Badge variant="secondary">{status}</Badge>;
  }
};

const InvoiceLink = ({ url, onDownload, isDownloading }) => {
    useEffect(() => {
        if (url) {
            console.log('[AdminInvoiceLink] Loaded with URL:', url);
        }
    }, [url]);

    if (!url) return <span className="text-slate-400 text-xs italic">Není nahrána</span>;

    return (
        <div className="flex flex-col gap-1">
            <Button 
                variant="outline"
                size="sm"
                onClick={() => onDownload(url)} 
                disabled={isDownloading}
                className="flex items-center gap-1 h-7 text-sm text-blue-600 hover:text-blue-800 font-medium bg-blue-50 border-blue-200 px-2 py-1 rounded-md transition-colors cursor-pointer w-fit"
                title="Kliknutím stáhnete fakturu"
            >
                {isDownloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {isDownloading ? 'Stahuji...' : 'Stáhnout'}
            </Button>
            <span className="text-[9px] text-slate-400 font-mono break-all max-w-[150px] truncate" title={url}>
                {url}
            </span>
        </div>
    );
};

const HourlyPayoutRequestsAdmin = () => {
  const { toast } = useToast();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
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
      // FIXED: Explicit foreign key relationship for hourly payout requests
      const { data, error } = await supabase
        .from('hourly_payout_requests')
        .select(`
          *,
          members:members!hourly_payout_requests_member_id_fkey(name, email, auth_user_id),
          projects(name)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setRequests(data || []);
      console.log('[Admin] Fetched requests:', data);
    } catch (error) {
      console.error("Error fetching requests:", error);
      toast({ title: "Chyba", description: "Nepodařilo se načíst žádosti.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
    const channel = supabase.channel('hourly_admin_changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'hourly_payout_requests' }, fetchRequests)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleDownloadInvoice = async (invoiceUrl) => {
    if (!invoiceUrl) return;
    console.log('[Admin] Admin clicked download invoice. URL:', invoiceUrl);
    setDownloadingInvoiceUrl(invoiceUrl);
    
    const { success, error } = await downloadInvoiceFromStorage(invoiceUrl);
    
    if (success) {
        console.log('[Admin] Download successful for URL:', invoiceUrl);
        toast({ title: "Staženo", description: "Soubor byl úspěšně stažen." });
    } else {
        console.error('[Admin] Download error:', error);
        toast({ 
            title: "Chyba stahování", 
            description: error || "Nepodařilo se stáhnout soubor.", 
            variant: "destructive" 
        });
    }
    
    setDownloadingInvoiceUrl(null);
  };

  const openApprovalDialog = (request) => {
    setApprovalRequest(request);
    setIsApprovalDialogOpen(true);
  };

  const handleApproveConfirm = async (requestId, adminNote, approvedWithoutInvoice) => {
    setProcessingId(requestId);
    
    const result = await approveHourlyPayoutRequest(requestId, adminNote, approvedWithoutInvoice);
    
    if (result.success) {
      toast({ 
          title: "Schváleno", 
          description: "Žádost byla úspěšně schválena." 
      });
      fetchRequests();
    } else {
      toast({ 
          title: "Chyba", 
          description: `Nepodařilo se schválit žádost: ${result.error}`, 
          variant: "destructive" 
      });
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

    const { success, error } = await updateHourlyPayoutRequestStatus(selectedRequest.id, 'rejected', reason, selectedRequest);
    setProcessingId(null);
    setIsRejectDialogOpen(false);
    setSelectedRequest(null);

    if (success) {
      await logPayoutAction('reject_success', selectedRequest?.id);
      toast({ title: "Zamítnuto", description: "Žádost byla zamítnuta." });
      fetchRequests();
    } else {
      await logPayoutAction('reject_failure', selectedRequest?.id, { error });
      toast({ title: "Chyba", description: error, variant: "destructive" });
    }
  };

  const handleMarkAsPaid = async (request) => {
      const canMarkAsPaid = request.invoice_url || request.approved_without_invoice;
      
      if (!canMarkAsPaid) {
          toast({ title: "Chybí faktura", description: "Nelze označit jako vyplacené bez nahrané faktury nebo schválení bez faktury.", variant: "warning" });
          return;
      }

      setProcessingId(request.id);
      await logPayoutAction('mark_paid_attempt', request.id);

      try {
          const paidDate = new Date().toISOString();
          
          const { data, error: dbError } = await supabase
            .from('hourly_payout_requests')
            .update({ status: 'paid', paid_at: paidDate, updated_at: paidDate })
            .eq('id', request.id)
            .select();
            
          if (dbError) throw dbError;

          console.log(`[HourlyPayoutRequestsAdmin] Marked request ${request.id} as paid.`, data);

          await sendHourlyPayoutPaidEmail({
              email: request.members?.email,
              memberName: request.members?.name || 'Pracovník',
              amount: request.total_amount,
              hours: request.hours,
              paidAt: paidDate
          });

          await logPayoutAction('mark_paid_success', request.id);
          toast({ title: "Vyplaceno", description: "Status změněn na vyplaceno a uživatel byl informován emailem." });
          fetchRequests(); 

      } catch (err) {
          console.error("[HourlyPayoutRequestsAdmin] Error marking as paid:", err);
          await logPayoutAction('mark_paid_failure', request.id, { error: err.message });
          toast({ title: "Chyba", description: "Nepodařilo se označit jako vyplacené.", variant: "destructive" });
      } finally {
          setProcessingId(null);
      }
  };
  
  const handleRunAudit = async () => {
      toast({ title: "Spouštím audit URL", description: "Sledujte konzoli pro výsledky." });
      const result = await auditInvoiceUrls();
      if (result.success) {
          toast({ 
              title: "Audit dokončen", 
              description: `Zkontrolováno ${result.total} URL. Varování: ${result.warnings}.`,
              variant: result.warnings > 0 ? "warning" : "default"
          });
      } else {
          toast({ title: "Chyba auditu", description: result.error, variant: "destructive" });
      }
  };

  const filteredRequests = requests.filter(req => statusFilter === 'all' ? true : req.status === statusFilter);

  return (
    <div className="space-y-6">
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="bg-slate-50/50 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 py-4 px-6">
          <div className="flex items-center gap-4">
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                  <Wallet className="w-5 h-5 text-primary" />
                  Správa hodinových žádostí
              </CardTitle>
              <CardDescription>Přehled a schvalování žádostí a přijatých faktur.</CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-3">
             <Button variant="outline" size="sm" onClick={handleRunAudit} className="gap-2 bg-white">
                <Search className="w-4 h-4 text-slate-500" />
                Audit DB URL
             </Button>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[200px] bg-white">
                <SelectValue placeholder="Filtr stavu" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Všechny žádosti</SelectItem>
                <SelectItem value="pending">Čeká na schválení</SelectItem>
                <SelectItem value="approved">Schváleno (čeká na faktu/vyplacení)</SelectItem>
                <SelectItem value="paid">Vyplaceno</SelectItem>
                <SelectItem value="rejected">Zamítnuto</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-12 text-center text-muted-foreground flex flex-col items-center">
                <Loader2 className="w-8 h-8 animate-spin text-slate-300 mb-4" />
                Načítání...
            </div>
          ) : (
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="px-6">Datum</TableHead>
                  <TableHead>Pracovník</TableHead>
                  <TableHead>Projekt</TableHead>
                  <TableHead className="text-right">Hodiny / Celkem</TableHead>
                  <TableHead>Stav</TableHead>
                  <TableHead>Faktura / Poznámka</TableHead>
                  <TableHead className="text-right px-6">Akce</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRequests.length > 0 ? (
                  filteredRequests.map((req) => (
                    <TableRow key={req.id} className="hover:bg-slate-50/50">
                      <TableCell className="px-6 font-medium text-slate-600">
                        {format(new Date(req.created_at), 'dd. MM. yyyy')}
                      </TableCell>
                      <TableCell className="font-semibold text-slate-800">
                        {req.members?.name || 'Neznámý'}
                      </TableCell>
                      <TableCell className="text-slate-600 text-sm">
                        {req.payout_month && req.payout_year 
                            ? `Žádost za ${req.payout_month}/${req.payout_year}` 
                            : req.projects?.name || 'Měsíční žádost'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="text-xs text-muted-foreground">{Number(req.total_hours || req.hours).toFixed(1)} h x {req.hourly_rate} Kč</div>
                        <div className="font-bold text-slate-900">{Number(req.total_amount).toLocaleString('cs-CZ')} Kč</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1 items-start">
                          {getStatusBadge(req.status)}
                          {req.approved_without_invoice && (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] cursor-help px-1.5 py-0">
                                    <FileWarning className="w-2.5 h-2.5 mr-1" />
                                    Bez faktury
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent>Schváleno bez nutnosti faktury</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <InvoiceLink 
                              url={req.invoice_url} 
                              onDownload={handleDownloadInvoice}
                              isDownloading={downloadingInvoiceUrl === req.invoice_url}
                          />
                          {req.admin_note && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <span className="text-xs text-slate-600 truncate block cursor-pointer hover:text-primary hover:underline border-b border-dashed border-slate-300 w-fit pb-0.5 mt-1">
                                  Poznámka...
                                </span>
                              </PopoverTrigger>
                              <PopoverContent className="w-80 text-sm">
                                <div className="font-semibold mb-1 text-slate-800">Poznámka:</div>
                                <p className="text-slate-600">{req.admin_note}</p>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right px-6">
                        <div className="flex justify-end items-center gap-2">
                           <Popover open={selectedAuditRequest === req.id} onOpenChange={(open) => setSelectedAuditRequest(open ? req.id : null)}>
                              <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-primary" title="Historie schválení">
                                  <Eye className="w-4 h-4" />
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className="w-96 p-0" align="end">
                                 <div className="p-4 border-b bg-slate-50 font-semibold text-slate-800">Detail schválení</div>
                                 <div className="p-4 max-h-[300px] overflow-y-auto">
                                   <HourlyPayoutApprovalAuditLog requestId={req.id} />
                                 </div>
                              </PopoverContent>
                           </Popover>

                          {req.status === 'pending' && (
                            <>
                              <Button size="sm" variant="outline" className="bg-emerald-50 text-emerald-700 hover:bg-emerald-100" onClick={() => openApprovalDialog(req)} disabled={processingId === req.id}>
                                {processingId === req.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-1" />} Schválit
                              </Button>
                              <Button size="sm" variant="outline" className="bg-red-50 text-red-700 hover:bg-red-100" onClick={() => openRejectDialog(req)} disabled={processingId === req.id}>
                                <XCircle className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {req.status === 'approved' && (
                             <Button 
                               size="sm" 
                               variant="default"
                               onClick={() => handleMarkAsPaid(req)}
                               disabled={processingId === req.id || (!req.invoice_url && !req.approved_without_invoice)}
                               className={(!req.invoice_url && !req.approved_without_invoice) ? 'opacity-50 cursor-not-allowed' : ''}
                               title={(!req.invoice_url && !req.approved_without_invoice) ? "Čeká se na nahrání faktury uživatelem" : "Označit jako vyplacené"}
                             >
                               {processingId === req.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <DollarSign className="w-4 h-4 mr-1" />}
                               Vyplatit
                             </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={7} className="h-32 text-center text-muted-foreground">
                      Žádné žádosti neodpovídají filtru.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

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