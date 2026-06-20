import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Download, Clock, Edit, Trash2, ChevronLeft, ChevronRight, Users, Send,
  CheckCircle, XCircle, Hourglass, Calendar, TrendingUp,
  Target, AlertTriangle, BarChart3, FileText,
  Edit2, Zap, Timer, Wallet,
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
import * as XLSX from 'xlsx';
import YearlyAttendanceSummary from '@/components/YearlyAttendanceSummary';
import AttendanceSubmissionsOptimized from '@/components/AttendanceSubmissionsOptimized';
import AttendanceReporting from '@/components/AttendanceReporting';
import { cn, formatCurrency } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import PageHeader from '@/components/ui/page-header';
import AttendanceDialog from './AttendanceDialog';
import { sendAttendanceApprovalRequestEmail } from '@/lib/email';
import { DataVizMetricCard } from '@/components/ui/data-viz';

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
};

const MyAttendance = ({ memberId, isAdmin, attendanceEnabled }) => {
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const [attendance, setAttendance] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [submission, setSubmission] = useState(null);
  const [viewMode, setViewMode] = useState('calendar'); // 'calendar' or 'list'
  const [typeFilter, setTypeFilter] = useState('all'); // 'all', 'project', 'realization'
  const [hourlyRate, setHourlyRate] = useState(0);

  // Edit/Delete/Add state
  const [isAttendanceDialogOpen, setIsAttendanceDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState(null);
  const [deletingRecord, setDeletingRecord] = useState(null);
  const [selectedDialogDate, setSelectedDialogDate] = useState(null);

  const isEditable = !submission || submission.status === 'draft' || submission.status === 'rejected';

  useEffect(() => {
    let isMounted = true;
    const fetchHourlyRate = async () => {
      if (!memberId) return;
      const { data: memberData } = await supabase.from('members').select('hourly_rate').eq('id', memberId).single();
      if (isMounted && memberData) setHourlyRate(memberData.hourly_rate || 0);
    };
    fetchHourlyRate();
    return () => { isMounted = false; };
  }, [memberId]);

  const fetchAttendanceAndSubmission = useCallback(async () => {
    if (!memberId) return;

    const startDate = startOfMonth(currentMonth);
    const endDate = endOfMonth(currentMonth);
    const formattedStartDate = format(startDate, 'yyyy-MM-dd');
    const formattedEndDate = format(endDate, 'yyyy-MM-dd');

    const [submissionRes, attendanceRes] = await Promise.all([
      supabase
        .from('attendance_submissions')
        .select('*')
        .eq('member_id', memberId)
        .eq('month_date', formattedStartDate)
        .maybeSingle(),
      supabase
        .from('attendance')
        .select('*, projects(name, code), realizations(name)')
        .eq('member_id', memberId)
        .gte('date', formattedStartDate)
        .lte('date', formattedEndDate)
        .order('date', { ascending: false })
    ]);

    return { submissionRes, attendanceRes };
  }, [memberId, currentMonth]);

  useEffect(() => {
    let isMounted = true;
    const loadData = async () => {
      try {
        const result = await fetchAttendanceAndSubmission();

        if (!isMounted || !result) return;

        const { submissionRes, attendanceRes } = result;

        if (submissionRes.error) {
          toast({ title: 'Chyba při načítání stavu docházky', description: submissionRes.error.message, variant: 'destructive' });
        } else {
          setSubmission(submissionRes.data);
        }

        if (attendanceRes.error) {
          toast({ title: 'Chyba při načítání docházky', description: attendanceRes.error.message, variant: 'destructive' });
        } else {
          setAttendance(attendanceRes.data || []);
        }
      } catch (err) {
        console.error(err);
      }
    };

    loadData();
    return () => { isMounted = false; };
  }, [fetchAttendanceAndSubmission, toast]);

  const handleSaveAttendance = async (recordData) => {
    let error;
    const isBatchInsert = Array.isArray(recordData);
    if (editingRecord) {
      if (isBatchInsert) {
        error = { message: 'Nelze hromadně ukládat při úpravě existujícího záznamu.' };
      } else {
        // Update
        ({ error } = await supabase.from('attendance').update({
          project_id: recordData.project_id,
          realizace_id: recordData.realizace_id,
          date: recordData.date,
          hours: recordData.hours,
          description: recordData.description
        }).eq('id', editingRecord.id));
      }
    } else {
      // Insert (single or batch)
      if (isBatchInsert) {
        const payloads = recordData.map((row) => ({ ...row, member_id: row.member_id || memberId }));
        ({ error } = await supabase.from('attendance').insert(payloads));
      } else {
        // Ensure member_id is set if passed from the child dialog, or fallback
        const payload = { ...recordData, member_id: recordData.member_id || memberId };
        ({ error } = await supabase.from('attendance').insert(payload));
      }
    }

    if (error) {
      toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
    } else {
      if (Array.isArray(recordData)) {
        toast({ title: `✅ Přidáno záznamů: ${recordData.length}` });
      } else {
        toast({ title: editingRecord ? '✅ Záznam aktualizován' : '✅ Záznam přidán' });
      }
      setIsAttendanceDialogOpen(false);
      setEditingRecord(null);

      // Refresh
      const result = await fetchAttendanceAndSubmission();
      if (result) {
        if (result.submissionRes.data) setSubmission(result.submissionRes.data);
        if (result.attendanceRes.data) setAttendance(result.attendanceRes.data);
      }
    }
  };

  const handleDeleteConfirmed = async () => {
    if (!deletingRecord) return;
    const { error } = await supabase.from('attendance').delete().eq('id', deletingRecord.id);

    if (error) {
      toast({ title: 'Chyba při mazání', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '🗑️ Záznam smazán' });
      const result = await fetchAttendanceAndSubmission();
      if (result) {
        if (result.attendanceRes.data) setAttendance(result.attendanceRes.data);
      }
    }
    setDeletingRecord(null);
  }

  const handleSubmitForApproval = async () => {
    const totalHours = attendance.reduce((sum, record) => sum + Number(record.hours), 0);
    const month_date = format(startOfMonth(currentMonth), 'yyyy-MM-dd');

    const submissionData = {
      member_id: memberId,
      month_date,
      total_hours: totalHours,
      status: 'submitted',
      submitted_at: new Date().toISOString(),
    };

    let error;
    if (submission) {
      ({ error } = await supabase.from('attendance_submissions').update(submissionData).eq('id', submission.id));
    } else {
      ({ error } = await supabase.from('attendance_submissions').insert(submissionData));
    }

    if (error) {
      toast({ title: 'Chyba při odesílání ke schválení', description: error.message, variant: 'destructive' });
    } else {
      
      try {
        const { data: mData } = await supabase.from('members').select('name').eq('id', memberId).single();
        const memberName = mData?.name || 'Neznámý';
        
        const projectNames = [...new Set(attendance.map(a => a.projects?.name || a.realizations?.name).filter(Boolean))].join(', ');
        
        await sendAttendanceApprovalRequestEmail({
          memberName,
          totalHours,
          monthDate: format(currentMonth, 'MM/yyyy'),
          projects: projectNames || 'Žádné specifikované',
          submittedAt: new Date().toISOString()
        });
      } catch (emailError) {
        console.error('Failed to send attendance approval email:', emailError);
      }

      toast({ title: '✅ Docházka odeslána ke schválení!' });
      const result = await fetchAttendanceAndSubmission();
      if (result) {
        if (result.submissionRes.data) setSubmission(result.submissionRes.data);
        if (result.attendanceRes.data) setAttendance(result.attendanceRes.data);
      }
    }
  };

  const handleDayClick = (day) => {
    if (!isEditable) {
      toast({ title: "Nelze upravovat", description: "Docházka je již odeslána nebo schválena.", variant: "warning" });
      return;
    }
    setEditingRecord(null); // Clear editing record to indicate "New"
    setSelectedDialogDate(day); // Set the date to pre-fill
    setIsAttendanceDialogOpen(true);
  };

  const handleExport = () => {
    const totalHours = attendance.reduce((sum, record) => sum + Number(record.hours), 0);

    const exportData = attendance.map(record => ({
      'Datum': format(new Date(record.date), 'd.M.yyyy'),
      'Typ': record.project_id ? 'Projekt' : 'Realizace',
      'Název': record.projects?.name || record.realizations?.name || 'Neznámý',
      'Kód': record.projects?.code || '-',
      'Počet hodin': Number(record.hours).toFixed(2),
      'Popis': record.description,
      'Částka': hourlyRate ? (Number(record.hours) * hourlyRate).toFixed(2) : '-'
    }));

    const summaryData = [{}, { 'Datum': 'Celkem hodin', 'Počet hodin': totalHours.toFixed(2) }];
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.sheet_add_json(worksheet, summaryData, { skipHeader: true, origin: -1 });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Docházka');
    XLSX.writeFile(workbook, `moje_dochazka_${format(currentMonth, 'MM-yyyy')}.xlsx`);
    toast({ title: '✅ Export úspěšně vygenerován!' });
  };

  const filteredAttendance = useMemo(() => {
    if (typeFilter === 'all') return attendance;
    if (typeFilter === 'project') return attendance.filter(a => a.project_id);
    if (typeFilter === 'realization') return attendance.filter(a => a.realizace_id);
    return attendance;
  }, [attendance, typeFilter]);

  const myWorkSummary = useMemo(() => {
    const summary = {};
    attendance.forEach(r => {
      const key = r.project_id ? `p_${r.project_id}` : `r_${r.realizace_id}`;

      if (!summary[key]) {
        summary[key] = {
          id: key,
          type: r.project_id ? 'Projekt' : 'Realizace',
          name: r.projects?.name || r.realizations?.name || 'Neznámý',
          code: r.projects?.code || '',
          hours: 0,
          cost: 0
        };
      }
      const hrs = Number(r.hours || 0);
      summary[key].hours += hrs;
      summary[key].cost += hrs * hourlyRate;
    });
    return Object.values(summary).sort((a, b) => b.hours - a.hours);
  }, [attendance, hourlyRate]);

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

  const currentStatus = submission ? statusConfig[submission.status] : statusConfig.draft;
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
    <div className="space-y-6">
      <YearlyAttendanceSummary memberId={memberId} attendanceEnabled={attendanceEnabled} />

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={Timer}
          title="Celkem hodin"
          value={totalHours.toFixed(1)}
          subtitle="za měsíc"
          color="text-blue-600"
        />
        <StatCard
          icon={Wallet}
          title="Celková hodnota"
          value={formatCurrency(totalValue)}
          subtitle="odhadovaná cena"
          color="text-green-600"
        />
        <StatCard
          icon={Calendar}
          title="Dny s docházkou"
          value={daysWithAttendance}
          subtitle={`z ${workingDays} pracovních`}
          color="text-purple-600"
        />
        <StatCard
          icon={Target}
          title="Průměr denně"
          value={averageHoursPerDay}
          subtitle="hodin"
          color="text-orange-600"
        />
      </div>

      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col lg:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-4">
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <h2 className="text-2xl font-bold text-center w-48 capitalize">
                {format(currentMonth, 'LLLL yyyy', { locale: cs })}
              </h2>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

            <Badge variant={currentStatus.variant} className="text-sm px-3 py-1">
              <StatusIcon className="w-4 h-4 mr-2" />
              {currentStatus.label}
            </Badge>

            <div className="flex flex-col sm:flex-row gap-2">
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
                >
                  <Calendar className="w-4 h-4 mr-2" />
                  Kalendář
                </Button>
                <Button
                  variant={viewMode === 'list' ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setViewMode('list')}
                >
                  <FileText className="w-4 h-4 mr-2" />
                  Seznam
                </Button>
              </div>
              <Button onClick={handleExport} variant="outline" disabled={attendance.length === 0}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              {isEditable && hasPermission('attendance', 'can_edit') && (
                <>
                  <Button onClick={() => { setEditingRecord(null); setSelectedDialogDate(new Date()); setIsAttendanceDialogOpen(true); }}>
                    <Plus className="w-4 h-4 mr-2" /> Přidat
                  </Button>
                  {attendance.length > 0 && (
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="default" className="bg-green-600 hover:bg-green-700">
                          <Send className="w-4 h-4 mr-2" /> Odeslat
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Odeslat docházku ke schválení?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Po odeslání již nebudete moci docházku pro tento měsíc upravovat, dokud nebude schválena nebo zamítnuta.
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
              )}
            </div>
          </div>
        </CardContent>
      </Card>

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

      {/* Work Summary for User */}
      {myWorkSummary.length > 0 && (
        <Card className="bg-slate-50 border-slate-200">
          <CardHeader className="py-4">
            <CardTitle className="text-base flex items-center gap-2">
              <BarChart3 className="w-4 h-4" /> Souhrn činností
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[100px]">Typ</TableHead>
                    <TableHead>Název</TableHead>
                    <TableHead className="text-right">Hodiny</TableHead>
                    {hourlyRate > 0 && <TableHead className="text-right">Odměna</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myWorkSummary.map(item => (
                    <TableRow key={item.id} className="hover:bg-slate-100">
                      <TableCell>
                        <Badge variant={item.type === 'Projekt' ? 'default' : 'secondary'}>{item.type}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{item.name}</div>
                        {item.code && <div className="text-xs text-muted-foreground">{item.code}</div>}
                      </TableCell>
                      <TableCell className="text-right font-bold">{item.hours.toFixed(1)}h</TableCell>
                      {hourlyRate > 0 && <TableCell className="text-right text-muted-foreground">{formatCurrency(item.cost)}</TableCell>}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Main Calendar/List View */}
      {viewMode === 'calendar' ? (
        <Card>
          <CardContent className="p-6">
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-muted-foreground mb-4 text-sm">
              {['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'].map(d => <div key={d}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {emptyDays.map((_, i) => <div key={`empty-${i}`} className="h-32" />)}
              {monthDays.map(day => {
                // Filter records for this day AND based on typeFilter
                const dayAttendance = filteredAttendance.filter(a => isSameDay(new Date(a.date), day));
                const dayHours = dayAttendance.reduce((sum, record) => sum + Number(record.hours), 0);
                const dayOfWeek = getDay(day);
                const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                const isTodayDate = isToday(day);
                const hasHours = dayHours > 0;

                return (
                  <motion.div
                    key={day.toString()}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => handleDayClick(day)}
                    className={cn(
                      "h-32 rounded-xl border p-3 flex flex-col justify-between transition-all duration-200 cursor-pointer relative group",
                      isWeekend ? "bg-slate-50/50" : "bg-white",
                      hasHours && "border-blue-200 bg-blue-50/30",
                      isTodayDate && "border-primary ring-2 ring-primary ring-offset-2",
                      "hover:shadow-md hover:border-primary/50"
                    )}
                  >
                    <div className="flex justify-between items-start">
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
                            {rec.projects?.code || rec.realizations?.name || '---'}
                          </div>
                        ))
                      ) : (
                        <div className="h-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Plus className="w-6 h-6 text-slate-300" />
                        </div>
                      )}
                      {dayAttendance.length > 3 && (
                        <div className="text-[9px] text-center text-muted-foreground">
                          +{dayAttendance.length - 3} další
                        </div>
                      )}
                    </div>
                  </motion.div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <FileText className="w-5 h-5" />
              Seznam záznamů
            </CardTitle>
          </CardHeader>
          <CardContent>
            {filteredAttendance.length > 0 ? (
              <div className="space-y-3">
                {filteredAttendance.map(record => (
                  <motion.div
                    key={record.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {record.project_id ? (
                          <Badge variant="default" className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> {record.projects?.code}</Badge>
                        ) : (
                          <Badge variant="secondary" className="flex items-center gap-1"><HardHat className="w-3 h-3" /> Realizace</Badge>
                        )}
                        <span className="font-medium">{record.projects?.name || record.realizations?.name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" /> {format(new Date(record.date), 'd. M. yyyy', { locale: cs })}</span>
                        {record.description && <span className="flex items-center gap-1 line-clamp-1"><FileText className="w-3 h-3" /> {record.description}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-6">
                      {hourlyRate > 0 && (
                        <div className="text-right hidden sm:block">
                          <div className="text-sm font-semibold text-slate-700">
                            {formatCurrency(Number(record.hours) * hourlyRate)}
                          </div>
                        </div>
                      )}
                      <div className="text-right w-20">
                        <div className="text-lg font-bold text-blue-600">
                          {Number(record.hours).toFixed(1)}h
                        </div>
                      </div>
                      {isEditable && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { setEditingRecord(record); setIsAttendanceDialogOpen(true); }}
                            title="Upravit"
                          >
                            <Edit2 className="w-4 h-4 text-slate-500" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeletingRecord(record)}
                            title="Smazat"
                            className="text-red-500 hover:text-red-600 hover:bg-red-50"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8">
                <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-muted-foreground">Žádné záznamy pro tento výběr.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Edit/Add Dialog */}
      <AttendanceDialog
        isOpen={isAttendanceDialogOpen}
        onClose={() => setIsAttendanceDialogOpen(false)}
        onSave={handleSaveAttendance}
        record={editingRecord}
        isAdmin={isAdmin}
        memberId={memberId}
        initialDate={selectedDialogDate}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={!!deletingRecord} onOpenChange={() => setDeletingRecord(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Smazat záznam?</AlertDialogTitle>
            <AlertDialogDescription>
              Opravdu chcete smazat tento záznam docházky?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteConfirmed} className="bg-destructive hover:bg-destructive/90">
              Smazat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </div>
  );
};


const Attendance = () => {
  const { toast } = useToast();
  const { user, hasPermission, memberId, userRole } = useAuth();
  const [attendanceEnabled, setAttendanceEnabled] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const getMemberInfo = async () => {
      if (user) {
        const { data: memberData, error: memberError } = await supabase
          .from('members')
          .select('id, attendance_enabled')
          .eq('auth_user_id', user.id)
          .single();

        if (!isMounted) return;

        if (memberError && memberError.code !== 'PGRST116') {
          // Silent error for admins without member profile
        } else if (memberData) {
          setAttendanceEnabled(memberData.attendance_enabled);
        }
      }
    };
    getMemberInfo();
    return () => { isMounted = false; };
  }, [user, toast]);

  const canViewAdminTabs = userRole === 'admin' || userRole === 'super_manager';

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
    <div className="app-page">
      <div className="space-y-6">
        <PageHeader
          icon={Clock}
          title="Docházka"
          description="Přehled vaší odpracované doby a správa docházky"
          actions={
            <>
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

        <Tabs defaultValue="my-attendance" className="w-full">
          <div className="glass-effect rounded-xl p-2 mb-6">
            <TabsList className="w-full grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4">
              <TabsTrigger value="my-attendance" className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                <span className="hidden sm:inline">Moje docházka</span>
                <span className="sm:hidden">Docházka</span>
              </TabsTrigger>
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
                  <TabsTrigger value="reporting" className="flex items-center gap-2">
                    <FileBarChart className="w-4 h-4" />
                    <span className="hidden sm:inline">Reporting</span>
                    <span className="sm:hidden">Report</span>
                  </TabsTrigger>
                </>
              )}
            </TabsList>
          </div>

          <TabsContent value="my-attendance" className="mt-6">
            <MyAttendance memberId={memberId} isAdmin={canViewAdminTabs} attendanceEnabled={attendanceEnabled} />
          </TabsContent>

          {canViewAdminTabs && (
            <>
              <TabsContent value="submissions" className="mt-6">
                <div className="glass-effect rounded-xl p-6">
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
                <div className="glass-effect rounded-xl p-6">
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
              <TabsContent value="reporting" className="mt-6">
                <div className="glass-effect rounded-xl p-6">
                  <AttendanceReporting />
                </div>
              </TabsContent>
            </>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default Attendance;
