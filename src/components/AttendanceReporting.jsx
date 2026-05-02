import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { format, startOfMonth, endOfMonth, addMonths, subMonths } from 'date-fns';
import { cs } from 'date-fns/locale';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, ChevronLeft, ChevronRight, Calculator, DollarSign, Users, RefreshCw, Mail, Send } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import * as XLSX from 'xlsx';
import { useToast } from '@/components/ui/use-toast';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { sendEmail } from '@/lib/email';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const AttendanceReporting = () => {
    const { toast } = useToast();
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [loading, setLoading] = useState(true);
    const [records, setRecords] = useState([]);
    const [members, setMembers] = useState([]);
    const [selectedMemberId, setSelectedMemberId] = useState('all');
    
    // Email state
    const [accountingEmail, setAccountingEmail] = useState('');
    const [tempEmail, setTempEmail] = useState(''); // For editing in dialog
    const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
    const [sendingEmail, setSendingEmail] = useState(false);

    // Fetch members and settings
    useEffect(() => {
        const fetchInitialData = async () => {
            const { data: membersData } = await supabase.from('members').select('id, name').order('name');
            setMembers(membersData || []);

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
    }, []);

    // Fetch attendance data
    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            const startDate = format(startOfMonth(currentMonth), 'yyyy-MM-dd');
            const endDate = format(endOfMonth(currentMonth), 'yyyy-MM-dd');

            // Fetch attendance with member details including hourly_rate
            const { data, error } = await supabase
                .from('attendance')
                .select(`
                    id,
                    date,
                    hours,
                    description,
                    members:members!attendance_member_id_fkey(id, name, hourly_rate),
                    projects (id, name, code),
                    realizations (id, name)
                `)
                .gte('date', startDate)
                .lte('date', endDate)
                .order('date', { ascending: true }); // Sorted by date for daily report

            if (error) {
                console.error('Error fetching attendance:', error);
                toast({ title: 'Chyba při načítání dat', description: error.message, variant: 'destructive' });
            } else {
                setRecords(data || []);
            }
            setLoading(false);
        };

        fetchData();
    }, [currentMonth, toast]);

    // Aggregate data per worker
    const aggregatedData = useMemo(() => {
        const grouped = {};

        records.forEach(record => {
            // Filter logic
            if (selectedMemberId !== 'all' && record.members?.id !== selectedMemberId) return;

            const memberId = record.members?.id || 'unknown';
            const memberName = record.members?.name || 'Neznámý pracovník';
            const rate = Number(record.members?.hourly_rate || 0);
            const hours = Number(record.hours || 0);

            if (!grouped[memberId]) {
                grouped[memberId] = {
                    memberId,
                    name: memberName,
                    rate: rate,
                    totalHours: 0,
                    totalCost: 0,
                    recordCount: 0
                };
            }

            grouped[memberId].totalHours += hours;
            grouped[memberId].totalCost += (hours * rate);
            grouped[memberId].recordCount += 1;
        });

        return Object.values(grouped).sort((a, b) => b.totalCost - a.totalCost);
    }, [records, selectedMemberId]);

    // Calculate totals
    const totals = useMemo(() => {
        return aggregatedData.reduce((acc, curr) => ({
            hours: acc.hours + curr.totalHours,
            cost: acc.cost + curr.totalCost,
            workers: acc.workers + 1
        }), { hours: 0, cost: 0, workers: 0 });
    }, [aggregatedData]);

    const averageRate = totals.hours > 0 ? (totals.cost / totals.hours) : 0;

    // Export handler
    const handleExport = () => {
        // Summary Sheet
        const summaryData = aggregatedData.map(item => ({
            'Pracovník': item.name,
            'Sazba (Kč/h)': item.rate,
            'Odpracované hodiny': item.totalHours.toFixed(2),
            'Náklady celkem (Kč)': item.totalCost.toFixed(2),
            'Počet záznamů': item.recordCount
        }));

        summaryData.push({});
        summaryData.push({
            'Pracovník': 'CELKEM',
            'Sazba (Kč/h)': averageRate.toFixed(2),
            'Odpracované hodiny': totals.hours.toFixed(2),
            'Náklady celkem (Kč)': totals.cost.toFixed(2),
            'Počet záznamů': ''
        });

        // Detail Sheet
        const detailData = records
            .filter(r => selectedMemberId === 'all' || r.members?.id === selectedMemberId)
            .map(r => ({
                'Datum': format(new Date(r.date), 'dd.MM.yyyy'),
                'Pracovník': r.members?.name || 'Neznámý',
                'Typ': r.projects ? 'Projekt' : (r.realizations ? 'Realizace' : '-'),
                'Název': r.projects?.name || r.realizations?.name || '-',
                'Kód': r.projects?.code || '-',
                'Popis': r.description || '',
                'Hodiny': Number(r.hours).toFixed(2),
                'Sazba': Number(r.members?.hourly_rate || 0),
                'Náklady': (Number(r.hours) * Number(r.members?.hourly_rate || 0)).toFixed(2)
            }));

        const wb = XLSX.utils.book_new();
        
        const wsSummary = XLSX.utils.json_to_sheet(summaryData);
        XLSX.utils.book_append_sheet(wb, wsSummary, "Souhrn");
        
        const wsDetail = XLSX.utils.json_to_sheet(detailData);
        XLSX.utils.book_append_sheet(wb, wsDetail, "Detail po dnech");
        
        const fileName = `Reporting_Dochazka_${format(currentMonth, 'MM-yyyy')}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    const handleSendEmail = async () => {
        const emailToSend = tempEmail ? tempEmail.trim() : accountingEmail ? accountingEmail.trim() : '';

        if (!emailToSend) {
            toast({ 
                title: "Chybí email", 
                description: "Zadejte prosím emailovou adresu příjemce.", 
                variant: "destructive" 
            });
            return;
        }

        // Basic email validation regex
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(emailToSend)) {
             toast({ 
                title: "Neplatný email", 
                description: "Zadejte prosím platnou emailovou adresu.", 
                variant: "destructive" 
            });
            return;
        }

        setSendingEmail(true);
        console.log("Starting email send process...");

        try {
            const monthStr = format(currentMonth, 'LLLL yyyy', { locale: cs });
            const fileName = `Reporting_Dochazka_${format(currentMonth, 'MM-yyyy')}.xlsx`;

            // 1. Prepare Summary Table HTML
            const summaryRows = aggregatedData.map(row => `
                <tr>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd;">${row.name}</td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${formatCurrency(row.rate)} /h</td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${row.totalHours.toFixed(1)} h</td>
                    <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right; font-weight: bold;">${formatCurrency(row.totalCost)}</td>
                </tr>
            `).join('');

            // 2. Prepare Daily Detail Table HTML
            const detailRows = records
                .filter(r => selectedMemberId === 'all' || r.members?.id === selectedMemberId)
                .map(r => {
                    const projectName = r.projects?.code ? `${r.projects.code} - ${r.projects.name}` : (r.realizations?.name || '-');
                    return `
                    <tr>
                        <td style="padding: 6px; border-bottom: 1px solid #eee; font-size: 13px;">${format(new Date(r.date), 'dd.MM.')}</td>
                        <td style="padding: 6px; border-bottom: 1px solid #eee; font-size: 13px;">${r.members?.name}</td>
                        <td style="padding: 6px; border-bottom: 1px solid #eee; font-size: 13px;">${projectName}</td>
                        <td style="padding: 6px; border-bottom: 1px solid #eee; text-align: right; font-weight: bold; font-size: 13px;">${Number(r.hours).toFixed(1)}</td>
                    </tr>
                `}).join('');

            // 3. Generate Excel File (Base64)
            console.log("Generating Excel file for email attachment...");
            const summarySheetData = aggregatedData.map(item => ({
                'Pracovník': item.name,
                'Sazba (Kč/h)': item.rate,
                'Odpracované hodiny': item.totalHours.toFixed(2),
                'Náklady celkem (Kč)': item.totalCost.toFixed(2),
                'Počet záznamů': item.recordCount
            }));
            
            // Add footer to summary data
            summarySheetData.push({});
            summarySheetData.push({
                'Pracovník': 'CELKEM',
                'Sazba (Kč/h)': averageRate.toFixed(2),
                'Odpracované hodiny': totals.hours.toFixed(2),
                'Náklady celkem (Kč)': totals.cost.toFixed(2),
                'Počet záznamů': ''
            });

            const detailSheetData = records
                .filter(r => selectedMemberId === 'all' || r.members?.id === selectedMemberId)
                .map(r => ({
                    'Datum': format(new Date(r.date), 'dd.MM.yyyy'),
                    'Pracovník': r.members?.name || 'Neznámý',
                    'Typ': r.projects ? 'Projekt' : (r.realizations ? 'Realizace' : '-'),
                    'Název': r.projects?.name || r.realizations?.name || '-',
                    'Kód': r.projects?.code || '-',
                    'Popis': r.description || '',
                    'Hodiny': Number(r.hours).toFixed(2),
                    'Sazba': Number(r.members?.hourly_rate || 0),
                    'Náklady': (Number(r.hours) * Number(r.members?.hourly_rate || 0)).toFixed(2)
                }));

            const wb = XLSX.utils.book_new();
            const wsSummary = XLSX.utils.json_to_sheet(summarySheetData);
            XLSX.utils.book_append_sheet(wb, wsSummary, "Souhrn");
            const wsDetail = XLSX.utils.json_to_sheet(detailSheetData);
            XLSX.utils.book_append_sheet(wb, wsDetail, "Detail po dnech");
            
            // Generate Base64 string directly
            const wbBase64 = XLSX.write(wb, { bookType: 'xlsx', type: 'base64' });
            console.log(`Excel file generated. Length: ${wbBase64.length}`);

            const emailContent = `
                <p>Zasíláme přehled docházky a nákladů za období <strong>${monthStr}</strong>.</p>
                
                <h3 style="margin-top: 20px;">Souhrn</h3>
                <ul style="margin-bottom: 20px;">
                    <li>Celkem hodin: <strong>${totals.hours.toFixed(1)} h</strong></li>
                    <li>Celkové náklady: <strong>${formatCurrency(totals.cost)}</strong></li>
                    <li>Průměrná sazba: <strong>${formatCurrency(averageRate)} /h</strong></li>
                </ul>

                <h3 style="margin-top: 20px;">Detail po pracovnících</h3>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px;">
                    <thead>
                        <tr style="background-color: #f8f9fa;">
                            <th style="padding: 10px; text-align: left; border-bottom: 2px solid #ddd;">Pracovník</th>
                            <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Sazba</th>
                            <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Hodiny</th>
                            <th style="padding: 10px; text-align: right; border-bottom: 2px solid #ddd;">Náklady</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${summaryRows}
                        <tr style="background-color: #f0f7ff; font-weight: bold;">
                            <td style="padding: 10px; border-top: 2px solid #000;">CELKEM</td>
                            <td style="padding: 10px; border-top: 2px solid #000; text-align: right;">-</td>
                            <td style="padding: 10px; border-top: 2px solid #000; text-align: right;">${totals.hours.toFixed(1)} h</td>
                            <td style="padding: 10px; border-top: 2px solid #000; text-align: right; color: #166534;">${formatCurrency(totals.cost)}</td>
                        </tr>
                    </tbody>
                </table>

                <h3 style="margin-top: 20px;">Detailní výpis dnů</h3>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px;">
                    <thead>
                        <tr style="background-color: #f8f9fa;">
                            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Datum</th>
                            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Pracovník</th>
                            <th style="padding: 8px; text-align: left; border-bottom: 2px solid #ddd;">Projekt / Realizace</th>
                            <th style="padding: 8px; text-align: right; border-bottom: 2px solid #ddd;">Hodiny</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${detailRows}
                    </tbody>
                </table>
                
                <p style="margin-top: 30px; font-size: 12px; color: #666;">
                    V příloze naleznete kompletní Excel soubor (Souhrn + Detail).
                </p>
            `;

            console.log("Sending email via sendEmail function...");
            const { error } = await sendEmail({
                to: emailToSend,
                subject: `Report docházky - ${monthStr}`,
                greeting: "Dobrý den,",
                content: emailContent,
                salutation: "S pozdravem,<br>Váš EKV Portál",
                attachments: [
                    {
                        filename: fileName,
                        content: wbBase64,
                        encoding: 'base64'
                    }
                ]
            });

            if (error) {
                console.error("Email send failed:", error);
                toast({ title: "Chyba při odesílání", description: "Email se nepodařilo odeslat. Zkontrolujte adresu.", variant: "destructive" });
            } else {
                console.log("Email sent successfully!");
                toast({ title: "✅ Email odeslán", description: `Report byl odeslán na ${emailToSend} včetně přílohy.` });
                setIsEmailDialogOpen(false);
                setAccountingEmail(emailToSend);
            }
        } catch (err) {
            console.error("Unexpected error in handleSendEmail:", err);
             toast({ title: "Kritická chyba", description: "Nastala neočekávaná chyba při generování nebo odesílání reportu.", variant: "destructive" });
        } finally {
            setSendingEmail(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header Controls */}
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

                        <div className="flex items-center gap-4 w-full lg:w-auto">
                            <div className="flex-1 lg:w-[250px]">
                                <Select value={selectedMemberId} onValueChange={setSelectedMemberId}>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Filtrovat pracovníka" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">Všichni pracovníci</SelectItem>
                                        {members.map(m => (
                                            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>
                            <Button 
                                variant="secondary" 
                                onClick={() => {
                                    setTempEmail(accountingEmail); // Reset temp email to current saved email when opening
                                    setIsEmailDialogOpen(true);
                                }}
                                disabled={aggregatedData.length === 0}
                            >
                                <Mail className="w-4 h-4 mr-2" />
                                Poslat emailem
                            </Button>
                            <Button variant="outline" onClick={handleExport} disabled={aggregatedData.length === 0}>
                                <Download className="w-4 h-4 mr-2" />
                                Export CSV
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-blue-50 border-blue-200">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-blue-800 flex items-center gap-2">
                            <Calculator className="w-4 h-4" /> Celkem hodin
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-blue-900">
                            {loading ? '...' : totals.hours.toFixed(1)} h
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-green-50 border-green-200">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-green-800 flex items-center gap-2">
                            <DollarSign className="w-4 h-4" /> Celkové náklady
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-green-900">
                            {loading ? '...' : formatCurrency(totals.cost)}
                        </div>
                    </CardContent>
                </Card>

                <Card className="bg-purple-50 border-purple-200">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-purple-800 flex items-center gap-2">
                            <Users className="w-4 h-4" /> Průměrná sazba
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold text-purple-900">
                            {loading ? '...' : formatCurrency(averageRate)} /h
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* Main Table */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-lg">Finanční přehled pracovníků</CardTitle>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex justify-center items-center py-12">
                            <RefreshCw className="w-8 h-8 animate-spin text-muted-foreground" />
                        </div>
                    ) : aggregatedData.length === 0 ? (
                        <div className="text-center py-12 text-muted-foreground">
                            Žádná data pro vybrané období a filtr.
                        </div>
                    ) : (
                        <div className="rounded-md border">
                            <Table>
                                <TableHeader>
                                    <TableRow className="bg-slate-50">
                                        <TableHead>Pracovník</TableHead>
                                        <TableHead className="text-right">Hodinová sazba</TableHead>
                                        <TableHead className="text-right">Odpracováno</TableHead>
                                        <TableHead className="text-right">Celkové náklady</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {aggregatedData.map((row) => (
                                        <TableRow key={row.memberId}>
                                            <TableCell className="font-medium">{row.name}</TableCell>
                                            <TableCell className="text-right text-muted-foreground">
                                                {formatCurrency(row.rate)} /h
                                            </TableCell>
                                            <TableCell className="text-right font-semibold">
                                                {row.totalHours.toFixed(1)} h
                                            </TableCell>
                                            <TableCell className="text-right font-bold text-green-700">
                                                {formatCurrency(row.totalCost)}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                    {/* Footer Summary Row */}
                                    <TableRow className="bg-slate-100 font-bold border-t-2 border-slate-200">
                                        <TableCell>CELKEM</TableCell>
                                        <TableCell className="text-right">-</TableCell>
                                        <TableCell className="text-right text-lg text-blue-700">{totals.hours.toFixed(1)} h</TableCell>
                                        <TableCell className="text-right text-lg text-green-700">{formatCurrency(totals.cost)}</TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </div>
                    )}
                </CardContent>
            </Card>
            
            <AlertDialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Odeslat report emailem?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Chystáte se odeslat report docházky a nákladů za <strong>{format(currentMonth, 'LLLL yyyy', { locale: cs })}</strong>.
                        </AlertDialogDescription>
                        <div className="py-4">
                            <Label htmlFor="email" className="mb-2 block">Příjemce</Label>
                            <Input 
                                id="email" 
                                value={tempEmail} 
                                onChange={(e) => setTempEmail(e.target.value)} 
                                placeholder="email@priklad.cz"
                            />
                            <p className="text-xs text-muted-foreground mt-2">
                                Výchozí email lze změnit v sekci Nastavení - Portál.
                            </p>
                        </div>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={sendingEmail}>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={(e) => { e.preventDefault(); handleSendEmail(); }} disabled={sendingEmail} className="bg-blue-600 hover:bg-blue-700">
                            {sendingEmail ? <RefreshCw className="w-4 h-4 mr-2 animate-spin"/> : <Send className="w-4 h-4 mr-2"/>}
                            {sendingEmail ? 'Odesílám...' : 'Odeslat'}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default AttendanceReporting;