import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from '@/lib/utils';
import { TrendingUp, TrendingDown, Activity, AlertTriangle, Info, Wallet, Percent, PieChart, Landmark, Building2, Coins, Calculator } from 'lucide-react';
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import RealizaceTeam from './RealizaceTeam';
import EditablePercentageField from './EditablePercentageField';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { calculateFinancials, validatePercentages } from './RealizaceFinancialCalculations';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialValueGuard from './FinancialValueGuard';

const RealizaceOverview = ({ realization, costStats, financialSnapshot, loading, onRealizationUpdate }) => {
    const { userRole, memberId } = useAuth();
    const [myShare, setMyShare] = useState(null);
    const [shareLoading, setShareLoading] = useState(false);
    
    // New State for percentages
    const [profitMarginPercent, setProfitMarginPercent] = useState(realization?.profit_margin_percent || 0);
    const [overheadPercent, setOverheadPercent] = useState(realization?.overhead_percent || 0);

    const { canViewAmounts } = getFinancialVisibility(userRole);
    const canEdit = userRole !== 'user';

    useEffect(() => {
        setProfitMarginPercent(realization?.profit_margin_percent || 0);
        setOverheadPercent(realization?.overhead_percent || 0);
    }, [realization?.profit_margin_percent, realization?.overhead_percent]);

    // Recalculate financials locally for immediate feedback using passed snapshot data
    const financials = calculateFinancials(
        financialSnapshot.contractAmount, 
        profitMarginPercent, 
        overheadPercent, 
        costStats.grandTotal
    );

    useEffect(() => {
        if (!canViewAmounts && memberId && realization?.id) {
            const fetchShare = async () => {
                setShareLoading(true);
                const { data } = await supabase.from('realization_profit_shares')
                    .select('*')
                    .eq('realizace_id', realization.id)
                    .eq('member_id', memberId)
                    .maybeSingle();
                setMyShare(data);
                setShareLoading(false);
            };
            fetchShare();
        }
    }, [canViewAmounts, memberId, realization?.id]);

    const handlePercentageUpdate = (field, newValue) => {
        const potentialMargin = field === 'profit_margin_percent' ? newValue : profitMarginPercent;
        const potentialOverhead = field === 'overhead_percent' ? newValue : overheadPercent;

        if (!validatePercentages(potentialMargin, potentialOverhead)) {
            console.warn("Total percentage exceeds 100%");
        }

        if (field === 'profit_margin_percent') {
            setProfitMarginPercent(newValue);
        } else if (field === 'overhead_percent') {
            setOverheadPercent(newValue);
        }
        
        if (onRealizationUpdate) {
            onRealizationUpdate({ ...realization, [field]: newValue });
        }
    };

    if (!realization) return null;

    const { contractAmount } = financialSnapshot;
    const { profitAmount, overheadAmount, teamBudget, totalCosts } = financials;

    // --- RESTRICTED VIEW (NON-ADMINS) ---
    if (!canViewAmounts) {
        let myRewardAmount = 0;
        if (myShare) {
            if (myShare.share_type === 'fixed') {
                myRewardAmount = Number(myShare.share_value);
            } else {
                myRewardAmount = Math.max(0, (teamBudget * Number(myShare.share_value)) / 100);
            }
        }

        return (
             <div className="space-y-6">
                 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <Card className="border-l-4 border-l-blue-500">
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                                <Wallet className="w-4 h-4"/> Moje odměna / Honorář
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-blue-600">
                                {shareLoading ? 'Načítání...' : <FinancialValueGuard value={formatCurrency(myRewardAmount)} />}
                            </div>
                            <div className="text-sm text-muted-foreground mt-1">
                                {myShare ? (
                                    myShare.share_type === 'percent' 
                                    ? `Podíl: ${myShare.share_value} %` 
                                    : 'Fixní částka'
                                ) : (
                                    'Zatím nebyl stanoven podíl'
                                )}
                            </div>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Stav realizace</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold mb-1">
                                <Badge variant={realization.status === 'Dokončeno' ? 'success' : 'secondary'}>
                                    {realization.status}
                                </Badge>
                            </div>
                             <div className="text-sm text-muted-foreground">
                                {realization.type || 'Typ neuveden'}
                            </div>
                        </CardContent>
                    </Card>
                 </div>
                 <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                    <div className="xl:col-span-2">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Informace o realizaci</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Investor:</span>
                                    <span className="font-medium">{realization.investor?.name || '-'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Vedoucí:</span>
                                    <span className="font-medium">{realization.lead_person?.name || '-'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Zahájení:</span>
                                    <span>{realization.start_date ? new Date(realization.start_date).toLocaleDateString('cs-CZ') : '-'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">GPS:</span>
                                    <span className="font-mono">{realization.location_gps || '-'}</span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                    <div className="xl:col-span-1">
                        <RealizaceTeam realizaceId={realization.id} teamBudget={teamBudget} />
                    </div>
                 </div>
             </div>
        );
    }

    // --- FULL VIEW (ADMIN/MANAGER) ---
    const statusColor = realization.status === 'Dokončeno' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800';
    const isBudgetPositive = teamBudget >= 0;

    return (
        <div className="space-y-6">
            {/* Top Row - Financial Model Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
                {/* 1. Contract Amount */}
                <Card className="border-l-4 border-l-slate-500">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground">Smlouva (Příjmy)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-xl font-bold"><FinancialValueGuard value={formatCurrency(contractAmount)} /></div>
                        <Badge variant="outline" className={`mt-1 text-[10px] h-5 ${statusColor}`}>
                            {realization.status}
                        </Badge>
                    </CardContent>
                </Card>

                {/* 2. Profit */}
                <Card className="border-l-4 border-l-green-500 bg-gradient-to-br from-green-50/50 to-white">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <Landmark className="w-3 h-3 text-green-600" /> Zisk firmy
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <EditablePercentageField
                            realizaceId={realization.id}
                            fieldName="profit_margin_percent"
                            currentValue={profitMarginPercent}
                            onUpdate={(val) => handlePercentageUpdate('profit_margin_percent', val)}
                            label="Zisk firmy"
                            canEdit={canEdit}
                        />
                        <div className="text-sm font-bold text-green-700 mt-1">
                            <FinancialValueGuard value={formatCurrency(profitAmount)} />
                        </div>
                    </CardContent>
                </Card>

                {/* 3. Overhead */}
                <Card className="border-l-4 border-l-purple-500 bg-gradient-to-br from-purple-50/50 to-white">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <Building2 className="w-3 h-3 text-purple-600" /> Režie firmy
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <EditablePercentageField
                            realizaceId={realization.id}
                            fieldName="overhead_percent"
                            currentValue={overheadPercent}
                            onUpdate={(val) => handlePercentageUpdate('overhead_percent', val)}
                            label="Režie firmy"
                            canEdit={canEdit}
                        />
                        <div className="text-sm font-bold text-purple-700 mt-1">
                            <FinancialValueGuard value={formatCurrency(overheadAmount)} />
                        </div>
                    </CardContent>
                </Card>

                {/* 4. Total Costs */}
                <Card className="border-l-4 border-l-orange-500">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <Activity className="w-3 h-3 text-orange-600" /> Celkem náklady
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-xl font-bold text-orange-700">
                            <FinancialValueGuard value={formatCurrency(totalCosts)} />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1">
                            Manuální + Hodinové + Ostatní
                        </div>
                    </CardContent>
                </Card>

                {/* 5. Team Budget */}
                <Card className={`border-l-4 ${isBudgetPositive ? 'border-l-blue-500 bg-blue-50' : 'border-l-red-500 bg-red-50'}`}>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            <Coins className="w-3 h-3 text-blue-600" /> Týmový rozpočet
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className={`text-xl font-bold ${isBudgetPositive ? 'text-blue-700' : 'text-red-700'}`}>
                            <FinancialValueGuard value={formatCurrency(teamBudget)} />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 truncate" title="Smlouva - Zisk - Režie - Náklady">
                            K rozdělení týmu
                        </div>
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                {/* Left Column - Financial Stats & Details */}
                <div className="xl:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Informace o realizaci</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Investor:</span>
                                    <span className="font-medium">{realization.investor?.name || '-'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Vedoucí:</span>
                                    <span className="font-medium">{realization.lead_person?.name || '-'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">GPS:</span>
                                    <span className="font-mono">{realization.location_gps || '-'}</span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Zahájení:</span>
                                    <span>{realization.start_date ? new Date(realization.start_date).toLocaleDateString('cs-CZ') : '-'}</span>
                                </div>
                                <div className="flex justify-between py-1">
                                    <span className="text-muted-foreground">Plánované dokončení:</span>
                                    <span>{realization.planned_end_date ? new Date(realization.planned_end_date).toLocaleDateString('cs-CZ') : '-'}</span>
                                </div>
                            </CardContent>
                        </Card>

                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">Detail nákladů</CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-2 text-sm">
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Vícenáklady (prodej):</span>
                                    <span className="font-medium text-green-600"><FinancialValueGuard value={formatCurrency(costStats.extraCostsSale)} /></span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Manuální náklady:</span>
                                    <span className="font-medium"><FinancialValueGuard value={formatCurrency(costStats.totalRecordedCosts)} /></span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Hodinové náklady:</span>
                                    <span className="font-medium"><FinancialValueGuard value={formatCurrency(costStats.hourlyCosts)} /></span>
                                </div>
                                <div className="flex justify-between py-1 border-b">
                                    <span className="text-muted-foreground">Vícenáklady (náklad):</span>
                                    <span className="font-medium"><FinancialValueGuard value={formatCurrency(costStats.extraCosts)} /></span>
                                </div>
                                <div className="flex justify-between py-1 bg-slate-50 px-2 rounded font-bold">
                                    <span>Celkem náklady:</span>
                                    <span><FinancialValueGuard value={formatCurrency(totalCosts)} /></span>
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                </div>

                {/* Right Column - Team Members */}
                <div className="xl:col-span-1">
                    <RealizaceTeam realizaceId={realization.id} teamBudget={teamBudget} />
                </div>
            </div>
        </div>
    );
};

export default RealizaceOverview;