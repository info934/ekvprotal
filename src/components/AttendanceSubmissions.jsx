import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Check, X, Send, MessageSquare, CornerUpLeft, Clock, Users, TrendingUp,
  Target, BarChart3, Eye, EyeOff, MoreHorizontal, Edit2, Calendar, FileText,
  AlertTriangle, CheckCircle, Hourglass, DollarSign, Timer, RefreshCw, Mail
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { format, startOfMonth, endOfMonth } from 'date-fns';
import { cs } from 'date-fns/locale';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn, formatCurrency } from '@/lib/utils';
import { sendEmail } from '@/lib/email';

// Modern UI Components implemented directly in file
const Badge = ({ children, variant = "default", className, ...props }) => {
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/80",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
    outline: "text-foreground border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    success: "bg-green-100 text-green-800 border-green-200",
    warning: "bg-orange-100 text-orange-800 border-orange-200",
    info: "bg-blue-100 text-blue-800 border-blue-200"
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

const Card = ({ children, className, ...props }) => (
  <div
    className={cn("rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow", className)}
    {...props}
  >
    {children}
  </div>
);

const CardContent = ({ children, className, ...props }) => (
  <div className={cn("p-6 pt-0", className)} {...props}>
    {children}
  </div>
);

const CardHeader = ({ children, className, ...props }) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props}>
    {children}
  </div>
);

const CardTitle = ({ children, className, ...props }) => (
  <h3 className={cn("font-semibold leading-none tracking-tight", className)} {...props}>
    {children}
  </h3>
);

const StatCard = ({ icon: Icon, title, value, subtitle, trend, color = "text-blue-600", className, ...props }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -4, scale: 1.02 }}
    className={cn("group bg-white border rounded-xl p-6 cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all duration-200", className)}
    {...props}
  >
    <div className="flex items-center justify-between mb-4">
      <div className={cn("p-3 bg-muted rounded-lg", color)}>
        <Icon className="w-6 h-6" />
      </div>
      {trend && (
        <Badge variant={trend > 0 ? "success" : "warning"} className="text-xs">
          <TrendingUp className="w-3 h-3 mr-1" />
          {trend > 0 ? '+' : ''}{trend}%
        </Badge>
      )}
    </div>
    <div className="space-y-2">
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-3xl font-bold">{value}</p>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  </motion.div>
);

const statusConfig = {
  submitted: {
    label: 'Čeká na schválení',
    color: 'text-orange-500',
    bg: 'bg-orange-100',
    icon: Hourglass,
    variant: 'warning'
  },
  approved: {
    label: 'Schváleno',
    color: 'text-green-500',
    bg: 'bg-green-100',
    icon: CheckCircle,
    variant: 'success'
  },
  rejected: {
    label: 'Zamítnuto',
    color: 'text-red-500',
    bg: 'bg-red-100',
    icon: X,
    variant: 'destructive'
  },
};

const parseEmails = (value = '') => value
  .split(',')
  .map((email) => email.trim())
  .filter(Boolean);

