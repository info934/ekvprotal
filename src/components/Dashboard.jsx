import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  DollarSign, TrendingUp, AlertCircle, CheckCircle, GanttChartSquare,
  PiggyBank, BarChart, Wallet, Wrench, Clock, Banknote,
  PieChart, ClipboardList, Briefcase, Home, Package, FilePieChart,
  MinusCircle, ArrowRight, Activity, CalendarClock, ShieldAlert
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import PageHeader from '@/components/ui/page-header';
import { supabase } from '@/lib/customSupabaseClient';
import ProjectGanttChart from '@/components/ProjectGanttChart';
import RealizationGanttChart from '@/components/RealizationGanttChart';
import PortalStatusChart from '@/components/PortalStatusChart';
import ProjectStatusChart from '@/components/ProjectStatusChart';
import { PendingApprovalsWidget } from '@/components/DashboardWidgets';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { cn, formatCurrency } from '@/lib/utils';

// Helper component for uniform stat cards
const StatCard = ({ title, value, icon: Icon, colorClass, subtext, trend }) => (
  <Card>
    <CardContent className="p-6 flex items-center justify-between space-x-4">
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-muted-foreground tracking-tight">{title}</span>
        <span className={cn("text-2xl font-bold tracking-tight", colorClass)}>
          {value}
        </span>
        {subtext && <span className="text-xs text-muted-foreground">{subtext}</span>}
      </div>
      <div className={cn("p-3 rounded-full bg-current/10", colorClass)}>
        <Icon className={cn("w-6 h-6", colorClass)} />
      </div>
    </CardContent>
  </Card>
);

const EngineeringActivityCard = ({ activity }) => {
  const statusConfig = {
    new: { icon: AlertCircle, variant: 'secondary', label: 'Nová', bg: 'bg-blue-50 text-blue-700' },
    in_progress: { icon: Clock, variant: 'default', label: 'V řešení', bg: 'bg-orange-50 text-orange-700' },
    done: { icon: CheckCircle, variant: 'outline', label: 'Hotovo', bg: 'bg-green-50 text-green-700' },
  };

  const config = statusConfig[activity.status] || statusConfig.new;

  return (
    <div className="flex items-center justify-between p-4 border rounded-lg hover:bg-slate-50 transition-colors group">
      <div className="flex items-start gap-4">
        <div className={cn("p-2 rounded-full shrink-0 mt-1", config.bg)}>
          <config.icon className="w-4 h-4" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium leading-none text-slate-900 group-hover:text-primary transition-colors">
            {activity.subject}
          </p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{activity.projects?.name}</span>
            <span>•</span>
            <Badge variant="outline" className={cn("text-[10px] px-1.5 h-5 font-normal border-0", config.bg)}>
              {config.label}
            </Badge>
          </div>
        </div>
      </div>
      <Button asChild variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity h-8 w-8 p-0">
        <Link to={`/projects/${activity.project_id}`}>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </Button>
    </div>
  );
}

