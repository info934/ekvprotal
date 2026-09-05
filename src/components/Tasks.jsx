import UnifiedTaskQueue from '@/components/UnifiedTaskQueue';
import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useSearchParams } from 'react-router-dom';
import { 
  ListTodo, Search, Plus, LayoutGrid, List,
  Clock, CheckCircle2, AlertCircle, Target,
  Filter, RefreshCw, Eye, Edit2, MoreHorizontal,
  Calendar as CalendarIcon, Users, Building
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import TaskDialog from '@/components/TaskDialog';
import { format, isPast } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ManagedTableSection } from '@/components/ui/managed-table';
import { logAction } from '@/lib/logger';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/ui/page-header';
import { DataVizMetricCard } from '@/components/ui/data-viz';

const StatCard = ({ icon: Icon, title, value, subtitle, color = "text-blue-600", className, ...props }) => (
  <motion.button
    type="button"
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -2 }}
    className={cn(
      "group flex min-h-[112px] w-full items-center gap-4 rounded-lg border bg-white p-4 text-left shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md",
      className
    )}
    {...props}
  >
    <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-50", color)}>
      <Icon className="h-5 w-5" />
    </div>
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="mt-1 flex items-end gap-2">
        <p className="text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      </div>
      {subtitle && <p className="mt-1 truncate text-xs text-muted-foreground">{subtitle}</p>}
    </div>
  </motion.button>
);

const taskStatusConfig = {
  'Nové': { 
    color: 'bg-blue-100 text-blue-800', 
    dot: 'bg-blue-500', 
    titleColor: 'text-blue-600',
    icon: Clock,
    variant: 'info'
  },
  'V řešení': { 
    color: 'bg-yellow-100 text-yellow-800', 
    dot: 'bg-yellow-500', 
    titleColor: 'text-yellow-600',
    icon: AlertCircle,
    variant: 'warning'
  },
  'Blokováno': { color: 'bg-red-100 text-red-800', dot: 'bg-red-500', titleColor: 'text-red-700', icon: AlertCircle, variant: 'destructive' },
  'Hotovo': { 
    color: 'bg-green-100 text-green-800', 
    dot: 'bg-green-500', 
    titleColor: 'text-green-600',
    icon: CheckCircle2,
    variant: 'success'
  },
  'Zrušeno': { color: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400', titleColor: 'text-slate-600', icon: AlertCircle, variant: 'secondary' },
};

const TaskCard = ({ task, onDragStart, onClick }) => {
  const { hasPermission } = useAuth();
  const isTaskPast = isPast(new Date(task.end_date)) && !['Hotovo', 'Zrušeno'].includes(task.status);
  const config = taskStatusConfig[task.status] || taskStatusConfig['Nové'];
  const StatusIcon = config.icon;

  return (
    <motion.div
      layout
      layoutId={`card-${task.id}`}
      draggable={hasPermission('tasks', 'can_edit')}
      onDragStart={(e) => onDragStart(e, task)}
      onClick={() => onClick(task)}
      dragElastic={0.5}
      dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
      className={cn(
        "group relative mb-3 overflow-hidden rounded-lg border bg-white p-4 shadow-sm transition-all duration-200 hover:border-primary/40 hover:shadow-md",
        hasPermission('tasks', 'can_edit') ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isTaskPast && "border-red-300 bg-red-50/60",
        task.status === 'Hotovo' && "opacity-75"
      )}
    >
      <div className={cn("absolute inset-x-0 top-0 h-1", config.dot)} />
      <div className="mb-4 flex items-start justify-between gap-3 pt-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <StatusIcon className={cn("h-4 w-4 shrink-0", config.titleColor)} />
            <h3 className="truncate text-sm font-semibold text-slate-950">{task.name}</h3>
          </div>
          {task.description && (
            <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">
              {task.description}
            </p>
          )}
        </div>
        <Badge variant={config.variant} className="shrink-0 text-xs">
          {task.status}
        </Badge>
      </div>

      <div className="space-y-2.5 text-sm">
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Building className="h-3.5 w-3.5 shrink-0" />
          <Link 
            to={`/projects/${task.project_id}`} 
            className="truncate hover:text-primary transition-colors" 
            onClick={(e) => e.stopPropagation()}
          >
            {task.projects?.name || 'Neznámý projekt'}
          </Link>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <Users className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{task.members?.name || 'Nepřiřazeno'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2 text-muted-foreground">
          <CalendarIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate text-xs">
            {format(new Date(task.start_date), 'd.M.yy')} - {format(new Date(task.end_date), 'd.M.yy')}
          </span>
          {isTaskPast && (
            <Badge variant="destructive" className="text-xs ml-auto">
              Po termínu
            </Badge>
          )}
        </div>
      </div>
    </motion.div>
  );
};

const StatusColumn = ({ status, tasks, config, onDragOver, onDrop, onTaskClick }) => {
    const StatusIcon = config.icon;
    
    return (
        <Card 
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, status)}
            className="flex h-full min-h-[360px] flex-col overflow-hidden border-slate-200 bg-slate-50/70 shadow-sm"
        >
            <CardHeader className="border-b bg-white/80 pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={cn("flex h-9 w-9 items-center justify-center rounded-md", config.titleColor.replace('text', 'bg'))}>
                            <StatusIcon className={cn("h-4 w-4", config.titleColor)} />
                        </div>
                        <CardTitle className="text-base text-slate-950">
                            {status}
                        </CardTitle>
                    </div>
                    <Badge variant="secondary" className="text-sm font-semibold">
                        {tasks.length}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto p-3">
                <AnimatePresence>
                    {tasks.length > 0 ? (
                        <div>
                            {tasks.map((task) => (
                                <TaskCard 
                                    key={task.id} 
                                    task={task} 
                                    onDragStart={(e, t) => e.dataTransfer.setData('taskId', t.id)} 
                                    onClick={onTaskClick} 
                                />
                            ))}
                        </div>
                    ) : (
                        <div className="flex min-h-[220px] flex-col items-center justify-center rounded-lg border border-dashed bg-white/70 p-6 text-center text-muted-foreground">
                            <StatusIcon className="mx-auto mb-3 h-8 w-8 opacity-40" />
                            <p className="text-sm">Žádné úkoly v tomto stavu</p>
                        </div>
                    )}
                </AnimatePresence>
            </CardContent>
        </Card>
    );
}

