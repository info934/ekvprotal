import React, { useState } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Edit2, Save, X, TrendingUp } from 'lucide-react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatCurrency as formatCurrencyValue } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";

const CATEGORIES = [
    { value: 'material', label: 'Materiál' },
    { value: 'transport', label: 'Doprava' },
    { value: 'subcontract', label: 'Subdodávka' },
    { value: 'salary', label: 'Mzdy/Práce' },
    { value: 'equipment', label: 'Vybavení/Nářadí' },
    { value: 'other', label: 'Ostatní' }
];

const RealizaceExtraCosts = ({ realizaceId, extraCosts, onUpdate, canEdit: canEditOverride }) => {
    const { toast } = useToast();
    const { hasPermission, userRole, isPrivateMode } = useAuth();
    const formatCurrency = value => isPrivateMode ? 'Skryto' : formatCurrencyValue(value);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);

    // Strictly disable edit for 'user' role
    const canEdit = !isPrivateMode && (canEditOverride ?? (hasPermission('realizace', 'can_edit') && userRole !== 'user'));

    // Form State
    const [description, setDescription] = useState('');
    const [category, setCategory] = useState('other');
    const [costAmount, setCostAmount] = useState('');
    const [saleAmount, setSaleAmount] = useState('');
    const [saving, setSaving] = useState(false);

    const openDialog = (item = null) => {
        if (item) {
            setEditingItem(item);
            setDescription(item.description);
            setCategory(item.category || 'other');
            setCostAmount(item.cost_amount);
            setSaleAmount(item.sale_amount);
        } else {
            setEditingItem(null);
            setDescription('');
            setCategory('other');
            setCostAmount('');
            setSaleAmount('');
        }
        setIsDialogOpen(true);
    };

    const handleSave = async () => {
        if (!canEdit) return;
        if (!description || !costAmount) {
            toast({ title: 'Chyba', description: 'Vyplňte popis a nákladovou cenu.', variant: 'destructive' });
            return;
        }

        setSaving(true);
        try {
            const costVal = parseFloat(costAmount);
            const saleVal = saleAmount ? parseFloat(saleAmount) : 0;
            // Calculate markup automatically if not explicitly stored, or just store 0 if not used heavily
            const markup = costVal > 0 ? ((saleVal - costVal) / costVal) * 100 : 0;

            const payload = {
                realizace_id: realizaceId,
                description,
                category,
                cost_amount: costVal,
                sale_amount: saleVal,
                markup_percent: markup
            };

            let error;
            if (editingItem) {
                const { error: updateError } = await supabase
                    .from('realizace_extra_costs')
                    .update(payload)
                    .eq('id', editingItem.id);
                error = updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('realizace_extra_costs')
                    .insert(payload);
                error = insertError;
            }

            if (error) throw error;

            toast({ title: editingItem ? 'Vícenáklad aktualizován' : 'Vícenáklad přidán' });
            setIsDialogOpen(false);
            onUpdate(); // Refresh parent data
        } catch (error) {
            console.error('Error saving extra cost:', error);
            toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async (id) => {
        if (!canEdit) return;
        try {
            const { error } = await supabase.from('realizace_extra_costs').delete().eq('id', id);
            if (error) throw error;
            toast({ title: 'Vícenáklad smazán' });
            onUpdate();
        } catch (error) {
            toast({ title: 'Chyba při mazání', description: error.message, variant: 'destructive' });
        }
    };

    const totalCost = extraCosts.reduce((sum, item) => sum + Number(item.cost_amount || 0), 0);
    const totalSale = extraCosts.reduce((sum, item) => sum + Number(item.sale_amount || 0), 0);
    const totalProfit = totalSale - totalCost;

    return (
        <Card>
            <CardHeader className="flex flex-col gap-3 pb-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                    <CardTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-orange-500"/> Vícenáklady / Vícepráce</CardTitle>
                    <CardDescription>Evidence dodatečných nákladů a prací nad rámec rozpočtu.</CardDescription>
                </div>
                {canEdit && (
                    <Button onClick={() => openDialog()} variant="outline" size="sm">
                        <Plus className="w-4 h-4 mr-2" /> Přidat položku
                    </Button>
                )}
            </CardHeader>
            <CardContent>
                {/* Summary Stats for Extra Costs */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                    <div className="bg-orange-50 p-3 rounded-lg border border-orange-100">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Náklady bez DPH</p>
                        <p className="text-lg font-bold text-orange-700">{formatCurrency(totalCost)}</p>
                    </div>
                    <div className="bg-green-50 p-3 rounded-lg border border-green-100">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Fakturace bez DPH</p>
                        <p className="text-lg font-bold text-green-700">{formatCurrency(totalSale)}</p>
                    </div>
                    <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">Hrubý rozdíl před marží a režií</p>
                        <p className={`text-lg font-bold ${totalProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                            {formatCurrency(totalProfit)}
                        </p>
                    </div>
                </div>

                <div className="rounded-md border">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Popis</TableHead>
                                <TableHead>Kategorie</TableHead>
                                <TableHead className="text-right">Náklad</TableHead>
                                <TableHead className="text-right">Prodejní cena</TableHead>
                                <TableHead className="text-right">Zisk</TableHead>
                                <TableHead className="w-[100px]"></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {extraCosts.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                                        Žádné vícenáklady.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                extraCosts.map((item) => {
                                    const profit = (Number(item.sale_amount) || 0) - (Number(item.cost_amount) || 0);
                                    const catLabel = CATEGORIES.find(c => c.value === item.category)?.label || item.category || 'Nezařazeno';
                                    
                                    return (
                                        <TableRow key={item.id}>
                                            <TableCell className="font-medium">{item.description}</TableCell>
                                            <TableCell><Badge variant="outline">{catLabel}</Badge></TableCell>
                                            <TableCell className="text-right text-red-600 font-medium">-{formatCurrency(item.cost_amount)}</TableCell>
                                            <TableCell className="text-right text-green-600 font-medium">+{formatCurrency(item.sale_amount)}</TableCell>
                                            <TableCell className={`text-right font-bold ${profit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>
                                                {formatCurrency(profit)}
                                            </TableCell>
                                            <TableCell>
                                                {canEdit && (
                                                    <div className="flex justify-end gap-1">
                                                        <Button variant="ghost" size="icon" aria-label={`Upravit vícepráci: ${item.description}`} onClick={() => openDialog(item)}>
                                                            <Edit2 className="w-4 h-4" />
                                                        </Button>
                                                        <AlertDialog>
                                                            <AlertDialogTrigger asChild>
                                                                <Button variant="ghost" size="icon" aria-label={`Smazat vícepráci: ${item.description}`} className="text-red-500 hover:text-red-700">
                                                                    <Trash2 className="w-4 h-4" />
                                                                </Button>
                                                            </AlertDialogTrigger>
                                                            <AlertDialogContent>
                                                                <AlertDialogHeader>
                                                                    <AlertDialogTitle>Smazat položku?</AlertDialogTitle>
                                                                </AlertDialogHeader>
                                                                <AlertDialogFooter>
                                                                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                                                    <AlertDialogAction onClick={() => handleDelete(item.id)} className="bg-destructive">Smazat</AlertDialogAction>
                                                                </AlertDialogFooter>
                                                            </AlertDialogContent>
                                                        </AlertDialog>
                                                    </div>
                                                )}
                                            </TableCell>
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>

            <Dialog open={isDialogOpen && !isPrivateMode} onOpenChange={setIsDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingItem ? 'Upravit vícenáklad' : 'Přidat vícenáklad'}</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div className="grid gap-2">
                            <Label>Popis *</Label>
                            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder="Např. Vícepráce - bourání příčky" />
                        </div>
                        <div className="grid gap-2">
                            <Label>Kategorie</Label>
                            <Select value={category} onValueChange={setCategory}>
                                <SelectTrigger><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    {CATEGORIES.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                            <div className="grid gap-2">
                                <Label>Nákladová cena bez DPH (Kč) *</Label>
                                <Input type="number" value={costAmount} onChange={e => setCostAmount(e.target.value)} placeholder="0" min="0" />
                            </div>
                            <div className="grid gap-2">
                                <Label>Prodejní cena klientovi bez DPH (Kč)</Label>
                                <Input type="number" value={saleAmount} onChange={e => setSaleAmount(e.target.value)} placeholder="0" min="0" />
                                <p className="text-[10px] text-muted-foreground">Pokud se nefakturuje klientovi, nechte 0.</p>
                            </div>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Zrušit</Button>
                        <Button onClick={handleSave} disabled={saving}>Uložit</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

export default RealizaceExtraCosts;
