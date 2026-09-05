import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatMoney, getFinanceErrorMessage } from '@/lib/financePresentation';
import { toFiniteAmount } from '@/domain/financials';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { FinanceVisibilityNotice } from '@/components/finance/FinanceWorkspace';
import { Button } from '@/components/ui/button';

const RealizaceFinancialTable = () => {
    const [financialData, setFinancialData] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [reload, setReload] = useState(0);
    const { userRole, isPrivateMode } = useAuth();
    const allowed = userRole === 'admin';

    useEffect(() => {
        const controller = new AbortController();
        setFinancialData([]); setError(null);
        if (!allowed) { setLoading(false); return () => controller.abort(); }
        const fetchTableData = async () => {
            setLoading(true);
            try {
            const { data, error: loadError } = await supabase
                .from('realizace_financials')
                .select(`
                    *,
                    realization:realizace_id (name)
                `)
                .order('period', { ascending: false })
                .order('id')
                .limit(10).abortSignal(controller.signal);
            if (loadError) throw loadError;
            if (!Array.isArray(data)) throw new Error('Finanční seznam nebyl načten.');
            if (!controller.signal.aborted) setFinancialData(data);
            } catch (loadError) {
                if (!controller.signal.aborted) setError(getFinanceErrorMessage(loadError, 'Finanční záznamy se nepodařilo načíst.'));
            } finally {
                if (!controller.signal.aborted) setLoading(false);
            }
        };
        fetchTableData();
        return () => controller.abort();
    }, [allowed, reload]);

    const formatCurrency = formatMoney;
    const periodLabel = value => {
        const date = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00Z`) : null;
        return date && Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date.toLocaleDateString('cs-CZ', { month: '2-digit', year: 'numeric', timeZone: 'UTC' }) : 'Období není platné';
    };
    if (!allowed || isPrivateMode) return <FinanceVisibilityNotice message={isPrivateMode ? 'Finanční záznamy jsou skryté v soukromém režimu.' : 'Finanční záznamy jsou dostupné administrátorovi.'} />;

    // Future integration point for Forecast module:
    // This table could be enhanced with a column showing 'Projected vs. Actual' variance
    // when forecast data is available for a given period.
    return (
        <Card>
            <CardHeader>
                <CardTitle>Poslední finanční záznamy</CardTitle>
                <CardDescription>10 nejnovějších periodických záznamů realizací. Přehled nezobrazuje všechny finanční pohyby.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Realizace</TableHead>
                            <TableHead>Období</TableHead>
                            <TableHead>Příjmy</TableHead>
                            <TableHead>Náklady</TableHead>
                            <TableHead className="text-right">Zisk</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center">Načítání...</TableCell>
                            </TableRow>
                        ) : error ? (
                            <TableRow><TableCell colSpan={5}><p role="alert" className="mb-3 text-sm text-red-800">{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>Zkusit znovu</Button></TableCell></TableRow>
                        ) : financialData.length === 0 ? (
                            <TableRow>
                                <TableCell colSpan={5} className="text-center">Nebyly nalezeny žádné finanční záznamy.</TableCell>
                            </TableRow>
                        ) : (
                            financialData.map(item => (
                                <TableRow key={item.id}>
                                    <TableCell>
                                        <div className="font-medium">{item.realization?.name || 'N/A'}</div>
                                    </TableCell>
                                    <TableCell>{periodLabel(item.period)}</TableCell>
                                    <TableCell className="text-green-600">{formatCurrency(item.actual_revenue)}</TableCell>
                                    <TableCell className="text-red-600">{formatCurrency(item.actual_costs)}</TableCell>
                                    <TableCell className="text-right font-medium">
                                        <Badge variant={toFiniteAmount(item.actual_profit) === null ? 'secondary' : Number(item.actual_profit) >= 0 ? 'success' : 'destructive'}>
                                            {formatCurrency(item.actual_profit)}
                                        </Badge>
                                    </TableCell>
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </CardContent>
        </Card>
    );
};

export default RealizaceFinancialTable;
