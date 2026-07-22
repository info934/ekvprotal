import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Download,
  ChevronLeft,
  ChevronRight,
  Calculator,
  DollarSign,
  Users,
  RefreshCw,
  Mail,
  Send,
  Search,
  Check,
  X,
  Hourglass,
  ShieldCheck,
  AlertTriangle,
  FileText
} from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { loadXlsx } from '@/lib/xlsx';
import { useToast } from '@/components/ui/use-toast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from '@/components/ui/alert-dialog';
import { sendEmail } from '@/lib/email';
import { DataVizMetricCard } from '@/components/ui/data-viz';

const STATUS_CONFIG = {
  draft: { label: 'Koncept', className: 'border-slate-200 bg-slate-100 text-slate-700', icon: FileText, tone: 'slate' },
  submitted: { label: 'Ke schválení', className: 'border-orange-200 bg-orange-50 text-orange-700', icon: Hourglass, tone: 'orange' },
  approved: { label: 'Schváleno', className: 'border-emerald-200 bg-emerald-50 text-emerald-700', icon: ShieldCheck, tone: 'green' },
  rejected: { label: 'Zamítnuto', className: 'border-red-200 bg-red-50 text-red-700', icon: AlertTriangle, tone: 'red' },
  returned: { label: 'Vráceno k úpravě', className: 'border-amber-200 bg-amber-50 text-amber-700', icon: Hourglass, tone: 'orange' },
  missing: { label: 'Neodesláno', className: 'border-slate-200 bg-white text-slate-500', icon: FileText, tone: 'slate' }
};

const escapeHtml = (value) => String(value ?? '')
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;');

const parseRecipients = (value) => value
  .split(/[;,]/)
  .map((email) => email.trim())
  .filter(Boolean);

const isValidEmailList = (value) => {
  const recipients = parseRecipients(value);
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return recipients.length > 0 && recipients.every((email) => emailRegex.test(email));
};

const StatusBadge = ({ status }) => {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.missing;
  return (
    <Badge variant="outline" className={`whitespace-nowrap font-semibold ${config.className}`}>
      {config.label}
    </Badge>
  );
};

const setColumnWidths = (sheet, widths) => {
  sheet['!cols'] = widths.map((wch) => ({ wch }));
};

const setAutoFilter = (sheet, range) => {
  sheet['!autofilter'] = { ref: range };
};

const applyNumberFormat = (sheet, columns, fromRow, toRow, formatCode) => {
  columns.forEach((col) => {
    for (let row = fromRow; row <= toRow; row += 1) {
      const cellRef = `${col}${row}`;
      if (sheet[cellRef]) sheet[cellRef].z = formatCode;
    }
  });
};

