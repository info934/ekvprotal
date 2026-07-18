import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { AlertTriangle, BarChart, DollarSign, TrendingUp, TrendingDown, HardHat, Plus, Edit2, FileText, Upload, X } from 'lucide-react';
import RealizaceFinancialChart from './RealizaceFinancialChart';
import RealizaceFinancialTable from './RealizaceFinancialTable';
import RealizaceOverheadSummary from './RealizaceOverheadSummary';
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

// Main Dashboard Component
const RealizaceFinancials = () => {
    const [financials, setFinancials] = useState(null);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();
    const { userRole } = useAuth();
    const { canViewAmounts } = getFinancialVisibility(userRole);

    useEffect(() => {
        if (!canViewAmounts) {
            setLoading(false);
            return;
        }

        const fetchFinancials = async () => {
            setLoading(true);
            const { data, error } = await supabase.rpc('get_realization_financial_overview');
            
            if (error) {
                toast({ title: 'Chyba při načítání financí', description: error.message, variant: 'destructive' });
            } else {
                setFinancials(data || {});
            }
            setLoading(false);
        };
        fetchFinancials();
    }, [canViewAmounts, toast]);

    if (loading) return <div className="p-8 text-center">Načítání...</div>;
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
    return (
        <div className="space-y-6 p-6">
            <div>
                <h2 className="flex items-center gap-2 text-xl font-semibold text-slate-950"><BarChart className="h-5 w-5"/> Finance realizací</h2>
                <p className="mt-1 text-sm text-slate-500">Souhrnný administrátorský pohled na výnosy, rozpočty a očekávaný výsledek realizací.</p>
            </div>
            <FinanceMetricStrip metrics={[
                { label: 'Výnosy ze smluv', value: <FinanceAmount value={financials?.total_revenue} />, detail: 'Evidované realizace', tone: 'neutral', icon: DollarSign },
                { label: 'Plánovaný zisk firmy', value: <FinanceAmount value={financials?.total_profit} />, detail: 'Podle nastavených marží', tone: Number(financials?.total_profit || 0) < 0 ? 'negative' : 'positive', icon: TrendingUp },
                { label: 'Plánovaná režie', value: <FinanceAmount value={financials?.total_overhead} />, detail: 'Rozpočtová alokace', tone: 'warning', icon: FileText },
                { label: 'Rozpočet týmů', value: <FinanceAmount value={financials?.total_distribution} />, detail: 'Základ pro odměny', tone: 'plan', icon: TrendingDown },
                { label: 'Počet realizací', value: financials?.realization_count || 0, detail: 'V agregovaném přehledu', tone: 'neutral', icon: HardHat },
            ]} className="2xl:grid-cols-5" />
            <RealizaceOverheadSummary />
            <RealizaceFinancialChart />
            <RealizaceFinancialTable />
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

    useEffect(() => {
        if(isOpen) fetchSubjects();
        if (costData && isOpen) {
            setDescription(costData.description || '');
            setAmount(costData.amount || '');
            setSupplierId(costData.supplier_id || '');
            setVariableSymbol(costData.variable_symbol || '');
            setNote(costData.note || '');
            setExistingInvoice(costData.invoice_url ? { name: costData.invoice_name, url: costData.invoice_url } : null);
            setRemoveInvoice(false);
            setInvoiceFile(null);
        } else if (isOpen) {
            resetForm();
        }
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
        const { data } = await supabase.from('subjects').select('id, name').order('name');
        setSubjects(data || []);
        setLoadingSubjects(false);
    };

    const handleQuickSubjectSave = async (subject) => {
         const { data, error } = await supabase.from('subjects').insert([subject]).select().single();
         if(error) { toast({title: 'Chyba', variant: 'destructive'}); return; }
         setSubjects(prev => [...prev, data].sort((a,b)=>a.name.localeCompare(b.name)));
         setSupplierId(data.id);
         setIsSubjectDialogOpen(false);
    };

    const handleSubmit = () => {
        if (!description || !amount) {
            toast({ title: 'Chybí povinné údaje', variant: 'destructive' });
            return;
        }
        onSave({
            description,
            amount: parseFloat(amount),
            supplier_id: supplierId || null,
            variable_symbol: variableSymbol || null,
            note: note || null,
            invoiceFile,
            existingInvoice,
            removeInvoice
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <FormDialogContent size="md">
                <FormDialogHeader
                    icon={costData ? Edit2 : Plus}
                    title={costData ? 'Upravit náklad' : 'Přidat nový náklad'}
                    description="Evidence faktur, dodavatelů a ostatních realizačních výdajů."
                />
                <FormDialogBody className="space-y-4">
                    <div className="grid gap-2">
                        <Label>Popis nákladu *</Label>
                        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Např. nákup materiálu" />
                    </div>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        <div className="grid gap-2">
                            <Label>Částka (Kč) *</Label>
                            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00" />
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
                                <SelectTrigger className="flex-1"><SelectValue placeholder="Vyberte dodavatele" /></SelectTrigger>
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
                </FormDialogBody>
                <FormDialogFooter>
                    <Button variant="outline" onClick={onClose}>Zrušit</Button>
                    <Button onClick={handleSubmit}>Uložit</Button>
                </FormDialogFooter>
            </FormDialogContent>
            <SubjectDialog isOpen={isSubjectDialogOpen} onClose={() => setIsSubjectDialogOpen(false)} onSave={handleQuickSubjectSave}/>
        </Dialog>
    );
};

export default RealizaceFinancials;
