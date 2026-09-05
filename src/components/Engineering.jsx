import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import {
  Plus, Wrench, Search, Filter, LayoutGrid, List, Calendar,
  CheckCircle, Hourglass, AlertTriangle, RefreshCw,
  MoreHorizontal, Edit2, Trash2, Eye, Building,
  Download, BarChart3, Upload, FileSpreadsheet, UserPlus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format, isPast, differenceInDays, parseISO } from 'date-fns';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from '@/lib/utils';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadXlsx } from '@/lib/xlsx';
import EngineeringForm from '@/components/EngineeringForm';
import EngineeringDetail from '@/components/EngineeringDetail';
import EngineeringGanttChart from '@/components/EngineeringGanttChart';
import SubjectDialog from '@/components/SubjectDialog';
import PageHeader from '@/components/ui/page-header';
import { activityStatusConfig, formatEngineeringCategory, getActivityStatusConfig } from '@/components/engineering/engineeringConfig';
import EngineeringStatusBadge from '@/components/engineering/EngineeringStatusBadge';
import { parseEngineeringDate } from '@/lib/operationsHelpers';


const StatCard = ({ icon: Icon, title, value, subtitle, color = "text-blue-600" }) => (
  <motion.div
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="group rounded-lg border bg-white p-5 shadow-sm transition-all duration-200 hover:border-primary/30 hover:shadow-md"
  >
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
        <p className="text-2xl font-bold tracking-tight text-slate-900">{value}</p>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      <div className={cn("rounded-md bg-slate-50 p-2.5", color)}>
        <Icon className="h-5 w-5" />
      </div>
    </div>
  </motion.div>
);

