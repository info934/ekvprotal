import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Bell, Calendar, CheckCircle, Clock } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/lib/customSupabaseClient';
import { format } from 'date-fns';
import { cs } from 'date-fns/locale';
import { formatCurrency } from '@/lib/utils';

export const PendingApprovalsWidget = () => {
    const [activeTab, setActiveTab] = useState('payouts');
    const [payouts, setPayouts] = useState([]);
    const [attendance, setAttendance] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchData = async () => {
            setLoading(true);
            
            // FIXED: Explicit FK reference for payouts
            const { data: payoutsData } = await supabase
                .from('payouts')
                .select('id, amount, request_date, members:members!payouts_member_id_fkey(name)')
                .eq('status', 'pending')
                .order('request_date', { ascending: true })
                .limit(5);
            
            // FIXED: Explicit FK reference for attendance_submissions
            const { data: attendanceData } = await supabase
                .from('attendance_submissions')
                .select('id, total_hours, month_date, member:members!attendance_submissions_member_id_fkey(name)')
                .eq('status', 'submitted')
                .order('submitted_at', { ascending: true })
                .limit(5);

            setPayouts(payoutsData || []);
            setAttendance(attendanceData || []);
            setLoading(false);
        };

        fetchData();
        
        // Realtime subscription
        const channel = supabase
            .channel('dashboard-pending-changes')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'payouts' }, fetchData)
            .on('postgres_changes', { event: '*', schema: 'public', table: 'attendance_submissions' }, fetchData)
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, []);

    const renderEmptyState = (message) => (
        <div className="flex flex-col items-center justify-center py-8 text-center text-muted-foreground">
            <CheckCircle className="w-8 h-8 mb-2 opacity-20" />
            <p className="text-sm">{message}</p>
        </div>
    );

    return (
        <Card className="crm-panel flex h-full flex-col">
            <CardHeader className="crm-panel-header">
                <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-2 text-base">
                        <Bell className="h-4 w-4 text-primary" />
                        Čekající žádosti
                    </CardTitle>
                    {(payouts.length > 0 || attendance.length > 0) && (
                        <Badge variant="destructive" className="ml-2">
                            {payouts.length + attendance.length}
                        </Badge>
                    )}
                </div>
                <CardDescription>Žádosti vyžadující vaši pozornost</CardDescription>
            </CardHeader>
            <CardContent className="flex-1 p-4">
                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full h-full flex flex-col">
                    <TabsList className="mb-4 grid w-full grid-cols-2 rounded-md">
                        <TabsTrigger value="payouts" className="relative">
                            Výplaty
                            {payouts.length > 0 && (
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="attendance" className="relative">
                            Docházka
                            {attendance.length > 0 && (
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
                            )}
                        </TabsTrigger>
                    </TabsList>

                    <TabsContent value="payouts" className="mt-0 flex-1">
                        {loading ? (
                            <div className="space-y-3">
                                {[1, 2].map(i => <div key={i} className="h-16 rounded-md bg-slate-100 animate-pulse" />)}
                            </div>
                        ) : payouts.length > 0 ? (
                            <div className="space-y-3">
                                {payouts.map(item => (
                                    <div key={item.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 transition-colors hover:border-primary/30 hover:bg-blue-50/30">
                                        <div className="space-y-1">
                                            <p className="text-sm font-semibold text-slate-950">{item.members?.name}</p>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Calendar className="w-3 h-3" />
                                                {format(new Date(item.request_date), 'd.M.yyyy')}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-semibold text-emerald-700">{formatCurrency(item.amount)}</p>
                                            <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                                                <Link to="/payouts">Detail</Link>
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                                    <Link to="/payouts">Zobrazit vše ({payouts.length})</Link>
                                </Button>
                            </div>
                        ) : renderEmptyState('Žádné žádosti o výplatu')}
                    </TabsContent>

                    <TabsContent value="attendance" className="mt-0 flex-1">
                         {loading ? (
                            <div className="space-y-3">
                                {[1, 2].map(i => <div key={i} className="h-16 rounded-md bg-slate-100 animate-pulse" />)}
                            </div>
                        ) : attendance.length > 0 ? (
                            <div className="space-y-3">
                                {attendance.map(item => (
                                    <div key={item.id} className="flex items-center justify-between rounded-md border border-slate-200 bg-white p-3 transition-colors hover:border-primary/30 hover:bg-blue-50/30">
                                        <div className="space-y-1">
                                            <p className="text-sm font-semibold text-slate-950">{item.member?.name}</p>
                                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                                <Clock className="w-3 h-3" />
                                                {format(new Date(item.month_date), 'LLLL yyyy', { locale: cs })}
                                            </div>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-sm font-semibold text-blue-700">{Number(item.total_hours).toFixed(1)} h</p>
                                            <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                                                <Link to="/attendance">Detail</Link>
                                            </Button>
                                        </div>
                                    </div>
                                ))}
                                <Button variant="outline" size="sm" className="w-full mt-2" asChild>
                                    <Link to="/attendance">Zobrazit vše ({attendance.length})</Link>
                                </Button>
                            </div>
                        ) : renderEmptyState('Žádné docházky ke schválení')}
                    </TabsContent>
                </Tabs>
            </CardContent>
        </Card>
    );
};
