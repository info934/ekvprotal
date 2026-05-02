import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FixedSizeList as List } from 'react-window';
import { 
  CheckCircle, XCircle, Clock, Eye, AlertTriangle, 
  Search, Filter, Calendar, User, ChevronRight,
  FileText, RotateCcw, Download, X
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

// --- Memoized Components ---

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
    <Badge variant="outline" className={cn("flex items-center gap-1", current.className)}>
      <Icon className="w-3 h-3" />
      {current.label}
    </Badge>
  );
});

StatusBadge.displayName = 'StatusBadge';

const SubmissionCard = React.memo(({ submission, style, onDetail, onApprove, onReject, onRevert, showActions }) => {
  const memberName = submission.member?.name || 'Neznámý uživatel';
  const monthLabel = format(parseISO(submission.month_date), 'LLLL yyyy', { locale: cs });
  const totalHours = Number(submission.total_hours).toFixed(1);
  const submittedDate = submission.submitted_at ? format(parseISO(submission.submitted_at), 'd.M.yyyy HH:mm') : '-';

  return (
    <div style={style} className="px-2 py-2">
      <div className="bg-white border rounded-lg p-4 hover:shadow-sm transition-all h-full flex flex-col justify-between">
        <div className="flex justify-between items-start mb-2">
          <div className="flex items-center gap-3">
            <div className="bg-blue-50 p-2 rounded-full">
              <User className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h4 className="font-semibold text-slate-900">{memberName}</h4>
              <p className="text-xs text-muted-foreground capitalize">{monthLabel}</p>
            </div>
          </div>
          <StatusBadge status={submission.status} />
        </div>

        <div className="grid grid-cols-2 gap-4 my-3 text-sm">
          <div className="bg-slate-50 p-2 rounded border border-slate-100">
            <span className="text-muted-foreground block text-xs">Celkem hodin</span>
            <span className="font-bold text-lg text-slate-800">{totalHours}h</span>
          </div>
          <div className="bg-slate-50 p-2 rounded border border-slate-100">
            <span className="text-muted-foreground block text-xs">Odesláno</span>
            <span className="font-medium text-slate-800">{submittedDate}</span>
          </div>
        </div>

        <div className="flex items-center justify-between mt-auto pt-2 border-t border-slate-100">
          <Button variant="ghost" size="sm" onClick={() => onDetail(submission)} className="text-blue-600 hover:text-blue-700 hover:bg-blue-50">
            <Eye className="w-4 h-4 mr-2" /> Detail
          </Button>
          
          {showActions && submission.status === 'submitted' && (
            <div className="flex gap-1">
              <Button size="sm" variant="ghost" onClick={() => onReject(submission)} className="text-red-600 hover:text-red-700 hover:bg-red-50">
                <XCircle className="w-4 h-4" />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onApprove(submission)} className="text-green-600 hover:text-green-700 hover:bg-green-50">
                <CheckCircle className="w-4 h-4" />
              </Button>
            </div>
          )}
          
          {showActions && submission.status !== 'submitted' && submission.status !== 'draft' && (
             <Button size="sm" variant="ghost" onClick={() => onRevert(submission)} className="text-orange-600 hover:text-orange-700 hover:bg-orange-50" title="Vrátit do zpracování">
                <RotateCcw className="w-4 h-4" />
             </Button>
          )}
        </div>
      </div>
    </div>
  );
});

SubmissionCard.displayName = 'SubmissionCard';

// --- Helper for virtualization ---
const Row = ({ index, style, data }) => {
  const { items, onDetail, onApprove, onReject, onRevert, showActions } = data;
  const submission = items[index];
  return (
    <SubmissionCard 
      submission={submission} 
      style={style} 
      onDetail={onDetail} 
      onApprove={onApprove} 
      onReject={onReject} 
      onRevert={onRevert}
      showActions={showActions}
    />
  );
};

