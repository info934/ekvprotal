import React, { useEffect, useMemo, useState } from 'react';
import { format, getMonth, getYear, startOfMonth } from 'date-fns';
import { cs } from 'date-fns/locale';
import { AlertCircle, CalendarDays, Clock, FileText, FileWarning, Search, Send, Trash2, Wallet } from 'lucide-react';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import InvoiceUpload from './InvoiceUpload';
import InvoicePreview from './InvoicePreview';
import DeletePayoutRequestDialog from './DeletePayoutRequestDialog';
import MonthSelector from './MonthSelector';
import HoursTable from './HoursTable';
import { auditInvoiceUrls } from '@/lib/invoiceAudit';
import { sendHourlyPayoutRequestEmail, sendPayoutRequestEmail } from '@/lib/email';
import { createHourlyPayoutRequest } from '@/lib/hourlyPayoutWorkflowService';
import {
  EmptyPayoutState,
  formatCurrency,
  formatHours,
  PayoutMetricCard,
  PayoutPanel,
  PayoutStatusBadge
} from '@/components/payouts/PayoutShared';

const HourlyPayoutRequest = ({ onPayoutRequested }) => {
  const { memberId } = useAuth();
  const { toast } = useToast();

  const [myRequests, setMyRequests] = useState([]);
  const [member, setMember] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(() => startOfMonth(new Date()).toISOString());
  const [monthData, setMonthData] = useState({ records: [], totalHours: 0, breakdown: {} });
  const [attendanceSubmission, setAttendanceSubmission] = useState(null);
  const [submissionLoading, setSubmissionLoading] = useState(false);
  const requestType = 'regular';
  const [ledgerSummary, setLedgerSummary] = useState({ hours: 0, amount: 0, weightedRate: 0 });
  const [deleteRequestId, setDeleteRequestId] = useState(null);
  const [isDeletingRequest, setIsDeletingRequest] = useState(false);

  const fetchBaseData = async () => {
    if (!memberId) return;
    setLoading(true);
    try {
      const [{ data: memberData }, { data: compensationData, error: compensationError }] = await Promise.all([
        supabase.from('members').select('id, name, email, attendance_enabled').eq('id', memberId).single(),
        supabase.rpc('get_member_compensation', { p_member_id: memberId }),
      ]);
      if (compensationError) throw compensationError;
      setMember({ ...memberData, ...compensationData });

      const { data: requestsData, error } = await supabase
        .from('hourly_payout_requests')
        .select('*, projects(name, code)')
        .eq('member_id', memberId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setMyRequests(requestsData || []);
    } catch (error) {
      console.error('Hourly payout request load failed:', error);
      toast({ title: 'Chyba načítání dat', description: 'Nepodařilo se načíst hodinové výplaty.', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBaseData();
  }, [memberId]);

  useEffect(() => {
    const fetchSubmission = async () => {
      if (!memberId || !selectedMonth) return;
      setSubmissionLoading(true);
      try {
        const monthDate = format(startOfMonth(new Date(selectedMonth)), 'yyyy-MM-dd');
        const [{ data, error }, ledgerResult] = await Promise.all([
          supabase
            .from('attendance_submissions')
            .select('id, status, total_hours, month_date')
            .eq('member_id', memberId)
            .eq('month_date', monthDate)
            .maybeSingle(),
          supabase
            .from('labor_cost_ledger')
            .select('hours, pay_amount')
            .eq('member_id', memberId)
            .eq('posting_month', monthDate)
            .eq('status', 'accrued'),
        ]);

        if (error) throw error;
        if (ledgerResult.error) throw ledgerResult.error;
        setAttendanceSubmission(data || null);
        const hours = (ledgerResult.data || []).reduce((sum, row) => sum + Number(row.hours || 0), 0);
        const amount = (ledgerResult.data || []).reduce((sum, row) => sum + Number(row.pay_amount || 0), 0);
        setLedgerSummary({ hours, amount, weightedRate: hours > 0 ? amount / hours : 0 });
      } catch (error) {
        console.error('Attendance submission load failed:', error);
        setAttendanceSubmission(null);
        setLedgerSummary({ hours: 0, amount: 0, weightedRate: 0 });
      } finally {
        setSubmissionLoading(false);
      }
    };

    fetchSubmission();
  }, [memberId, selectedMonth]);

  const grandTotalHours = ledgerSummary.hours || monthData.totalHours;
  const grandTotalAmount = ledgerSummary.amount;

  const requestStats = useMemo(() => {
    const active = myRequests.filter((request) => ['pending', 'approved', 'invoice_uploaded'].includes(request.status));
    const paid = myRequests.filter((request) => request.status === 'paid');
    return {
      active: active.length,
      paid: paid.length,
      activeAmount: active.reduce((sum, request) => sum + Number(request.total_amount || 0), 0),
      paidAmount: paid.reduce((sum, request) => sum + Number(request.total_amount || 0), 0)
    };
  }, [myRequests]);

  const handleRequestPayout = async () => {
    if (grandTotalHours <= 0) return;
    if (attendanceSubmission?.status !== 'approved') {
      toast({
        title: 'Docházka není schválená',
        description: 'Hodinovou žádost lze vytvořit až po schválení docházky za vybraný měsíc.',
        variant: 'warning'
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const targetDate = new Date(selectedMonth);
      const request = await createHourlyPayoutRequest({
        memberId,
        payoutMonth: getMonth(targetDate) + 1,
        payoutYear: getYear(targetDate),
        requestType,
      });

      const requestHours = Number(request?.total_hours || request?.hours || grandTotalHours);
      const requestAmount = Number(request?.total_amount || grandTotalAmount);
      const requestBreakdown = request?.breakdown || monthData.breakdown;

      try {
        await sendHourlyPayoutRequestEmail({
          memberName: member?.name || 'Neznámý pracovník',
          hours: requestHours,
          projects: Object.keys(requestBreakdown || {}).join(', ') || 'Všechny projekty',
          totalAmount: requestAmount,
          createdAt: new Date().toISOString()
        });

        await sendPayoutRequestEmail({ memberId, amount: requestAmount });
        toast({ title: 'Žádost odeslána', description: 'Žádost byla předána ke schválení a emaily byly odeslány.' });
      } catch (emailError) {
        console.error('Hourly payout notification failed:', emailError);
        toast({
          title: 'Žádost odeslána',
          description: 'Žádost byla vytvořena, ale emailová notifikace se nepodařila odeslat.',
          variant: 'warning'
        });
      }

      fetchBaseData();
      if (onPayoutRequested) onPayoutRequested();
    } catch (error) {
      console.error('Hourly payout request submit failed:', error);
      toast({ title: 'Chyba', description: 'Nepodařilo se odeslat žádost.', variant: 'destructive' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteRequest = async (id) => {
    setIsDeletingRequest(true);
    try {
      await supabase.from('hourly_payout_requests').delete().eq('id', id);
      toast({ title: 'Žádost byla smazána' });
      fetchBaseData();
      if (onPayoutRequested) onPayoutRequested();
    } catch (error) {
      toast({ title: 'Chyba mazání', description: 'Žádost se nepodařilo smazat.', variant: 'destructive' });
    } finally {
      setIsDeletingRequest(false);
      setDeleteRequestId(null);
    }
  };

  const handleRunAudit = async () => {
    const result = await auditInvoiceUrls();
    if (result.success) {
      toast({ title: 'Audit dokončen', variant: result.warnings > 0 ? 'warning' : 'default' });
    }
  };

  if (loading) {
    return (
      <PayoutPanel>
        <div className="flex flex-col items-center p-10 text-center text-slate-500">
          <Clock className="mb-4 h-8 w-8 animate-spin text-slate-300" />
          Načítám hodinovou mzdu...
        </div>
      </PayoutPanel>
    );
  }

  if (!member?.hourly_rate || member.hourly_rate <= 0) {
    return (
      <EmptyPayoutState
        icon={AlertCircle}
        title="Nemáte nastavenou hodinovou sazbu"
        description="Hodinovou žádost lze vytvořit až po nastavení sazby v profilu zaměstnance."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Můj aktuální měsíc</h2>
          <p className="mt-1 text-sm text-slate-600">Souhrn vybraného měsíce a stav mých hodinových žádostí.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <PayoutMetricCard icon={Clock} label="Hodiny v měsíci" value={formatHours(grandTotalHours)} detail="Dle vybraného období" tone="blue" />
          <PayoutMetricCard icon={Wallet} label="K žádosti za měsíc" value={formatCurrency(grandTotalAmount)} detail={`Vážená sazba ${formatCurrency(ledgerSummary.weightedRate)}/h`} tone="emerald" />
          <PayoutMetricCard icon={FileText} label="Moje aktivní žádosti" value={requestStats.active.toString()} detail={formatCurrency(requestStats.activeAmount)} tone="amber" />
          <PayoutMetricCard icon={Wallet} label="Mně vyplaceno" value={requestStats.paid.toString()} detail={formatCurrency(requestStats.paidAmount)} tone="slate" />
        </div>
      </div>

      <PayoutPanel
        title="Nová hodinová žádost"
        description="Vyberte měsíc, zkontrolujte docházku a odešlete žádost ke schválení."
        actions={
          member?.user_role === 'admin' && (
            <Button variant="outline" size="sm" onClick={handleRunAudit} className="gap-2 bg-white">
              <Search className="h-4 w-4" />
              Audit URL
            </Button>
          )
        }
      >
        <div className="grid gap-3 border-b border-slate-200 bg-slate-50/60 p-4 md:grid-cols-1 md:items-end">
          <MonthSelector value={selectedMonth} onChange={setSelectedMonth} />
        </div>
        <div className="space-y-5 p-5">
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-950">
              <CalendarDays className="h-4 w-4 text-slate-500" />
              Detail hodin
            </div>
            <HoursTable selectedMonth={selectedMonth} memberId={memberId} onDataFetched={setMonthData} />
          </div>
          {attendanceSubmission?.status !== 'approved' && (
            <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <div className="font-semibold">Vybraný měsíc není schválený</div>
                <div className="mt-0.5 text-amber-800">Hodinovou žádost lze odeslat až po schválení docházky.</div>
              </div>
            </div>
          )}
          <div className="flex justify-end border-t border-slate-100 pt-5">
            <Button onClick={handleRequestPayout} disabled={grandTotalHours <= 0 || grandTotalAmount <= 0 || isSubmitting || submissionLoading || attendanceSubmission?.status !== 'approved'} className="gap-2 shadow-sm">
              {isSubmitting ? <Clock className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Odeslat žádost
            </Button>
          </div>
        </div>
      </PayoutPanel>

      <PayoutPanel title="Moje hodinové žádosti" description="Přehled stavu, faktur a uzavřených výplat.">
        {myRequests.length === 0 ? (
          <div className="p-5">
            <EmptyPayoutState title="Zatím nemáte žádné žádosti" description="Po odeslání hodinové žádosti se její stav zobrazí zde." />
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {myRequests.map((request) => (
              <div key={request.id} className="grid gap-4 p-5 lg:grid-cols-[1fr_360px] lg:items-center">
                <div className="min-w-0 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-slate-500">{format(new Date(request.created_at), 'dd. MM. yyyy', { locale: cs })}</span>
                    <PayoutStatusBadge status={request.status} />
                    {request.approved_without_invoice && (
                      <Badge variant="outline" className="h-7 gap-1.5 rounded-full border-amber-200 bg-amber-50 px-2.5 text-amber-700">
                        <FileWarning className="h-3.5 w-3.5" />
                        Bez faktury
                      </Badge>
                    )}
                    <Badge variant="outline" className="h-7 rounded-full border-slate-200 bg-slate-50 px-2.5 text-slate-600">
                      {request.request_type === 'supplement' ? 'Doplatek' : request.request_type === 'correction' ? 'Oprava' : 'Běžná'}
                    </Badge>
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-slate-950">
                      {request.payout_month ? `Žádost za ${request.payout_month}/${request.payout_year}` : request.projects?.name || 'Měsíční žádost'}
                    </h3>
                    <div className="mt-1 flex flex-wrap gap-4 text-sm text-slate-600">
                      <span>{formatHours(request.total_hours || request.hours)}</span>
                      <span className="font-semibold text-slate-950">{formatCurrency(request.total_amount)}</span>
                    </div>
                  </div>
                  {request.status === 'rejected' && (
                    <Button variant="outline" size="sm" onClick={() => setDeleteRequestId(request.id)} className="gap-2">
                      <Trash2 className="h-4 w-4" />
                      Smazat zamítnutou žádost
                    </Button>
                  )}
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-4">
                  {request.status === 'approved' && !request.invoice_url && !request.approved_without_invoice && (
                    <InvoiceUpload
                      requestId={request.id}
                      memberId={memberId}
                      projectReference={request.projects?.code || request.project_id}
                      onUploadSuccess={() => fetchBaseData()}
                    />
                  )}
                  {request.invoice_url && (
                    <InvoicePreview
                      invoicePath={request.invoice_url}
                      invoiceName={request.invoice_storage_metadata?.originalFileName}
                      uploadedAt={request.invoice_uploaded_at}
                      status={request.status}
                      requestId={request.id}
                      storageProvider={request.invoice_storage_provider}
                      storageConnectionId={request.invoice_storage_connection_id}
                      externalFileId={request.invoice_external_file_id}
                      storageMetadata={request.invoice_storage_metadata}
                      onDelete={() => fetchBaseData()}
                    />
                  )}
                  {request.status !== 'approved' && !request.invoice_url && (
                    <div className="text-sm text-slate-500">Faktura se nahrává až po schválení žádosti.</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </PayoutPanel>

      <DeletePayoutRequestDialog
        isOpen={!!deleteRequestId}
        onClose={() => setDeleteRequestId(null)}
        onConfirm={handleDeleteRequest}
        requestId={deleteRequestId}
        isLoading={isDeletingRequest}
      />
    </div>
  );
};

export default HourlyPayoutRequest;
