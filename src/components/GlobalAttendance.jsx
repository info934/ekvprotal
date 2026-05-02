import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Download,
  ChevronLeft,
  ChevronRight,
  Users,
  Trash2,
  Timer,
  TrendingUp,
  Target,
  BarChart3,
  FileText,
  Mail,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import * as XLSX from 'xlsx';
import { cn } from '@/lib/utils';
import { sendEmail } from '@/lib/email';

const Badge = ({ children, variant = 'default', className, ...props }) => {
  const variants = {
    default: 'bg-primary text-primary-foreground hover:bg-primary/80',
    secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
    destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/80',
    outline: 'text-foreground border border-input bg-background hover:bg-accent hover:text-accent-foreground',
    success: 'bg-green-100 text-green-800 border-green-200',
    warning: 'bg-orange-100 text-orange-800 border-orange-200',
    info: 'bg-blue-100 text-blue-800 border-blue-200',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border',
        variants[variant],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
};

const Card = ({ children, className, ...props }) => (
  <div className={cn('rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow', className)} {...props}>
    {children}
  </div>
);

const CardContent = ({ children, className, ...props }) => (
  <div className={cn('p-6 pt-0', className)} {...props}>
    {children}
  </div>
);

const CardHeader = ({ children, className, ...props }) => (
  <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props}>
    {children}
  </div>
);

const CardTitle = ({ children, className, ...props }) => (
  <h3 className={cn('font-semibold leading-none tracking-tight', className)} {...props}>
    {children}
  </h3>
);

const parseEmails = (value = '') =>
  value
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean);

