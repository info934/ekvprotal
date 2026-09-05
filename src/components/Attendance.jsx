import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Download, Clock, Edit, Trash2, ChevronLeft, ChevronRight, Users, Send,
  CheckCircle, XCircle, Hourglass, Calendar, TrendingUp,
  Target, AlertTriangle, BarChart3, FileText,
  Edit2, Zap, Timer, Wallet, RotateCcw, FileX,
  HardHat, Briefcase, FileBarChart
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format, startOfMonth, endOfMonth, addMonths, subMonths, eachDayOfInterval, getDay, isSameDay, isToday } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import GlobalAttendanceOptimized from '@/components/GlobalAttendanceOptimized';
import { loadXlsx } from '@/lib/xlsx';
import YearlyAttendanceSummary from '@/components/YearlyAttendanceSummary';
import AttendanceSubmissionsOptimized from '@/components/AttendanceSubmissionsOptimized';
import AttendanceReporting from '@/components/AttendanceReporting';
import { cn, formatCurrency } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import AttendanceDialog from './AttendanceDialog';
import AttendancePlanning from './AttendancePlanning';
import { useSearchParams } from 'react-router-dom';
import { attendanceEntryDate } from '@/lib/operationsHelpers';
import { sendAttendanceApprovalRequestEmail } from '@/lib/email';
import { deleteAttendanceRecord, deleteAttendanceSubmission, saveAttendanceRecords, submitAttendanceMonth, withdrawAttendanceSubmission } from '@/lib/attendanceWorkflowService';
import { DataVizMetricCard } from '@/components/ui/data-viz';
import { attendanceMonthEditable, loadAttendanceMonth, filterAttendanceRows, groupAttendanceWork, sumAttendanceHours } from '@/lib/attendanceWorkspace';
import { useAttendanceResource } from '@/hooks/useAttendanceResource';
import { AttendanceLoadState, AttendanceMonthControl, AttendanceRecordsTable } from './AttendanceWorkspaceParts';

const metricToneFromColor = (color = '') => {
  if (color.includes('green')) return 'emerald';
  if (color.includes('purple')) return 'violet';
  if (color.includes('orange') || color.includes('yellow')) return 'amber';
  if (color.includes('red')) return 'rose';
  return 'blue';
};

const StatCard = ({ icon: Icon, title, value, subtitle, trend, color = "text-blue-600", className, ...props }) => (
  <DataVizMetricCard
    as={motion.div}
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -2 }}
    icon={Icon}
    label={title}
    value={value}
    detail={subtitle}
    trend={trend}
    tone={metricToneFromColor(color)}
    className={className}
    {...props}
  />
);

const statusConfig = {
  draft: { label: 'Koncept', icon: Edit, color: 'text-slate-500', bg: 'bg-slate-100', variant: 'secondary' },
  submitted: { label: 'Odesláno ke schválení', icon: Hourglass, color: 'text-orange-500', bg: 'bg-orange-100', variant: 'warning' },
  approved: { label: 'Schváleno', icon: CheckCircle, color: 'text-green-500', bg: 'bg-green-100', variant: 'success' },
  rejected: { label: 'Zamítnuto', icon: XCircle, color: 'text-red-500', bg: 'bg-red-100', variant: 'destructive' },
  returned: { label: 'Vráceno k úpravě', icon: RotateCcw, color: 'text-amber-600', bg: 'bg-amber-100', variant: 'warning' },
};

