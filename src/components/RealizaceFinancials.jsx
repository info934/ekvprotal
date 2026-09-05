import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, BarChart, DollarSign, TrendingUp, TrendingDown, HardHat, Plus, Edit2, FileText, X, Wallet, RefreshCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SubjectDialog from './SubjectDialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import { FinanceAmount, FinanceMetricStrip } from '@/components/finance/FinanceWorkspace';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EkvLoader from '@/components/ui/ekv-loader';
import { fetchAllFinancialRows, getFinanceErrorMessage } from '@/lib/financePresentation';
import { toFiniteAmount } from '@/domain/financials';

// Main Dashboard Component
const RealizaceFinancials = () => {
    const [financials, setFinancials] = useState(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [reload, setReload] = useState(0);
    const { userRole } = useAuth();
    const { canViewAmounts } = getFinancialVisibility(userRole);

    useEffect(() => {
        const controller = new AbortController();
        setFinancials(null);
        setLoadError(null);
        if (!canViewAmounts) {
            setLoading(false);
            return () => controller.abort();
        }

        const fetchFinancials = async () => {
            setLoading(true);
            try {
                const { data, error } = await supabase.rpc('get_realization_financial_overview').abortSignal(controller.signal);
                if (error) throw error;
                if (!data || !Array.isArray(data.items) || toFiniteAmount(data.realization_count) === null || Number(data.realization_count) !== data.items.length) {
                    throw new Error('Finanční přehled není úplný.');
                }
                if (!controller.signal.aborted) setFinancials(data);
            } catch (error) {
                if (!controller.signal.aborted) setLoadError(getFinanceErrorMessage(error, 'Finanční přehled se nepodařilo úplně načíst. Obnovte jej prosím.'));
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        fetchFinancials();
        return () => controller.abort();
    }, [canViewAmounts, reload]);

    if (!canViewAmounts) {
        return (
            <div className="app-page">
                <Card className="p-12 text-center">
                    <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
                    <h1 className="text-2xl font-bold text-red-600 mb-2">Přístup odepřen</h1>
                    <p className="text-muted-foreground">Nemáte oprávnění zobrazit finanční přehled realizací.</p>
                </Card>
            </div>
        );
    }
    if (loading) return <EkvLoader title="Načítám finance realizací" description="Načítám výnosy, náklady a rozpočty." />;
    if (loadError || !financials) return <Card className="space-y-4 p-6"><h2 className="font-semibold">Finance realizací nejsou dostupné</h2><p role="alert" className="text-sm text-red-800">{loadError || 'Finanční přehled nebyl načten.'}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}><RefreshCw className="mr-2 h-4 w-4" />Zkusit znovu</Button></Card>;
    return (
        <div className="space-y-6 p-6">
            <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-950"><BarChart className="h-5 w-5"/> Finance realizací</h2>
                <p className="mt-1 text-sm text-slate-500">Souhrnný administrátorský pohled na výnosy, rozpočty a očekávaný výsledek realizací.</p>
            </div>
            <FinanceMetricStrip metrics={[
                { label: 'Výnosy bez DPH', value: <FinanceAmount value={financials?.total_revenue} />, detail: 'Smlouvy a vícepráce', tone: 'neutral', icon: DollarSign },
                { label: 'Náklady a vyplacené odměny', value: <FinanceAmount value={financials?.total_costs} />, detail: 'Bez DPH; materiál, vícepráce, přímá práce a odměny', tone: 'neutral', icon: Wallet },
                { label: 'Plánovaný zisk firmy', value: <FinanceAmount value={financials?.total_profit} />, detail: 'Podle nastavených marží', tone: Number(financials?.total_profit || 0) < 0 ? 'negative' : 'positive', icon: TrendingUp },
                { label: 'Plánovaná režie', value: <FinanceAmount value={financials?.total_overhead} />, detail: 'Rozpočtová alokace', tone: 'warning', icon: FileText },
                { label: 'Rozpočet týmů', value: <FinanceAmount value={financials?.total_distribution} />, detail: 'Základ pro odměny', tone: 'plan', icon: TrendingDown },
                { label: 'Počet realizací', value: financials.realization_count, detail: 'V agregovaném přehledu', tone: 'neutral', icon: HardHat },
                { label: 'Volný týmový rozpočet', value: <FinanceAmount value={financials?.total_available_for_payout} />, detail: 'Po rezervacích a vyplacených odměnách; není stav účtu', tone: 'positive', icon: Wallet },
            ]} className="2xl:grid-cols-4" />
            <Card>
                <CardHeader><CardTitle>Finanční stav realizací</CardTitle></CardHeader>
                <CardContent className="overflow-x-auto">
                    <Table className="min-w-[980px]">
                        <TableHeader><TableRow><TableHead>Realizace</TableHead><TableHead>Stav</TableHead><TableHead className="text-right">Výnos bez DPH</TableHead><TableHead className="text-right">Náklady bez DPH</TableHead><TableHead className="text-right">Plánovaný zisk</TableHead><TableHead className="text-right">Plánovaná režie</TableHead><TableHead className="text-right">Týmový rozpočet</TableHead><TableHead className="text-right">Volný rozpočet</TableHead></TableRow></TableHeader>
                        <TableBody>
                            {(financials?.items || []).map((item) => <TableRow key={item.id}>
                                <TableCell className="font-medium">{item.name}</TableCell><TableCell>{item.status}</TableCell>
                                <TableCell className="text-right"><FinanceAmount value={item.revenue} /></TableCell><TableCell className="text-right"><FinanceAmount value={item.costs} /></TableCell>
                                <TableCell className="text-right"><FinanceAmount value={item.profit} /></TableCell><TableCell className="text-right"><FinanceAmount value={item.overhead} /></TableCell>
                                <TableCell className="text-right"><FinanceAmount value={item.team_budget} /></TableCell><TableCell className="text-right"><FinanceAmount value={item.available_for_payout} /></TableCell>
                            </TableRow>)}
                            {!(financials?.items || []).length && <TableRow><TableCell colSpan={8} className="py-8 text-center text-slate-500">Nejsou evidované žádné realizace.</TableCell></TableRow>}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </div>
    );
};

// Dialog Component for Adding/Editing Costs
export const RealizaceCostDialog = ({ isOpen, onClose, onSave, costData }) => {
    const { toast } = useToast();
    const [description, setDescription] = useState('');
    const [amount, setAmount] = useState('');
    const [supplierId, setSupplierId] = useState('');
    const [subjects, setSubjects] = useState([]);
    const [variableSymbol, setVariableSymbol] = useState('');
    const [note, setNote] = useState('');
    const [invoiceFile, setInvoiceFile] = useState(null);
    const [existingInvoice, setExistingInvoice] = useState(null);
    const [removeInvoice, setRemoveInvoice] = useState(false);
    const [isSubjectDialogOpen, setIsSubjectDialogOpen] = useState(false);
    const [loadingSubjects, setLoadingSubjects] = useState(false);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const inFlight = useRef(false);

    useEffect(() => {
        if(isOpen) fetchSubjects();
        if (costData && isOpen) {
            setDescription(costData.description || '');
            setAmount(costData.amount ?? '');
            setSupplierId(costData.supplier_id || '');
            setVariableSymbol(costData.variable_symbol || '');
            setNote(costData.note || '');
            setExistingInvoice(costData.invoice_url ? { name: costData.invoice_name, url: costData.invoice_url } : null);
            setRemoveInvoice(false);
            setInvoiceFile(null);
        } else if (isOpen) {
            resetForm();
        }
        if (isOpen) setSaveError(null);
    }, [costData, isOpen]);

    const resetForm = () => {
        setDescription('');
        setAmount('');
        setSupplierId('');
        setVariableSymbol('');
        setNote('');
        setInvoiceFile(null);
        setExistingInvoice(null);
        setRemoveInvoice(false);
    };

    const fetchSubjects = async () => {
        setLoadingSubjects(true);
        try {
            const data = await fetchAllFinancialRows(() => supabase.from('subjects').select('id,name').order('name').order('id'));
            setSubjects(data);
        } catch (error) { toast({ title: 'Dodavatele se nepodařilo načíst', description: getFinanceErrorMessage(error), variant: 'destructive' }); }
        finally { setLoadingSubjects(false); }
    };

    const handleQuickSubjectSave = async (subject) => {
         const { data, error } = await supabase.from('subjects').insert([subject]).select().single();
         if(error) { toast({title: 'Chyba', variant: 'destructive'}); return; }
         setSubjects(prev => [...prev, data].sort((a,b)=>a.name.localeCompare(b.name)));
         setSupplierId(data.id);
         setIsSubjectDialogOpen(false);
    };

    const handleSubmit = async () => {
        if (inFlight.current) return;
        const numericAmount = toFiniteAmount(amount);
        if (!description.trim() || numericAmount === null) {
            setSaveError('Vyplňte popis a platnou konečnou částku bez DPH.');
            return;
        }
        inFlight.current = true;
        setSaveError(null);
        setSaving(true);
        try {
            const saved = await onSave({ description: description.trim(), amount: numericAmount, supplier_id: supplierId || null, variable_symbol: variableSymbol || null, note: note || null, invoiceFile, existingInvoice, removeInvoice });
            if (saved !== false) onClose();
            else setSaveError('Náklad nebyl uložen. Zkontrolujte hlášení a zkuste to znovu; rozepsané údaje zůstaly zachované.');
        } catch (error) {
            setSaveError(getFinanceErrorMessage(error));
        } finally {
            inFlight.current = false;
            setSaving(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={open => { if (!open && !inFlight.current) onClose(); }}>
            <FormDialogContent size="md">
                <FormDialogHeader
                    icon={costData ? Edit2 : Plus}
                    title={costData ? 'Upravit náklad' : 'Přidat nový náklad'}
                    description="Evidence faktur, dodavatelů a ostatních realizačních výdajů."
                />
                <FormDialogBody className="space-y-4">
                    <fieldset disabled={saving} className="space-y-4">
                    <div className="grid gap-2">
                        <Label>Popis nákladu *</Label>
                        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Např. nákup materiálu" />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>Částka bez DPH (Kč) *</Label>
                            <p className="text-xs text-muted-foreground">Do finančního výsledku realizace vstupuje náklad bez DPH.</p>
                            <Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
                        </div>
                        <div className="grid gap-2">
                            <Label>Variabilní symbol</Label>
                            <Input value={variableSymbol} onChange={e => setVariableSymbol(e.target.value)} placeholder="123456" />
                        </div>
                    </div>
                    <div className="grid gap-2">
                        <Label>Dodavatel</Label>
                        <div className="flex gap-2">
                            <Select value={supplierId} onValueChange={setSupplierId}>
                                <SelectTrigger className="flex-1" disabled={loadingSubjects || saving}><SelectValue placeholder={loadingSubjects ? 'Načítám dodavatele…' : 'Vyberte dodavatele'} /></SelectTrigger>
                                <SelectContent>
                                    {subjects.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <Button variant="outline" onClick={() => setIsSubjectDialogOpen(true)}><Plus className="w-4 h-4"/></Button>
                        </div>
                    </div>
                     <div className="grid gap-2">
                        <Label>Poznámka</Label>
                        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} />
                    </div>
                    <div className="grid gap-2">
                        <Label>Faktura / Příloha</Label>
                        <div className="border rounded-md p-4 bg-slate-50">
                            {existingInvoice && !removeInvoice ? (
                                <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium truncate">{existingInvoice.name || 'Soubor nahrán'}</span>
                                    <Button variant="ghost" size="sm" onClick={() => setRemoveInvoice(true)}><X className="w-4 h-4 text-red-500"/></Button>
                                </div>
                            ) : (
                                <Input type="file" onChange={e => setInvoiceFile(e.target.files[0])} />
                            )}
                        </div>
                    </div>
                    {saveError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{saveError}</p>}
                    </fieldset>
                </FormDialogBody>
                <FormDialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={saving}>Zrušit</Button>
                    <Button onClick={handleSubmit} disabled={saving}>{saving ? 'Ukládám…' : 'Uložit'}</Button>
                </FormDialogFooter>
            </FormDialogContent>
            <SubjectDialog isOpen={isSubjectDialogOpen} onClose={() => setIsSubjectDialogOpen(false)} onSave={handleQuickSubjectSave}/>
        </Dialog>
    );
};

export default RealizaceFinancials;
