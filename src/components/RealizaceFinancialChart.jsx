import React, { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BarChart3 } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { DataVizCard, DATAVIZ_COLORS, DataVizEmptyState, formatVizCurrency, VizTooltip } from '@/components/ui/data-viz';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { aggregateFinancialPeriods, fetchAllFinancialRows, getFinanceErrorMessage } from '@/lib/financePresentation';
import { FinanceVisibilityNotice } from '@/components/finance/FinanceWorkspace';
import { Button } from '@/components/ui/button';

const RealizaceFinancialChart = () => {
  const [chartData, setChartData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reload, setReload] = useState(0);
  const { userRole, isPrivateMode } = useAuth();
  const allowed = userRole === 'admin';

  useEffect(() => {
    const controller = new AbortController();
    setChartData([]);
    setError(null);
    if (!allowed) { setLoading(false); return () => controller.abort(); }
    const fetchChartData = async () => {
      setLoading(true);
      try {
        const rows = await fetchAllFinancialRows(() => supabase.from('realizace_financials').select('id,period,actual_revenue,actual_costs,actual_profit').order('period').order('id'), controller.signal);
        const data = aggregateFinancialPeriods(rows).map(row => ({ ...row, name: new Date(`${row.month}-01T12:00:00Z`).toLocaleDateString('cs-CZ', { month: 'short', year: 'numeric', timeZone: 'UTC' }) }));
        if (!controller.signal.aborted) setChartData(data);
      } catch (loadError) {
        if (!controller.signal.aborted) setError(getFinanceErrorMessage(loadError, 'Graf nelze sestavit z úplných a platných finančních záznamů. Obnovte data.'));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };

    fetchChartData();
    return () => controller.abort();
  }, [allowed, reload]);

  if (!allowed || isPrivateMode) return <FinanceVisibilityNotice message={isPrivateMode ? 'Finanční graf je skrytý v soukromém režimu.' : 'Finanční graf je dostupný administrátorovi.'} />;

  return (
    <DataVizCard
      title="Zaznamenané výsledky po měsících"
      description="Součet periodických finančních záznamů realizací. Nejde o plánované smluvní výnosy."
      icon={BarChart3}
      contentClassName="h-[360px]"
    >
      {loading ? (
        <DataVizEmptyState label="Načítám data grafu..." className="h-full" />
      ) : error ? (
        <div className="space-y-4 p-4"><p role="alert" className="text-sm text-red-800">{error}</p><Button variant="outline" onClick={() => setReload(value => value + 1)}>Zkusit znovu</Button></div>
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
