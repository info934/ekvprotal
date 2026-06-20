import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { format, parseISO } from 'date-fns';
import { cs } from 'date-fns/locale';
import { DataVizCard, DATAVIZ_COLORS, DataVizEmptyState, formatVizCurrency, VizTooltip } from '@/components/ui/data-viz';

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
        const monthlyData = (data || []).reduce((acc, item) => {
          const month = format(parseISO(item.period), 'yyyy-MM');
          if (!acc[month]) {
            acc[month] = {
              month,
              name: format(parseISO(item.period), 'MMM yyyy', { locale: cs }),
              revenue: 0,
              costs: 0,
              profit: 0,
            };
          }
          acc[month].revenue += Number(item.actual_revenue) || 0;
          acc[month].costs += Number(item.actual_costs) || 0;
          acc[month].profit += Number(item.actual_profit) || 0;
          return acc;
        }, {});

        setChartData(Object.values(monthlyData));
      }
      setLoading(false);
    };

    fetchChartData();
  }, [toast]);

  return (
    <DataVizCard
      title="Finanční vývoj realizací"
      description="Měsíční přehled příjmů, nákladů a zisku. Hodnoty jsou agregované podle období."
      icon={BarChart3}
      contentClassName="h-[360px]"
    >
      {loading ? (
        <DataVizEmptyState label="Načítám data grafu..." className="h-full" />
      ) : chartData.length === 0 ? (
        <DataVizEmptyState label="Žádné finanční hodnoty k zobrazení." className="h-full" />
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }} barGap={6}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="name" stroke="#64748b" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis
              stroke="#64748b"
              fontSize={12}
              tickLine={false}
              axisLine={false}
              width={72}
              tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`}
            />
            <Tooltip content={<VizTooltip valueFormatter={formatVizCurrency} />} cursor={{ fill: '#f8fafc' }} />
            <Bar dataKey="revenue" fill={DATAVIZ_COLORS.emerald} name="Příjmy" radius={[6, 6, 0, 0]} />
            <Bar dataKey="costs" fill={DATAVIZ_COLORS.rose} name="Náklady" radius={[6, 6, 0, 0]} />
            <Bar dataKey="profit" fill={DATAVIZ_COLORS.primary} name="Zisk" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </DataVizCard>
  );
};

export default RealizaceFinancialChart;