const AttendanceReporting = () => {
  const { toast } = useToast();
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [submissions, setSubmissions] = useState([]);
  const [members, setMembers] = useState([]);
  const [selectedMemberIds, setSelectedMemberIds] = useState([]);
  const [memberSearch, setMemberSearch] = useState('');
  const [accountingEmail, setAccountingEmail] = useState('');
  const [tempEmail, setTempEmail] = useState('');
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);

  useEffect(() => {
    const fetchInitialData = async () => {
      const [membersResult, compensationResult] = await Promise.all([
        supabase
          .from('members')
          .select('id, name')
          .eq('attendance_enabled', true)
          .order('name'),
        supabase.rpc('list_member_compensations_admin'),
      ]);
      const { data: membersData, error: membersError } = membersResult;

      if (membersError) {
        toast({ title: 'Chyba při načítání pracovníků', description: membersError.message, variant: 'destructive' });
      }

      if (compensationResult.error) {
        toast({ title: 'Chyba při načítání sazeb', description: compensationResult.error.message, variant: 'destructive' });
      }
      const compensationByMember = new Map(
        (compensationResult.data || []).map((item) => [String(item.member_id), Number(item.hourly_rate || 0)])
      );
      setMembers((membersData || []).map((member) => ({
        ...member,
        hourly_rate: compensationByMember.get(String(member.id)) || 0,
      })));

      const { data: settingsData } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'accounting_email')
        .maybeSingle();

      if (settingsData?.value) {
        setAccountingEmail(settingsData.value);
        setTempEmail(settingsData.value);
      }
    };

    fetchInitialData();
  }, [toast]);

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      const startDate = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
      const endDate = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

      const [attendanceResult, submissionsResult] = await Promise.all([
        supabase
          .from('attendance')
          .select(`
            id,
            date,
            hours,
            description,
            members:members!attendance_member_id_fkey(id, name),
            projects (id, name, code),
            realizations (id, name)
          `)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: true }),
        supabase
          .from('attendance_submissions')
          .select('id, member_id, status, total_hours, month_date, submitted_at, approved_at')
          .eq('month_date', startDate)
      ]);

      if (attendanceResult.error) {
        toast({ title: 'Chyba při načítání docházky', description: attendanceResult.error.message, variant: 'destructive' });
        setRecords([]);
      } else {
        setRecords(attendanceResult.data || []);
      }

      if (submissionsResult.error) {
        toast({ title: 'Chyba při načítání stavů', description: submissionsResult.error.message, variant: 'destructive' });
        setSubmissions([]);
      } else {
        setSubmissions(submissionsResult.data || []);
      }

      setLoading(false);
    };

    fetchData();
  }, [currentMonth, toast]);

  const selectedSet = useMemo(() => new Set(selectedMemberIds), [selectedMemberIds]);
  const hasMemberFilter = selectedMemberIds.length > 0;

  const filteredMembers = useMemo(() => {
    const query = memberSearch.trim().toLowerCase();
    if (!query) return members;
    return members.filter((member) => member.name?.toLowerCase().includes(query));
  }, [members, memberSearch]);

  const visibleMembers = useMemo(() => (
    hasMemberFilter ? members.filter((member) => selectedSet.has(member.id)) : members
  ), [hasMemberFilter, members, selectedSet]);

  const rateByMember = useMemo(() => new Map(
    members.map((member) => [String(member.id), Number(member.hourly_rate || 0)])
  ), [members]);

  const submissionByMember = useMemo(() => {
    const map = new Map();
    submissions.forEach((submission) => map.set(submission.member_id, submission));
    return map;
  }, [submissions]);

  const filteredRecords = useMemo(() => {
    if (!hasMemberFilter) return records;
    return records.filter((record) => selectedSet.has(record.members?.id));
  }, [records, selectedSet, hasMemberFilter]);

  const aggregatedData = useMemo(() => {
    const grouped = new Map();

    visibleMembers.forEach((member) => {
      const submission = submissionByMember.get(member.id);
      grouped.set(member.id, {
        memberId: member.id,
        name: member.name || 'Neznámý pracovník',
        rate: Number(member.hourly_rate || 0),
        totalHours: 0,
        totalCost: 0,
        recordCount: 0,
        status: submission?.status || 'missing',
        submittedAt: submission?.submitted_at || null
      });
    });

    filteredRecords.forEach((record) => {
      const memberId = record.members?.id || 'unknown';
      if (!grouped.has(memberId)) {
        const submission = submissionByMember.get(memberId);
        grouped.set(memberId, {
          memberId,
          name: record.members?.name || 'Neznámý pracovník',
          rate: rateByMember.get(String(memberId)) || 0,
          totalHours: 0,
          totalCost: 0,
          recordCount: 0,
          status: submission?.status || 'missing',
          submittedAt: submission?.submitted_at || null
        });
      }

      const row = grouped.get(memberId);
      const rate = rateByMember.get(String(memberId)) ?? Number(row.rate || 0);
      const hours = Number(record.hours || 0);

      row.rate = rate;
      row.totalHours += hours;
      row.totalCost += hours * rate;
      row.recordCount += 1;
    });

    return Array.from(grouped.values())
      .sort((a, b) => b.totalCost - a.totalCost || a.name.localeCompare(b.name, 'cs'));
  }, [visibleMembers, filteredRecords, submissionByMember, rateByMember]);

  const totals = useMemo(() => aggregatedData.reduce((acc, curr) => ({
    hours: acc.hours + curr.totalHours,
    cost: acc.cost + curr.totalCost,
    workers: acc.workers + 1
  }), { hours: 0, cost: 0, workers: 0 }), [aggregatedData]);

  const statusCounts = useMemo(() => aggregatedData.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, { approved: 0, submitted: 0, rejected: 0, returned: 0, draft: 0, missing: 0 }), [aggregatedData]);

  const averageRate = totals.hours > 0 ? totals.cost / totals.hours : 0;

  const selectedLabel = useMemo(() => {
    if (!hasMemberFilter) return 'Všichni pracovníci';
    if (selectedMemberIds.length === 1) {
      return members.find((member) => member.id === selectedMemberIds[0])?.name || '1 pracovník';
    }
    return `${selectedMemberIds.length} pracovníků`;
  }, [hasMemberFilter, selectedMemberIds, members]);

  const toggleMember = (memberId) => {
    setSelectedMemberIds((current) => (
      current.includes(memberId)
        ? current.filter((id) => id !== memberId)
        : [...current, memberId]
    ));
  };

  const buildWorkbook = (XLSX) => {
    const monthLabel = format(currentMonth, 'LLLL yyyy', { locale: cs });
    const workbook = XLSX.utils.book_new();

    const summaryRows = [
      [`Docházka - souhrn za ${monthLabel}`],
      [],
      ['Pracovník', 'Stav docházky', 'Sazba (Kč/h)', 'Odpracované hodiny', 'Náklady celkem (Kč)', 'Počet záznamů']
    ];

    aggregatedData.forEach((item) => {
      summaryRows.push([
        item.name,
        STATUS_CONFIG[item.status]?.label || item.status,
        item.rate,
        Number(item.totalHours.toFixed(2)),
        Number(item.totalCost.toFixed(2)),
        item.recordCount
      ]);
    });

    summaryRows.push([]);
    summaryRows.push(['CELKEM', '', Number(averageRate.toFixed(2)), Number(totals.hours.toFixed(2)), Number(totals.cost.toFixed(2)), '']);

    const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows);
    setColumnWidths(summarySheet, [28, 18, 16, 20, 22, 16]);
    setAutoFilter(summarySheet, `A3:F${Math.max(3, aggregatedData.length + 3)}`);
    summarySheet['!freeze'] = { xSplit: 0, ySplit: 3 };
    applyNumberFormat(summarySheet, ['C', 'D'], 4, aggregatedData.length + 4, '# ##0.00');
    applyNumberFormat(summarySheet, ['E'], 4, aggregatedData.length + 4, '# ##0.00 Kč');
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Souhrn');

    const detailRows = [
      [`Docházka - detail po dnech za ${monthLabel}`],
      [],
      ['Datum', 'Pracovník', 'Stav měsíce', 'Typ', 'Projekt / realizace', 'Kód', 'Popis', 'Hodiny', 'Sazba (Kč/h)', 'Náklady (Kč)']
    ];

    filteredRecords.forEach((record) => {
      const memberId = record.members?.id;
      const submission = submissionByMember.get(memberId);
      const status = submission?.status || 'missing';
      const hours = Number(record.hours || 0);
      const rate = rateByMember.get(String(memberId)) || 0;
      detailRows.push([
        format(new Date(record.date), 'dd.MM.yyyy'),
        record.members?.name || 'Neznámý',
        STATUS_CONFIG[status]?.label || status,
        record.projects ? 'Projekt' : (record.realizations ? 'Realizace' : '-'),
        record.projects?.name || record.realizations?.name || '-',
        record.projects?.code || '-',
        record.description || '',
        Number(hours.toFixed(2)),
        Number(rate.toFixed(2)),
        Number((hours * rate).toFixed(2))
      ]);
    });

    const detailSheet = XLSX.utils.aoa_to_sheet(detailRows);
    setColumnWidths(detailSheet, [14, 26, 18, 14, 36, 16, 48, 12, 14, 16]);
    setAutoFilter(detailSheet, `A3:J${Math.max(3, filteredRecords.length + 3)}`);
    detailSheet['!freeze'] = { xSplit: 0, ySplit: 3 };
    applyNumberFormat(detailSheet, ['H', 'I'], 4, filteredRecords.length + 4, '# ##0.00');
    applyNumberFormat(detailSheet, ['J'], 4, filteredRecords.length + 4, '# ##0.00 Kč');
    XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detail po dnech');

    const statusRows = [
      [`Docházka - kontrola stavů za ${monthLabel}`],
      [],
      ['Stav', 'Počet pracovníků'],
      ['Schváleno', statusCounts.approved || 0],
      ['Ke schválení', statusCounts.submitted || 0],
      ['Zamítnuto', statusCounts.rejected || 0],
      ['Koncept', statusCounts.draft || 0],
      ['Neodesláno', statusCounts.missing || 0],
      [],
      ['Pracovník', 'Stav docházky', 'Odpracované hodiny', 'Počet záznamů']
    ];

    aggregatedData.forEach((item) => {
      statusRows.push([
        item.name,
        STATUS_CONFIG[item.status]?.label || item.status,
        Number(item.totalHours.toFixed(2)),
        item.recordCount
      ]);
    });

    const statusSheet = XLSX.utils.aoa_to_sheet(statusRows);
    setColumnWidths(statusSheet, [28, 18, 20, 16]);
    setAutoFilter(statusSheet, `A10:D${Math.max(10, aggregatedData.length + 10)}`);
    statusSheet['!freeze'] = { xSplit: 0, ySplit: 10 };
    applyNumberFormat(statusSheet, ['C'], 11, aggregatedData.length + 11, '# ##0.00');
    XLSX.utils.book_append_sheet(workbook, statusSheet, 'Stavy');

    return workbook;
  };

  const handleExport = async () => {
    const XLSX = await loadXlsx();
    const fileName = `Reporting_Dochazka_${format(currentMonth, 'MM-yyyy')}.xlsx`;
    XLSX.writeFile(buildWorkbook(XLSX), fileName);
  };

  const buildEmailContent = (monthStr) => {
    const summaryRows = aggregatedData.map((row) => `
      <tr>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${escapeHtml(row.name)}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;">${STATUS_CONFIG[row.status]?.label || row.status}</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;">${formatCurrency(row.rate)} /h</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;">${row.totalHours.toFixed(1)} h</td>
        <td style="padding:10px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:700;color:#166534;">${formatCurrency(row.totalCost)}</td>
      </tr>
    `).join('');

    const detailRows = filteredRecords.slice(0, 80).map((record) => {
      const memberId = record.members?.id;
      const status = submissionByMember.get(memberId)?.status || 'missing';
      const target = record.projects?.code
        ? `${record.projects.code} - ${record.projects.name}`
        : (record.realizations?.name || '-');

      return `
        <tr>
          <td style="padding:7px;border-bottom:1px solid #eef2f7;font-size:13px;">${format(new Date(record.date), 'dd.MM.')}</td>
          <td style="padding:7px;border-bottom:1px solid #eef2f7;font-size:13px;">${escapeHtml(record.members?.name || '-')}</td>
          <td style="padding:7px;border-bottom:1px solid #eef2f7;font-size:13px;">${STATUS_CONFIG[status]?.label || status}</td>
          <td style="padding:7px;border-bottom:1px solid #eef2f7;font-size:13px;">${escapeHtml(target)}</td>
          <td style="padding:7px;border-bottom:1px solid #eef2f7;text-align:right;font-weight:700;font-size:13px;">${Number(record.hours).toFixed(1)} h</td>
        </tr>
      `;
    }).join('');

    return `
      <p style="margin:0 0 16px;">Zasíláme přehled docházky a nákladů za období <strong>${monthStr}</strong>.</p>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:18px 0;">
        <div style="padding:14px;border:1px solid #dbeafe;border-radius:10px;background:#eff6ff;">
          <div style="font-size:12px;color:#1d4ed8;font-weight:700;text-transform:uppercase;">Celkem hodin</div>
          <div style="font-size:22px;font-weight:800;color:#111827;margin-top:6px;">${totals.hours.toFixed(1)} h</div>
        </div>
        <div style="padding:14px;border:1px solid #bbf7d0;border-radius:10px;background:#f0fdf4;">
          <div style="font-size:12px;color:#166534;font-weight:700;text-transform:uppercase;">Celkové náklady</div>
          <div style="font-size:22px;font-weight:800;color:#14532d;margin-top:6px;">${formatCurrency(totals.cost)}</div>
        </div>
        <div style="padding:14px;border:1px solid #e9d5ff;border-radius:10px;background:#faf5ff;">
          <div style="font-size:12px;color:#7e22ce;font-weight:700;text-transform:uppercase;">Průměrná sazba</div>
          <div style="font-size:22px;font-weight:800;color:#581c87;margin-top:6px;">${formatCurrency(averageRate)} /h</div>
        </div>
      </div>

      <h3 style="margin:22px 0 8px;">Souhrn pracovníků</h3>
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:10px;text-align:left;border-bottom:1px solid #cbd5e1;">Pracovník</th>
            <th style="padding:10px;text-align:left;border-bottom:1px solid #cbd5e1;">Stav</th>
            <th style="padding:10px;text-align:right;border-bottom:1px solid #cbd5e1;">Sazba</th>
            <th style="padding:10px;text-align:right;border-bottom:1px solid #cbd5e1;">Hodiny</th>
            <th style="padding:10px;text-align:right;border-bottom:1px solid #cbd5e1;">Náklady</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows}
          <tr style="background:#f1f5f9;font-weight:800;">
            <td style="padding:10px;border-top:2px solid #94a3b8;">CELKEM</td>
            <td style="padding:10px;border-top:2px solid #94a3b8;">-</td>
            <td style="padding:10px;border-top:2px solid #94a3b8;text-align:right;">-</td>
            <td style="padding:10px;border-top:2px solid #94a3b8;text-align:right;">${totals.hours.toFixed(1)} h</td>
            <td style="padding:10px;border-top:2px solid #94a3b8;text-align:right;color:#166534;">${formatCurrency(totals.cost)}</td>
          </tr>
        </tbody>
      </table>

      <h3 style="margin:22px 0 8px;">Detail po dnech</h3>
      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#f8fafc;">
            <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Datum</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Pracovník</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Stav</th>
            <th style="padding:8px;text-align:left;border-bottom:1px solid #cbd5e1;">Projekt / Realizace</th>
            <th style="padding:8px;text-align:right;border-bottom:1px solid #cbd5e1;">Hodiny</th>
          </tr>
        </thead>
        <tbody>${detailRows}</tbody>
      </table>

      ${filteredRecords.length > 80 ? '<p style="margin-top:10px;color:#64748b;font-size:12px;">Zobrazeno prvních 80 řádků. Kompletní detail je v příloze.</p>' : ''}
      <p style="margin-top:24px;color:#64748b;font-size:12px;">V příloze je kompletní Excel soubor se souhrnem, detailem po dnech a kontrolou stavů.</p>
    `;
  };

  const handleSendEmail = async () => {
    const emailToSend = tempEmail.trim() || accountingEmail.trim();

    if (!isValidEmailList(emailToSend)) {
      toast({
        title: 'Neplatný příjemce',
        description: 'Zadejte jednu nebo více emailových adres oddělených čárkou.',
        variant: 'destructive'
      });
      return;
    }

    setSendingEmail(true);

    try {
      const XLSX = await loadXlsx();
      const monthStr = format(currentMonth, 'LLLL yyyy', { locale: cs });
      const fileName = `Reporting_Dochazka_${format(currentMonth, 'MM-yyyy')}.xlsx`;
      const wbBase64 = XLSX.write(buildWorkbook(XLSX), { bookType: 'xlsx', type: 'base64' });

      const recipients = parseRecipients(emailToSend);
      for (const recipient of recipients) {
        const { error } = await sendEmail({
          to: recipient,
          subject: `Report docházky - ${monthStr}`,
          greeting: 'Dobrý den,',
          content: buildEmailContent(monthStr),
          salutation: 'S pozdravem,<br>EKV Portál',
          attachments: [{ filename: fileName, content: wbBase64, encoding: 'base64' }]
        });

        if (error) throw error;
      }

      toast({ title: 'Email odeslán', description: `Report byl odeslán na ${recipients.length} příjemců.` });
      setAccountingEmail(emailToSend);
      setIsEmailDialogOpen(false);
    } catch (error) {
      toast({ title: 'Chyba při odesílání', description: error.message, variant: 'destructive' });
    } finally {
      setSendingEmail(false);
    }
  };

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden rounded-xl border-slate-200 bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-3">
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}>
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <h2 className="w-48 text-center text-2xl font-bold capitalize text-slate-900">
                {format(currentMonth, 'LLLL yyyy', { locale: cs })}
              </h2>
              <Button variant="outline" size="icon" onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}>
                <ChevronRight className="h-5 w-5" />
              </Button>
            </div>

            <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="h-11 justify-between gap-3 bg-white lg:min-w-[320px]">
                    <span className="truncate">{selectedLabel}</span>
                    <Badge variant="secondary" className="rounded-full">{hasMemberFilter ? selectedMemberIds.length : members.length}</Badge>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[380px] p-0" align="end">
                  <div className="border-b p-3">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <Input value={memberSearch} onChange={(event) => setMemberSearch(event.target.value)} placeholder="Hledat pracovníka..." className="pl-9" />
                    </div>
                  </div>
                  <div className="flex gap-2 border-b p-3">
                    <Button size="sm" variant="outline" className="gap-2" onClick={() => setSelectedMemberIds(members.map((member) => member.id))}>
                      <Check className="h-4 w-4" /> Vybrat vše
                    </Button>
                    <Button size="sm" variant="ghost" className="gap-2" onClick={() => setSelectedMemberIds([])}>
                      <X className="h-4 w-4" /> Zrušit výběr
                    </Button>
                  </div>
                  <div className="max-h-72 overflow-y-auto p-2">
                    {filteredMembers.map((member) => {
                      const status = submissionByMember.get(member.id)?.status || 'missing';
                      return (
                        <label key={member.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50">
                          <Checkbox checked={selectedSet.has(member.id)} onCheckedChange={() => toggleMember(member.id)} />
                          <span className="min-w-0 flex-1 truncate font-medium text-slate-800">{member.name}</span>
                          <StatusBadge status={status} />
                        </label>
                      );
                    })}
                    {filteredMembers.length === 0 && <div className="p-4 text-center text-sm text-slate-500">Žádný pracovník nenalezen.</div>}
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                variant="secondary"
                onClick={() => {
                  setTempEmail(accountingEmail);
                  setIsEmailDialogOpen(true);
                }}
                disabled={aggregatedData.length === 0}
                className="gap-2"
              >
                <Mail className="h-4 w-4" />
                Poslat emailem
              </Button>
              <Button variant="outline" onClick={handleExport} disabled={aggregatedData.length === 0} className="gap-2 bg-white">
                <Download className="h-4 w-4" />
                Export XLSX
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <DataVizMetricCard icon={Calculator} label="Celkem hodin" value={loading ? '...' : `${totals.hours.toFixed(1)} h`} tone="blue" />
        <DataVizMetricCard icon={DollarSign} label="Celkové náklady" value={loading ? '...' : formatCurrency(totals.cost)} tone="emerald" />
        <DataVizMetricCard icon={Users} label="Průměrná sazba" value={loading ? '...' : `${formatCurrency(averageRate)} /h`} tone="violet" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DataVizMetricCard icon={ShieldCheck} label="Schváleno" value={loading ? '...' : statusCounts.approved} tone="green" />
        <DataVizMetricCard icon={Hourglass} label="Ke schválení" value={loading ? '...' : statusCounts.submitted} tone="orange" />
        <DataVizMetricCard icon={AlertTriangle} label="Zamítnuto" value={loading ? '...' : statusCounts.rejected} tone="red" />
        <DataVizMetricCard icon={Hourglass} label="Vráceno k úpravě" value={loading ? '...' : statusCounts.returned} tone="orange" />
        <DataVizMetricCard icon={FileText} label="Neodesláno / koncept" value={loading ? '...' : (statusCounts.missing || 0) + (statusCounts.draft || 0)} tone="slate" />
      </div>

      <Card className="overflow-hidden rounded-xl border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b border-slate-200 bg-white">
          <CardTitle className="text-lg">Finanční přehled pracovníků</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 animate-spin text-slate-400" />
            </div>
          ) : aggregatedData.length === 0 ? (
            <div className="py-12 text-center text-slate-500">Žádná data pro vybrané období a filtr.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead className="h-11 px-5 text-xs font-bold uppercase tracking-wide text-slate-500">Pracovník</TableHead>
                    <TableHead className="h-11 text-xs font-bold uppercase tracking-wide text-slate-500">Stav docházky</TableHead>
                    <TableHead className="h-11 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Hodinová sazba</TableHead>
                    <TableHead className="h-11 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Odpracováno</TableHead>
                    <TableHead className="h-11 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Záznamů</TableHead>
                    <TableHead className="h-11 px-5 text-right text-xs font-bold uppercase tracking-wide text-slate-500">Celkové náklady</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aggregatedData.map((row) => (
                    <TableRow key={row.memberId} className="border-slate-100 hover:bg-slate-50/70">
                      <TableCell className="px-5 font-semibold text-slate-900">{row.name}</TableCell>
                      <TableCell><StatusBadge status={row.status} /></TableCell>
                      <TableCell className="text-right text-slate-600">{formatCurrency(row.rate)} /h</TableCell>
                      <TableCell className="text-right font-semibold tabular-nums text-slate-900">{row.totalHours.toFixed(1)} h</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">{row.recordCount}</TableCell>
                      <TableCell className="px-5 text-right font-bold tabular-nums text-emerald-700">{formatCurrency(row.totalCost)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-slate-200 bg-slate-100 font-bold">
                    <TableCell className="px-5">CELKEM</TableCell>
                    <TableCell />
                    <TableCell className="text-right">-</TableCell>
                    <TableCell className="text-right text-lg text-blue-700">{totals.hours.toFixed(1)} h</TableCell>
                    <TableCell className="text-right">{filteredRecords.length}</TableCell>
                    <TableCell className="px-5 text-right text-lg text-emerald-700">{formatCurrency(totals.cost)}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
        <AlertDialogContent className="sm:max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Odeslat report docházky</AlertDialogTitle>
            <AlertDialogDescription>
              Report za <strong>{format(currentMonth, 'LLLL yyyy', { locale: cs })}</strong>
              {hasMemberFilter ? ` pro ${selectedMemberIds.length} vybraných pracovníků` : ' pro všechny pracovníky'} bude odeslán s XLSX přílohou.
              Excel obsahuje souhrn, detail po dnech a kontrolu stavů schválení.
            </AlertDialogDescription>
            <div className="py-4">
              <Label htmlFor="email" className="mb-2 block">Příjemce</Label>
              <Input id="email" value={tempEmail} onChange={(event) => setTempEmail(event.target.value)} placeholder="email@priklad.cz, dalsi@priklad.cz" />
              <p className="mt-2 text-xs text-slate-500">Lze zadat více adres oddělených čárkou nebo středníkem.</p>
            </div>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sendingEmail}>Zrušit</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); handleSendEmail(); }} disabled={sendingEmail} className="bg-blue-600 hover:bg-blue-700">
              {sendingEmail ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {sendingEmail ? 'Odesílám...' : 'Odeslat'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default AttendanceReporting;
