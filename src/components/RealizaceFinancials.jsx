import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { BarChart, DollarSign, TrendingUp, TrendingDown, HardHat, Plus, Edit2, FileText, Upload, X } from 'lucide-react';
import RealizaceFinancialChart from './RealizaceFinancialChart';
import RealizaceFinancialTable from './RealizaceFinancialTable';
import RealizaceOverheadSummary from './RealizaceOverheadSummary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import SubjectDialog from './SubjectDialog';
import { calculateFinancials } from './RealizaceFinancialCalculations';

// Main Dashboard Component
const RealizaceFinancials = () => {
    const [financials, setFinancials] = useState(null);
    const [realizationData, setRealizationData] = useState([]); // Store details for local calc if needed
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        const fetchFinancials = async () => {
            setLoading(true);
            // We fetch the detailed view now to do client side aggregations if the RPC doesn't support the new breakdown
            // For now, let's just stick to the RPC for global stats, but maybe we could enhance it later.
            // But the request asks to "update to include breakdown... profit, overhead, distribution".
            // Since RPC `get_realizace_financials` doesn't return these specific splits (it returns totals),
            // we might need to fetch `realizations` table to sum them up manually for the dashboard.
            
            const { data, error } = await supabase.from('realizations').select('contract_amount, profit_margin_percent, overhead_percent');
            
            if (error) {
                toast({ title: 'Chyba při načítání financí', description: error.message, variant: 'destructive' });
            } else {
                // Calculate Aggregates
                let totalContract = 0;
                let totalProfit = 0;
                let totalOverhead = 0;
                let totalDistribution = 0;
                
                (data || []).forEach(r => {
                    const calc = calculateFinancials(r.contract_amount, r.profit_margin_percent, r.overhead_percent);
                    totalContract += calc.contractAmount;
                    totalProfit += calc.profitAmount;
                    totalOverhead += calc.overheadAmount;
                    totalDistribution += calc.distributionAmount;
                });

                setFinancials({
                    total_revenue: totalContract,
                    total_profit: totalProfit,
                    total_overhead: totalOverhead,
                    total_distribution: totalDistribution,
                    realization_count: data?.length || 0
                });
            }
            setLoading(false);
        };
        fetchFinancials();
    }, [toast]);

    if (loading) return <div className="p-8 text-center">Načítání...</div>;
    const formatCurrency = (val) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(val || 0);

    return (
        <div className="space-y-6 p-6">
            <h2 className="text-2xl font-bold flex items-center gap-2"><BarChart className="w-6 h-6"/> Finance Realizace (Přehled)</h2>
            <div className="grid gap-4 md:grid-cols-5">
                <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Celkové Smlouvy</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{formatCurrency(financials?.total_revenue)}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Zisk Firmy</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-green-600">{formatCurrency(financials?.total_profit)}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Režie Firmy</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-purple-600">{formatCurrency(financials?.total_overhead)}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Rozpočet Týmů</CardTitle></CardHeader><CardContent className="text-2xl font-bold text-blue-600">{formatCurrency(financials?.total_distribution)}</CardContent></Card>
                <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Počet Realizací</CardTitle></CardHeader><CardContent className="text-2xl font-bold">{financials?.realization_count || 0}</CardContent></Card>
            </div>
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
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{costData ? 'Upravit náklad' : 'Přidat nový náklad'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="grid gap-2">
                        <Label>Popis nákladu *</Label>
                        <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder="Např. nákup materiálu" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
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
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose}>Zrušit</Button>
                    <Button onClick={handleSubmit}>Uložit</Button>
                </DialogFooter>
            </DialogContent>
            <SubjectDialog isOpen={isSubjectDialogOpen} onClose={() => setIsSubjectDialogOpen(false)} onSave={handleQuickSubjectSave}/>
        </Dialog>
    );
};

export default RealizaceFinancials;