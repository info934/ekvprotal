import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardHeader, CardContent, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Clock, User, Calendar, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { getFinancialVisibility } from '@/lib/getFinancialVisibility';
import FinancialValueGuard from './FinancialValueGuard';

const RealizaceHourlyCosts = ({ realizaceId, linkedProjectId, onLinkProject, distributionAmount }) => {
    const { hasPermission, userRole } = useAuth();
    const [records, setRecords] = useState([]);
    const [projects, setProjects] = useState([]); // For linking logic
    const [loading, setLoading] = useState(true);
    const [totalHours, setTotalHours] = useState(0);
    const [totalCost, setTotalCost] = useState(0);

    const { canViewAmounts } = getFinancialVisibility(userRole);

    // Strictly disable edit for 'user' role
    const canEdit = hasPermission('realizace', 'can_edit') && userRole !== 'user';

    // Fetch data
    useEffect(() => {
        const fetchAttendance = async () => {
            if (!realizaceId) return;
            setLoading(true);
            try {
                // 1. Fetch direct attendance on this Realization
                const { data: directData, error: directError } = await supabase
                    .from('attendance')
                    .select('*, members(name, hourly_rate)')
                    .eq('realizace_id', realizaceId)
                    .order('date', { ascending: false });

                if (directError) throw directError;

                // 2. Fetch linked project attendance if exists
                let projectData = [];
                if (linkedProjectId) {
                     const { data: pData, error: pError } = await supabase
                        .from('attendance')
                        .select('*, members(name, hourly_rate)')
                        .eq('project_id', linkedProjectId)
                        .order('date', { ascending: false });
                     if (!pError) projectData = pData || [];
                }

                // Combine and Deduplicate (though keys should differ)
                // Mark source
                const combined = [
                    ...(directData || []).map(r => ({ ...r, source: 'realization' })),
                    ...(projectData || []).map(r => ({ ...r, source: 'project' }))
                ];

                // Sort by date desc
                combined.sort((a, b) => new Date(b.date) - new Date(a.date));
                setRecords(combined);

                // Calc totals
                const tHours = combined.reduce((acc, r) => acc + Number(r.hours), 0);
                const tCost = combined.reduce((acc, r) => {
                    const rate = r.members?.hourly_rate ? Number(r.members.hourly_rate) : 0;
                    return acc + (Number(r.hours) * rate);
                }, 0);
                
                setTotalHours(tHours);
                setTotalCost(tCost);

            } catch (error) {
                console.error("Error fetching hourly costs:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchAttendance();
    }, [realizaceId, linkedProjectId]);

    // Fetch projects for linking
    useEffect(() => {
        const fetchProjects = async () => {
            const { data } = await supabase.from('projects').select('id, name, code').order('name');
            setProjects(data || []);
        };
        fetchProjects();
    }, []);

    const handleProjectLink = async (projectId) => {
        if (!canEdit) return; // Guard logic

        const newVal = projectId === 'none' ? null : projectId;
        const { error } = await supabase
            .from('realizations')
            .update({ linked_project_id: newVal })
            .eq('id', realizaceId);
        
        if (!error && onLinkProject) {
            onLinkProject(newVal);
        }
    };

    // Worker Summary
    const workerSummary = useMemo(() => {
        const summary = {};
        records.forEach(r => {
            const name = r.members?.name || 'Neznámý';
            if (!summary[name]) summary[name] = { hours: 0, cost: 0, count: 0 };
            const h = Number(r.hours);
            const rate = r.members?.hourly_rate ? Number(r.members.hourly_rate) : 0;
            summary[name].hours += h;
            summary[name].cost += h * rate;
            summary[name].count += 1;
        });
        return Object.entries(summary).sort((a,b) => b[1].hours - a[1].hours);
    }, [records]);

    return (
        <div className="space-y-6">
            {distributionAmount !== undefined && canViewAmounts && (
                 <div className="bg-blue-50 border border-blue-100 p-3 rounded-md flex items-center gap-2 mb-4">
                     <span className="text-sm font-medium text-blue-700">Týmový rozpočet (pro mzdy a náklady):</span>
                     <span className="text-lg font-bold text-blue-800"><FinancialValueGuard value={formatCurrency(distributionAmount)} /></span>
                 </div>
            )}
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium text-muted-foreground">Celkem hodin</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold flex items-center gap-2">
                            <Clock className="w-5 h-5 text-blue-500" />
                            {totalHours.toFixed(1)} h
                        </div>
                    </CardContent>
                </Card>
                {canViewAmounts && (
                    <Card>
                        <CardHeader className="pb-2">
                            <CardTitle className="text-sm font-medium text-muted-foreground">Celkové mzdové náklady</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-2xl font-bold text-green-600">
                                <FinancialValueGuard value={formatCurrency(totalCost)} />
                            </div>
                            <p className="text-xs text-muted-foreground mt-1">Vypočítáno dle hodinových sazeb pracovníků</p>
                        </CardContent>
                    </Card>
                )}
            </div>

            {/* Worker Summary */}
            <Card>
                <CardHeader>
                    <CardTitle>Přehled dle pracovníků</CardTitle>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Pracovník</TableHead>
                                <TableHead className="text-right">Odpracováno</TableHead>
                                {canViewAmounts && <TableHead className="text-right">Náklady</TableHead>}
                                <TableHead className="text-right">Počet záznamů</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {workerSummary.length === 0 ? (
                                <TableRow><TableCell colSpan={canViewAmounts ? 4 : 3} className="text-center text-muted-foreground">Žádná data</TableCell></TableRow>
                            ) : (
                                workerSummary.map(([name, stats]) => (
                                    <TableRow key={name}>
                                        <TableCell className="font-medium">{name}</TableCell>
                                        <TableCell className="text-right">{stats.hours.toFixed(1)} h</TableCell>
                                        {canViewAmounts && (
                                            <TableCell className="text-right">
                                                <FinancialValueGuard value={formatCurrency(stats.cost)} />
                                            </TableCell>
                                        )}
                                        <TableCell className="text-right text-muted-foreground">{stats.count}</TableCell>
                                    </TableRow>
                                ))
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <Card>
                <CardHeader className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <CardTitle>Detailní záznamy docházky</CardTitle>
                        <CardDescription>Kompletní historie odpracovaných hodin na této realizaci</CardDescription>
                    </div>
                    
                    {canEdit && (
                        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 bg-slate-50 p-2 rounded border w-full sm:w-auto">
                            <span className="text-sm font-medium whitespace-nowrap">Propojený projekt:</span>
                            <Select 
                                value={linkedProjectId || 'none'} 
                                onValueChange={handleProjectLink}
                            >
                                <SelectTrigger className="w-full sm:w-[250px] h-8 text-sm bg-white">
                                    <SelectValue placeholder="Vybrat projekt..." />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="none">-- Žádný --</SelectItem>
                                    {projects.map(p => (
                                        <SelectItem key={p.id} value={p.id}>{p.code} - {p.name}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    )}
                </CardHeader>
                <CardContent>
                    {!linkedProjectId && canEdit && (
                        <Alert className="mb-4 bg-blue-50 border-blue-200">
                            <AlertCircle className="h-4 w-4 text-blue-600" />
                            <AlertTitle>Informace</AlertTitle>
                            <AlertDescription>
                                Pokud tato realizace navazuje na projekt, propojte ho výše pro zobrazení hodin odpracovaných ve fázi projektu.
                            </AlertDescription>
                        </Alert>
                    )}

                    <div className="rounded-md border">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Datum</TableHead>
                                    <TableHead>Pracovník</TableHead>
                                    <TableHead>Popis</TableHead>
                                    <TableHead>Zdroj</TableHead>
                                    <TableHead className="text-right">Hodiny</TableHead>
                                    {canViewAmounts && <TableHead className="text-right">Náklad</TableHead>}
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {loading ? (
                                    <TableRow><TableCell colSpan={canViewAmounts ? 6 : 5} className="text-center py-8">Načítání...</TableCell></TableRow>
                                ) : records.length === 0 ? (
                                    <TableRow><TableCell colSpan={canViewAmounts ? 6 : 5} className="text-center py-8 text-muted-foreground">Žádné záznamy docházky.</TableCell></TableRow>
                                ) : (
                                    records.map((record) => (
                                        <TableRow key={record.id}>
                                            <TableCell className="font-medium flex items-center gap-2">
                                                <Calendar className="w-3 h-3 text-muted-foreground" />
                                                {format(new Date(record.date), 'd. M. yyyy')}
                                            </TableCell>
                                            <TableCell>
                                                <div className="flex items-center gap-2">
                                                    <User className="w-3 h-3 text-muted-foreground" />
                                                    {record.members?.name}
                                                </div>
                                            </TableCell>
                                            <TableCell className="max-w-[200px] lg:max-w-[300px] truncate" title={record.description}>
                                                {record.description || '-'}
                                            </TableCell>
                                            <TableCell>
                                                {record.source === 'project' ? (
                                                    <Badge variant="outline" className="text-xs">Z projektu</Badge>
                                                ) : (
                                                    <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 text-xs shadow-none">Přímo</Badge>
                                                )}
                                            </TableCell>
                                            <TableCell className="text-right font-bold">
                                                {Number(record.hours).toFixed(1)}
                                            </TableCell>
                                            {canViewAmounts && (
                                                <TableCell className="text-right text-muted-foreground">
                                                    <FinancialValueGuard value={formatCurrency(Number(record.hours) * (record.members?.hourly_rate || 0))} />
                                                </TableCell>
                                            )}
                                        </TableRow>
                                    ))
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default RealizaceHourlyCosts;