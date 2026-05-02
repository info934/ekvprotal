import React, { useState, useEffect } from 'react';
import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { format, parseISO } from 'date-fns';
import { cs } from 'date-fns/locale';

const RealizaceFinancialChart = () => {
    const [chartData, setChartData] = useState([]);
    const [loading, setLoading] = useState(true);
    const { toast } = useToast();

    useEffect(() => {
        const fetchChartData = async () => {
            setLoading(true);
            const { data, error } = await supabase
                .from('realizace_financials')
                .select('period, actual_revenue, actual_costs, actual_profit')
                .order('period', { ascending: true });

            if (error) {
                toast({ title: 'Chyba načítání dat pro graf', variant: 'destructive', description: error.message });
            } else {
                // Aggregate data by month
                const monthlyData = data.reduce((acc, item) => {
                    const month = format(parseISO(item.period), 'yyyy-MM');
                    if (!acc[month]) {
                        acc[month] = {
                            month,
                            name: format(parseISO(item.period), 'MMM yyyy', { locale: cs }),
                            revenue: 0,
                            costs: 0,
                            profit: 0
                        };
                    }
                    acc[month].revenue += item.actual_revenue || 0;
                    acc[month].costs += item.actual_costs || 0;
                    acc[month].profit += item.actual_profit || 0;
                    return acc;
                }, {});

                setChartData(Object.values(monthlyData));
            }
            setLoading(false);
        };
        fetchChartData();
    }, [toast]);

    if (loading) {
        return (
            <Card>
                <CardHeader>
                    <CardTitle>Finanční vývoj</CardTitle>
                    <CardDescription>Měsíční přehled příjmů, nákladů a zisku.</CardDescription>
                </CardHeader>
                <CardContent className="h-[350px] flex items-center justify-center">
                    <p>Načítání dat grafu...</p>
                </CardContent>
            </Card>
        );
    }
    
    // Future integration point for Forecast module:
    // This chart could accept props to display projected data alongside actual data.
    // e.g., <RealizaceFinancialChart actualData={...} forecastData={...} />
    return (
        <Card>
            <CardHeader>
                <CardTitle>Finanční vývoj - Realizace</CardTitle>
                <CardDescription>Měsíční přehled příjmů, nákladů a zisku.</CardDescription>
            </CardHeader>
            <CardContent className="h-[350px]">
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                        <XAxis dataKey="name" stroke="#888888" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#888888" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value / 1000}k`} />
                        <Tooltip
                            contentStyle={{ background: "#fff", border: "1px solid #ccc", borderRadius: "0.5rem" }}
                            formatter={(value) => new Intl.NumberFormat('cs-CZ', { style: 'currency', currency: 'CZK' }).format(value)}
                        />
                        <Legend />
                        <Bar dataKey="revenue" fill="#22c55e" name="Příjmy" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="costs" fill="#ef4444" name="Náklady" radius={[4, 4, 0, 0]} />
                        <Bar dataKey="profit" fill="#3b82f6" name="Zisk" radius={[4, 4, 0, 0]} />
                    </BarChart>
                </ResponsiveContainer>
            </CardContent>
        </Card>
    );
};

export default RealizaceFinancialChart;