const AttendanceSubmissionsOptimized = () => {
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  
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
        .select('date, hours, description, project:projects(name, code)')
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
      const { error } = await supabase
        .from('attendance_submissions')
        .update({
          status: 'approved',
          approver_id: user.id, // Assuming user.id maps to auth_user_id, might need member id
          approved_at: new Date().toISOString()
        })
        .eq('id', submission.id);

      if (error) throw error;

      toast({ title: 'Schváleno', className: 'bg-green-100 text-green-800' });
      fetchSubmissions();
      
      // Send email
      if (submission.member?.email) {
        await sendEmail({
          to: submission.member.email,
          subject: `Docházka schválena: ${format(parseISO(submission.month_date), 'LLLL yyyy', { locale: cs })}`,
          content: `<p>Vaše docházka byla schválena.</p>`
        });
      }
    } catch (error) {
      toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
    }
  }, [canAdmin, user, fetchSubmissions, toast]);

  const handleRejectConfirm = useCallback(async () => {
    if (!canAdmin || !rejectDialog) return;
    try {
      const { error } = await supabase
        .from('attendance_submissions')
        .update({
          status: 'rejected',
          notes: rejectReason,
          approver_id: user.id
        })
        .eq('id', rejectDialog.id);

      if (error) throw error;

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
  }, [canAdmin, rejectDialog, rejectReason, user, fetchSubmissions, toast]);

  const handleRevert = useCallback(async (submission) => {
    if (!canAdmin) return;
    try {
      const { error } = await supabase
        .from('attendance_submissions')
        .update({ status: 'submitted', approver_id: null, approved_at: null })
        .eq('id', submission.id);

      if (error) throw error;
      toast({ title: 'Vráceno do schvalování' });
      fetchSubmissions();
    } catch (error) {
      toast({ title: 'Chyba', description: error.message, variant: 'destructive' });
    }
  }, [canAdmin, fetchSubmissions, toast]);

  return (
    <div className="space-y-6">
      {/* Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-orange-50 border-orange-100">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-orange-600">Ke schválení</p>
              <p className="text-2xl font-bold text-orange-700">{stats.pending}</p>
            </div>
            <Clock className="w-8 h-8 text-orange-300" />
          </CardContent>
        </Card>
        <Card className="bg-green-50 border-green-100">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-green-600">Schváleno</p>
              <p className="text-2xl font-bold text-green-700">{stats.approved}</p>
            </div>
            <CheckCircle className="w-8 h-8 text-green-300" />
          </CardContent>
        </Card>
        <Card className="bg-red-50 border-red-100">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-red-600">Zamítnuto</p>
              <p className="text-2xl font-bold text-red-700">{stats.rejected}</p>
            </div>
            <XCircle className="w-8 h-8 text-red-300" />
          </CardContent>
        </Card>
        <Card className="bg-slate-50 border-slate-100">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-600">Celkem</p>
              <p className="text-2xl font-bold text-slate-700">{stats.total}</p>
            </div>
            <FileText className="w-8 h-8 text-slate-300" />
          </CardContent>
        </Card>
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
      <div className="h-[600px] w-full bg-slate-50/50 rounded-lg border border-slate-200">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <span className="animate-spin mr-2">⏳</span> Načítání...
          </div>
        ) : filteredSubmissions.length > 0 ? (
          <List
            height={600}
            itemCount={filteredSubmissions.length}
            itemSize={200} // Approximate height of card + padding
            width="100%"
            itemData={{
              items: filteredSubmissions,
              onDetail: handleOpenDetail,
              onApprove: handleApprove,
              onReject: (s) => setRejectDialog(s),
              onRevert: handleRevert,
              showActions: canAdmin
            }}
          >
            {Row}
          </List>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Search className="w-12 h-12 mb-2 opacity-20" />
            <p>Žádné záznamy k zobrazení</p>
          </div>
        )}
      </div>

      {/* Detail Dialog */}
      <Dialog open={!!detailSubmission} onOpenChange={(open) => !open && setDetailSubmission(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Detail docházky</DialogTitle>
            <DialogDescription>
              {detailSubmission?.member?.name} - {detailSubmission && format(parseISO(detailSubmission.month_date), 'LLLL yyyy', { locale: cs })}
            </DialogDescription>
          </DialogHeader>
          
          <div className="flex-1 overflow-y-auto pr-2 mt-4 space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
               <div className="bg-slate-50 p-3 rounded">
                 <span className="text-muted-foreground">Celkem hodin</span>
                 <p className="font-bold text-lg">{detailSubmission ? Number(detailSubmission.total_hours).toFixed(1) : 0}</p>
               </div>
               <div className="bg-slate-50 p-3 rounded">
                 <span className="text-muted-foreground">Stav</span>
                 <div className="mt-1"><StatusBadge status={detailSubmission?.status} /></div>
               </div>
            </div>

            {detailLoading ? (
              <p className="text-center py-4">Načítání detailů...</p>
            ) : detailRecords.length > 0 ? (
              <div className="space-y-2">
                <h4 className="font-semibold text-sm text-slate-700 sticky top-0 bg-white py-2">Denní záznamy</h4>
                {detailRecords.map((record, idx) => (
                  <div key={idx} className="flex justify-between items-start text-sm border-b pb-2">
                    <div>
                      <div className="font-medium">{format(parseISO(record.date), 'd.M.yyyy')}</div>
                      <div className="text-muted-foreground text-xs">{record.project?.name} ({record.project?.code})</div>
                      {record.description && <div className="text-xs mt-0.5 italic">{record.description}</div>}
                    </div>
                    <div className="font-bold">{Number(record.hours).toFixed(1)}h</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-4">Žádné záznamy v tomto měsíci.</p>
            )}
          </div>

          <DialogFooter className="border-t pt-4">
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
        <DialogContent>
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