const TaskTable = ({ tasks, onTaskClick }) => {
    const { hasPermission } = useAuth();

    return (
        <ManagedTableSection
            title="Úkoly"
            count={tasks.length}
            minWidth="1040px"
        >
            <CardHeader className="hidden">
                <CardTitle className="flex items-center gap-2">
                    <ListTodo className="h-5 w-5 text-primary" />
                    Přehled úkolů
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow className="bg-slate-50">
                                <TableHead className="font-semibold">Název úkolu</TableHead>
                                <TableHead className="font-semibold">Projekt</TableHead>
                                <TableHead className="font-semibold">Přiřazeno</TableHead>
                                <TableHead className="font-semibold">Termín</TableHead>
                                <TableHead className="font-semibold">Stav</TableHead>
                                <TableHead className="font-semibold text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {tasks.map((task) => {
                                const isTaskPast = isPast(new Date(task.end_date)) && !['Hotovo', 'Zrušeno'].includes(task.status);
                                const config = taskStatusConfig[task.status] || taskStatusConfig['Nové'];
                                const StatusIcon = config.icon;

                                return (
                                    <TableRow 
                                        key={task.id} 
                                        className="cursor-pointer bg-white transition-colors hover:bg-blue-50/35"
                                        onClick={() => onTaskClick(task)}
                                    >
                                        <TableCell className="min-w-[240px] font-semibold">
                                            <div className="flex min-w-0 items-center gap-2">
                                                <StatusIcon className={cn("h-4 w-4 shrink-0", config.titleColor)} />
                                                <span className="truncate">{task.name}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="min-w-[180px]">
                                            <Link 
                                                to={`/projects/${task.project_id}`} 
                                                className="flex min-w-0 items-center gap-1 transition-colors hover:text-primary"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Building className="h-3.5 w-3.5 shrink-0" />
                                                <span className="truncate">{task.projects?.name || 'N/A'}</span>
                                            </Link>
                                        </TableCell>
                                        <TableCell className="min-w-[160px]">
                                            <div className="flex min-w-0 items-center gap-1">
                                                <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                                                <span className="truncate">{task.members?.name || 'Nepřiřazeno'}</span>
                                            </div>
                                        </TableCell>
                                        <TableCell className="min-w-[160px]">
                                            <div className="flex items-center gap-1">
                                                <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                                                <span>{format(new Date(task.end_date), 'd.M.yyyy')}</span>
                                                {isTaskPast && (
                                                    <Badge variant="destructive" className="text-xs ml-2">
                                                        Po termínu
                                                    </Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Badge variant={config.variant} className="text-xs">
                                                <StatusIcon className="w-3 h-3 mr-1" />
                                                {task.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end items-center gap-2">
                                                <Button 
                                                    variant="ghost" 
                                                    size="sm" 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onTaskClick(task);
                                                    }}
                                                >
                                                    <Eye className="w-4 h-4" />
                                                </Button>
                                                {hasPermission('tasks', 'can_edit') && (
                                                    <DropdownMenu>
                                                        <DropdownMenuTrigger asChild>
                                                            <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                                                                <MoreHorizontal className="w-4 h-4" />
                                                            </Button>
                                                        </DropdownMenuTrigger>
                                                        <DropdownMenuContent align="end">
                                                            <DropdownMenuItem onClick={() => onTaskClick(task)}>
                                                                <Edit2 className="w-4 h-4 mr-2" />
                                                                Upravit
                                                            </DropdownMenuItem>
                                                        </DropdownMenuContent>
                                                    </DropdownMenu>
                                                )}
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                );
                            })}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </ManagedTableSection>
    );
};

