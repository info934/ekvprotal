import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useNavigate } from 'react-router-dom';
import { 
  ListTodo, User, Folder, Calendar, Search, Plus, LayoutGrid, List, 
  Clock, CheckCircle2, AlertCircle, TrendingUp, Target, BarChart3,
  Filter, RefreshCw, Eye, Edit2, Trash2, MoreHorizontal, Zap,
  ArrowUpDown, Calendar as CalendarIcon, Users, Building
} from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import TaskDialog from '@/components/TaskDialog';
import { format, isPast } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { logAction } from '@/lib/logger';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';
import PageHeader from '@/components/ui/page-header';

// Modern UI Components implemented directly in file
const Card = ({ children, className, ...props }) => (
  <div
    className={cn("rounded-xl border bg-card text-card-foreground shadow-sm hover:shadow-md transition-shadow", className)}
    {...props}
  >
    {children}
  </div>
);

const CardContent = ({ children, className, ...props }) => (
  <div className={cn("p-6 pt-0", className)} {...props}>
    {children}
  </div>
);

const CardHeader = ({ children, className, ...props }) => (
  <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props}>
    {children}
  </div>
);

const CardTitle = ({ children, className, ...props }) => (
  <h3 className={cn("font-semibold leading-none tracking-tight", className)} {...props}>
    {children}
  </h3>
);

const Badge = ({ children, variant = "default", className, ...props }) => {
  const variants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/80",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/80",
    outline: "text-foreground border border-input bg-background hover:bg-accent hover:text-accent-foreground",
    success: "bg-green-100 text-green-800 border-green-200",
    warning: "bg-orange-100 text-orange-800 border-orange-200",
    info: "bg-blue-100 text-blue-800 border-blue-200"
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 border",
        variants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
};

const StatCard = ({ icon: Icon, title, value, subtitle, trend, color = "text-blue-600", className, ...props }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    whileHover={{ y: -4, scale: 1.02 }}
    className={cn("group bg-white border rounded-xl p-6 cursor-pointer hover:shadow-lg hover:border-primary/50 transition-all duration-200", className)}
    {...props}
  >
    <div className="flex items-center justify-between mb-4">
      <div className={cn("p-3 bg-muted rounded-lg", color)}>
        <Icon className="w-6 h-6" />
      </div>
      {trend && (
        <Badge variant={trend > 0 ? "success" : "warning"} className="text-xs">
          <TrendingUp className="w-3 h-3 mr-1" />
          {trend > 0 ? '+' : ''}{trend}%
        </Badge>
      )}
    </div>
    <div className="space-y-2">
      <h3 className="font-semibold text-lg">{title}</h3>
      <p className="text-3xl font-bold">{value}</p>
      {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
    </div>
  </motion.div>
);

const DropdownMenu = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="relative">
      {React.Children.map(children, child => {
        if (child.type === DropdownMenuTrigger) {
          return React.cloneElement(child, { isOpen, setIsOpen });
        } else if (child.type === DropdownMenuContent) {
          return React.cloneElement(child, { isOpen, setIsOpen });
        }
        return child;
      })}
    </div>
  );
};

const DropdownMenuTrigger = ({ children, asChild, isOpen, setIsOpen, ...props }) => {
  const handleClick = (e) => {
    e.stopPropagation();
    setIsOpen(!isOpen);
  };

  if (asChild) {
    return React.cloneElement(children, {
      onClick: handleClick,
      ...props
    });
  }

  return (
    <button onClick={handleClick} {...props}>
      {children}
    </button>
  );
};

const DropdownMenuContent = ({ children, align = "center", className, isOpen, setIsOpen, ...props }) => {
  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onClick={() => setIsOpen(false)}
      />
      <div
        className={cn(
          "absolute z-50 min-w-[8rem] overflow-hidden rounded-md border bg-white p-1 text-gray-900 shadow-lg",
          align === "end" && "right-0",
          className
        )}
        {...props}
      >
        {React.Children.map(children, child =>
          child.type === DropdownMenuItem ?
            React.cloneElement(child, { setIsOpen }) :
            child
        )}
      </div>
    </>
  );
};

const DropdownMenuItem = ({ children, className, setIsOpen, ...props }) => (
  <div
    className={cn(
      "relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-gray-100 focus:bg-gray-100",
      className
    )}
    onClick={(e) => {
      e.stopPropagation();
      setIsOpen(false);
    }}
    {...props}
  >
    {children}
  </div>
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
  'Hotovo': { 
    color: 'bg-green-100 text-green-800', 
    dot: 'bg-green-500', 
    titleColor: 'text-green-600',
    icon: CheckCircle2,
    variant: 'success'
  },
};

