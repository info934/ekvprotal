import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Plus, Trash2, Save, AlertTriangle, Users, Coins } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatCurrency } from '@/lib/utils';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialValueGuard from './FinancialValueGuard';

const RealizaceProfitSharing = ({ realizaceId, distributionAmount, isCompleted }) => {
    const { toast } = useToast();
    const { hasPermission, userRole } = useAuth();
    const [shares, setShares] = useState([]);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    
    const { canViewAmounts } = getFinancialVisibility(userRole);

    // Strictly disable edit for 'user' role
    const canEdit = hasPermission('realizace', 'can_edit') && userRole !== 'user';

    const fetchData = useCallback(async () => {
        try {
            setLoading(true);
            const [sharesRes, membersRes] = await Promise.all([
                supabase.from('realization_profit_shares').select('*').eq('realizace_id', realizaceId),
                supabase.from('members').select('id, name').order('name')
            ]);

            if (sharesRes.error) throw sharesRes.error;
            if (membersRes.error) throw membersRes.error;

            setMembers(membersRes.data || []);
            
            // Transform shares to local state
            const loadedShares = (sharesRes.data || []).map(s => ({
                id: s.id, // existing ID
                member_id: s.member_id,
                share_type: s.share_type,
                share_value: s.share_value,
                note: s.note || ''
            }));
            
            setShares(loadedShares);

        } catch (error) {
            console.error('Error fetching profit shares:', error);
            toast({ title: 'Chyba při načítání podílů', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [realizaceId, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleAddShare = () => {
        setShares([...shares, { id: null, member_id: '', share_type: 'percent', share_value: '', note: '' }]);
    };

    const handleRemoveShare = (index) => {
        const newShares = [...shares];
        newShares.splice(index, 1);
        setShares(newShares);
    };

    const handleUpdateShare = (index, field, value) => {
        const newShares = [...shares];
        newShares[index][field] = value;
        setShares(newShares);
    };

    const calculateTotals = () => {
        let percentTotal = 0;
        let fixedTotal = 0;
        let distributedProfit = 0;

        shares.forEach(s => {
            const val = parseFloat(s.share_value) || 0;
            if (s.share_type === 'percent') {
                percentTotal += val;
                distributedProfit += (distributionAmount * val) / 100;
            } else if (s.share_type === 'fixed') {
                fixedTotal += val;
                distributedProfit += val;
            }
        });

        return { percentTotal, fixedTotal, distributedProfit };
    };

    const { distributedProfit } = calculateTotals();
    const remainingProfit = distributionAmount - distributedProfit;
    
    // Valid if within budget tolerance (or if budget is negative, we can't distribute)
    const isValid = distributionAmount > 0 ? distributedProfit <= (distributionAmount + 1) : true;
    const isBudgetPositive = distributionAmount >= 0;

    const handleSave = async () => {
        if (!isBudgetPositive && shares.length > 0) {
            toast({ title: 'Nelze rozdělit zisk', description: 'Týmový rozpočet je záporný.', variant: 'destructive' });
            return;
        }

        if (distributedProfit > (distributionAmount + 1)) {
            toast({ title: 'Chyba validace', description: 'Rozdělená částka překračuje dostupný rozpočet.', variant: 'destructive' });
            return;
        }

        const invalidEntry = shares.find(s => !s.member_id || !s.share_value);
        if (invalidEntry) {
            toast({ title: 'Neúplné údaje', description: 'Vyplňte člena a hodnotu u všech řádků.', variant: 'destructive' });
            return;
        }

        setSaving(true);
        try {
            // Delete existing shares for this realization (simple replace strategy)
            const { error: deleteError } = await supabase
                .from('realization_profit_shares')
                .delete()
                .eq('realizace_id', realizaceId);

            if (deleteError) throw deleteError;

            if (shares.length > 0) {
                const payload = shares.map(s => ({
                    realizace_id: realizaceId,
                    member_id: s.member_id,
                    share_type: s.share_type,
                    share_value: parseFloat(s.share_value),
                    note: s.note
                }));

                const { error: insertError } = await supabase
                    .from('realization_profit_shares')
                    .insert(payload);
                
                if (insertError) throw insertError;
            }

            toast({ title: 'Rozdělení uloženo' });
            fetchData();
        } catch (error) {
            console.error('Error saving shares:', error);
            toast({ title: 'Chyba při ukládání', description: error.message, variant: 'destructive' });
        } finally {
            setSaving(false);
        }
    };

    if (loading) return <div className="p-8 text-center">Načítání rozdělení zisku...</div>;

    return (
        <div className="space-y-6">
            {canViewAmounts && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <Card className={`border ${isBudgetPositive ? 'bg-blue-50 border-blue-200' : 'bg-red-50 border-red-200'}`}>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                <Coins className={`w-4 h-4 ${isBudgetPositive ? 'text-blue-600' : 'text-red-600'}`}/> Týmový rozpočet (k rozdělení)
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${isBudgetPositive ? 'text-blue-700' : 'text-red-700'}`}>
                                <FinancialValueGuard value={formatCurrency(distributionAmount)} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Smlouva - (Zisk + Režie + Náklady)</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Rozděleno</CardTitle>
                        </CardHeader>
                        <CardContent>
                             <div className="text-2xl font-bold text-slate-700">
                                <FinancialValueGuard value={formatCurrency(distributedProfit)} />
                             </div>
                             <p className="text-xs text-muted-foreground mt-1">Součet podílů členů</p>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Zbývá nerozděleno</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className={`text-2xl font-bold ${remainingProfit < 0 ? "text-red-600" : "text-green-600"}`}>
                                <FinancialValueGuard value={formatCurrency(remainingProfit)} />
                            </div>
                        </CardContent>
                    </Card>
                </div>
            )}

            {!isCompleted && (
                <Alert variant="warning" className="bg-yellow-50 border-yellow-200">
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                    <AlertTitle className="text-yellow-800">Realizace není dokončena</AlertTitle>
                    <AlertDescription className="text-yellow-700">
                        Finální rozdělení zisku by mělo proběhnout až po dokončení realizace.
                    </AlertDescription>
                </Alert>
            )}

            {!isBudgetPositive && canViewAmounts && (
                 <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Záporný rozpočet</AlertTitle>
                    <AlertDescription>
                        Týmový rozpočet je v mínusu. Nelze rozdělovat podíly.
                    </AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                    <div>
                        <CardTitle className="flex items-center gap-2"><Users className="w-5 h-5"/> Podíly členů týmu</CardTitle>
                        <CardDescription>
                            {canViewAmounts ? 'Definujte podíly z čistého týmového rozpočtu.' : 'Seznam členů s podílem na zisku.'}
                        </CardDescription>
                    </div>
                    {canEdit && isBudgetPositive && (
                        <Button onClick={handleAddShare} variant="outline" size="sm">
                            <Plus className="w-4 h-4 mr-2" /> Přidat člena
                        </Button>
                    )}
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="w-[250px]">Člen týmu</TableHead>
                                <TableHead className="w-[150px]">Typ podílu</TableHead>
                                {canViewAmounts && <TableHead className="w-[150px]">Hodnota</TableHead>}
                                {canViewAmounts && <TableHead>Vypočtená částka</TableHead>}
                                <TableHead>Poznámka</TableHead>
                                {canEdit && <TableHead className="w-[50px]"></TableHead>}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {shares.length === 0 ? (
                                <TableRow>
                                    <TableCell colSpan={canViewAmounts ? (canEdit ? 6 : 5) : (canEdit ? 4 : 3)} className="text-center py-8 text-muted-foreground">
                                        Zatím nejsou definovány žádné podíly.
                                    </TableCell>
                                </TableRow>
                            ) : (
                                shares.map((share, index) => {
                                    const calculatedAmount = share.share_type === 'percent' 
                                        ? (distributionAmount * (parseFloat(share.share_value) || 0)) / 100 
                                        : (parseFloat(share.share_value) || 0);

                                    return (
                                        <TableRow key={index}>
                                            <TableCell>
                                                {canEdit ? (
                                                    <Select 
                                                        value={share.member_id} 
                                                        onValueChange={(val) => handleUpdateShare(index, 'member_id', val)}
                                                    >
                                                        <SelectTrigger><SelectValue placeholder="Vyberte člena" /></SelectTrigger>
                                                        <SelectContent>
                                                            {members.map(m => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    members.find(m => m.id === share.member_id)?.name || 'Neznámý'
                                                )}
                                            </TableCell>
                                            <TableCell>
                                                {canEdit ? (
                                                    <Select 
                                                        value={share.share_type} 
                                                        onValueChange={(val) => handleUpdateShare(index, 'share_type', val)}
                                                    >
                                                        <SelectTrigger><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="percent">Procento (%)</SelectItem>
                                                            <SelectItem value="fixed">Fixní částka (Kč)</SelectItem>
                                                        </SelectContent>
                                                    </Select>
                                                ) : (
                                                    share.share_type === 'percent' ? 'Procento' : 'Fixní částka'
                                                )}
                                            </TableCell>
                                            {canViewAmounts && (
                                                <TableCell>
                                                    {canEdit ? (
                                                        <div className="relative">
                                                            <Input 
                                                                type="number" 
                                                                value={share.share_value} 
                                                                onChange={(e) => handleUpdateShare(index, 'share_value', e.target.value)}
                                                                min="0"
                                                            />
                                                            <span className="absolute right-3 top-2.5 text-muted-foreground text-xs">
                                                                {share.share_type === 'percent' ? '%' : 'Kč'}
                                                            </span>
                                                        </div>
                                                    ) : (
                                                        <span><FinancialValueGuard value={`${share.share_value} ${share.share_type === 'percent' ? '%' : 'Kč'}`} /></span>
                                                    )}
                                                </TableCell>
                                            )}
                                            {canViewAmounts && (
                                                <TableCell className="font-medium">
                                                    <FinancialValueGuard value={formatCurrency(calculatedAmount)} />
                                                </TableCell>
                                            )}
                                            <TableCell>
                                                 {canEdit ? (
                                                    <Input 
                                                        value={share.note} 
                                                        onChange={(e) => handleUpdateShare(index, 'note', e.target.value)}
                                                        placeholder="Poznámka..."
                                                    />
                                                 ) : (
                                                     share.note
                                                 )}
                                            </TableCell>
                                            {canEdit && (
                                                <TableCell>
                                                    <Button variant="ghost" size="icon" onClick={() => handleRemoveShare(index)} className="text-red-500 hover:text-red-700">
                                                        <Trash2 className="w-4 h-4" />
                                                    </Button>
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    );
                                })
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            {canEdit && (
                <div className="flex justify-end items-center bg-slate-100 p-4 rounded-lg">
                    <Button onClick={handleSave} disabled={saving || (!isBudgetPositive && shares.length > 0 && !isValid)}>
                        {saving ? 'Ukládání...' : <><Save className="w-4 h-4 mr-2" /> Uložit rozdělení</>}
                    </Button>
                </div>
            )}
        </div>
    );
};

export default RealizaceProfitSharing;