const UserFinancials = ({ memberId }) => {
  const { toast } = useToast();
  const { isPrivateMode } = useAuth();
  const [stats, setStats] = useState({ totalReward: 0, toPayOut: 0, available: 0, paid: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (!memberId) {
      setLoading(false);
      return;
    }

    const fetchUserFinancials = async () => {
      try {
        if (mounted) setLoading(true);
        const { data, error } = await supabase.rpc('get_user_financials', { p_member_id: memberId });

        if (error) throw error;

        if (mounted && data && data.length > 0) {
          const result = data[0];
          setStats({
            totalReward: Math.round(result.total_reward || 0),
            toPayOut: Math.round((result.total_reward || 0) - (result.total_paid || 0)),
            available: Math.round(result.available_to_payout || 0),
            paid: Math.round(result.total_paid || 0)
          });
        }
      } catch (error) {
        console.error('Error fetching user financials:', error);
        if (mounted) {
          toast({ title: 'Chyba', description: 'Nepodařilo se načíst finance.', variant: 'destructive' });
        }
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchUserFinancials();
    return () => { mounted = false; };
  }, [memberId]);

  // Completely hide in Private Mode
  if (isPrivateMode) return null;

  if (loading) return <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-pulse"><div className="h-32 bg-slate-100 rounded-xl" /><div className="h-32 bg-slate-100 rounded-xl" /><div className="h-32 bg-slate-100 rounded-xl" /></div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <StatCard
        title="Dostupné k vyplacení"
        value={formatCurrency(stats.available)}
        icon={Banknote}
        colorClass="text-green-600"
      />
      <StatCard
        title="Zbývá k vyplacení"
        value={formatCurrency(stats.toPayOut)}
        icon={DollarSign}
        colorClass="text-blue-600"
      />
      <StatCard
        title="Celkem vyplaceno"
        value={formatCurrency(stats.paid)}
        icon={DollarSign}
        colorClass="text-slate-600"
      />
    </div>
  );
};

const AdminFinancials = () => {
  const { toast } = useToast();
  const { isPrivateMode } = useAuth();
  const [profits, setProfits] = useState({ realized: 0, potential: 0, totalOverhead: 0, totalProjectValue: 0, unallocatedBudget: 0 });
  const [overheadSummary, setOverheadSummary] = useState({ allocated: 0, accounted: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    const fetchAdminData = async () => {
      try {
        if (mounted) setLoading(true);
        const [financialsRes, overheadRes] = await Promise.all([
          supabase.rpc('get_company_financials'),
          supabase.rpc('get_overhead_summary')
        ]);

        if (financialsRes.error) throw financialsRes.error;
        if (overheadRes.error) throw overheadRes.error;

        if (mounted && financialsRes.data && financialsRes.data.length > 0) {
          const result = financialsRes.data[0];
          setProfits({
            realized: Math.round(result.realized_profit || 0),
            potential: Math.round(result.potential_profit || 0),
            totalOverhead: Math.round(result.total_overhead || 0),
            totalProjectValue: Math.round(result.total_project_value || 0),
            unallocatedBudget: Math.round(result.unallocated_budget || 0),
          });
        }

        if (mounted && overheadRes.data && overheadRes.data.length > 0) {
          const result = overheadRes.data[0];
          setOverheadSummary({
            allocated: Math.round(result.total_allocated_overhead || 0),
            accounted: Math.round(result.total_accounted_overhead || 0)
          });
        }
      } catch (error) {
        console.error('Error fetching company financials:', error);
        if (mounted) toast({ title: 'Chyba', description: 'Chyba načítání dat firmy.', variant: 'destructive' });
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchAdminData();
    return () => { mounted = false; };
  }, []);

  // Completely hide in Private Mode
  if (isPrivateMode) return null;

  if (loading) return <div className="h-64 bg-slate-100 rounded-xl animate-pulse"></div>;

  const overheadDifference = overheadSummary.allocated - overheadSummary.accounted;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Realizovaný zisk"
          value={formatCurrency(profits.realized)}
          icon={DollarSign}
          colorClass="text-green-600"
        />
        <StatCard
          title="Potenciální zisk"
          value={formatCurrency(profits.potential)}
          icon={DollarSign}
          colorClass="text-blue-600"
        />
        <StatCard
          title="Celková hodnota"
          value={formatCurrency(profits.totalProjectValue)}
          icon={DollarSign}
          colorClass="text-cyan-600"
        />
        <StatCard
          title="Nerozdělený budget"
          value={formatCurrency(profits.unallocatedBudget)}
          icon={DollarSign}
          colorClass="text-rose-600"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg font-semibold flex items-center gap-2">
                <FilePieChart className="w-5 h-5 text-slate-500" />
                Režie a náklady
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-blue-50 rounded-full text-blue-600">
                    <CheckCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Alokované režie</p>
                    <p className="text-xl font-bold text-slate-900">{formatCurrency(overheadSummary.allocated)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="p-3 bg-green-50 rounded-full text-green-600">
                    <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Zaúčtované režie</p>
                    <p className="text-xl font-bold text-slate-900">{formatCurrency(overheadSummary.accounted)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className={cn("p-3 rounded-full", overheadDifference >= 0 ? "bg-slate-100 text-slate-600" : "bg-red-50 text-red-600")}>
                    <MinusCircle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Rozdíl (Bilance)</p>
                    <p className={cn("text-xl font-bold", overheadDifference < 0 && "text-red-600")}>
                      {formatCurrency(overheadDifference)}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
        <div className="lg:col-span-1">
          <PendingApprovalsWidget />
        </div>
      </div>
    </div>
  );
}

const Dashboard = () => {
  const { isSuperUser, memberId, isPrivateMode } = useAuth();
  const { toast } = useToast();
  const [userProjects, setUserProjects] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [realizations, setRealizations] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [pendingActivitiesList, setPendingActivitiesList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState('month');

  useEffect(() => {
    let mounted = true;
    const fetchData = async () => {
      try {
        if (mounted) setLoading(true);

        // Fetch data based on role
        if (memberId) {
          const [userProjectsRes, tasksRes, activitiesRes] = await Promise.all([
            supabase.rpc('get_user_projects', { p_member_id: memberId }),
            supabase.from('project_tasks').select('id, name, status, start_date, end_date').eq('member_id', memberId),
            supabase.rpc('get_user_activities', { p_member_id: memberId })
          ]);

          if (userProjectsRes.error) throw userProjectsRes.error;
          if (mounted) setUserProjects(userProjectsRes.data || []);

          if (tasksRes.error) throw tasksRes.error;
          if (mounted) setTasks(tasksRes.data || []);

          if (activitiesRes.error) throw activitiesRes.error;
          if (mounted) setPendingActivitiesList(activitiesRes.data || []);

          // Fetch user realizations (filter by team member)
          const { data: realData, error: realError } = await supabase
            .from('realizations')
            .select('id, name, status, start_date, planned_end_date, actual_end_date, created_at, team_members')
            .contains('team_members', [memberId])
            .order('created_at', { ascending: false });

          if (realError && realError.code !== 'PGRST116') console.error(realError);
          if (mounted) setRealizations(realData || []);
        }

        if (isSuperUser) {
          const { data: allProjectsData, error: allProjectsError } = await supabase
            .from('projects')
            .select('id, name, code, status, start_date, completion_date, created_at')
            .order('code');

          if (allProjectsError) throw allProjectsError;
          if (mounted) setAllProjects(allProjectsData || []);

          // Fetch all realizations for admin
          const { data: allRealizations, error: allRealError } = await supabase
            .from('realizations')
            .select('id, name, status, start_date, planned_end_date, actual_end_date, created_at')
            .order('created_at', { ascending: false });

          if (allRealError) throw allRealError;
          if (mounted) setRealizations(allRealizations || []);

          if ((!memberId || (mounted && pendingActivitiesList.length === 0))) {
            const { data: activitiesData, error: activitiesError } = await supabase
              .from('engineering_activities')
              .select('id, subject, status, project_id, projects(name)')
              .neq('status', 'done')
              .order('end_date', { ascending: true })
              .limit(5);
            if (activitiesError) throw activitiesError;
            if (mounted) setPendingActivitiesList(activitiesData || []);
          }
        }
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
        if (mounted) toast({ title: 'Chyba', description: 'Nepodařilo se načíst data.', variant: 'destructive' });
      } finally {
        if (mounted) setLoading(false);
      }
    };

    fetchData();
    return () => { mounted = false; };
  }, [isSuperUser, memberId]);

  if (loading) {
    return (
      <div className="app-page-wide">
        <div className="h-12 w-48 bg-slate-100 rounded-lg animate-pulse mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />
          <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />
          <div className="h-32 bg-slate-100 rounded-xl animate-pulse" />
        </div>
        <div className="h-96 bg-slate-100 rounded-xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="app-page-wide animate-in fade-in duration-500">
      <PageHeader
        icon={Home}
        title="Přehled"
        description="Vítejte zpět, zde je souhrn aktuálního dění v systému."
        actions={
          <Badge variant="outline" className="px-3 py-1 text-sm font-normal">
            {new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Badge>
        }
      />
      <div className="hidden">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
            <Home className="w-8 h-8 text-slate-800" />
            Přehled
          </h1>
          <p className="text-muted-foreground mt-1">
            Vítejte zpět, zde je souhrn aktuálního dění v systému.
          </p>
        </div>
        <div className="hidden sm:block text-right">
          <Badge variant="outline" className="px-3 py-1 text-sm font-normal">
            {new Date().toLocaleDateString('cs-CZ', { weekday: 'long', day: 'numeric', month: 'long' })}
          </Badge>
        </div>
      </div>

      {isPrivateMode && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 px-4 py-3 rounded-lg flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <div>
            <p className="font-semibold text-sm">Privátní mód je aktivní</p>
            <p className="text-xs opacity-90">Všechna finanční data jsou skryta. Pro zobrazení financí vypněte privátní mód v uživatelském menu.</p>
          </div>
        </div>
      )}

      {isSuperUser ? (
        <Tabs defaultValue={isPrivateMode ? "projects" : "financials"} className="space-y-6">
          <div className="flex items-center justify-between">
            <TabsList>
              {!isPrivateMode && <TabsTrigger value="financials">Finance</TabsTrigger>}
              <TabsTrigger value="projects">Projekty & Stav</TabsTrigger>
              <TabsTrigger value="schedules">Harmonogramy</TabsTrigger>
            </TabsList>
          </div>

          {!isPrivateMode && (
            <TabsContent value="financials" className="space-y-6 mt-0">
              <AdminFinancials />
              <div className="grid grid-cols-1 gap-6">
                <Card className="h-full">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Activity className="w-5 h-5 text-slate-500" /> Moje Finance
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-4">
                      <UserFinancials memberId={memberId} />
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>
          )}

          <TabsContent value="projects" className="space-y-6 mt-0">
            <PortalStatusChart />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Inženýrské činnosti</CardTitle>
                  <CardDescription>Nedokončené úkoly napříč projekty</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {pendingActivitiesList.length > 0 ? (
                    pendingActivitiesList.map(activity => <EngineeringActivityCard key={activity.id} activity={activity} />)
                  ) : (
                    <p className="text-sm text-muted-foreground py-4 text-center">Všechny činnosti jsou hotové.</p>
                  )}
                  <Button variant="link" asChild className="px-0 pt-2 text-primary">
                    <Link to="/engineering">Přejít na inženýring &rarr;</Link>
                  </Button>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Moje Úkoly</CardTitle>
                  <CardDescription>Přehled stavu vašich úkolů</CardDescription>
                </CardHeader>
                <CardContent>
                  <ProjectStatusChart tasks={tasks} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="schedules" className="space-y-6 mt-0">
            <div className="grid grid-cols-1 gap-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <GanttChartSquare className="w-5 h-5 text-indigo-600" />
                    Harmonogram Projektů
                  </CardTitle>
                  <CardDescription>Časová osa všech projektů</CardDescription>
                </CardHeader>
                <CardContent>
                  <ProjectGanttChart projects={allProjects} zoom={zoom} onZoomChange={setZoom} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <CalendarClock className="w-5 h-5 text-orange-600" />
                    Harmonogram Realizací
                  </CardTitle>
                  <CardDescription>Časová osa aktivních realizací</CardDescription>
                </CardHeader>
                <CardContent>
                  <RealizationGanttChart realizations={realizations} zoom={zoom} onZoomChange={setZoom} />
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      ) : (
        /* USER VIEW */
        <div className="space-y-6">
          <UserFinancials memberId={memberId} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <PieChart className="w-5 h-5 text-purple-600" />
                    Projekty
                  </CardTitle>
                </div>
                <CardDescription>Stav přiřazených projektů</CardDescription>
              </CardHeader>
              <CardContent>
                <ProjectStatusChart projects={userProjects} />
              </CardContent>
            </Card>

            <Card className="h-full">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ClipboardList className="w-5 h-5 text-blue-600" />
                    Úkoly
                  </CardTitle>
                </div>
                <CardDescription>Stav přiřazených úkolů</CardDescription>
              </CardHeader>
              <CardContent>
                <ProjectStatusChart tasks={tasks} />
              </CardContent>
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2">
              <CardHeader className="pb-4">
                <CardTitle className="text-lg flex items-center gap-2">
                  <GanttChartSquare className="w-5 h-5 text-purple-600" />
                  Harmonogramy
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Tabs defaultValue="projects" className="w-full">
                  <TabsList className="w-full justify-start mb-4">
                    <TabsTrigger value="projects">Projekty</TabsTrigger>
                    <TabsTrigger value="realizations">Realizace</TabsTrigger>
                  </TabsList>
                  <TabsContent value="projects" className="mt-0">
                    <ProjectGanttChart projects={userProjects} zoom={zoom} onZoomChange={setZoom} />
                  </TabsContent>
                  <TabsContent value="realizations" className="mt-0">
                    <RealizationGanttChart realizations={realizations} zoom={zoom} onZoomChange={setZoom} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Wrench className="w-5 h-5 text-orange-500" />
                  Inženýring
                </CardTitle>
                <CardDescription>Probíhající činnosti</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                {pendingActivitiesList.length > 0 ? (
                  pendingActivitiesList.map(activity => <EngineeringActivityCard key={activity.id} activity={activity} />)
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    <CheckCircle className="w-8 h-8 mx-auto mb-2 opacity-20" />
                    Žádné aktivní činnosti
                  </div>
                )}
                <Button variant="outline" size="sm" asChild className="w-full mt-4">
                  <Link to="/engineering">Zobrazit vše</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