const TaskCard = ({ task, onDragStart, onClick }) => {
  const { hasPermission } = useAuth();
  const isTaskPast = isPast(new Date(task.end_date)) && task.status !== 'Hotovo';
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
        "group bg-white border rounded-xl p-4 mb-4 cursor-grab active:cursor-grabbing hover:shadow-lg hover:border-primary/50 transition-all duration-200",
        isTaskPast && "opacity-70 border-red-300",
        task.status === 'Hotovo' && "opacity-50"
      )}
    >
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <StatusIcon className={cn("w-4 h-4 flex-shrink-0", config.titleColor)} />
          <h3 className="font-semibold text-sm truncate">{task.name}</h3>
        </div>
        <Badge variant={config.variant} className="text-xs flex-shrink-0">
          {task.status}
        </Badge>
      </div>

      {/* Content */}
      <div className="space-y-2 text-sm">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building className="w-3 h-3 flex-shrink-0" />
          <Link 
            to={`/projects/${task.project_id}`} 
            className="truncate hover:text-primary transition-colors" 
            onClick={(e) => e.stopPropagation()}
          >
            {task.projects?.name || 'Neznámý projekt'}
          </Link>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Users className="w-3 h-3 flex-shrink-0" />
          <span className="truncate">{task.members?.name || 'Nepřiřazeno'}</span>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <CalendarIcon className="w-3 h-3 flex-shrink-0" />
          <span className="text-xs">
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
            className="bg-gradient-to-b from-slate-50 to-white border-slate-200 flex flex-col h-full"
        >
            <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className={cn("p-2 rounded-lg", config.titleColor.replace('text', 'bg'))}>
                            <StatusIcon className={cn("w-5 h-5", config.titleColor)} />
                        </div>
                        <CardTitle className={cn("text-lg", config.titleColor)}>
                            {status}
                        </CardTitle>
                    </div>
                    <Badge variant="secondary" className="text-sm font-semibold">
                        {tasks.length}
                    </Badge>
                </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-y-auto">
                <AnimatePresence>
                    {tasks.length > 0 ? (
                        <div className="space-y-3">
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
                        <div className="text-center text-muted-foreground py-12">
                            <StatusIcon className="w-8 h-8 mx-auto mb-3 opacity-50" />
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
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="w-5 h-5" />
                    Přehled úkolů
                </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
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
                                const isTaskPast = isPast(new Date(task.end_date)) && task.status !== 'Hotovo';
                                const config = taskStatusConfig[task.status] || taskStatusConfig['Nové'];
                                const StatusIcon = config.icon;

                                return (
                                    <TableRow 
                                        key={task.id} 
                                        className="cursor-pointer hover:bg-slate-50 transition-colors" 
                                        onClick={() => onTaskClick(task)}
                                    >
                                        <TableCell className="font-semibold">
                                            <div className="flex items-center gap-2">
                                                <StatusIcon className={cn("w-4 h-4", config.titleColor)} />
                                                {task.name}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <Link 
                                                to={`/projects/${task.project_id}`} 
                                                className="hover:text-primary transition-colors flex items-center gap-1" 
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <Building className="w-3 h-3" />
                                                {task.projects?.name || 'N/A'}
                                            </Link>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <Users className="w-3 h-3 text-muted-foreground" />
                                                {task.members?.name || 'Nepřiřazeno'}
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-1">
                                                <CalendarIcon className="w-3 h-3 text-muted-foreground" />
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
        </Card>
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
    const overdueTasks = tasks.filter(t => isPast(new Date(t.end_date)) && t.status !== 'Hotovo').length;

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
              <Button variant="outline" size="sm" className="bg-white/80">
                <RefreshCw className="w-4 h-4 mr-2" />
                Aktualizovat
              </Button>
            </>
          }
        />
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="hidden"
        >
          <div>
            <h1 className="text-3xl font-bold text-slate-800 mb-2 flex items-center gap-3">
              <ListTodo className="w-8 h-8 text-blue-600" />
              Přehled úkolů
            </h1>
            <p className="text-muted-foreground">
              {isSuperUser ? 'Správa všech úkolů napříč projekty' : 'Přehled vašich úkolů'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {hasPermission('tasks', 'can_edit') && (
              <Button 
                onClick={() => { setEditingTask(null); setIsDialogOpen(true); }} 
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <Plus className="w-4 h-4 mr-2" />
                Nový úkol
              </Button>
            )}
            <Button variant="outline" size="sm" className="bg-white/80">
              <RefreshCw className="w-4 h-4 mr-2" />
              Aktualizovat
            </Button>
          </div>
        </motion.div>

        {/* Statistics Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4"
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
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-col lg:flex-row gap-4 items-start lg:items-center justify-between">
              {/* Search */}
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  placeholder="Hledat úkol, projekt, projektanta..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>

              {/* Filters */}
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-muted-foreground" />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                  >
                    <option value="all">Všechny stavy</option>
                    <option value="Nové">Nové</option>
                    <option value="V řešení">V řešení</option>
                    <option value="Hotovo">Hotovo</option>
                  </select>
                </div>

                <div className="flex gap-2">
                  <Button
                    variant={view === 'kanban' ? 'default' : 'outline'}
                    onClick={() => setView('kanban')}
                    size="sm"
                  >
                    <LayoutGrid className="w-4 h-4 mr-2" /> Kanban
                  </Button>
                  <Button
                    variant={view === 'table' ? 'default' : 'outline'}
                    onClick={() => setView('table')}
                    size="sm"
                  >
                    <List className="w-4 h-4 mr-2" /> Tabulka
                  </Button>
                </div>
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
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
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

export default Tasks;