const StatCard = ({ icon: Icon, title, value, subtitle, trend, color = 'text-blue-600', className, ...props }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -4, scale: 1.02 }}
    className={cn(
      'group bg-white border rounded-xl p-6 cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all duration-200',
      className,
    )}
    {...props}
  >
    <div className="flex items-center justify-between mb-4">
      <div className={cn('p-3 bg-muted rounded-lg', color)}>
        <Icon className="w-6 h-6" />
      </div>
      {trend && (
        <Badge variant={trend > 0 ? 'success' : 'warning'} className="text-xs">
          <TrendingUp className="w-3 h-3 mr-1" />
          {trend > 0 ? '+' : ''}
          {trend}%
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

const GlobalAttendance = () => {
  const { toast } = useToast();
  const { isAdmin } = useAuth();
  const [attendance, setAttendance] = useState([]);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState([]);
  const [selectedMember, setSelectedMember] = useState('all');
  const [accountingEmails, setAccountingEmails] = useState([]);
  const [sendingGlobalReport, setSendingGlobalReport] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(true);

  useEffect(() => {
    const fetchMembers = async () => {
      const { data, error } = await supabase.from('members').select('id, name').order('name');
      if (error) {
        toast({ title: 'Chyba při načítání projektantů', variant: 'destructive' });
      } else {
        setMembers(data);
      }
    };
    fetchMembers();
  }, [toast]);

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

  const fetchAttendance = useCallback(async () => {
    setLoading(true);
    const startDate = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
    const endDate = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

    let query = supabase
      .from('attendance')
      .select('*, projects(name), members(id, name)')
      .gte('date', startDate)
      .lte('date', endDate)
      .order('date', { ascending: false });

    if (selectedMember !== 'all') {
      query = query.eq('member_id', selectedMember);
    }

    const { data, error } = await query;

    if (error) {
      toast({ title: 'Chyba při načítání docházky', description: error.message, variant: 'destructive' });
    } else {
      setAttendance(data);
    }
    setLoading(false);
  }, [toast, currentMonth, selectedMember]);

  useEffect(() => {
    fetchAttendance();
  }, [fetchAttendance]);

  useEffect(() => {
    fetchAccountingEmails();
  }, [fetchAccountingEmails]);

  const handleDeleteRecord = async (recordId) => {
    const { error } = await supabase.from('attendance').delete().eq('id', recordId);
    if (error) {
      toast({ title: 'Chyba při mazání záznamu', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '✅ Záznam úspěšně smazán' });
      fetchAttendance();
    }
  };

  const handleSendAccountingReport = async () => {
    if (settingsLoading) {
      toast({ title: 'Nastavení se načítá', description: 'Zkuste to prosím za chvíli.', variant: 'default' });
      return;
    }

    if (!accountingEmails.length) {
      toast({ title: 'Není nastaven e-mail účetní', description: 'Doplňte adresu v Nastavení portálu.', variant: 'destructive' });
      return;
    }

    if (attendance.length === 0) {
      toast({ title: 'Žádná data k odeslání', description: 'Za zvolené období nejsou dostupné záznamy docházky.', variant: 'destructive' });
      return;
    }

    setSendingGlobalReport(true);

    try {
      const month = format(currentMonth, 'LLLL yyyy', { locale: cs });
      const summaryRows = memberStats
        .map(
          (member, index) => `
        <tr>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${index + 1}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${member.name}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;">${member.totalHours.toFixed(2)}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;">${member.recordCount}</td>
          <td style="padding:6px 8px;border:1px solid #e5e7eb;">${member.projectCount}</td>
        </tr>
      `,
        )
        .join('');

      const content = `
        <p>Souhrnný docházkový report za <strong>${month}</strong>.</p>
        <p>Celkem hodin: <strong>${totalHours.toFixed(2)}</strong></p>
        <p><strong>Přehled podle projektantů:</strong></p>
        <table style="border-collapse:collapse;font-size:14px;width:100%;">
          <thead>
            <tr>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">#</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Projektant</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;">Hodin</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:right;">Záznamů</th>
              <th style="padding:6px 8px;border:1px solid #e5e7eb;text-align:left;">Počet projektů</th>
            </tr>
          </thead>
          <tbody>
            ${summaryRows || '<tr><td colspan="5" style="padding:6px 8px;border:1px solid #e5e7eb;text-align:center;">Žádná data</td></tr>'}
          </tbody>
        </table>
      `;

      const detailRows = [
        ['Projektant', 'Datum', 'Projekt', 'Hodin', 'Popis'],
        ...attendance.map((record) => [
          record.members?.name || '',
          format(new Date(record.date), 'd.M.yyyy'),
          record.projects?.name || '',
          Number(record.hours || 0),
          record.description || '',
        ]),
      ];

      const summarySheet = XLSX.utils.aoa_to_sheet([
        ['#', 'Projektant', 'Hodin', 'Záznamů', 'Počet projektů'],
        ...memberStats.map((m, idx) => [idx + 1, m.name, Number(m.totalHours.toFixed(2)), m.recordCount, m.projectCount]),
        [],
        ['Celkem hodin', totalHours],
      ]);
      const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Souhrn');
      XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detaily');
      const base64Xlsx = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

      await Promise.all(
        accountingEmails.map((email) =>
          sendEmail({
            to: email,
            subject: `Docházkový report - celkový - ${month}`,
            greeting: 'Dobrý den,',
            content,
            salutation: 'S pozdravem,<br>EKV Portál',
            attachments: [
              {
                filename: `dochazka_celkem_${format(currentMonth, 'MM-yyyy')}.xlsx`,
                content: base64Xlsx,
                encoding: 'base64',
              },
            ],
          }),
        ),
      );

      toast({ title: 'Report odeslán účetní' });
    } catch (error) {
      toast({ title: 'Chyba při odesílání reportu', description: error.message, variant: 'destructive' });
    }

    setSendingGlobalReport(false);
  };

  const handleExport = () => {
    const totalHours = attendance.reduce((sum, record) => sum + Number(record.hours), 0);

    const exportData = attendance.map((record) => ({
      Datum: format(new Date(record.date), 'd.M.yyyy'),
      Projektant: record.members?.name || 'Neznámý',
      Projekt: record.projects?.name || 'Neznámý',
      'Počet hodin': Number(record.hours).toFixed(2),
      Popis: record.description,
    }));

    const summaryData = [{}, { Datum: 'Celkem hodin', 'Počet hodin': totalHours.toFixed(2) }];

    const worksheet = XLSX.utils.json_to_sheet(exportData);
    XLSX.utils.sheet_add_json(worksheet, summaryData, { skipHeader: true, origin: -1 });

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Docházka');

    const selectedMemberName = members.find((m) => m.id === selectedMember)?.name || 'vsichni';
    const fileName = `globalni_dochazka_${selectedMemberName.replace(/\s/g, '_')}_${format(currentMonth, 'MM-yyyy')}.xlsx`;
    XLSX.writeFile(workbook, fileName);

    toast({ title: '✅ Export úspěšně vygenerován!' });
  };

  const totalHours = useMemo(() => {
    return attendance.reduce((sum, record) => sum + Number(record.hours), 0);
  }, [attendance]);

  const memberStats = useMemo(() => {
    const stats = {};
    attendance.forEach((record) => {
      const memberId = record.member_id;
      const memberName = record.members?.name || 'Neznámý';

      if (!stats[memberId]) {
        stats[memberId] = {
          id: memberId,
          name: memberName,
          totalHours: 0,
          recordCount: 0,
          projects: new Set(),
        };
      }

      stats[memberId].totalHours += Number(record.hours);
      stats[memberId].recordCount += 1;
      if (record.projects?.name) {
        stats[memberId].projects.add(record.projects.name);
      }
    });

    return Object.values(stats)
      .map((stat) => ({
        ...stat,
        projects: Array.from(stat.projects),
        projectCount: stat.projects.size,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);
  }, [attendance]);

  const averageHoursPerMember = useMemo(() => {
    return memberStats.length > 0 ? (totalHours / memberStats.length).toFixed(1) : '0';
  }, [totalHours, memberStats.length]);

  const mostActiveMember = useMemo(() => {
    return memberStats.length > 0 ? memberStats[0] : null;
  }, [memberStats]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon={Timer} title="Celkem hodin" value={totalHours.toFixed(1)} subtitle="za měsíc" color="text-blue-600" />
        <StatCard icon={Users} title="Aktivní členové" value={memberStats.length} subtitle="projektanti" color="text-green-600" />
        <StatCard icon={Target} title="Průměr na člena" value={averageHoursPerMember} subtitle="hodin" color="text-purple-600" />
        <StatCard
          icon={BarChart3}
          title="Nejaktivnější"
          value={mostActiveMember ? mostActiveMember.name.split(' ')[0] : 'N/A'}
          subtitle={mostActiveMember ? `${mostActiveMember.totalHours.toFixed(1)}h` : ''}
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
              <h2 className="text-2xl font-bold text-center w-48 capitalize">{format(currentMonth, 'LLLL yyyy', { locale: cs })}</h2>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

            <div className="flex flex-col sm:flex-row gap-4 items-center">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-muted-foreground" />
                <Select value={selectedMember} onValueChange={setSelectedMember}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Vyberte projektanta" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všichni projektanti</SelectItem>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button onClick={handleSendAccountingReport} disabled={attendance.length === 0 || sendingGlobalReport || settingsLoading}>
                <Mail className="w-4 h-4 mr-2" />
                {sendingGlobalReport ? 'Odesílám...' : 'Poslat účetní report'}
              </Button>
              <Button onClick={handleExport} variant="outline" disabled={attendance.length === 0}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="summary" className="w-full">
        <Card>
          <CardContent className="p-6">
            <TabsList className="grid grid-cols-2 w-full">
              <TabsTrigger value="summary" className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4" />
                Souhrn
              </TabsTrigger>
              <TabsTrigger value="details" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Detailní záznamy
              </TabsTrigger>
            </TabsList>
          </CardContent>
        </Card>

        <TabsContent value="summary" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="w-5 h-5" />
                Souhrn podle projektantů
              </CardTitle>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                  <span className="ml-2">Načítání...</span>
                </div>
              ) : memberStats.length > 0 ? (
                <div className="space-y-3">
                  {memberStats.map((member, index) => (
                    <motion.div
                      key={member.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                      className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-600 rounded-full font-bold text-sm">
                          {index + 1}
                        </div>
                        <div>
                          <div className="font-semibold text-lg">{member.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {member.recordCount} záznamů • {member.projectCount} projektů
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-2xl font-bold text-blue-600">{member.totalHours.toFixed(1)}h</div>
                        <div className="text-sm text-muted-foreground">
                          {((member.totalHours / totalHours) * 100).toFixed(1)}% z celku
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <Users className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                  <p className="text-muted-foreground">Žádné záznamy pro tento měsíc.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="details" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                Detailní záznamy docházky
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="max-h-[60vh] overflow-y-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white z-10">
                    <TableRow>
                      <TableHead>Projektant</TableHead>
                      <TableHead>Datum</TableHead>
                      <TableHead>Projekt</TableHead>
                      <TableHead>Popis</TableHead>
                      <TableHead className="text-right">Hodin</TableHead>
                      {isAdmin && <TableHead className="text-right">Akce</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loading ? (
                      <TableRow>
                        <TableCell colSpan={isAdmin ? 6 : 5} className="text-center h-24">
                          <div className="flex items-center justify-center">
                            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600 mr-2"></div>
                            Načítání...
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : attendance.length > 0 ? (
                      attendance.map((record) => (
                        <TableRow key={record.id}>
                          <TableCell className="font-medium">{record.members?.name || 'Neznámý'}</TableCell>
                          <TableCell>{format(new Date(record.date), 'd.M.yyyy')}</TableCell>
                          <TableCell>{record.projects?.name}</TableCell>
                          <TableCell className="max-w-[200px] truncate">{record.description}</TableCell>
                          <TableCell className="text-right font-medium">{Number(record.hours).toFixed(2)}</TableCell>
                          {isAdmin && (
                            <TableCell className="text-right">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button variant="ghost" size="icon">
                                    <Trash2 className="w-4 h-4 text-red-500" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Opravdu smazat tento záznam?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      Tato akce je nevratná. Záznam bude trvale odstraněn.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => handleDeleteRecord(record.id)} className="bg-red-600 hover:bg-red-700">
                                      Smazat
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </TableCell>
                          )}
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={isAdmin ? 6 : 5} className="text-center h-24 text-muted-foreground">
                          Žádné záznamy pro tento měsíc a filtr.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default GlobalAttendance;