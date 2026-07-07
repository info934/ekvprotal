import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  CheckCircle, XCircle, Clock, Eye,
  Search, Filter, User,
  FileText, RotateCcw
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useDebouncedValue } from '@/hooks/useDebounce';
import { format, parseISO, startOfMonth, endOfMonth } from 'date-fns';
import { cs } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { sendEmail } from '@/lib/email';
import {
  approveAttendanceSubmission,
  rejectAttendanceSubmission,
  revertAttendanceSubmission,
} from '@/lib/attendanceWorkflowService';
import { DataVizMetricCard } from '@/components/ui/data-viz';

// --- Memoized Components ---
const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const buildAttendanceApprovalEmail = ({ submission, records }) => {
  const monthLabel = format(parseISO(submission.month_date), 'LLLL yyyy', { locale: cs });
  const detailRows = records.map((record) => {
    const target = record.project?.code
      ?`${record.project.code} - ${record.project.name}`
      : (record.realization?.name || '-');

    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eef2f7;">${format(new Date(record.date), 'dd.MM.yyyy')}</td>
        <td style="padding:8px;border-bottom:1px solid #eef2f7;">${escapeHtml(target)}</td>
        <td style="padding:8px;border-bottom:1px solid #eef2f7;">${escapeHtml(record.description || '')}</td>
        <td style="padding:8px;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;">${Number(record.hours || 0).toFixed(1)} h</td>
      </tr>
    `;
  }).join('');

  return `
    <p>Vaše docházka za období <strong>${monthLabel}</strong> byla schválena.</p>

    <div style="margin:18px 0;padding:16px;border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4;">
      <div style="font-size:12px;color:#166534;font-weight:700;text-transform:uppercase;">Schválený souhrn</div>
      <div style="font-size:26px;font-weight:800;color:#14532d;margin-top:6px;">${Number(submission.total_hours || 0).toFixed(1)} h</div>
    </div>

    <h3 style="margin:22px 0 8px;">Detail záznamů</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Datum</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Projekt / Realizace</th>
          <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Popis</th>
          <th style="padding:8px;text-align:right;border-bottom:1px solid #cbd5e1;">Hodiny</th>
        </tr>
      </thead>
      <tbody>${detailRows || '<tr><td colspan="4" style="padding:10px;color:#64748b;">Bez detailních záznamů.</td></tr>'}</tbody>
    </table>

    <p style="margin-top:20px;color:#64748b;font-size:13px;">Schválená docházka je nyní uzavřená pro další zpracování hodinové mzdy.</p>
  `;
};

const StatusBadge = React.memo(({ status }) => {
  const config = {
    submitted: { label: 'Ke schválení', icon: Clock, variant: 'warning', className: 'bg-orange-100 text-orange-800 border-orange-200' },
    approved: { label: 'Schváleno', icon: CheckCircle, variant: 'success', className: 'bg-green-100 text-green-800 border-green-200' },
    rejected: { label: 'Zamítnuto', icon: XCircle, variant: 'destructive', className: 'bg-red-100 text-red-800 border-red-200' },
    draft: { label: 'Koncept', icon: FileText, variant: 'secondary', className: 'bg-gray-100 text-gray-800 border-gray-200' }
  };

  const current = config[status] || config.draft;
  const Icon = current.icon;

  return (
    <Badge variant="outline" className={cn("inline-flex max-w-full items-center gap-1 whitespace-nowrap font-semibold", current.className)}>
      <Icon className="h-3 w-3 shrink-0" />
      <span className="truncate">{current.label}</span>
    </Badge>
  );
});

StatusBadge.displayName = 'StatusBadge';

const StatCard = ({ label, value, icon: Icon, tone }) => (
  <DataVizMetricCard icon={Icon} label={label} value={value} tone={tone} />
);

const SubmissionCard = React.memo(({ submission, onDetail, onApprove, onReject, onRevert, showActions }) => {
  const memberName = submission.member?.name || 'Neznámý uživatel';
  const monthLabel = format(parseISO(submission.month_date), 'LLLL yyyy', { locale: cs });
  const totalHours = Number(submission.total_hours).toFixed(1);
  const submittedDate = submission.submitted_at ?format(parseISO(submission.submitted_at), 'd.M.yyyy HH:mm') : '-';

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition-all hover:border-primary/25 hover:shadow-md">
      <div className="flex min-h-[128px] flex-col justify-between">
        <div className="mb-2 flex min-w-0 flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-blue-50 text-blue-600">
              <User className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h4 className="truncate font-semibold text-slate-950">{memberName}</h4>
              <p className="truncate text-xs capitalize text-muted-foreground">{monthLabel}</p>
            </div>
          </div>
          <StatusBadge status={submission.status} />
        </div>

        <div className="my-3 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
          <div className="min-w-0 rounded border border-slate-100 bg-slate-50 p-2">
            <span className="text-muted-foreground block text-xs">Celkem hodin</span>
            <span className="text-lg font-bold text-slate-800">{totalHours} h</span>
          </div>
          <div className="min-w-0 rounded border border-slate-100 bg-slate-50 p-2">
            <span className="text-muted-foreground block text-xs">Odesláno</span>
            <span className="block truncate font-medium text-slate-800">{submittedDate}</span>
          </div>
        </div>

        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-2">
          <Button variant="ghost" size="sm" onClick={() => onDetail(submission)} className="text-blue-600 hover:bg-blue-50 hover:text-blue-700">
            <Eye className="mr-2 h-4 w-4" /> Detail
          </Button>
          
          {showActions && submission.status === 'submitted' && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => onReject(submission)} className="border-red-100 text-red-600 hover:bg-red-50 hover:text-red-700">
                <XCircle className="mr-2 h-4 w-4" />
                Zamítnout
              </Button>
              <Button size="sm" variant="outline" onClick={() => onApprove(submission)} className="border-emerald-100 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700">
                <CheckCircle className="mr-2 h-4 w-4" />
                Schválit
              </Button>
            </div>
          )}
          
          {showActions && submission.status !== 'submitted' && submission.status !== 'draft' && (
             <Button size="sm" variant="outline" onClick={() => onRevert(submission)} className="border-orange-100 text-orange-600 hover:bg-orange-50 hover:text-orange-700" title="Vrátit do zpracování">
                <RotateCcw className="mr-2 h-4 w-4" />
                Vrátit
             </Button>
          )}
        </div>
      </div>
    </div>
  );
});

SubmissionCard.displayName = 'SubmissionCard';

const AttendanceSubmissionsOptimized = () => {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  
  // Data State
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // UI State
  const [filterStatus, setFilterStatus] = useState('submitted');
  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  
  // Dialog State
  const [detailSubmission, setDetailSubmission] = useState(null);
  const [detailRecords, setDetailRecords] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectDialog, setRejectDialog] = useState(null);
  const [rejectReason, setRejectReason] = useState('');

  const canAdmin = hasPermission('attendance', 'can_admin');

  // --- 4) Optimize Supabase query ---
  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('attendance_submissions')
        .select(`
          id, 
          status, 
          total_hours, 
          month_date, 
          submitted_at, 
          notes, 
          member_id,
          member:members!attendance_submissions_member_id_fkey(id, name, email)
        `)
        .order('submitted_at', { ascending: false });

      const { data, error } = await query;

      if (error) throw error;
      setSubmissions(data || []);
    } catch (error) {
      toast({ title: 'Chyba při načítání', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  // --- 2) Optimized useMemo for filtered submissions & stats ---
  const filteredSubmissions = useMemo(() => {
    return submissions.filter(sub => {
      const matchesStatus = filterStatus === 'all' || sub.status === filterStatus;
      const matchesSearch = debouncedSearchTerm === '' || 
        sub.member?.name?.toLowerCase().includes(debouncedSearchTerm.toLowerCase());
      return matchesStatus && matchesSearch;
    });
  }, [submissions, filterStatus, debouncedSearchTerm]);

  const stats = useMemo(() => {
    return submissions.reduce((acc, sub) => {
      acc.total++;
      if (sub.status === 'submitted') acc.pending++;
      if (sub.status === 'approved') acc.approved++;
      if (sub.status === 'rejected') acc.rejected++;
      return acc;
    }, { total: 0, pending: 0, approved: 0, rejected: 0 });
  }, [submissions]);

  // --- Detail Logic ---
  const fetchDetailRecords = useCallback(async (submission) => {
    setDetailLoading(true);
    const start = startOfMonth(parseISO(submission.month_date));
    const end = endOfMonth(start);
    
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('date, hours, description, project:projects(name, code), realization:realizations(name)')
        .eq('member_id', submission.member_id)
        .gte('date', format(start, 'yyyy-MM-dd'))
        .lte('date', format(end, 'yyyy-MM-dd'))
        .order('date');
        
      if (error) throw error;
      setDetailRecords(data || []);
    } catch (error) {
      toast({ title: 'Chyba detailu', description: error.message, variant: 'destructive' });
    } finally {
      setDetailLoading(false);
    }
  }, [toast]);

  const handleOpenDetail = useCallback((submission) => {
    setDetailSubmission(submission);
    fetchDetailRecords(submission);
  }, [fetchDetailRecords]);

  // --- 3) useCallback for actions ---
  const handleApprove = useCallback(async (submission) => {
    if (!canAdmin) return;
    try {
      await approveAttendanceSubmission(submission.id);

      toast({ title: 'Schváleno', className: 'bg-green-100 text-green-800' });
      fetchSubmissions();
      
      if (submission.member?.email) {
        try {
          const start = startOfMonth(parseISO(submission.month_date));
          const end = endOfMonth(start);
          const { data: approvedRecords, error: recordsError } = await supabase
            .from('attendance')
            .select('date, hours, description, project:projects(name, code), realization:realizations(name)')
            .eq('member_id', submission.member_id)
            .gte('date', format(start, 'yyyy-MM-dd'))
            .lte('date', format(end, 'yyyy-MM-dd'))
            .order('date');

          if (recordsError) throw recordsError;

          const { error: emailError } = await sendEmail({
            to: submission.member.email,
            subject: `Docházka schválena: ${format(parseISO(submission.month_date), 'LLLL yyyy', { locale: cs })}`,
            greeting: `Dobrý den, ${submission.member?.name || ''}`,
            content: buildAttendanceApprovalEmail({ submission, records: approvedRecords || [] }),
            salutation: 'S pozdravem,<br>EKV Portál'
          });

          if (emailError) throw emailError;
        } catch (emailError) {
          toast({
            title: 'Schváleno, ale email se nepodařilo odeslat',
            description: emailError.message,
            variant: 'warning'
          });
        }
      }
    } catch (error) {
      toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
    }
  }, [canAdmin, fetchSubmissions, toast]);

  const handleRejectConfirm = useCallback(async () => {
    if (!canAdmin || !rejectDialog) return;
    try {
      await rejectAttendanceSubmission(rejectDialog.id, rejectReason);

      toast({ title: 'Zamítnuto', description: 'Uživatel byl notifikován.' });
      setRejectDialog(null);
      setRejectReason('');
      fetchSubmissions();

      if (rejectDialog.member?.email) {
        await sendEmail({
          to: rejectDialog.member.email,
          subject: `Docházka ZAMÍTNUTA: ${format(parseISO(rejectDialog.month_date), 'LLLL yyyy', { locale: cs })}`,
          content: `<p>Vaše docházka byla zamítnuta.</p><p>Důvod: ${rejectReason}</p>`
        });
      }
    } catch (error) {
      toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
    }
  }, [canAdmin, rejectDialog, rejectReason, fetchSubmissions, toast]);

  const handleRevert = useCallback(async (submission) => {
    if (!canAdmin) return;
    try {
      await revertAttendanceSubmission(submission.id);
      toast({ title: 'Vráceno do schvalování' });
      fetchSubmissions();
    } catch (error) {
      toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
    }
  }, [canAdmin, fetchSubmissions, toast]);

  return (
    <div className="space-y-6">
      {/* Statistics */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Ke schválení" value={stats.pending} icon={Clock} tone="orange" />
        <StatCard label="Schváleno" value={stats.approved} icon={CheckCircle} tone="green" />
        <StatCard label="Zamítnuto" value={stats.rejected} icon={XCircle} tone="red" />
        <StatCard label="Celkem" value={stats.total} icon={FileText} tone="slate" />
      </div>

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-center">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input 
            placeholder="Hledat jméno..." 
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <Filter className="w-4 h-4 text-muted-foreground" />
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Filtr stavu" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Všechny stavy</SelectItem>
              <SelectItem value="submitted">Ke schválení</SelectItem>
              <SelectItem value="approved">Schváleno</SelectItem>
              <SelectItem value="rejected">Zamítnuto</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List */}
      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-2">
        {loading ?(
          <div className="flex min-h-[260px] items-center justify-center text-sm text-muted-foreground">
            <span className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-primary" />
            Načítání...
          </div>
        ) : filteredSubmissions.length > 0 ?(
          <div className="max-h-[620px] space-y-2 overflow-y-auto pr-1">
            {filteredSubmissions.map((submission) => (
              <SubmissionCard
                key={submission.id}
                submission={submission}
                onDetail={handleOpenDetail}
                onApprove={handleApprove}
                onReject={(s) => setRejectDialog(s)}
                onRevert={handleRevert}
                showActions={canAdmin}
              />
            ))}
          </div>
        ) : (
          <div className="flex min-h-[260px] flex-col items-center justify-center text-muted-foreground">
            <Search className="mb-2 h-12 w-12 opacity-20" />
            <p>Žádné záznamy k zobrazení</p>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detailSubmission} onOpenChange={(open) => !open && setDetailSubmission(null)}>
        <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] max-w-5xl flex-col overflow-hidden p-0">
          <DialogHeader className="border-b bg-slate-50/80 px-6 py-5 text-left">
            <DialogTitle>Detail docházky</DialogTitle>
            <DialogDescription>
              Kontrola měsíčního výkazu před schválením, zamítnutím nebo vrácením do schvalování.
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="grid gap-3 text-sm md:grid-cols-5">
              <div className="rounded-lg border border-slate-200 bg-white p-3 md:col-span-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pracovník</span>
                <p className="mt-1 truncate text-base font-bold text-slate-950">{detailSubmission?.member?.name || '-'}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Měsíc</span>
                <p className="mt-1 font-semibold capitalize text-slate-900">{detailSubmission && format(parseISO(detailSubmission.month_date), 'LLLL yyyy', { locale: cs })}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Celkem hodin</span>
                <p className="mt-1 text-lg font-bold text-slate-950">{detailSubmission ? Number(detailSubmission.total_hours).toFixed(1) : 0} h</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stav</span>
                <div className="mt-1"><StatusBadge status={detailSubmission?.status} /></div>
              </div>
            </div>

            {detailLoading ?(
              <p className="text-center py-4">Načítání detailů...</p>
            ) : detailRecords.length > 0 ?(
              <div className="space-y-2">
                <h4 className="font-semibold text-sm text-slate-700 sticky top-0 bg-white py-2">Denní záznamy</h4>
                {detailRecords.map((record, idx) => (
                  <div key={idx} className="flex flex-col gap-2 rounded-md border border-slate-100 bg-white p-3 text-sm sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium">{format(parseISO(record.date), 'd.M.yyyy')}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {record.project ? `${record.project.name} (${record.project.code})` : record.realization?.name || 'Bez přiřazení'}
                      </div>
                      {record.description && <div className="mt-0.5 break-words text-xs italic">{record.description}</div>}
                    </div>
                    <div className="shrink-0 font-bold">{Number(record.hours).toFixed(1)} h</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">Žádné záznamy v tomto měsíci.</p>
            )}
          </div>

          <DialogFooter className="border-t bg-white px-6 py-4">
            <Button variant="outline" onClick={() => setDetailSubmission(null)}>Zavřít</Button>
            {canAdmin && detailSubmission?.status === 'submitted' && (
              <>
                <Button variant="destructive" onClick={() => { setRejectDialog(detailSubmission); setDetailSubmission(null); }}>Zamítnout</Button>
                <Button onClick={() => { handleApprove(detailSubmission); setDetailSubmission(null); }} className="bg-green-600 hover:bg-green-700">Schválit</Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject Reason Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={(open) => !open && setRejectDialog(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Zamítnout docházku</DialogTitle>
            <DialogDescription>
              Zadejte důvod zamítnutí. Uživatel bude informován e-mailem.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Textarea 
              placeholder="Důvod zamítnutí..." 
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="min-h-[100px]"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejectDialog(null)}>Zrušit</Button>
            <Button variant="destructive" onClick={handleRejectConfirm} disabled={!rejectReason.trim()}>Zamítnout</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AttendanceSubmissionsOptimized;
