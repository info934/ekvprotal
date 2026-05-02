import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { format, parseISO } from 'date-fns';

const RealizaceFinancialTable = () => {
    const [financialData, setFinancialData] = useState([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        const fetchTableData = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('realizace_financials')
                .select(`
                    *,
                    realization:realizace_id (name)
                `)
                .order('period', { ascending: false })
                .limit(10);
            
            if (error) {
                toast({ title: 'Chyba načítání finančních záznamů', variant: 'destructive', description: error.message });
            } else {
                setFinancialData(data);
            }
            setLoading(false);
        };
        fetchTableData();
    }, [toast]);

    const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(value || 0);

    // Future integration point for Forecast module:
    // This table could be enhanced with a column showing 'Projected vs. Actual' variance
    // when forecast data is available for a given period.
    return (
        <Card>
            <CardHeader>
                <CardTitle>Poslední finanční operace</CardTitle>
                <CardDescription>Přehled posledních zaznamenaných finančních pohybů v realizacích.</CardDescription>
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
                                    <TableCell>{format(parseISO(item.period), 'MM/yyyy')}</TableCell>
                                    <TableCell className="text-green-600">{formatCurrency(item.actual_revenue)}</TableCell>
                                    <TableCell className="text-red-600">{formatCurrency(item.actual_costs)}</TableCell>
                                    <TableCell className="text-right font-medium">
                                        <Badge variant={item.actual_profit >= 0 ? 'success' : 'destructive'}>
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