const ActivityCard = ({ activity, onCardClick, onEdit, onDelete, onStatusChange, onDragStart, hasPermission }) => {
  const config = getActivityStatusConfig(activity.status);
  const StatusIcon = config.icon;
  const isOverdue = activity.end_date && isPast(parseISO(activity.end_date)) && activity.status !== 'done';
  const daysRemaining = activity.end_date ? differenceInDays(parseISO(activity.end_date), new Date()) : null;
  const canEdit = hasPermission('engineering', 'can_edit');

  return (
    <motion.div
      layout
      layoutId={`activity-${activity.id}`}
      onClick={() => onCardClick(activity)}
      draggable={canEdit}
      onDragStart={(e) => canEdit && onDragStart(e, activity.id)}
      className={cn(
        "group bg-white border rounded-xl p-4 mb-4 transition-all duration-200",
        canEdit ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        "hover:shadow-lg hover:border-primary/50",
        isOverdue && "border-red-300 bg-red-50",
        activity.is_urgent && "border-2 border-yellow-500 bg-yellow-50"
      )}
    >
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <StatusIcon className={cn("w-4 h-4 flex-shrink-0", config.color)} />
          <h3 className="font-semibold text-sm truncate">{activity.subject}</h3>
        </div>
        <EngineeringStatusBadge status={activity.status} className="flex-shrink-0" showIcon={false} />
      </div>
      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{activity.description}</p>
      <div className="space-y-2 text-sm mt-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <Building className="w-3 h-3 flex-shrink-0" />
          <Link
            to={`/projects/${activity.project_id}`}
            className="truncate hover:text-primary transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {activity.projects?.name || 'Neznámý projekt'}
          </Link>
        </div>
        <div className="flex items-center gap-2 text-muted-foreground">
          <Calendar className="w-3 h-3 flex-shrink-0" />
          <span className="text-xs">
            {activity.start_date ? format(parseISO(activity.start_date), 'd.M.yy') : '-'} - {activity.end_date ? format(parseISO(activity.end_date), 'd.M.yy') : '-'}
          </span>
          {isOverdue && (
            <Badge variant="destructive" className="text-xs ml-auto">
              Po termínu
            </Badge>
          )}
          {activity.status !== 'done' && !isOverdue && daysRemaining !== null && daysRemaining <= 7 && daysRemaining >= 0 && (
            <Badge variant="warning" className="text-xs ml-auto">
              Zbývá {daysRemaining} dní
            </Badge>
          )}
        </div>
        {activity.category && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Wrench className="w-3 h-3 flex-shrink-0" />
            <span className="text-xs">{formatEngineeringCategory(activity.category)}</span>
          </div>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-4">
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                <MoreHorizontal className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Změnit stav</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {Object.entries(activityStatusConfig).map(([key, { label, icon: Icon }]) => (
                <DropdownMenuItem key={key} onClick={(e) => { e.stopPropagation(); onStatusChange(activity.id, key); }}>
                  <Icon className="w-4 h-4 mr-2" /> {label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(activity); }}>
                <Edit2 className="w-4 h-4 mr-2" /> Upravit
              </DropdownMenuItem>
              {hasPermission('engineering', 'can_admin') && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-red-600">
                      <Trash2 className="w-4 h-4 mr-2" /> Smazat
                    </DropdownMenuItem>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Opravdu smazat aktivitu?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Tato akce je nevratná.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Zrušit</AlertDialogCancel>
                      <AlertDialogAction onClick={(e) => { e.stopPropagation(); onDelete(activity.id); }} className="bg-red-600 hover:bg-red-700">
                        Smazat
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </motion.div>
  );
};

const StatusColumn = ({ status, activities, config, onDragOver, onDrop, onCardClick, onEdit, onDelete, onStatusChange, onDragStart, hasPermission }) => {
  const StatusIcon = config.icon;
  const [isOver, setIsOver] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsOver(true);
  };
  
  const handleDragLeave = (e) => {
    setIsOver(false);
  };

  const handleDrop = (e, status) => {
    onDrop(e, status);
    setIsOver(false);
  };

  return (
    <Card
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={(e) => handleDrop(e, status)}
      className={cn(
        "bg-gradient-to-b from-slate-50 to-white border-slate-200 flex flex-col h-full transition-colors",
        isOver && "bg-primary/10 border-primary/30"
        )}
    >
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", config.color.replace('text', 'bg'))}>
              <StatusIcon className={cn("w-5 h-5", config.color)} />
            </div>
            <CardTitle className={cn("text-lg", config.color)}>
              {config.label}
            </CardTitle>
          </div>
          <Badge variant="secondary" className="text-sm font-semibold">
            {activities.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex-1 overflow-y-auto pt-0">
        <AnimatePresence>
          {activities.length > 0 ? (
            <div className="space-y-3">
              {activities.map((activity) => (
                <ActivityCard
                  key={activity.id}
                  activity={activity}
                  onCardClick={onCardClick}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onStatusChange={onStatusChange}
                  onDragStart={onDragStart}
                  hasPermission={hasPermission}
                />
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-12">
              <StatusIcon className="w-8 h-8 mx-auto mb-3 opacity-50" />
              <p className="text-sm">Žádné aktivity v tomto stavu.</p>
            </div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
};

const EngineeringTable = ({ activities, onRowClick, onEdit, onDelete, onStatusChange, hasPermission }) => {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="font-semibold">Předmět</TableHead>
                <TableHead className="font-semibold">Projekt</TableHead>
                <TableHead className="font-semibold">Kategorie</TableHead>
                <TableHead className="font-semibold">Termín</TableHead>
                <TableHead className="font-semibold">Stav</TableHead>
                <TableHead className="font-semibold text-right">Akce</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {activities.map((activity) => {
                const config = getActivityStatusConfig(activity.status);
                const StatusIcon = config.icon;
                const isOverdue = activity.end_date && isPast(parseISO(activity.end_date)) && activity.status !== 'done';

                return (
                  <TableRow
                    key={activity.id}
                    className={cn(
                      "cursor-pointer hover:bg-slate-50 transition-colors",
                      isOverdue && "bg-red-50 hover:bg-red-100/60",
                      activity.is_urgent && "bg-yellow-50 hover:bg-yellow-100/60"
                    )}
                    onClick={() => onRowClick(activity)}
                  >
                    <TableCell className="font-semibold">
                      <div className="flex items-center gap-2">
                        <StatusIcon className={cn("w-4 h-4", config.color)} />
                        {activity.subject}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/projects/${activity.project_id}`}
                        className="hover:text-primary transition-colors flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Building className="w-3 h-3" />
                        {activity.projects?.name || 'N/A'}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                         {formatEngineeringCategory(activity.category)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Calendar className="w-3 h-3 text-muted-foreground" />
                        <span>{activity.end_date ? format(parseISO(activity.end_date), 'd.M.yyyy') : 'N/A'}</span>
                        {isOverdue && (
                          <Badge variant="destructive" className="text-xs ml-2">
                            Po termínu
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <EngineeringStatusBadge status={activity.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRowClick(activity);
                          }}
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        {hasPermission('engineering', 'can_edit') && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                                <MoreHorizontal className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Změnit stav</DropdownMenuLabel>
                              <DropdownMenuSeparator />
                              {Object.entries(activityStatusConfig).map(([key, { label, icon: Icon }]) => (
                                <DropdownMenuItem key={key} onClick={(e) => { e.stopPropagation(); onStatusChange(activity.id, key); }}>
                                  <Icon className="w-4 h-4 mr-2" /> {label}
                                </DropdownMenuItem>
                              ))}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); onEdit(activity); }}>
                                <Edit2 className="w-4 h-4 mr-2" /> Upravit
                              </DropdownMenuItem>
                              {hasPermission('engineering', 'can_admin') && (
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-red-600">
                                      <Trash2 className="w-4 h-4 mr-2" /> Smazat
                                    </DropdownMenuItem>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Opravdu smazat aktivitu?</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Tato akce je nevratná.
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                      <AlertDialogAction onClick={(e) => { e.stopPropagation(); onDelete(activity.id); }} className="bg-red-600 hover:bg-red-700">
                                        Smazat
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              )}
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

const Engineering = () => {
  const { toast } = useToast();
  const { hasPermission, isSuperUser, memberId } = useAuth();
  const [activities, setActivities] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [isFormOpen, setIsFormOpen] = useState(false); // Used for inline form toggle
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isSubjectDialogOpen, setIsSubjectDialogOpen] = useState(false);
  const [editingActivity, setEditingActivity] = useState(null);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [viewMode, setViewMode] = useState('kanban'); // 'kanban', 'table', 'gantt'
  const [loading, setLoading] = useState(true);

  // Default form type state
  const [activeFormType, setActiveFormType] = useState('general'); // 'general' or 'dotceny'

  const fetchActivities = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('engineering_activities')
      .select('*, projects(name, code)')
      .order('end_date', { ascending: true });

    if (!isSuperUser) {
      const { data: projectMembers, error: pmError } = await supabase
        .from('project_members')
        .select('project_id')
        .eq('member_id', memberId);

      if (pmError) {
        toast({ title: 'Chyba při načítání projektů uživatele', description: pmError.message, variant: 'destructive' });
        setLoading(false);
        return;
      }

      const projectIds = projectMembers.map(pm => pm.project_id);
      if (projectIds.length === 0) {
          setActivities([]);
          setLoading(false);
          return;
      }
      query = query.in('project_id', projectIds);
    }

    const { data, error } = await query;

    if (error) {
      toast({ title: 'Chyba při načítání aktivit', description: error.message, variant: 'destructive' });
    } else {
      setActivities(data);
    }
    setLoading(false);
  }, [toast, isSuperUser, memberId]);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  const handleSaveActivity = async (activityData) => {
    if (editingActivity) {
      const { error } = await supabase.from('engineering_activities').update(activityData).eq('id', editingActivity.id);
      if (error) {
        toast({ title: 'Chyba při úpravě aktivity', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: '✅ Aktivita úspěšně upravena!' });
        fetchActivities();
      }
    } else {
      const { error } = await supabase.from('engineering_activities').insert([activityData]);
      if (error) {
        toast({ title: 'Chyba při vytváření aktivity', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: '✅ Aktivita úspěšně vytvořena!' });
        fetchActivities();
      }
    }
    setIsFormOpen(false);
    setEditingActivity(null);
    setActiveFormType('general'); // Reset to default
  };

  const handleSaveSubject = async (subjectData) => {
     const { error } = await supabase.from('subjects').insert([subjectData]);
      if (error) {
        toast({ title: 'Chyba při vytváření subjektu', description: error.message, variant: 'destructive' });
      } else {
        toast({ title: '✅ Subjekt úspěšně vytvořen!' });
        setIsSubjectDialogOpen(false);
      }
  }

  const handleDeleteActivity = async (activityId) => {
    if (!hasPermission('engineering', 'can_admin')) {
      toast({ title: 'Nedostatečná oprávnění', description: 'Nemáte oprávnění mazat aktivity.', variant: 'destructive' });
      return;
    }
    const { error } = await supabase.from('engineering_activities').delete().eq('id', activityId);
    if (error) {
      toast({ title: 'Chyba při mazání aktivity', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: '🗑️ Aktivita smazána' });
      fetchActivities();
      setIsDetailOpen(false);
      setSelectedActivity(null);
    }
  };

  const handleStatusChange = async (activityId, newStatus) => {
    if (!hasPermission('engineering', 'can_edit')) {
      toast({ title: 'Nedostatečná oprávnění', description: 'Nemáte oprávnění měnit stav aktivit.', variant: 'destructive' });
      return;
    }
    // Optimistic UI update
    const originalActivities = [...activities];
    const updatedActivities = activities.map(a => a.id === activityId ? { ...a, status: newStatus } : a);
    setActivities(updatedActivities);

    const { error } = await supabase.from('engineering_activities').update({ status: newStatus }).eq('id', activityId);
    if (error) {
      // Revert on error
      setActivities(originalActivities);
      toast({ title: 'Chyba při změně stavu', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: `Stav aktivity změněn na "${activityStatusConfig[newStatus].label}"` });
    }
  };

  const handleToggleUrgency = async (activity) => {
    if (!hasPermission('engineering', 'can_edit')) return;
    const newUrgency = !activity.is_urgent;
    const { error } = await supabase.from('engineering_activities').update({ is_urgent: newUrgency }).eq('id', activity.id);
    if (error) {
      toast({ title: 'Chyba při změně urgence', variant: 'destructive' });
    } else {
      toast({ title: newUrgency ? 'Aktivita označena jako urgentní' : 'Urgence zrušena' });
      fetchActivities();
      setSelectedActivity(prev => ({ ...prev, is_urgent: newUrgency }));
    }
  };

  const handleOpenDetail = (activity) => {
    setSelectedActivity(activity);
    setIsDetailOpen(true);
  };

  const handleOpenForm = (activity = null, type = 'general') => {
    // Close detail view if open
    setIsDetailOpen(false);
    
    setEditingActivity(activity);
    // Correctly detect form type based on activity category or fallback to request
    let formCategory = type;
    if (activity) {
        formCategory = activity.category === 'dotceny_stavbou' ? 'dotceny' : 'general';
    }
    
    setActiveFormType(formCategory);
    setIsFormOpen(true);
  };

  const onDragStart = (e, activityId) => {
    e.dataTransfer.setData('activityId', activityId);
  };

  const onDrop = (e, newStatus) => {
    const activityId = e.dataTransfer.getData('activityId');
    const activity = activities.find(a => a.id === activityId);
    if (activity && activity.status !== newStatus) {
      handleStatusChange(activityId, newStatus);
    }
  };

  const filteredActivities = useMemo(() => {
    return activities.filter(activity => {
      const lowerSearch = searchTerm.toLowerCase();
      const matchesSearch = (
        activity.subject.toLowerCase().includes(lowerSearch) ||
        (activity.description && activity.description.toLowerCase().includes(lowerSearch)) ||
        (activity.projects?.name && activity.projects.name.toLowerCase().includes(lowerSearch)) ||
        (activity.projects?.code && activity.projects.code.toLowerCase().includes(lowerSearch))
      );

      const matchesStatus = statusFilter === 'all' || activity.status === statusFilter;
      const matchesCategory = categoryFilter === 'all' || activity.category === categoryFilter;

      return matchesSearch && matchesStatus && matchesCategory;
    });
  }, [activities, searchTerm, statusFilter, categoryFilter]);

  const activitiesByStatus = useMemo(() => {
    return Object.keys(activityStatusConfig).reduce((acc, status) => {
      acc[status] = filteredActivities.filter(activity => activity.status === status);
      return acc;
    }, {});
  }, [filteredActivities]);

  const uniqueCategories = useMemo(() => {
    const categories = new Set(activities.map(a => a.category).filter(Boolean));
    return ['all', ...Array.from(categories)];
  }, [activities]);

  const totalActivities = activities.length;
  const completedActivities = activities.filter(a => a.status === 'done').length;
  const inProgressActivities = activities.filter(a => a.status === 'in_progress').length;
  const overdueActivities = activities.filter(a => a.end_date && isPast(parseISO(a.end_date)) && a.status !== 'done').length;
  const hasActiveFilters = searchTerm.trim() !== '' || statusFilter !== 'all' || categoryFilter !== 'all';

  const resetFilters = () => {
    setSearchTerm('');
    setStatusFilter('all');
    setCategoryFilter('all');
  };

  const handleExportDotceny = async () => {
    const XLSX = await loadXlsx();
    const dataToExport = activities
      .filter(a => a.category === 'dotceny_stavbou')
      .map(activity => ({
        'Předmět (Vlastník)': activity.subject,
        'Projekt': activity.projects?.code || 'N/A',
        'Popis': activity.description || '',
        'Stav': activityStatusConfig[activity.status]?.label || activity.status,
        'Datum zahájení': activity.start_date ? format(parseISO(activity.start_date), 'd.M.yyyy') : '',
        'Termín dokončení': activity.end_date ? format(parseISO(activity.end_date), 'd.M.yyyy') : '',
        'Dny na vyjádření': activity.dny_na_vyjadreni || '',
        'Urgentní': activity.is_urgent ? 'Ano' : 'Ne'
    }));

    if(dataToExport.length === 0) {
        toast({ title: 'Žádná data k exportu', description: 'Nebyly nalezeny žádné aktivity typu "Dotčený stavbou".', variant: 'warning' });
        return;
    }

    const worksheet = XLSX.utils.json_to_sheet(dataToExport);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Dotčené stavbou');
    XLSX.writeFile(workbook, `dotcene_stavbou_${format(new Date(), 'yyyyMMdd')}.xlsx`);
    toast({ title: '✅ Export "Dotčené stavbou" vygenerován!' });
  };

  const handleImportDotceny = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const XLSX = await loadXlsx();
      
      const reader = new FileReader();
      reader.onload = async (evt) => {
          try {
              const bstr = evt.target.result;
              const wb = XLSX.read(bstr, { type: 'binary' });
              const dateOptions = { date1904: Boolean(wb.Workbook?.WBProps?.date1904) };
              const wsname = wb.SheetNames[0];
              const ws = wb.Sheets[wsname];
              const data = XLSX.utils.sheet_to_json(ws);
              
              let successCount = 0;
              let errorCount = 0;
              const dateErrors = [];

              // We need project IDs. Let's fetch all projects first to map codes to IDs.
              const { data: allProjects, error: projectsError } = await supabase.from('projects').select('id, code');
              if (projectsError) throw projectsError;
              const projectMap = {};
              allProjects?.forEach(p => projectMap[p.code] = p.id);

              for (const row of data) {
                  const projectCode = row['Projekt'];
                  const projectId = projectMap[projectCode];
                  
                  if (!projectId) {
                      console.warn(`Project code ${projectCode} not found.`);
                      errorCount++;
                      continue;
                  }

                  // Parse Status reverse
                  let status = 'new';
                  for(const [key, val] of Object.entries(activityStatusConfig)) {
                      if(val.label === row['Stav']) {
                          status = key;
                          break;
                      }
                  }

                  let startDate, endDate;
                  try {
                    startDate = parseEngineeringDate(row['Datum zahájení'], dateOptions);
                    endDate = parseEngineeringDate(row['Termín dokončení'], dateOptions);
                    if (startDate && endDate && endDate < startDate) throw new Error('Termín dokončení je před zahájením.');
                  } catch (dateError) {
                    errorCount++;
                    if (dateErrors.length < 3) dateErrors.push(`${projectCode}: ${dateError.message}`);
                    continue;
                  }
                  
                  const newActivity = {
                      project_id: projectId,
                      category: 'dotceny_stavbou',
                      subject: row['Předmět (Vlastník)'] || 'Neznámý vlastník',
                      description: row['Popis'] || '',
                      status: status,
                      start_date: startDate,
                      end_date: endDate,
                      dny_na_vyjadreni: row['Dny na vyjádření'] ? parseInt(row['Dny na vyjádření']) : null,
                      is_urgent: row['Urgentní'] === 'Ano'
                  };

                  const { error } = await supabase.from('engineering_activities').insert([newActivity]);
                  if(error) errorCount++;
                  else successCount++;
              }

              toast({ 
                  title: 'Import dokončen', 
                  description: `Úspěšně importováno: ${successCount}, vynechané řádky: ${errorCount}.${dateErrors.length ? ` ${dateErrors.join(' ')}` : ''}`,
                  variant: errorCount > 0 ? 'warning' : 'default'
              });
              fetchActivities();

          } catch (err) {
              console.error(err);
              toast({ title: 'Chyba při importu', description: 'Nepodařilo se zpracovat soubor.', variant: 'destructive' });
          }
      };
      reader.readAsBinaryString(file);
      e.target.value = null; // reset input
  }


  if (!hasPermission('engineering', 'can_read')) {
    return (
      <div className="app-page">
        <div className="space-y-6">
          <Card className="p-12 text-center">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-red-600 mb-2">Přístup odepřen</h1>
            <p className="text-muted-foreground">Nemáte oprávnění pro přístup k tomuto modulu.</p>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="app-page">
      <div className="space-y-6">
        <PageHeader
          icon={Wrench}
          title="Inženýring"
          description="Správa inženýrských činností a vyjádření k projektům"
          actions={
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
              {hasPermission('engineering', 'can_create') && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="w-full sm:w-auto">
                      <Plus className="w-4 h-4 mr-2" />
                      Nový záznam
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-72">
                    <DropdownMenuLabel>Vyberte typ záznamu</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => handleOpenForm(null, 'general')} className="flex-col items-start gap-1">
                      <div className="flex items-center gap-2 font-medium">
                        <Wrench className="w-4 h-4 text-slate-500" />
                        Obecná aktivita
                      </div>
                      <span className="pl-6 text-xs text-muted-foreground">DOSS, sítě, ostatní inženýrská agenda</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleOpenForm(null, 'dotceny')} className="flex-col items-start gap-1">
                      <div className="flex items-center gap-2 font-medium">
                        <Building className="w-4 h-4 text-slate-500" />
                        Dotčený stavbou
                      </div>
                      <span className="pl-6 text-xs text-muted-foreground">Majetkoprávní záznam vlastníka nebo subjektu</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => setIsSubjectDialogOpen(true)} className="flex-col items-start gap-1">
                      <div className="flex items-center gap-2 font-medium">
                        <UserPlus className="w-4 h-4 text-slate-500" />
                        Subjekt
                      </div>
                      <span className="pl-6 text-xs text-muted-foreground">Samostatný kontakt pro další použití</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="w-full bg-white sm:w-auto">
                    <FileSpreadsheet className="w-4 h-4 mr-2" />
                    Excel
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuLabel>Dotčené stavbou</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleExportDotceny}>
                    <Download className="w-4 h-4 mr-2" /> Exportovat
                  </DropdownMenuItem>
                  <div className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground">
                    <Upload className="w-4 h-4 mr-2" />
                    Importovat
                    <input
                      type="file"
                      accept=".xlsx, .xls"
                      className="absolute inset-0 cursor-pointer opacity-0"
                      onChange={handleImportDotceny}
                    />
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" onClick={fetchActivities} className="w-full bg-white sm:w-auto">
                <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
                Aktualizovat
              </Button>
            </div>
          }
        />
        {/* Inline Engineering Form */}
        <AnimatePresence>
            {isFormOpen && (
                <motion.div
                    key={`${editingActivity?.id || 'new'}-${activeFormType}`}
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="overflow-hidden"
                >
                    <EngineeringForm 
                        activity={editingActivity}
                        formType={activeFormType}
                        onSave={handleSaveActivity}
                        onCancel={() => { setIsFormOpen(false); setEditingActivity(null); }}
                    />
                </motion.div>
            )}
        </AnimatePresence>

        {/* Statistics Cards */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
        >
          <StatCard
            icon={Wrench}
            title="Celkem aktivit"
            value={totalActivities}
            subtitle="Všechny inženýrské činnosti"
            color="text-blue-600"
          />
          <StatCard
            icon={Hourglass}
            title="V řešení"
            value={inProgressActivities}
            subtitle="Aktivní činnosti"
            color="text-orange-600"
          />
          <StatCard
            icon={CheckCircle}
            title="Hotovo"
            value={completedActivities}
            subtitle="Dokončené činnosti"
            color="text-green-600"
          />
          <StatCard
            icon={AlertTriangle}
            title="Po termínu"
            value={overdueActivities}
            subtitle="Vyžadují pozornost"
            color="text-red-600"
          />
        </motion.div>

        {/* Filters and Controls */}
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-4 sm:p-5">
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-sm font-semibold text-slate-900">Pracovní přehled</h2>
                  <p className="text-xs text-muted-foreground">
                    Zobrazeno {filteredActivities.length} z {totalActivities} aktivit
                  </p>
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
                  <div className="relative w-full sm:w-80">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Hledat aktivitu, projekt nebo kód..."
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="pl-10"
                    />
                  </div>
                  {hasActiveFilters && (
                    <Button variant="ghost" size="sm" onClick={resetFilters} className="shrink-0">
                      Zrušit filtry
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Filter className="h-4 w-4" />
                    Filtry
                  </div>
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="w-full bg-white sm:w-56">
                      <SelectValue placeholder="Filtrovat dle stavu" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Všechny stavy</SelectItem>
                      {Object.entries(activityStatusConfig).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                    <SelectTrigger className="w-full bg-white sm:w-60">
                      <SelectValue placeholder="Filtrovat dle kategorie" />
                    </SelectTrigger>
                    <SelectContent>
                      {uniqueCategories.map(category => (
                        <SelectItem key={category} value={category}>
                          {formatEngineeringCategory(category)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-100 p-1 sm:flex sm:w-auto">
                  <Button
                    variant={viewMode === 'kanban' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('kanban')}
                    size="sm"
                    className="justify-center"
                  >
                    <LayoutGrid className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Kanban</span>
                  </Button>
                  <Button
                    variant={viewMode === 'table' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('table')}
                    size="sm"
                    className="justify-center"
                  >
                    <List className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Tabulka</span>
                  </Button>
                  <Button
                    variant={viewMode === 'gantt' ? 'secondary' : 'ghost'}
                    onClick={() => setViewMode('gantt')}
                    size="sm"
                    className="justify-center"
                  >
                    <BarChart3 className="w-4 h-4 sm:mr-2" /><span className="hidden sm:inline">Gantt</span>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Content Area */}
        <AnimatePresence mode="wait">
          {loading ? (
            <div className="flex justify-center items-center h-64">
              <RefreshCw className="w-8 h-8 animate-spin text-primary" />
              <p className="ml-2 text-muted-foreground">Načítání aktivit...</p>
            </div>
          ) : filteredActivities.length > 0 ? (
            viewMode === 'kanban' ? (
              <motion.div
                key="kanban"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
              >
                {Object.entries(activitiesByStatus).map(([status, activitiesInStatus]) => (
                  <StatusColumn
                    key={status}
                    status={status}
                    activities={activitiesInStatus}
                    config={activityStatusConfig[status]}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={onDrop}
                    onCardClick={handleOpenDetail}
                    onEdit={handleOpenForm}
                    onDelete={handleDeleteActivity}
                    onStatusChange={handleStatusChange}
                    onDragStart={onDragStart}
                    hasPermission={hasPermission}
                  />
                ))}
              </motion.div>
            ) : viewMode === 'table' ? (
              <motion.div
                key="table"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <EngineeringTable
                  activities={filteredActivities}
                  onRowClick={handleOpenDetail}
                  onEdit={handleOpenForm}
                  onDelete={handleDeleteActivity}
                  onStatusChange={handleStatusChange}
                  hasPermission={hasPermission}
                />
              </motion.div>
            ) : (
              <motion.div
                key="gantt"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
              >
                <EngineeringGanttChart activities={filteredActivities} />
              </motion.div>
            )
          ) : (
            <Card>
              <CardContent className="p-12 text-center">
                <Wrench className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Žádné inženýrské aktivity nenalezeny</h3>
                <p className="text-muted-foreground mb-4">
                  Zkuste změnit filtry nebo vytvořte novou aktivitu.
                </p>
                {hasPermission('engineering', 'can_create') && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button>
                        <Plus className="w-4 h-4 mr-2" />
                        Nový záznam
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="center" className="w-72">
                      <DropdownMenuLabel>Vyberte typ záznamu</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => handleOpenForm(null, 'general')} className="flex-col items-start gap-1">
                        <div className="flex items-center gap-2 font-medium">
                          <Wrench className="w-4 h-4 text-slate-500" />
                          Obecná aktivita
                        </div>
                        <span className="pl-6 text-xs text-muted-foreground">DOSS, sítě, ostatní inženýrská agenda</span>
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleOpenForm(null, 'dotceny')} className="flex-col items-start gap-1">
                        <div className="flex items-center gap-2 font-medium">
                          <Building className="w-4 h-4 text-slate-500" />
                          Dotčený stavbou
                        </div>
                        <span className="pl-6 text-xs text-muted-foreground">Majetkoprávní záznam vlastníka nebo subjektu</span>
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </CardContent>
            </Card>
          )}
        </AnimatePresence>

        <EngineeringDetail
          isOpen={isDetailOpen}
          onClose={() => setIsDetailOpen(false)}
          activity={selectedActivity}
          onEdit={(activity) => { setIsDetailOpen(false); handleOpenForm(activity); }}
          onDelete={handleDeleteActivity}
          onToggleUrgency={handleToggleUrgency}
          onStatusChange={fetchActivities}
        />

        <SubjectDialog
            isOpen={isSubjectDialogOpen}
            onClose={() => setIsSubjectDialogOpen(false)}
            onSave={handleSaveSubject}
        />
      </div>
    </div>
  );
};

export default Engineering;