const MyAttendance = ({ memberId, isAdmin, attendanceEnabled }) => {
  const { toast } = useToast();
  const { hasPermission, isPrivateMode } = useAuth();
  const [monthParams, setMonthParams] = useSearchParams();
  const requestedMonth = (monthParams.get('month') || '').slice(0, 7);
  const monthKey = /^\d{4}-(0[1-9]|1[0-2])$/.test(requestedMonth) ? requestedMonth : format(new Date(), 'yyyy-MM');
  const currentMonth = useMemo(() => new Date(`${monthKey}-01T12:00:00`), [monthKey]);
  const setCurrentMonth = date => setMonthParams(current => { const next = new URLSearchParams(current); next.set('month', format(date, 'yyyy-MM')); return next; });
  const [viewMode, setViewMode] = useState('calendar');
  const [calendarDay, setCalendarDay] = useState(null);
  const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'project', 'realization'
  const [hourlyRate, setHourlyRate] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Edit/Delete/Add state
  const [isAttendanceDialogOpen, setIsAttendanceDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [deletingRecord, setDeletingRecord] = useState(null);
  const [selectedDialogDate, setSelectedDialogDate] = useState(null);
  const [pending, setPending] = useState(false);
  const [recordsRevision, setRecordsRevision] = useState(0);
  const busy = useRef(false);
  const loader = useCallback(signal => loadAttendanceMonth(supabase, { memberId, month: currentMonth, signal }), [memberId, currentMonth]);
  const resource = useAttendanceResource(`${memberId}:${format(currentMonth, 'yyyy-MM')}`, loader, Boolean(memberId && attendanceEnabled));
  const attendance = resource.data?.records || [];
  const submission = resource.data?.submission || null;

  const isEditable = attendanceMonthEditable(submission, resource.ready) && (hasPermission('attendance', 'can_edit') || hasPermission('attendance', 'can_admin')) && !pending;
  const canManageSubmission = resource.ready && (hasPermission('attendance', 'can_edit') || hasPermission('attendance', 'can_admin')) && submission && submission.status !== 'approved' && !pending;

  useEffect(() => {
    let isMounted = true;
    const fetchHourlyRate = async () => {
      setHourlyRate(null);
      if (!memberId) return;
      const { data: compensationData, error } = await supabase.rpc('get_member_compensation', { p_member_id: memberId });
      if (isMounted) setHourlyRate(error || compensationData?.hourly_rate == null || compensationData.currency !== 'CZK' || !Number.isFinite(Number(compensationData.hourly_rate)) ? null : Number(compensationData.hourly_rate));
    };
    fetchHourlyRate();
    return () => { isMounted = false; };
  }, [memberId]);

  const handleSaveAttendance = async (recordData, options) => {
    if (busy.current || !isEditable) throw new Error('Zápis nyní není dostupný. Obnovte stav měsíce.');
    busy.current = true; setPending(true);
    const isBatchInsert = Array.isArray(recordData);

    try {
      if (editingRecord && isBatchInsert) {
        throw new Error('Nelze hromadně ukládat při úpravě existujícího záznamu.');
      }

      const payload = isBatchInsert
        ? recordData.map((row) => ({ ...row, member_id: row.member_id || memberId }))
        : { ...recordData, member_id: recordData.member_id || memberId };

      await saveAttendanceRecords(payload, editingRecord?.id || null, options);
      setRecordsRevision(value => value + 1);

      if (Array.isArray(recordData)) {
        toast({ title: `Přidáno záznamů: ${recordData.length}` });
      } else {
        toast({ title: editingRecord ? 'Záznam aktualizován' : 'Záznam přidán' });
      }
      setIsAttendanceDialogOpen(false);
      setEditingRecord(null);

      resource.refresh();
    } catch (error) {
      throw error;
    } finally { busy.current = false; setPending(false); }
  };

  const handleDeleteConfirmed = async () => {
    if (!deletingRecord || busy.current || !isEditable) return;
    busy.current = true; setPending(true);
    try {
      await deleteAttendanceRecord(deletingRecord.id);
      setRecordsRevision(value => value + 1);
      toast({ title: 'Záznam smazán' });
      resource.refresh();
    } catch (error) {
      toast({ title: 'Chyba při mazání', description: error.message, variant: 'destructive' });
    } finally { busy.current = false; setPending(false); }
    setDeletingRecord(null);
  }

  const handleSubmitForApproval = async () => {
    if (busy.current || !isEditable || !attendance.length) return;
    busy.current = true; setPending(true);
    const month_date = format(startOfMonth(currentMonth), 'yyyy-MM-dd');

    try {
      const savedSubmission = await submitAttendanceMonth(memberId, month_date);
      resource.refresh();
      const totalHours = Number(savedSubmission?.total_hours || attendance.reduce((sum, record) => sum + Number(record.hours), 0));

      try {
        const { data: mData } = await supabase.from('members').select('name').eq('id', memberId).single();
        const memberName = mData?.name || 'Neznámý';
        
        const projectNames = [...new Set(attendance.map(a => a.projects?.name || a.realizations?.name).filter(Boolean))].join(', ');
        
        const notification = await sendAttendanceApprovalRequestEmail({
          submissionId: savedSubmission?.id,
          memberName,
          totalHours,
          monthDate: format(currentMonth, 'MM/yyyy'),
          projects: projectNames || 'Žádné specifikované',
          submittedAt: new Date().toISOString()
        });
        if (!notification?.success) {
          toast({
            title: 'Docházka byla odeslána',
            description: 'Změna je uložená, ale e-mail administrátorům se nepodařilo potvrdit.',
            variant: 'warning',
          });
        } else {
          toast({ title: 'Docházka odeslána ke schválení', description: 'Administrátoři byli informováni e-mailem.' });
        }
      } catch (emailError) {
        console.error('Failed to send attendance approval email:', emailError);
        toast({ title: 'Docházka byla odeslána', description: 'Změna je uložená, e-mailová notifikace ale selhala.', variant: 'warning' });
      }
    } catch (error) {
      toast({ title: 'Chyba při odesílání ke schválení', description: error.message, variant: 'destructive' });
    } finally { busy.current = false; setPending(false); }
  };

  const handleWithdrawSubmission = async () => {
    if (!submission?.id || submission.status === 'approved' || busy.current) return;
    busy.current = true; setPending(true);

    try {
      await withdrawAttendanceSubmission(submission.id);
      toast({ title: 'Žádost stažena k úpravě', description: 'Docházku můžete znovu upravovat a poté odeslat ke schválení.' });
      resource.refresh();
    } catch (error) {
      toast({ title: 'Žádost se nepodařilo stáhnout', description: error.message, variant: 'destructive' });
    } finally { busy.current = false; setPending(false); }
  };

  const handleDeleteSubmission = async () => {
    if (!submission?.id || submission.status === 'approved' || busy.current) return;
    busy.current = true; setPending(true);

    try {
      await deleteAttendanceSubmission(submission.id);
      toast({ title: 'Žádost smazána', description: 'Docházkové záznamy zůstaly zachované a můžete je dál upravovat.' });
      resource.refresh();
    } catch (error) {
      toast({ title: 'Žádost se nepodařilo smazat', description: error.message, variant: 'destructive' });
    } finally { busy.current = false; setPending(false); }
  };

  const handleDayClick = (day) => {
    setCalendarDay(format(day, 'yyyy-MM-dd'));
    if (!isEditable) {

      return;
    }
    setEditingRecord(null); // Clear editing record to indicate "New"
    setSelectedDialogDate(day); // Set the date to pre-fill
    setIsAttendanceDialogOpen(true);
  };

  const handleExport = async () => {
    if (!resource.ready || exporting || !filteredAttendance.length) return;
    setExporting(true);
    try {
      const XLSX = await loadXlsx();
      const exportData = filteredAttendance.map(record => ({
        'Datum': format(new Date(record.date), 'd.M.yyyy'),
        'Typ': record.project_id ? 'Projekt' : record.realization_id ? 'Realizace' : 'Bez přiřazení',
        'Název': record.projects?.name || record.realizations?.name || 'Bez přiřazení',
        'Kód': record.projects?.code || '', 'Počet hodin': Number(record.hours), 'Popis': record.description,
        'Orientační odměna při aktuální sazbě (Kč)': hourlyRate === null ? 'Sazba není dostupná' : Number(record.hours) * hourlyRate,
      }));
      const worksheet = XLSX.utils.json_to_sheet(exportData);
      XLSX.utils.sheet_add_json(worksheet, [{}, { 'Datum': 'Celkem zobrazené hodiny', 'Počet hodin': sumAttendanceHours(filteredAttendance) }], { skipHeader: true, origin: -1 });
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Docházka');
      XLSX.writeFile(workbook, `moje_dochazka_${format(currentMonth, 'MM-yyyy')}.xlsx`);
      toast({ title: 'Export byl vytvořen', description: 'Soubor obsahuje záznamy odpovídající aktuálnímu filtru.' });
    } catch (error) { toast({ title: 'Export se nepodařilo vytvořit', description: error.message, variant: 'destructive' }); }
    finally { setExporting(false); }
  };

  const filteredAttendance = useMemo(() => filterAttendanceRows(attendance, { type: typeFilter }), [attendance, typeFilter]);

  const myWorkSummary = useMemo(() => groupAttendanceWork(attendance), [attendance]);

  const totalHours = useMemo(() => {
    return attendance.reduce((sum, record) => sum + Number(record.hours), 0);
  }, [attendance]);

  const totalValue = useMemo(() => {
    return totalHours * hourlyRate;
  }, [totalHours, hourlyRate]);

  const workingDays = useMemo(() => {
    const monthDays = eachDayOfInterval({
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth)
    });
    return monthDays.filter(day => {
      const dayOfWeek = getDay(day);
      return dayOfWeek >= 1 && dayOfWeek <= 5; // Monday to Friday
    }).length;
  }, [currentMonth]);

  const averageHoursPerDay = useMemo(() => {
    return workingDays > 0 ? (totalHours / workingDays).toFixed(1) : '0';
  }, [totalHours, workingDays]);

  const daysWithAttendance = useMemo(() => {
    const uniqueDays = new Set(attendance.map(record => record.date));
    return uniqueDays.size;
  }, [attendance]);

  const monthDays = useMemo(() => eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth)
  }), [currentMonth]);

  const firstDayOfMonth = getDay(startOfMonth(currentMonth));
  // Adjust for Monday start (0 is Sunday in date-fns, but we want Monday as 1)
  const mondayOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
  const emptyDays = Array.from({ length: mondayOffset });

  const currentStatus = submission ? statusConfig[submission.status] || { label: 'Neznámý stav', icon: AlertTriangle, variant: 'warning' } : statusConfig.draft;
  const StatusIcon = currentStatus.icon;

  if (!attendanceEnabled) {
    return (
      <Card className="p-12 text-center">
        <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
        <h3 className="text-xl font-bold">Docházka je pro váš účet vypnuta</h3>
        <p className="text-muted-foreground mt-2">Pro aktivaci docházky kontaktujte administrátora.</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AttendanceMonthControl value={currentMonth} onChange={setCurrentMonth} disabled={pending} />
        {isEditable && hasPermission('attendance', 'can_edit') && (
          <Button className="h-10 w-full sm:w-auto" onClick={() => { setEditingRecord(null); setSelectedDialogDate(attendanceEntryDate(currentMonth)); setIsAttendanceDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Zapsat odpracované hodiny
          </Button>
        )}
      </div>
      <AttendanceLoadState loading={resource.loading} error={resource.error} onRetry={resource.refresh}>
      {resource.ready && <>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-slate-200 lg:grid-cols-4">
        {[['Hodiny za měsíc', totalHours.toLocaleString('cs-CZ') + ' h'], ['Orientační odměna', isPrivateMode ? 'Skryto' : hourlyRate === null ? 'Sazba není dostupná' : formatCurrency(totalValue)], ['Dny se záznamem', daysWithAttendance], ['Zakázky', myWorkSummary.length]].map(([label, value]) => <div key={label} className="bg-white px-3 py-2"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>)}
      </div>

      <Card>
        <CardContent className="p-3">
          <div className="flex flex-wrap justify-between items-center gap-2">
            <Badge variant={currentStatus.variant} className="text-sm px-3 py-1">
              <StatusIcon className="w-4 h-4 mr-2" />
              {currentStatus.label}
            </Badge>

            <div className="flex w-full flex-wrap justify-start gap-2 lg:w-auto">
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filtr zobrazení" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Vše</SelectItem>
                  <SelectItem value="project">Jen projekty</SelectItem>
                  <SelectItem value="realization">Jen realizace</SelectItem>
                </SelectContent>
              </Select>

              <div className="flex gap-2">
                <Button
                  variant={viewMode === 'calendar' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('calendar')}
                  aria-pressed={viewMode === 'calendar'}
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Kalendář
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                  aria-pressed={viewMode === 'list'}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Seznam
                </Button>
              </div>

            </div>
          </div>
        </CardContent>
      </Card>

      {canManageSubmission && (
        <Card className="border-amber-200 bg-amber-50/60">
          <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <Hourglass className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="font-semibold text-amber-950">
                  {submission.status === 'submitted' ? 'Docházka čeká na schválení' : submission.status === 'returned' ? 'Docházka byla vrácena k úpravě' : 'Žádost docházky je rozpracovaná'}
                </p>
                <p className="text-sm text-amber-800">
                  Do schválení můžete žádost stáhnout nebo smazat. Docházkové řádky zůstanou zachované, dokud je nesmažete samostatně.
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              {submission.status === 'submitted' && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" className="border-amber-200 text-amber-700 hover:bg-amber-100">
                      <RotateCcw className="mr-2 h-4 w-4" />
                      Stáhnout k úpravě
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent className="sm:max-w-xl">
                    <AlertDialogHeader>
                      <AlertDialogTitle>Stáhnout žádost zpět k úpravě?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Žádost se vrátí do konceptu a nebude vidět ve frontě ke schválení. Docházkové záznamy zůstanou zachované.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Zrušit</AlertDialogCancel>
                      <AlertDialogAction onClick={handleWithdrawSubmission}>Stáhnout</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="border-red-200 text-red-600 hover:bg-red-50">
                    <FileX className="mr-2 h-4 w-4" />
                    Smazat žádost
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent className="sm:max-w-xl">
                  <AlertDialogHeader>
                    <AlertDialogTitle>Smazat žádost o schválení?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Smaže se pouze měsíční žádost a její stav. Samotné docházkové záznamy v měsíci zůstanou zachované a půjdou znovu odeslat.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                    <AlertDialogAction onClick={handleDeleteSubmission} className="bg-destructive hover:bg-destructive/90">
                      Smazat žádost
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </CardContent>
        </Card>
      )}
      {submission?.status === 'rejected' && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded-lg"
        >
          <div className="flex items-start gap-3">
            <XCircle className="w-5 h-5 text-red-500 mt-0.5" />
            <div>
              <p className="font-bold">Docházka byla zamítnuta</p>
              <p className="text-sm mt-1">Poznámka od schvalujícího: {submission.notes || 'Bez poznámky.'}</p>
            </div>
          </div>
        </motion.div>
      )}



      {/* Main Calendar/List View */}
      {viewMode === 'calendar' ? (
        <Card>
          <CardContent className="p-2 sm:p-3">
            <p className="mb-2 text-sm text-slate-600">{isEditable ? 'Kliknutím na den přidáte odpracované hodiny. Záznamy vybraného dne najdete pod kalendářem.' : 'Měsíc je pouze pro čtení. Kliknutím na den zobrazíte jeho záznamy.'}</p>
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-muted-foreground mb-2 text-sm">
              {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1 sm:gap-2">
              {emptyDays.map((_, i) => <div key={`empty-${i}`} className="h-24 sm:h-32" />)}
              {monthDays.map(day => {
                // Filter records for this day AND based on typeFilter
                const dayAttendance = filteredAttendance.filter(a => isSameDay(new Date(a.date), day));
                const dayHours = dayAttendance.reduce((sum, record) => sum + Number(record.hours), 0);
                const dayOfWeek = getDay(day);
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isTodayDate = isToday(day);
                const hasHours = dayHours > 0;

                return (
                  <motion.button
                    type="button"
                    key={day.toString()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleDayClick(day)}
                    aria-label={`${format(day, 'd. MMMM yyyy', { locale: cs })}, ${dayHours.toFixed(1)} hodin${isEditable ? ', přidat záznam' : ''}`}
                    className={cn(
                      "h-24 sm:h-32 min-w-0 rounded-xl border p-1 sm:p-3 text-left flex flex-col justify-between transition-all duration-200 cursor-pointer relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isWeekend ? "bg-slate-50/50" : "bg-white",
                      hasHours && "border-blue-200 bg-blue-50/30",
                      isTodayDate && "border-primary ring-2 ring-primary ring-offset-2",
                      "hover:shadow-md hover:border-primary/50"
                    )}
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-1">
                      <span className={cn(
                        "font-bold text-sm rounded-full w-7 h-7 flex items-center justify-center",
                        isTodayDate ? "bg-primary text-primary-foreground" : "text-slate-600",
                        hasHours && !isTodayDate && "bg-blue-100 text-blue-700"
                      )}>
                        {format(day, 'd')}
                      </span>
                      {hasHours && (
                        <Badge variant="outline" className="bg-white/80 border-blue-200 text-blue-700 shadow-sm font-mono text-xs">
                          {dayHours.toFixed(1)}h
                        </Badge>
                      )}
                    </div>

                    <div className="space-y-1 mt-2 overflow-y-auto custom-scrollbar">
                      {dayAttendance.length > 0 ? (
                        dayAttendance.slice(0, 3).map((rec, idx) => (
                          <div key={rec.id} className="text-[10px] leading-tight truncate px-1.5 py-1 bg-white rounded border border-slate-100 text-slate-600">
                            {rec.projects?.code || rec.projects?.name || rec.realizations?.name || 'Bez zakázky'}
                          </div>
                        ))
                      ) : (
                        <div className="h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          {isEditable && <Plus className="w-6 h-6 text-slate-300" />}
                        </div>
                      )}
                      {dayAttendance.length > 3 && (
                        <div className="text-[9px] text-center text-muted-foreground">
                          +{dayAttendance.length - 3} další
                        </div>
                      )}
                    </div>
                  </motion.button>
                )
              })}
            </div>
            {calendarDay?.startsWith(monthKey) && <section className="mt-5 border-t pt-5"><h3 className="mb-3 font-semibold">Záznamy dne {format(new Date(calendarDay + 'T12:00:00'), 'd. M. yyyy')}</h3><AttendanceRecordsTable records={filteredAttendance.filter(row => row.date.slice(0, 10) === calendarDay)} pending={pending} onEdit={isEditable ? record => { setEditingRecord(record); setIsAttendanceDialogOpen(true); } : null} onDelete={isEditable ? setDeletingRecord : null} empty="Pro tento den a filtr nejsou zapsané hodiny." /></section>}
          </CardContent>
        </Card>
      ) : (
        <AttendanceRecordsTable records={filteredAttendance} pending={pending} onEdit={isEditable ? record => { setEditingRecord(record); setIsAttendanceDialogOpen(true); } : null} onDelete={isEditable ? setDeletingRecord : null} empty={attendance.length ? 'Vybranému filtru neodpovídá žádný záznam.' : 'Tento měsíc zatím nemáte zapsané hodiny. Začněte tlačítkem Zapsat odpracované hodiny.'} />
      )}
<div className="flex flex-wrap items-center justify-end gap-2 rounded-lg border bg-white p-3" aria-label="Export a odeslání měsíce">              <Button onClick={handleExport} variant="outline" disabled={exporting || !resource.ready || filteredAttendance.length === 0}>
                <Download className="w-4 h-4 mr-2" />
                Export zobrazených
              </Button>
              {isEditable && hasPermission('attendance', 'can_edit') && (
                <>
                  {attendance.length > 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="default" className="bg-green-600 hover:bg-green-700">
                          <Send className="w-4 h-4 mr-2" /> Odeslat měsíc ke schválení
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent className="sm:max-w-2xl">
                        <AlertDialogHeader>
                          <AlertDialogTitle>Odeslat docházku ke schválení?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Odesíláte celý měsíc bez ohledu na filtr. Záznamy zůstanou uzamčené i po schválení; úpravy jsou možné po stažení žádosti nebo vrácení administrátorem.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Zrušit</AlertDialogCancel>
                          <AlertDialogAction onClick={handleSubmitForApproval} className="bg-green-600 hover:bg-green-700">Odeslat</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  )}
                </>
              )}</div>
      {myWorkSummary.length > 0 && <details className="rounded-xl border bg-white p-5"><summary className="cursor-pointer text-sm font-semibold">Souhrn práce podle zakázek</summary><ul className="mt-4 divide-y">{myWorkSummary.map(item => <li key={item.id} className="flex justify-between gap-4 py-3 text-sm"><span>{item.name}<small className="ml-2 text-slate-500">{item.code || item.type}</small></span><strong className="whitespace-nowrap tabular-nums">{item.hours.toLocaleString('cs-CZ')} h</strong></li>)}</ul><p className="mt-3 text-xs text-slate-500">Orientační odměna používá aktuální hodinovou sazbu. Schválené částky najdete ve výplatách.</p></details>}
      </>}
      </AttendanceLoadState>

      <details className="rounded-xl border bg-white p-4"><summary className="cursor-pointer font-medium text-slate-700">Roční souhrn docházky</summary><div className="mt-4"><YearlyAttendanceSummary memberId={memberId} attendanceEnabled={attendanceEnabled} revision={recordsRevision} /></div></details>

      {/* Edit/Add Dialog */}
      <AttendanceDialog
        isOpen={isAttendanceDialogOpen}
        onClose={() => setIsAttendanceDialogOpen(false)}
        onSave={handleSaveAttendance}
        record={editingRecord}
        isAdmin={false}
        memberId={memberId}
        initialDate={selectedDialogDate}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingRecord} onOpenChange={open => { if (!open && !pending) setDeletingRecord(null); }}>
        <AlertDialogContent className="sm:max-w-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat záznam?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingRecord?.date} · {deletingRecord?.hours} h. Záznam se odečte z měsíčního součtu a nelze jej obnovit.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction disabled={pending} onClick={event => { event.preventDefault(); handleDeleteConfirmed(); }} className="bg-destructive hover:bg-destructive/90">
              Smazat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};


const Attendance = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { user, hasPermission, memberId, userRole } = useAuth();
  const loadMember = useCallback(async signal => {
    const { data, error } = await supabase.from('members').select('id,attendance_enabled').eq('auth_user_id', user.id).maybeSingle().abortSignal(signal);
    if (error) throw error;
    return data;
  }, [user?.id]);
  const memberResource = useAttendanceResource('attendance-access:' + user?.id, loadMember, Boolean(user?.id));
  const attendanceEnabled = memberResource.data?.attendance_enabled === true;

  const canViewReport = userRole === 'admin';
  const canViewAdminTabs = userRole === 'admin' || userRole === 'super_manager' || hasPermission('attendance', 'can_admin');

  if (!hasPermission('attendance', 'can_read')) {
    return (
      <Card className="p-12 text-center">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold text-red-600 mb-2">Přístup odepřen</h1>
        <p className="text-muted-foreground">Nemáte oprávnění pro přístup k tomuto modulu.</p>
      </Card>
    );
  }

  return (
    <div className="app-page compact-workspace">
      <div className="space-y-3">
        <PageHeader
          icon={Clock}
          title="Docházka"
          description="Hodiny, zakázky a schválení měsíce na jednom místě."
          actions={
            <>
              {memberResource.loading ? <Badge variant="secondary">Načítám nastavení</Badge> : memberResource.error ? <Badge variant="warning">Nastavení není dostupné</Badge> : attendanceEnabled ? (
                <Badge variant="success" className="text-sm px-3 py-1">
                  <CheckCircle className="w-4 h-4 mr-2" />
                  Povoleno
                </Badge>
              ) : (
                <Badge variant="destructive" className="text-sm px-3 py-1">
                  <XCircle className="w-4 h-4 mr-2" />
                  Vypnuto
                </Badge>
              )}
            </>
          }
        />
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="hidden"
        >
          <div>
            <h1 className="text-3xl sm:text-4xl font-bold text-slate-800 mb-2 flex items-center gap-3">
              <Clock className="w-8 h-8 text-primary" />
              Docházka
            </h1>
            <p className="text-muted-foreground">Přehled vaší odpracované doby a správa docházky</p>
          </div>

          <div className="flex gap-2">
            <Badge variant="info" className="text-sm px-3 py-1">
              <Timer className="w-4 h-4 mr-2" />
              Aktivní sledování
            </Badge>
            {attendanceEnabled ? (
              <Badge variant="success" className="text-sm px-3 py-1">
                <CheckCircle className="w-4 h-4 mr-2" />
                Povoleno
              </Badge>
            ) : (
              <Badge variant="destructive" className="text-sm px-3 py-1">
                <XCircle className="w-4 h-4 mr-2" />
                Vypnuto
              </Badge>
            )}
          </div>
        </motion.div>

        <Tabs value={searchParams.get('tab') === 'planning' ? 'planning' : canViewAdminTabs && ['approvals', 'submissions', 'global-attendance', ...(canViewReport ? ['reporting'] : [])].includes(searchParams.get('tab')) ? (searchParams.get('tab') === 'approvals' ? 'submissions' : searchParams.get('tab')) : 'my-attendance'} onValueChange={tab => setSearchParams(current => { const next = new URLSearchParams(current); next.set('tab', tab); return next; })} className="w-full">
          <div className="border-b border-slate-200 mb-3 overflow-x-auto">
            <TabsList className="w-max min-w-full flex justify-start">
              <TabsTrigger value="my-attendance" className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">Moje docházka</span>
                <span className="sm:hidden">Docházka</span>
              </TabsTrigger>
              <TabsTrigger value="planning"><Calendar className="mr-2 h-4 w-4" />Plán docházky</TabsTrigger>
              {canViewAdminTabs && (
                <>
                  <TabsTrigger value="submissions" className="flex items-center gap-2">
                    <Send className="w-4 h-4" />
                    <span className="hidden sm:inline">Ke schválení</span>
                    <span className="sm:hidden">Schválení</span>
                  </TabsTrigger>
                  <TabsTrigger value="global-attendance" className="flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    <span className="hidden sm:inline">Celkový přehled</span>
                    <span className="sm:hidden">Přehled</span>
                  </TabsTrigger>
                  {canViewReport && <TabsTrigger value="reporting" className="flex items-center gap-2">
                    <FileBarChart className="w-4 h-4" />
                    <span className="hidden sm:inline">Podklady a export</span>
                    <span className="sm:hidden">Report</span>
                  </TabsTrigger>}
                </>
              )}
            </TabsList>
          </div>

          <TabsContent value="planning"><AttendancePlanning memberId={memberId} /></TabsContent>
          <TabsContent value="my-attendance" className="mt-6">
            <AttendanceLoadState loading={memberResource.loading} error={memberResource.error} onRetry={memberResource.refresh}>{memberResource.ready && <MyAttendance memberId={memberId} isAdmin={canViewAdminTabs} attendanceEnabled={attendanceEnabled} />}</AttendanceLoadState>
          </TabsContent>

          {canViewAdminTabs && (
            <>
              <TabsContent value="submissions" className="mt-6">
                <div className="space-y-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Send className="w-5 h-5" />
                      Docházka ke schválení
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <AttendanceSubmissionsOptimized />
                  </CardContent>
                </div>
              </TabsContent>
              <TabsContent value="global-attendance" className="mt-6">
                <div className="space-y-4">
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Users className="w-5 h-5" />
                      Celkový přehled docházky
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <GlobalAttendanceOptimized />
                  </CardContent>
                </div>
              </TabsContent>
              {canViewReport && <TabsContent value="reporting" className="mt-6">
                <div className="space-y-4">
                  <AttendanceReporting />
                </div>
              </TabsContent>}
            </>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default Attendance;