const Tasks = () => {
  const { toast } = useToast();
  const { memberId, hasPermission, isSuperUser } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState(null);
  const [view, setView] = useState('kanban'); // 'kanban' or 'table'
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchTasks = useCallback(async () => {
    let query = supabase
      .from('project_tasks')
      .select('*, projects(name), members(name)')
      .order('end_date', { ascending: true });

    if (!isSuperUser && memberId) {
        query = query.eq('member_id', memberId);
    }

    const { data, error } = await query;

    if (error) {
      toast({ title: 'Chyba při načítání úkolů', variant: 'destructive' });
    } else {
      setTasks(data);
    }
  }, [toast, isSuperUser, memberId]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);
  
  const handleSaveTask = async (taskData) => {
    const originalTask = editingTask ? tasks.find(t => t.id === editingTask.id) : null;
    const originalStatus = originalTask?.status;
    const newStatus = taskData.status;

    if (editingTask) {
        const { error } = await supabase.from('project_tasks').update(taskData).eq('id', editingTask.id);
        if (error) {
            toast({ title: 'Chyba při úpravě úkolu', description: error.message, variant: 'destructive' });
            return false;
        } else {
            if(originalStatus !== newStatus){
                await logAction('update_task_status', {
                    project_id: taskData.project_id,
                    project_name: tasks.find(t => t.id === editingTask.id)?.projects?.name || 'Neznámý',
                    task_name: taskData.name,
                    old_status: originalStatus,
                    new_status: newStatus
                });
            }
            toast({ title: '✅ Úkol úspěšně upraven!' });
            fetchTasks();
        }
    } else {
        const { error } = await supabase.from('project_tasks').insert([taskData]);
        if (error) {
            toast({ title: 'Chyba při ukládání úkolu', description: error.message, variant: 'destructive' });
            return false;
        } else {
            toast({ title: '✅ Úkol úspěšně vytvořen!' });
            fetchTasks();
        }
    }
    setIsDialogOpen(false);
    setEditingTask(null);
  };
  
  const handleDeleteTask = async (taskId) => {
    if (!hasPermission('tasks', 'can_admin')) {
      toast({ title: '🛑 Nedostatečná oprávnění', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('project_tasks').delete().eq('id', taskId);
    if (error) {
      toast({ title: 'Chyba při mazání úkolu', description: error.message, variant: 'destructive' });
      return false;
    } else {
      toast({ title: '🗑️ Úkol smazán' });
      fetchTasks();
    }
    setIsDialogOpen(false);
    setEditingTask(null);
  };

  const handleTaskClick = (task) => {
    setEditingTask(task);
    setIsDialogOpen(true);
  };

  const handleDragOver = (e) => {
    if(hasPermission('tasks', 'can_edit')) e.preventDefault();
  };

  const handleDrop = async (e, newStatus) => {
    if(!hasPermission('tasks', 'can_edit')) return;
    e.preventDefault();
    const taskId = e.dataTransfer.getData('taskId');
    const task = tasks.find(t => t.id === taskId);

    if (task && task.status !== newStatus) {
      const originalStatus = task.status;
      const originalTasks = [...tasks];
      const updatedTasks = tasks.map(t => t.id === taskId ? { ...t, status: newStatus } : t);
      setTasks(updatedTasks);
      
      const { error } = await supabase
        .from('project_tasks')
        .update({ status: newStatus })
        .eq('id', taskId);

      if (error) {
        setTasks(originalTasks);
        toast({ title: 'Chyba při změně stavu', variant: 'destructive' });
      } else {
        await logAction('update_task_status', {
            project_id: task.project_id,
            project_name: task.projects?.name || 'Neznámý',
            task_name: task.name,
            old_status: originalStatus,
            new_status: newStatus
        });
        toast({ title: `Úkol přesunut do stavu "${newStatus}"` });
      }
    }
  };

  // Calculate statistics
  const stats = React.useMemo(() => {
    const totalTasks = tasks.length;
    const newTasks = tasks.filter(t => t.status === 'Nové').length;
    const inProgressTasks = tasks.filter(t => t.status === 'V řešení').length;
    const completedTasks = tasks.filter(t => t.status === 'Hotovo').length;
    const overdueTasks = tasks.filter(t => isPast(new Date(t.end_date)) && !['Hotovo', 'Zrušeno'].includes(t.status)).length;

    return {
      totalTasks,
      newTasks,
      inProgressTasks,
      completedTasks,
      overdueTasks
    };
  }, [tasks]);

  const filteredTasks = tasks.filter(item => {
      const lowercasedFilter = searchTerm.toLowerCase();
      const matchesSearch = (
        item.name.toLowerCase().includes(lowercasedFilter) ||
        (item.projects?.name && item.projects.name.toLowerCase().includes(lowercasedFilter)) ||
        (item.members?.name && item.members.name.toLowerCase().includes(lowercasedFilter)) ||
        (item.status && item.status.toLowerCase().includes(lowercasedFilter))
      );
      
      const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
      
      return matchesSearch && matchesStatus;
  });

  const hasActiveFilters = searchTerm.trim() !== '' || statusFilter !== 'all';

  const tasksByStatus = Object.keys(taskStatusConfig).reduce((acc, status) => {
    acc[status] = filteredTasks.filter(task => task.status === status);
    return acc;
  }, {});

  return (
    <div className="app-page">
      <div className="space-y-6">
        <PageHeader
          icon={ListTodo}
          title="Přehled úkolů"
          description={isSuperUser ? 'Správa všech úkolů napříč projekty' : 'Přehled vašich úkolů'}
          actions={
            <>
              {hasPermission('tasks', 'can_edit') && (
                <Button onClick={() => { setEditingTask(null); setIsDialogOpen(true); }}>
                  <Plus className="w-4 h-4 mr-2" />
                  Nový úkol
                </Button>
              )}
              <Button variant="outline" size="sm" className="bg-white/80" onClick={fetchTasks}>
                <RefreshCw className="w-4 h-4 mr-2" />
                Aktualizovat
              </Button>
            </>
          }
        />
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5"
        >
          <StatCard
            icon={ListTodo}
            title="Celkem úkolů"
            value={stats.totalTasks}
            subtitle="Všechny úkoly"
            color="text-blue-600"
          />
          <StatCard
            icon={Clock}
            title="Nové"
            value={stats.newTasks}
            subtitle="Čekají na začátek"
            color="text-blue-600"
          />
          <StatCard
            icon={AlertCircle}
            title="V řešení"
            value={stats.inProgressTasks}
            subtitle="Aktivní úkoly"
            color="text-orange-600"
          />
          <StatCard
            icon={CheckCircle2}
            title="Hotovo"
            value={stats.completedTasks}
            subtitle="Dokončené úkoly"
            color="text-green-600"
          />
          <StatCard
            icon={Target}
            title="Po termínu"
            value={stats.overdueTasks}
            subtitle="Vyžadují pozornost"
            color="text-red-600"
          />
        </motion.div>

        {/* Filters and Controls */}
        <Card className="overflow-hidden">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="relative w-full xl:max-w-xl">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Hledat úkol, projekt, projektanta..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              <div className="flex w-full flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center xl:w-auto xl:justify-end">
                <div className="flex min-w-0 items-center gap-2">
                  <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <Select
                    value={statusFilter}
                    onValueChange={setStatusFilter}
                  >
                    <SelectTrigger className="w-full bg-white sm:w-[180px]">
                      <SelectValue placeholder="Filtrovat stav" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Všechny stavy</SelectItem>
                      <SelectItem value="Nové">Nové</SelectItem>
                      <SelectItem value="V řešení">V řešení</SelectItem>
                      <SelectItem value="Blokováno">Blokováno</SelectItem>
                      <SelectItem value="Hotovo">Hotovo</SelectItem>
                      <SelectItem value="Zrušeno">Zrušeno</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex rounded-lg bg-slate-100 p-1">
                  <Button
                    variant={view === 'kanban' ? 'secondary' : 'ghost'}
                    onClick={() => setView('kanban')}
                    size="sm"
                    className="flex-1 sm:flex-none"
                  >
                    <LayoutGrid className="w-4 h-4 mr-2" /> Kanban
                  </Button>
                  <Button
                    variant={view === 'table' ? 'secondary' : 'ghost'}
                    onClick={() => setView('table')}
                    size="sm"
                    className="flex-1 sm:flex-none"
                  >
                    <List className="w-4 h-4 mr-2" /> Tabulka
                  </Button>
                </div>

                {hasActiveFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchTerm('');
                      setStatusFilter('all');
                    }}
                  >
                    Zrušit filtry
                  </Button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Content */}
        <AnimatePresence mode="wait">
          {view === 'kanban' ? (
            <motion.div
              key="kanban"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4"
            >
              {Object.entries(tasksByStatus).map(([status, tasksInStatus]) => (
                <StatusColumn 
                  key={status}
                  status={status}
                  tasks={tasksInStatus}
                  config={taskStatusConfig[status]}
                  onDragOver={handleDragOver}
                  onDrop={handleDrop}
                  onTaskClick={handleTaskClick}
                />
              ))}
            </motion.div>
          ) : (
            <motion.div
              key="table"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              {filteredTasks.length > 0 ? (
                <TaskTable tasks={filteredTasks} onTaskClick={handleTaskClick} />
              ) : (
                <Card>
                  <CardContent className="p-12 text-center">
                    <ListTodo className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-semibold mb-2">Žádné úkoly nenalezeny</h3>
                    <p className="text-muted-foreground mb-4">
                      Zkuste změnit filtry nebo vyhledávání
                    </p>
                    {hasPermission('tasks', 'can_edit') && (
                      <Button onClick={() => { setEditingTask(null); setIsDialogOpen(true); }}>
                        <Plus className="w-4 h-4 mr-2" />
                        Vytvořit úkol
                      </Button>
                    )}
                  </CardContent>
                </Card>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty State for Kanban */}
        {filteredTasks.length === 0 && view === 'kanban' && (
          <Card>
            <CardContent className="p-12 text-center">
              <ListTodo className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Žádné úkoly nenalezeny</h3>
              <p className="text-muted-foreground mb-4">
                Zkuste změnit filtry nebo vytvořte nový úkol
              </p>
              {hasPermission('tasks', 'can_edit') && (
                <Button onClick={() => { setEditingTask(null); setIsDialogOpen(true); }}>
                  <Plus className="w-4 h-4 mr-2" />
                  Vytvořit úkol
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <TaskDialog 
          isOpen={isDialogOpen}
          onClose={() => { setIsDialogOpen(false); setEditingTask(null); }}
          onSave={handleSaveTask}
          onDelete={handleDeleteTask}
          task={editingTask}
        />
      </div>
    </div>
  );
};

export default function TasksPage() { const [params] = useSearchParams(); return params.get('view') === 'project' ? <Tasks /> : <UnifiedTaskQueue />; }