const AttendanceSubmissions = () => {
  const { toast } = useToast();
  const { user } = useAuth();
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('submitted');
  const [isRejectDialogOpen, setIsRejectDialogOpen] = useState(false);
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [selectedSubmission, setSelectedSubmission] = useState(null);
  const [accountingEmails, setAccountingEmails] = useState([]);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [sendingAccountingId, setSendingAccountingId] = useState(null);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('attendance_submissions')
      .select('*, member:members(name, email, hourly_rate)')
      .eq('status', activeTab)
      .order('submitted_at', { ascending: true });

    if (error) {
      toast({ title: 'Chyba při načítání žádostí', description: error.message, variant: 'destructive' });
    } else {
      setSubmissions(data);
    }
    setLoading(false);
  }, [toast, activeTab]);

  const fetchAccountingEmails = useCallback(async () => {
    setSettingsLoading(true);
    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'accounting_email')
      .maybeSingle();

    if (error) {
      toast({ title: 'Chyba při načítání nastavení', description: error.message, variant: 'destructive' });
    } else {
      setAccountingEmails(parseEmails(data?.value || ''));
    }
    setSettingsLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchSubmissions();
  }, [fetchSubmissions]);

  useEffect(() => {
    fetchAccountingEmails();
  }, [fetchAccountingEmails]);

  const generateProjectCosts = async (submission) => {
    const hourlyRate = submission.member?.hourly_rate;
    if (!hourlyRate || hourlyRate <= 0) {
      toast({ title: 'Projektové náklady nebyly vytvořeny', description: 'Projektant nemá nastavenou hodinovou sazbu.', variant: 'default' });
      return;
    }

    // Check if costs for this submission already exist
    const { data: existingCosts, error: checkError } = await supabase
      .from('project_costs')
      .select('id')
      .eq('attendance_submission_id', submission.id);

    if (checkError) {
      toast({ title: 'Chyba při kontrole nákladů', description: checkError.message, variant: 'destructive' });
      return;
    }

    if (existingCosts.length > 0) {
      // Costs already exist, maybe delete them and regenerate? Or just skip. For now, skip.
      toast({ title: 'Náklady již existují', description: 'Náklady pro tuto docházku již byly dříve vygenerovány.', variant: 'default' });
      return;
    }

    const startDate = format(startOfMonth(new Date(submission.month_date)), 'yyyy-MM-dd');
    const endDate = format(endOfMonth(new Date(submission.month_date)), 'yyyy-MM-dd');

    const { data: attendanceData, error: attendanceError } = await supabase
      .from('attendance')
      .select('project_id, hours')
      .eq('member_id', submission.member_id)
      .gte('date', startDate)
      .lte('date', endDate);

    if (attendanceError) {
      toast({ title: 'Chyba při načítání docházky pro náklady', description: attendanceError.message, variant: 'destructive' });
      return;
    }

    const costsByProject = attendanceData.reduce((acc, record) => {
      if (!acc[record.project_id]) {
        acc[record.project_id] = 0;
      }
      acc[record.project_id] += Number(record.hours);
      return acc;
    }, {});

    const costsToInsert = Object.entries(costsByProject).map(([projectId, totalHours]) => ({
      project_id: projectId,
      description: `Náklady na docházku - ${submission.member.name} - ${format(new Date(submission.month_date), 'LLLL yyyy', { locale: cs })}`,
      amount: totalHours * hourlyRate,
      created_at: new Date().toISOString(),
      is_attendance_cost: true,
      attendance_submission_id: submission.id,
    }));

    if (costsToInsert.length > 0) {
      const { error: insertError } = await supabase.from('project_costs').insert(costsToInsert);
      if (insertError) {
        toast({ title: 'Chyba při generování projektových nákladů', description: insertError.message, variant: 'destructive' });
      } else {
        toast({ title: '✅ Projektové náklady vygenerovány!' });
      }
    }
  };

  const sendAttendanceApprovedEmail = async (submission) => {
    if (!submission.member?.email) {
      console.error("Cannot send email: member email not found.");
      return;
    }

    const month = format(new Date(submission.month_date), 'LLLL yyyy', { locale: cs });
    const subject = `Vaše docházka za ${month} byla schválena`;

    await sendEmail({
      to: submission.member.email,
      subject,
      greeting: `Dobrý den, ${submission.member.name},`,
      content: `
        <p>Vaše docházka za období <strong>${month}</strong> byla úspěšně schválena.</p>
        <p>Celkem bylo schváleno <strong>${submission.total_hours} hodin</strong>.</p>
      `,
      salutation: 'S pozdravem,<br>Tým EKV',
    });
  };

  const sendAccountingReport = async (submission, { manual = false } = {}) => {
    if (settingsLoading) {
      toast({ title: 'Nastavení se načítá', description: 'Zkuste to prosím za chvíli.', variant: 'default' });
      return;
    }

    if (!accountingEmails.length) {
      toast({ title: 'Není nastaven e-mail účetní', description: 'Doplňte adresu v Nastavení portálu.', variant: 'destructive' });
      return;
    }

    setSendingAccountingId(submission.id);

    const startDate = format(startOfMonth(new Date(submission.month_date)), 'yyyy-MM-dd');
    const endDate = format(endOfMonth(new Date(submission.month_date)), 'yyyy-MM-dd');

    try {
      const { data: attendanceData, error } = await supabase
        .from('attendance')
        .select('date, hours, description, projects(name, code)')
        .eq('member_id', submission.member_id)
        .gte('date', startDate)
        .lte('date', endDate)
        .order('date', { ascending: true });

      if (error) {
        toast({ title: 'Chyba při načítání docházky pro report', description: error.message, variant: 'destructive' });
        return;
      }

      const month = format(new Date(submission.month_date), 'LLLL yyyy', { locale: cs });
      const totalHours = attendanceData.reduce((sum, record) => sum + Number(record.hours || 0), 0);
      const projectTotals = attendanceData.reduce((acc, record) => {
        const key = record.projects?.code || record.projects?.name || 'Neznámý projekt';
        const hours = Number(record.hours || 0);
        acc[key] = (acc[key] || 0) + hours;
        return acc;
      }, {});

      const projectSummaryRows = Object.entries(projectTotals)
        .map(([project, hours]) => `<tr><td style="padding:6px 8px;border:1px solid #e5e7eb;">${project}</td><td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;">${hours.toFixed(2)} h</td></tr>`)
        .join('');

      const detailRows = attendanceData.map((record) => `
        <tr>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${format(new Date(record.date), 'd.M.yyyy')}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${record.projects?.code || ''}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${record.projects?.name || ''}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;">${Number(record.hours || 0).toFixed(2)}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${record.description || ''}</td>
        </tr>
      `).join('');

      const estimatedValue = submission.member?.hourly_rate
        ? (totalHours * Number(submission.member.hourly_rate)).toLocaleString('cs-CZ')
        : null;

      const content = `
        <p>Report docházky za <strong>${month}</strong> pro projektanta <strong>${submission.member.name}</strong>.</p>
        <p><strong>Souhrn:</strong></p>
        <ul>
          <li>Celkem hodin: <strong>${totalHours.toFixed(2)}</strong></li>
          ${estimatedValue ? `<li>Odhadovaná hodnota: <strong>${estimatedValue} Kč</strong></li>` : ''}
        </ul>
        ${projectSummaryRows ? `
        <p><strong>Souhrn podle projektů:</strong></p>
        <table style="border-collapse:collapse;font-size:14px;width:100%;margin-bottom:12px;">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px 8px;border:1px solid #e5e7eb;">Projekt</th>
              <th style="text-align:right;padding:6px 8px;border:1px solid #e5e7eb;">Hodin</th>
            </tr>
          </thead>
          <tbody>${projectSummaryRows}</tbody>
        </table>` : ''}
        <p><strong>Detailní záznamy:</strong></p>
        <table style="border-collapse:collapse;font-size:13px;width:100%;">
          <thead>
            <tr>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Datum</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Kód</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Projekt</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;">Hodin</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Popis</th>
            </tr>
          </thead>
          <tbody>
            ${detailRows || '<tr><td colspan="5" style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center;">Žádné záznamy</td></tr>'}
          </tbody>
        </table>
      `;

      const subject = `Docházkový report - ${submission.member.name} - ${month}`;

      await Promise.all(accountingEmails.map((email) => sendEmail({
        to: email,
        subject,
        greeting: 'Dobrý den,',
        content,
        salutation: 'S pozdravem,<br>EKV Portál',
      })));

      toast({ title: manual ? 'Report odeslán účetní' : 'Report odeslán účetní automaticky' });
    } catch (error) {
      toast({ title: 'Chyba při odesílání reportu', description: error.message, variant: 'destructive' });
    } finally {
      setSendingAccountingId(null);
    }
  };

  const handleApprove = async (submission) => {
    const { error } = await supabase
      .from('attendance_submissions')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approver_id: user.id
      })
      .eq('id', submission.id);

    if (error) {
      toast({ title: 'Chyba při schvalování', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Docházka schválena!' });
      await generateProjectCosts(submission);
      await sendAttendanceApprovedEmail(submission);
      await sendAccountingReport(submission);
      fetchSubmissions();
    }
  };

  const handleReject = async () => {
    if (!selectedSubmission) return;

    const { error } = await supabase
      .from('attendance_submissions')
      .update({
        status: 'rejected',
        notes: rejectionNotes,
        approver_id: user.id
      })
      .eq('id', selectedSubmission.id);

    if (error) {
      toast({ title: 'Chyba při zamítání', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '❌ Docházka zamítnuta.' });
      fetchSubmissions();
    }
    setIsRejectDialogOpen(false);
    setRejectionNotes('');
    setSelectedSubmission(null);
  };

  const handleRevert = async (submission) => {
    // For approved submissions, delete associated project costs first
    if (submission.status === 'approved') {
      const { error: deleteError } = await supabase
        .from('project_costs')
        .delete()
        .eq('attendance_submission_id', submission.id);

      if (deleteError) {
        toast({ title: 'Chyba při mazání nákladů', description: 'Docházku se nepodařilo vrátit k úpravě.', variant: 'destructive' });
        return;
      }
    }

    // Then, revert the submission status
    const revertMessage = submission.status === 'approved'
      ? `Vráceno k úpravě administrátorem ${user.email} dne ${format(new Date(), 'd.M.yyyy')}.`
      : `Zamítnutá docházka vrácena k úpravě administrátorem ${user.email} dne ${format(new Date(), 'd.M.yyyy')}.`;

    const { error: revertError } = await supabase
      .from('attendance_submissions')
      .update({
        status: 'draft',
        notes: revertMessage,
        approver_id: null,
        approved_at: null,
      })
      .eq('id', submission.id);

    if (revertError) {
      toast({ title: 'Chyba při vracení k úpravě', description: revertError.message, variant: 'destructive' });
    } else {
      const successMessage = submission.status === 'approved'
        ? 'Schválená docházka vrácena k úpravě'
        : 'Zamítnutá docházka vrácena k úpravě';
      toast({ title: successMessage });
      fetchSubmissions();
    }
  };

  const openRejectDialog = (submission) => {
    setSelectedSubmission(submission);
    setIsRejectDialogOpen(true);
  };

  // Calculate statistics
  const stats = useMemo(() => {
    const submitted = submissions.filter(s => s.status === 'submitted').length;
    const approved = submissions.filter(s => s.status === 'approved').length;
    const rejected = submissions.filter(s => s.status === 'rejected').length;
    const totalHours = submissions.reduce((sum, s) => sum + Number(s.total_hours), 0);
    const totalValue = submissions.reduce((sum, s) => {
      const hourlyRate = s.member?.hourly_rate || 0;
      return sum + (Number(s.total_hours) * hourlyRate);
    }, 0);

    return {
      submitted,
      approved,
      rejected,
      totalHours: totalHours.toFixed(1),
      totalValue
    };
  }, [submissions]);

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard
          icon={Hourglass}
          title="Ke schválení"
          value={stats.submitted}
          subtitle="čekajících"
          color="text-orange-600"
        />
        <StatCard
          icon={CheckCircle}
          title="Schválené"
          value={stats.approved}
          subtitle="potvrzených"
          color="text-green-600"
        />
        <StatCard
          icon={X}
          title="Zamítnuté"
          value={stats.rejected}
          subtitle="odmítnutých"
          color="text-red-600"
        />
        <StatCard
          icon={DollarSign}
          title="Celková hodnota"
          value={formatCurrency(stats.totalValue)}
          subtitle={`${stats.totalHours}h`}
          color="text-blue-600"
        />
      </div>

      {/* Main Content with Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <Card>
          <CardContent className="p-6">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="submitted" className="flex items-center gap-2">
                <Hourglass className="w-4 h-4" />
                Ke schválení
                {stats.submitted > 0 && (
                  <Badge variant="warning" className="ml-2 text-xs">
                    {stats.submitted}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="approved" className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Schválené
                {stats.approved > 0 && (
                  <Badge variant="success" className="ml-2 text-xs">
                    {stats.approved}
                  </Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="rejected" className="flex items-center gap-2">
                <X className="w-4 h-4" />
                Zamítnuté
                {stats.rejected > 0 && (
                  <Badge variant="destructive" className="ml-2 text-xs">
                    {stats.rejected}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>
          </CardContent>
        </Card>

        {/* Submissions Content */}
        <TabsContent value={activeTab} className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {React.createElement(statusConfig[activeTab].icon, { className: "w-5 h-5" })}
                {statusConfig[activeTab].label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <RefreshCw className="w-6 h-6 animate-spin mr-2" />
                  Načítání...
                </div>
              ) : submissions.length > 0 ? (
                <div className="space-y-3">
                  {submissions.map((sub, index) => (
                    <motion.div
                      key={sub.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div className="font-semibold text-lg">{sub.member.name}</div>
                          <Badge variant={statusConfig[activeTab].variant}>
                            {format(new Date(sub.month_date), 'LLLL yyyy', { locale: cs })}
                          </Badge>
                        </div>
                        <div className="flex items-center gap-4 text-sm text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-4 h-4" />
                            Odesláno: {format(new Date(sub.submitted_at), 'd.M.yyyy HH:mm')}
                          </span>
                          <span className="flex items-center gap-1">
                            <DollarSign className="w-4 h-4" />
                            {sub.member.hourly_rate ? `${formatCurrency(sub.member.hourly_rate)} /h` : 'Nenastaveno'}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="text-2xl font-bold text-blue-600">
                            {Number(sub.total_hours).toFixed(1)}h
                          </div>
                          {sub.member.hourly_rate && (
                            <div className="text-sm text-muted-foreground">
                              {formatCurrency(Number(sub.total_hours) * sub.member.hourly_rate)}
                            </div>
                          )}
                        </div>
                        <div className="flex gap-2">
                          {activeTab === 'submitted' && (
                            <>
                              <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => handleApprove(sub)}>
                                <Check className="w-4 h-4 mr-2" />
                                Schválit
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => openRejectDialog(sub)}>
                                <X className="w-4 h-4 mr-2" />
                                Zamítnout
                              </Button>
                            </>
                          )}
                          {activeTab === 'approved' && (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => sendAccountingReport(sub, { manual: true })}
                                disabled={settingsLoading || sendingAccountingId === sub.id}
                              >
                                <Mail className="w-4 h-4 mr-2" />
                                {sendingAccountingId === sub.id ? 'Odesílám...' : 'Poslat účetní'}
                              </Button>
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button size="sm" variant="outline">
                                    <CornerUpLeft className="w-4 h-4 mr-2" />
                                    Vrátit
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Vrátit docházku k úpravě?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Tato akce vrátí docházku do stavu konceptu a smaže vygenerované náklady. Uživatel bude moci docházku znovu upravit a odeslat.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleRevert(sub)}>Vrátit</AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </>
                          )}
                          {activeTab === 'rejected' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button size="sm" variant="outline">
                                  <CornerUpLeft className="w-4 h-4 mr-2" />
                                  Vrátit k úpravě
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Vrátit zamítnutou docházku k úpravě?</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Tato akce vrátí zamítnutou docházku do stavu konceptu. Uživatel bude moci docházku znovu upravit a odeslat ke schválení.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => handleRevert(sub)}>Vrátit k úpravě</AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <FileText className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">Žádné žádosti v tomto stavu.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Reject Dialog */}
      <AlertDialog open={isRejectDialogOpen} onOpenChange={setIsRejectDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <X className="w-5 h-5 text-red-500" />
              Zamítnout docházku?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Můžete přidat poznámku pro uživatele, proč byla docházka zamítnuta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-4">
            {selectedSubmission && (
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="font-medium">{selectedSubmission.member.name}</div>
                <div className="text-sm text-muted-foreground">
                  {format(new Date(selectedSubmission.month_date), 'LLLL yyyy', { locale: cs })} • {Number(selectedSubmission.total_hours).toFixed(1)}h
                </div>
              </div>
            )}
            <div className="relative">
              <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Důvod zamítnutí (nepovinné)..."
                value={rejectionNotes}
                onChange={(e) => setRejectionNotes(e.target.value)}
                className="pl-10"
              />
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={handleReject} className="bg-red-600 hover:bg-red-700">
              Zamítnout
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AttendanceSubmissions;