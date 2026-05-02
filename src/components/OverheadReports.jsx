import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { BarChart, FileDown, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ResponsiveContainer, BarChart as RechartsBarChart, Bar, XAxis, YAxis, Tooltip, Legend } from 'recharts';
import * as XLSX from 'xlsx';
import PageHeader from '@/components/ui/page-header';

const OverheadReports = () => {
  const { toast } = useToast();
  const [allocations, setAllocations] = useState([]);
  const [projects, setProjects] = useState([]);
  const [costs, setCosts] = useState([]);
  const [loading, setLoading] = useState(true);

  const [filters, setFilters] = useState({
    period: 'all',
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
    const approvedMonthIds = approvedMonths.map(m => m.id);

    const [allocationsRes, projectsRes, costsRes] = await Promise.all([
      supabase.from('overhead_allocation_items').select('*').in('overhead_monthly_allocation_id', approvedMonthIds),
      supabase.from('projects').select('id, name, code'),
      supabase.from('overhead_costs').select('id, category, type'),
    ]);
    
    if (allocationsRes.error || projectsRes.error || costsRes.error) {
      toast({ title: 'Chyba načítání dat pro report', variant: 'destructive' });
    } else {
      setAllocations(allocationsRes.data);
      setProjects(projectsRes.data);
      setCosts(costsRes.data);
    }
    setLoading(false);
  };
  
  useEffect(() => {
    fetchReportData();
  }, []);

  const reportData = useMemo(() => {
    const dataWithDetails = allocations.map(alloc => {
      const project = projects.find(p => p.id === alloc.project_id);
      const cost = costs.find(c => c.id === alloc.overhead_cost_id);
      return {
        ...alloc,
        project_name: project?.name,
        project_code: project?.code,
        category: cost?.category,
        cost_type: cost?.type,
        // This is a simplification; for real period filtering, we'd need monthly_allocation details
        // period: '2025-11' 
      };
    });
    
    // Placeholder for period filtering
    const filteredData = dataWithDetails.filter(d => 
        (filters.project === 'all' || d.project_id === filters.project) &&
        (filters.category === 'all' || d.category === filters.category)
    );

    // Costs by Project
    const byProject = filteredData.reduce((acc, item) => {
        if (!acc[item.project_id]) {
            acc[item.project_id] = { 
                id: item.project_id, 
                name: item.project_name, 
                code: item.project_code, 
                total: 0,
                regular: 0,
                variable: 0,
            };
        }
        const amount = parseFloat(item.amount_allocated) || 0;
        acc[item.project_id].total += amount;
        if (item.cost_type === 'PRAVIDELNY') {
            acc[item.project_id].regular += amount;
        } else {
            acc[item.project_id].variable += amount;
        }
        return acc;
    }, {});

    // Costs by Category
    const byCategory = filteredData.reduce((acc, item) => {
        const category = item.category || 'Nekategorizováno';
        if (!acc[category]) {
            acc[category] = { name: category, total: 0 };
        }
        acc[category].total += parseFloat(item.amount_allocated) || 0;
        return acc;
    }, {});
    
    return {
      byProject: Object.values(byProject).sort((a,b) => b.total - a.total),
      byCategory: Object.values(byCategory).sort((a,b) => b.total - a.total),
    };
  }, [allocations, projects, costs, filters]);
  
  const uniqueCategories = useMemo(() => ['all', ...new Set(costs.map(c => c.category).filter(Boolean))], [costs]);
  
  const handleExport = () => {
    const ws = XLSX.utils.json_to_sheet(reportData.byProject.map(p => ({
        'Kód projektu': p.code,
        'Název projektu': p.name,
        'Režie celkem (Kč)': p.total,
        'Pravidelné náklady (Kč)': p.regular,
        'Proměnlivé náklady (Kč)': p.variable,
    })));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Režie dle projektů");
    XLSX.writeFile(wb, "report_rezie_projekty.xlsx");
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={BarChart}
        title="Reporty režijních nákladů"
        description="Přehled rozdělení režie podle projektů a kategorií."
      />
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="hidden">
        <h1 className="text-3xl font-bold text-slate-800 flex items-center gap-3">
          <BarChart className="w-8 h-8 text-primary" /> Reporty režijních nákladů
        </h1>
      </motion.div>

      <Card>
        <CardContent className="p-4">
          <div className="flex flex-col md:flex-row gap-4 justify-between">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <Select value={filters.project} onValueChange={v => setFilters(f => ({ ...f, project: v }))}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všechny projekty</SelectItem>
                  {projects.map(p => <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={filters.category} onValueChange={v => setFilters(f => ({ ...f, category: v }))}>
                <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {uniqueCategories.map(c => <SelectItem key={c} value={c}>{c === 'all' ? 'Všechny kategorie' : c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={handleExport}><FileDown className="mr-2 h-4 w-4" /> Exportovat</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Náklady dle projektů</CardTitle></CardHeader>
          <CardContent>
            {loading ? <p>Načítání...</p> : (
              <Table>
                <TableHeader><TableRow><TableHead>Projekt</TableHead><TableHead>Pravidelné</TableHead><TableHead>Proměnlivé</TableHead><TableHead className="text-right">Celkem</TableHead></TableRow></TableHeader>
                <TableBody>
                  {reportData.byProject.map(item => (
                    <TableRow key={item.id}>
                      <TableCell className="font-semibold">{item.code} - {item.name}</TableCell>
                      <TableCell>{item.regular.toLocaleString('cs-CZ')} Kč</TableCell>
                      <TableCell>{item.variable.toLocaleString('cs-CZ')} Kč</TableCell>
                      <TableCell className="text-right font-bold">{item.total.toLocaleString('cs-CZ')} Kč</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Náklady dle kategorií</CardTitle></CardHeader>
          <CardContent className="h-96">
            {loading ? <p>Načítání...</p> : (
              <ResponsiveContainer width="100%" height="100%">
                <RechartsBarChart data={reportData.byCategory} margin={{ top: 5, right: 20, left: 20, bottom: 5 }}>
                  <XAxis dataKey="name" />
                  <YAxis />
                  <Tooltip formatter={(value) => `${Number(value).toLocaleString('cs-CZ')} Kč`} />
                  <Legend />
                  <Bar dataKey="total" fill="#2563eb" name="Celkové náklady" />
                </RechartsBarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default OverheadReports;
