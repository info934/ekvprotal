import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { BarChart3, FileDown, Filter, Layers3, RefreshCw, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Bar, BarChart as RechartsBarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { loadXlsx } from '@/lib/xlsx';
import PageHeader from '@/components/ui/page-header';
import { DataVizCard, DATAVIZ_COLORS, DataVizEmptyState, formatVizCurrency, VizTooltip } from '@/components/ui/data-viz';
import { FinanceAmount, FinanceMetricStrip } from '@/components/finance/FinanceWorkspace';

const OverheadReports = () => {
  const { toast } = useToast();
  const [allocations, setAllocations] = useState([]);
  const [projects, setProjects] = useState([]);
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({
    project: 'all',
    category: 'all',
  });

  const fetchReportData = async () => {
    setLoading(true);
    const { data: approvedMonths, error: monthsError } = await supabase
      .from('overhead_monthly_allocations')
      .select('id')
      .eq('status', 'APPROVED');

    if (monthsError) {
      toast({ title: 'Chyba načítání schválených měsíců', variant: 'destructive' });
      setLoading(false);
      return;
    }

    const approvedMonthIds = (approvedMonths || []).map((month) => month.id);
    if (approvedMonthIds.length === 0) {
      setAllocations([]);
      setProjects([]);
      setCosts([]);
      setLoading(false);
      return;
    }

    const [allocationsRes, projectsRes, costsRes] = await Promise.all([
      supabase.from('overhead_allocation_items').select('*').in('overhead_monthly_allocation_id', approvedMonthIds),
      supabase.from('projects').select('id, name, code'),
      supabase.from('overhead_costs').select('id, category, type'),
    ]);

    if (allocationsRes.error || projectsRes.error || costsRes.error) {
      toast({ title: 'Chyba načítání dat pro report', variant: 'destructive' });
    } else {
      setAllocations(allocationsRes.data || []);
      setProjects(projectsRes.data || []);
      setCosts(costsRes.data || []);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchReportData();
  }, []);

  const reportData = useMemo(() => {
    const dataWithDetails = allocations.map((allocation) => {
      const project = projects.find((item) => item.id === allocation.project_id);
      const cost = costs.find((item) => item.id === allocation.overhead_cost_id);
      return {
        ...allocation,
        project_name: project?.name,
        project_code: project?.code,
        category: cost?.category,
        cost_type: cost?.type,
      };
    });

    const filteredData = dataWithDetails.filter(
      (item) =>
        (filters.project === 'all' || item.project_id === filters.project) &&
        (filters.category === 'all' || item.category === filters.category)
    );

    const byProject = filteredData.reduce((acc, item) => {
      if (!acc[item.project_id]) {
        acc[item.project_id] = {
          id: item.project_id,
          name: item.project_name || 'Bez názvu',
          code: item.project_code || '-',
          total: 0,
          regular: 0,
          variable: 0,
        };
      }

      const amount = Number(item.amount_allocated) || 0;
      acc[item.project_id].total += amount;
      if (item.cost_type === 'PRAVIDELNY') {
        acc[item.project_id].regular += amount;
      } else {
        acc[item.project_id].variable += amount;
      }
      return acc;
    }, {});

    const byCategory = filteredData.reduce((acc, item) => {
      const category = item.category || 'Nekategorizováno';
      if (!acc[category]) {
        acc[category] = { name: category, total: 0 };
      }
      acc[category].total += Number(item.amount_allocated) || 0;
      return acc;
    }, {});

    return {
      byProject: Object.values(byProject).sort((a, b) => b.total - a.total),
      byCategory: Object.values(byCategory).sort((a, b) => b.total - a.total),
    };
  }, [allocations, projects, costs, filters]);

  const uniqueCategories = useMemo(() => ['all', ...new Set(costs.map((cost) => cost.category).filter(Boolean))], [costs]);
  const reportTotals = useMemo(() => reportData.byProject.reduce((sum, item) => ({
    total: sum.total + item.total,
    regular: sum.regular + item.regular,
    variable: sum.variable + item.variable,
  }), { total: 0, regular: 0, variable: 0 }), [reportData.byProject]);

  const handleExport = async () => {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(
      reportData.byProject.map((project) => ({
        'Kód projektu': project.code,
        'Název projektu': project.name,
        'Režie celkem (Kč)': project.total,
        'Pravidelné náklady (Kč)': project.regular,
        'Proměnlivé náklady (Kč)': project.variable,
      }))
    );
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Režie dle projektů');
    XLSX.writeFile(wb, 'report_rezie_projekty.xlsx');
  };

  return (
    <div className="space-y-6">
      <PageHeader icon={BarChart3} title="Reporty režie" description="Přehled rozdělení režijních nákladů podle projektů a kategorií." />

      <FinanceMetricStrip metrics={[
        { label: 'Přidělená režie celkem', value: <FinanceAmount value={reportTotals.total} />, detail: 'Pouze schválená období', tone: 'neutral', icon: Wallet },
        { label: 'Pravidelné náklady', value: <FinanceAmount value={reportTotals.regular} />, detail: 'Opakované firemní náklady', tone: 'plan', icon: RefreshCw },
        { label: 'Proměnlivé náklady', value: <FinanceAmount value={reportTotals.variable} />, detail: 'Jednorázové a variabilní položky', tone: 'warning', icon: BarChart3 },
        { label: 'Projektů v reportu', value: reportData.byProject.length, detail: `${reportData.byCategory.length} kategorií`, tone: 'neutral', icon: Layers3 },
      ]} className="xl:grid-cols-4 2xl:grid-cols-4" />

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
                <Filter className="h-4 w-4" /> Filtry reportu
              </div>
              <Select value={filters.project} onValueChange={(value) => setFilters((current) => ({ ...current, project: value }))}>
                <SelectTrigger className="w-full sm:w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všechny projekty</SelectItem>
                  {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.code} - {project.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.category} onValueChange={(value) => setFilters((current) => ({ ...current, category: value }))}>
                <SelectTrigger className="w-full sm:w-56"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {uniqueCategories.map((category) => <SelectItem key={category} value={category}>{category === 'all' ? 'Všechny kategorie' : category}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleExport} variant="outline"><FileDown className="mr-2 h-4 w-4" /> Exportovat</Button>
          </div>
        </CardContent>
      </Card>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-1 gap-6 xl:grid-cols-5">
        <DataVizCard title="Náklady podle projektu" description="Seřazeno podle celkové přiřazené režie." icon={BarChart3} className="xl:col-span-3">
          {loading ? (
            <DataVizEmptyState label="Načítám report..." />
          ) : reportData.byProject.length === 0 ? (
            <DataVizEmptyState label="Žádné schválené režie k zobrazení." />
          ) : (
            <div className="overflow-x-auto">
              <Table className="finance-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Projekt</TableHead>
                    <TableHead className="text-right">Pravidelné</TableHead>
                    <TableHead className="text-right">Proměnlivé</TableHead>
                    <TableHead className="text-right">Celkem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {reportData.byProject.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="min-w-64 font-semibold text-slate-900">{item.code} - {item.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatVizCurrency(item.regular)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatVizCurrency(item.variable)}</TableCell>
                      <TableCell className="text-right font-bold tabular-nums">{formatVizCurrency(item.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DataVizCard>

        <DataVizCard title="Náklady podle kategorii" description="Rychlé porovnání největších zdrojů režie." icon={BarChart3} className="xl:col-span-2" contentClassName="h-[420px]">
          {loading ? (
            <DataVizEmptyState label="Načítám graf..." className="h-full" />
          ) : reportData.byCategory.length === 0 ? (
            <DataVizEmptyState label="Žádné kategorie k zobrazení." className="h-full" />
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <RechartsBarChart data={reportData.byCategory} layout="vertical" margin={{ top: 8, right: 8, left: 12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e2e8f0" />
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={118} tickLine={false} axisLine={false} fontSize={12} stroke="#64748b" />
                <Tooltip content={<VizTooltip valueFormatter={formatVizCurrency} />} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="total" name="Celkem" fill={DATAVIZ_COLORS.primary} radius={[0, 6, 6, 0]} barSize={18} />
              </RechartsBarChart>
            </ResponsiveContainer>
          )}
        </DataVizCard>
      </motion.div>
    </div>
  );
};

export default OverheadReports;
