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
import { useToast } from '@/components/ui/use-toast';

const RealizaceHourlyCosts = ({ realizaceId, linkedProjectId, onLinkProject }) => {
    const { hasPermission, userRole } = useAuth();
    const { toast } = useToast();
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
                // Attendance has both member_id and sponsor_member_id_snapshot
                // foreign keys to members. Select the worker relationship
                // explicitly so PostgREST does not reject the embed as ambiguous.
                const memberSelect = 'members:members!attendance_member_id_fkey(name)';
                const attendanceQuery = supabase
                    .from('attendance')
                    .select(`*, ${memberSelect}`)
                    .eq('realizace_id', realizaceId)
                    .order('date', { ascending: false });
                const ledgerQuery = canViewAmounts
                    ? supabase
                        .from('labor_cost_ledger')
                        .select('attendance_id, employer_cost, status')
                        .eq('realization_id', realizaceId)
                    : Promise.resolve({ data: [], error: null });
                const [
                    { data: directData, error: directError },
                    { data: ledgerData, error: ledgerError },
                ] = await Promise.all([attendanceQuery, ledgerQuery]);

                if (directError) throw directError;
                if (ledgerError) throw ledgerError;

                const reversedAttendanceIds = new Set((ledgerData || [])
                    .filter((row) => row.status === 'reversed')
                    .map((row) => String(row.attendance_id)));
                const ledgerCostByAttendance = (ledgerData || []).filter((row) => row.status !== 'reversed').reduce((costs, row) => {
                    const attendanceId = String(row.attendance_id);
                    costs.set(attendanceId, (costs.get(attendanceId) || 0) + Number(row.employer_cost || 0));
                    return costs;
                }, new Map());

                // A linked project is contextual only. Its attendance belongs to
                // the project ledger and must not be charged to the realization.
                // Historical costs always use immutable approval snapshots.
                const combined = (directData || []).map(row => ({
                    ...row,
                    source: 'realization',
                    _employer_cost: ledgerCostByAttendance.get(String(row.id))
                        ?? (reversedAttendanceIds.has(String(row.id)) ? 0 : Number(row.employer_cost_snapshot || 0)),
                }));

                // Sort by date desc
                combined.sort((a, b) => new Date(b.date) - new Date(a.date));
                setRecords(combined);

                // Calc totals
                const tHours = combined.reduce((acc, r) => acc + Number(r.hours), 0);
                const tCost = canViewAmounts
                    ? combined.reduce((acc, r) => {
                        return acc + Number(r._employer_cost || 0);
                    }, 0)
                    : 0;
                
                setTotalHours(tHours);
                setTotalCost(tCost);

            } catch (error) {
                console.error("Error fetching hourly costs:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchAttendance();
    }, [realizaceId, canViewAmounts]);

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
        
        if (error) {
            toast({ title: 'Projekt se nepodařilo propojit', description: error.message, variant: 'destructive' });
            return;
        }
        if (onLinkProject) {
            onLinkProject(newVal, projects.find((project) => project.id === newVal) || null);
        }
    };

    // Worker Summary
    const workerSummary = useMemo(() => {
        const summary = {};
        records.forEach(r => {
            const name = r.members?.name || 'Neznámý';
            if (!summary[name]) summary[name] = { hours: 0, cost: 0, count: 0 };
            const h = Number(r.hours);
            summary[name].hours += h;
            summary[name].cost += canViewAmounts ? Number(r._employer_cost || 0) : 0;
            summary[name].count += 1;
        });
        return Object.entries(summary).sort((a,b) => b[1].hours - a[1].hours);
    }, [records, canViewAmounts]);

    return (
        <div className="space-y-6">

            
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
                                Propojený projekt slouží jako kontext. Jeho docházka zůstává v nákladech projektu a do realizace se znovu nepřičítá.
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
                                                <Badge className="bg-blue-100 text-blue-700 hover:bg-blue-200 border-blue-200 text-xs shadow-none">Přímo</Badge>
                                            </TableCell>
                                            <TableCell className="text-right font-bold">
                                                {Number(record.hours).toFixed(1)}
                                            </TableCell>
                                            {canViewAmounts && (
                                                <TableCell className="text-right text-muted-foreground">
                                                    <FinancialValueGuard value={formatCurrency(record._employer_cost)} />
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
