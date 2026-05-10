// Updating to include safer deletion logic
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { motion, AnimatePresence } from 'framer-motion';
import {
  FolderPlus, Search, SlidersHorizontal, ArrowUpDown, ChevronDown,
  ChevronUp, LayoutGrid, List as ListIcon, Loader2, X, Building as BuildingIcon, DollarSign, Activity, Columns, CopyPlus
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from '@/components/ui/select';
import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ManagedTableToolbar, useManagedColumns } from '@/components/ui/managed-table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuCheckboxItem, DropdownMenuLabel, DropdownMenuSeparator
} from '@/components/ui/dropdown-menu';
import { formatCurrency, cn, projectStatusConfig } from '@/lib/utils';
import { useToast } from '@/components/ui/use-toast';
import { parseApiError } from '@/lib/apiValidation';
import BatchProjectDialog from '@/components/BatchProjectDialog';
import { calculateProjectMemberRewardFromProject } from '@/domain/financials';

const Projects = () => {
  const navigate = useNavigate();
  const { user, isPrivateMode, hasPermission, memberId } = useAuth();
  const { toast } = useToast();

  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState('kanban');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'created_at', direction: 'desc' });
  const [filterOpen, setFilterOpen] = useState(false);
  const [projectStats, setProjectStats] = useState({ total: 0, active: 0, value: 0 });
  const [memberRewards, setMemberRewards] = useState({});
  const [totalReward, setTotalReward] = useState(0);
  const [updatingProjectId, setUpdatingProjectId] = useState(null);
  const [draggingProjectId, setDraggingProjectId] = useState(null);
  const [dragOverStatusKey, setDragOverStatusKey] = useState(null);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  
  const statusOrder = useMemo(() => Object.keys(projectStatusConfig), []);

  const canEdit = hasPermission('projects', 'can_edit');
  const canViewFinance = hasPermission('finance', 'can_read');
  const showFinance = canViewFinance && !isPrivateMode;
  const showReward = !isPrivateMode && !canViewFinance;
  const projectTableColumns = useMemo(() => [
    { id: 'code', label: 'Kód', hideable: false },
    { id: 'name', label: 'Název' },
    { id: 'investor', label: 'Investor' },
    { id: 'status', label: 'Stav' },
    showFinance && { id: 'price', label: 'Cena' },
    showReward && { id: 'reward', label: 'Odměna' },
    { id: 'actions', label: 'Akce', hideable: false },
  ].filter(Boolean), [showFinance, showReward]);
  const projectManagedTable = useManagedColumns('ekv-table-projects', projectTableColumns);
  const projectVisibleColumns = projectManagedTable.visibleColumns;
  const projectHeadClasses = {
    code: 'w-24',
    name: 'min-w-[260px]',
    investor: 'min-w-[220px]',
    status: 'min-w-[160px]',
    price: 'min-w-[140px] text-right',
    reward: 'min-w-[140px] text-right',
    actions: 'w-12 text-right',
  };
  const projectCellClasses = {
    code: 'font-mono text-xs text-muted-foreground',
    name: 'max-w-[280px] truncate font-medium',
    investor: 'text-muted-foreground',
    price: 'text-right font-mono',
    reward: 'text-right font-mono',
    actions: 'text-right text-muted-foreground',
  };
  const renderProjectTableCell = (project, columnId) => {
    switch (columnId) {
      case 'code':
        return project.code;
      case 'name':
        return project.name;
      case 'investor':
        return project.investor?.name || '-';
      case 'status':
        return renderStatusMenu(project);
      case 'price':
        return formatCurrency(project.price);
      case 'reward':
        return getRewardDisplay(project.id) || '-';
      case 'actions':
        return <ChevronDown className="ml-auto h-4 w-4 -rotate-90 opacity-0 group-hover:opacity-100" />;
      default:
        return null;
    }
  };

  const computeProjectStats = useCallback((items) => {
    return (items || []).reduce((acc, curr) => ({
      total: acc.total + 1,
      active: curr.status === 'active' ? acc.active + 1 : acc.active,
      value: acc.value + (curr.price || 0)
    }), { total: 0, active: 0, value: 0 });
  }, []);

  const fetchMemberRewards = useCallback(async () => {
    if (!memberId || !showReward) {
      setMemberRewards({});
      setTotalReward(0);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('project_members')
        .select('project_id, reward_percentage, reward_amount, reward_type, is_hourly, project:projects(id, price, budget_percentage, overhead_percentage, project_subcontractors(price))')
        .eq('member_id', memberId);

      if (error) throw error;

      const rewardsByProject = {};
      let rewardTotal = 0;

      (data || []).forEach((assignment) => {
        const hasReward = assignment.reward_type === 'fixed' || assignment.reward_type === 'percentage';
        const isHourly = !!assignment.is_hourly && !hasReward;
        let rewardAmount = 0;

        if (assignment.project && hasReward) {
          rewardAmount = calculateProjectMemberRewardFromProject(assignment);
        }

        if (hasReward || isHourly) {
          rewardsByProject[assignment.project_id] = {
            amount: rewardAmount,
            hasReward,
            isHourly,
          };
        }

        if (hasReward && rewardAmount > 0) {
          rewardTotal += rewardAmount;
        }
      });

      setMemberRewards(rewardsByProject);
      setTotalReward(rewardTotal);
    } catch (error) {
      console.error('Error fetching member rewards:', error);
      toast({ title: 'Chyba načítání odměn', description: error.message, variant: 'destructive' });
      setMemberRewards({});
      setTotalReward(0);
    }
  }, [memberId, showReward, toast]);

  const getRewardDisplay = useCallback((projectId) => {
    const reward = memberRewards[projectId];
    if (!reward) return null;
    if (reward.isHourly && !reward.hasReward) return 'Hodinová';
    if (reward.hasReward) return formatCurrency(reward.amount);
    return null;
  }, [memberRewards]);

  const updateProjectStatus = useCallback(async (projectId, nextStatus) => {
    if (updatingProjectId) return;
    setUpdatingProjectId(projectId);
    try {
      // Updated: Ensure we use 'id'
      const { error } = await supabase
        .from('projects')
        .update({ status: nextStatus })
        .eq('id', projectId);

      if (error) throw error;

      setProjects((prev) => {
        const nextProjects = prev.map((project) =>
          project.id === projectId ? { ...project, status: nextStatus } : project
        );
        setProjectStats(computeProjectStats(nextProjects));
        return nextProjects;
      });

      toast({
        title: 'Stav projektu aktualizován',
        description: projectStatusConfig[nextStatus]?.label || nextStatus,
      });
    } catch (error) {
      const msg = parseApiError(error);
      toast({ title: 'Chyba změny stavu', description: msg, variant: 'destructive' });
    } finally {
      setUpdatingProjectId(null);
    }
  }, [computeProjectStats, toast, updatingProjectId]);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('projects')
        .select('*, investor:investor_id(name), client:client_id(name)')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setProjects(data || []);
      setProjectStats(computeProjectStats(data || []));
    } catch (error) {
      console.error('Error fetching projects:', error);
      toast({ title: 'Chyba načítání projektů', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [computeProjectStats, toast]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  useEffect(() => {
    fetchMemberRewards();
  }, [fetchMemberRewards]);

  const filteredProjects = useMemo(() => {
    let result = [...projects];

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.code.toLowerCase().includes(q) ||
        p.investor?.name?.toLowerCase().includes(q)
      );
    }

    if (statusFilter !== 'all') {
      result = result.filter(p => p.status === statusFilter);
    }

    result.sort((a, b) => {
      let aVal = a[sortConfig.key];
      let bVal = b[sortConfig.key];

      if (aVal === null) aVal = '';
      if (bVal === null) bVal = '';

      if (typeof aVal === 'string') aVal = aVal.toLowerCase();
      if (typeof bVal === 'string') bVal = bVal.toLowerCase();

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [projects, searchQuery, statusFilter, sortConfig]);

  const handleSort = (key) => {
    setSortConfig(current => ({
      key,
      direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const renderStatusMenu = (project, triggerClassName) => {
    const label = projectStatusConfig[project.status]?.label || project.status;
    if (!canEdit) {
      return (
        <Badge
          className={cn("font-normal max-w-[160px] truncate text-xs", projectStatusConfig[project.status]?.color)}
          title={label}
        >
          {label}
        </Badge>
      );
    }

    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className={cn("h-7 px-2 gap-1", triggerClassName)}
            onClick={(event) => event.stopPropagation()}
            title={label}
          >
            <Badge
              className={cn("font-normal max-w-[160px] truncate text-xs", projectStatusConfig[project.status]?.color)}
              title={label}
            >
              {label}
            </Badge>
            {updatingProjectId === project.id ? (
              <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="w-3 h-3 text-muted-foreground" />
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {Object.entries(projectStatusConfig).map(([key, conf]) => (
            <DropdownMenuItem
              key={key}
              disabled={updatingProjectId === project.id || project.status === key}
              onClick={(event) => {
                event.stopPropagation();
                updateProjectStatus(project.id, key);
              }}
              title={conf.label}
            >
              <span className={cn("w-2 h-2 rounded-full mr-2", conf.color.split(' ')[0])} />
              {conf.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const handleDragStart = (event, projectId) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', projectId);
    setDraggingProjectId(projectId);
  };

  const handleDragEnd = () => {
    setDraggingProjectId(null);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Načítání projektů...</p>
      </div>
    );
  }

  return (
    <div className="app-page">
      <PageHeader
        icon={FolderPlus}
        title="Projekty"
        description="Správa projektové dokumentace a zakázek"
        actions={canEdit && (
          <>
            <Button onClick={() => setBatchDialogOpen(true)} variant="outline">
              <CopyPlus className="w-4 h-4 mr-2" />
              Dávka projektů
            </Button>
            <Button onClick={() => navigate('/projects/new')}>
              <FolderPlus className="w-4 h-4 mr-2" />
              Nový projekt
            </Button>
          </>
        )}
      />
      
      <BatchProjectDialog 
        open={batchDialogOpen} 
        onOpenChange={setBatchDialogOpen} 
        onProjectsCreated={fetchProjects} 
      />

      {/* Stats Cards and Filters omitted for brevity, but they are preserved from original file logic */}
      
      {!isPrivateMode && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Celkem projektů</p>
                <p className="text-2xl font-bold">{projectStats.total}</p>
              </div>
              <div className="p-3 bg-slate-100 rounded-full">
                <FolderPlus className="w-6 h-6 text-slate-600" />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-6 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Aktivní</p>
                <p className="text-2xl font-bold text-blue-600">{projectStats.active}</p>
              </div>
              <div className="p-3 bg-blue-50 rounded-full">
                <Activity className="w-6 h-6 text-blue-600" />
              </div>
            </CardContent>
          </Card>
          {showFinance && (
            <Card>
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Hodnota (Aktivní)</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(projectStats.value)}</p>
                </div>
                <div className="p-3 bg-green-50 rounded-full">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
              </CardContent>
            </Card>
          )}
          {showReward && (
            <Card>
              <CardContent className="p-6 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Moje odměna</p>
                  <p className="text-2xl font-bold text-green-600">{formatCurrency(totalReward)}</p>
                </div>
                <div className="p-3 bg-green-50 rounded-full">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Filters & Controls */}
      <div className="app-surface sticky top-0 z-10 flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2 flex-1 w-full md:w-auto">
          <div className="relative flex-1 md:max-w-sm">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Hledat projekt, investora..."
              className="pl-9"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <DropdownMenu open={filterOpen} onOpenChange={setFilterOpen}>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" className={statusFilter !== 'all' ? 'border-primary text-primary' : ''}>
                <SlidersHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Filtrovat stav</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={statusFilter === 'all'} onCheckedChange={() => setStatusFilter('all')}>
                Všechny
              </DropdownMenuCheckboxItem>
              {Object.entries(projectStatusConfig).map(([key, conf]) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={statusFilter === key}
                  onCheckedChange={() => setStatusFilter(key)}
                >
                  <span className={cn("w-2 h-2 rounded-full mr-2", conf.color.split(' ')[0].replace('bg-', 'bg-'))} />
                  {conf.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          {(searchQuery || statusFilter !== 'all') && (
            <Button variant="ghost" size="sm" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>
              <X className="w-4 h-4 mr-1" /> Reset
            </Button>
          )}
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <Select value={sortConfig.key} onValueChange={handleSort}>
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Řazení" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at">Nejnovejší</SelectItem>
              <SelectItem value="name">Název A-Z</SelectItem>
              <SelectItem value="code">Kód projektu</SelectItem>
              {showFinance && <SelectItem value="price">Cena</SelectItem>}
            </SelectContent>
          </Select>

          <div className="border rounded-lg p-1 flex items-center bg-slate-50">
            <Button
              variant={viewMode === 'grid' ? 'white' : 'ghost'}
              size="sm"
              className={cn("h-7 w-7 p-0 shadow-sm", viewMode === 'grid' && "bg-white")}
              onClick={() => setViewMode('grid')}
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'list' ? 'white' : 'ghost'}
              size="sm"
              className={cn("h-7 w-7 p-0 shadow-sm", viewMode === 'list' && "bg-white")}
              onClick={() => setViewMode('list')}
            >
              <ListIcon className="w-4 h-4" />
            </Button>
            <Button
              variant={viewMode === 'kanban' ? 'white' : 'ghost'}
              size="sm"
              className={cn("h-7 w-7 p-0 shadow-sm", viewMode === 'kanban' && "bg-white")}
              onClick={() => setViewMode('kanban')}
            >
              <Columns className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </div>

      {filteredProjects.length === 0 ? (
        <div className="text-center py-16 bg-slate-50 rounded-lg border border-dashed">
          <p className="text-muted-foreground">Nebyly nalezeny žádné projekty odpovídající filtrům.</p>
          <Button variant="link" onClick={() => { setSearchQuery(''); setStatusFilter('all'); }}>
            Vymazat filtry
          </Button>
        </div>
      ) : (
        <AnimatePresence mode='wait'>
          {viewMode === 'grid' ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredProjects.map((project) => {
                const rewardDisplay = getRewardDisplay(project.id);
                return (
                  <motion.div
                    key={project.id}
                    layout
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ProjectCard
                      project={project}
                      onClick={() => navigate(`/projects/${project.id}`)}
                      showFinance={showFinance}
                      showReward={showReward}
                      rewardDisplay={rewardDisplay}
                    />
                  </motion.div>
                );
              })}
            </div>
          ) : viewMode === 'list' ? (
            <div className="space-y-3">
              <div className="flex justify-end">
                <ManagedTableToolbar
                  columns={projectManagedTable.columns}
                  visibility={projectManagedTable.visibility}
                  onMoveColumn={projectManagedTable.moveColumn}
                  onToggleColumn={projectManagedTable.toggleColumn}
                  onReset={projectManagedTable.resetColumns}
                />
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    {projectVisibleColumns.map((column) => (
                      <TableHead key={column.id} className={projectHeadClasses[column.id]}>{column.label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredProjects.map((project) => (
                    <TableRow
                      key={project.id}
                      className="group cursor-pointer"
                      onClick={() => navigate(`/projects/${project.id}`)}
                    >
                      {projectVisibleColumns.map((column) => (
                        <TableCell key={column.id} className={projectCellClasses[column.id]} title={column.id === 'name' ? project.name : undefined}>
                          {renderProjectTableCell(project, column.id)}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {statusOrder.map((statusKey) => {
                const columnProjects = filteredProjects.filter((project) => project.status === statusKey);
                const statusConfig = projectStatusConfig[statusKey];
                return (
                  <Card
                    key={statusKey}
                    className={cn(
                      "bg-slate-50 border-dashed transition-colors",
                      dragOverStatusKey === statusKey && "border-primary bg-primary/5"
                    )}
                    onDragOver={(event) => {
                      if (!canEdit) return;
                      event.preventDefault();
                      if (dragOverStatusKey !== statusKey) {
                        setDragOverStatusKey(statusKey);
                      }
                    }}
                    onDrop={(event) => {
                      if (!canEdit) return;
                      event.preventDefault();
                      setDragOverStatusKey(null);
                      const projectId = event.dataTransfer.getData('text/plain');
                      if (!projectId) return;
                      const targetProject = projects.find((project) => project.id === projectId);
                      if (!targetProject || targetProject.status === statusKey) return;
                      updateProjectStatus(projectId, statusKey);
                    }}
                    onDragLeave={() => {
                      if (!canEdit) return;
                      setDragOverStatusKey((current) => (current === statusKey ? null : current));
                    }}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <Badge
                          className={cn("font-normal max-w-[160px] truncate text-xs", statusConfig?.color)}
                          title={statusConfig?.label || statusKey}
                        >
                          {statusConfig?.label || statusKey}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{columnProjects.length}</span>
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {columnProjects.length > 0 ? (
                        columnProjects.map((project) => {
                          const rewardDisplay = getRewardDisplay(project.id);
                          return (
                            <div
                              key={project.id}
                              className={cn(
                                "bg-white border rounded-lg p-3 hover:shadow-sm transition-shadow cursor-pointer min-w-0",
                                draggingProjectId === project.id && "opacity-60"
                              )}
                              onClick={() => navigate(`/projects/${project.id}`)}
                              draggable={canEdit}
                              onDragStart={(event) => {
                                if (!canEdit) return;
                                handleDragStart(event, project.id);
                              }}
                              onDragEnd={handleDragEnd}
                            >
                              <div className="flex items-start justify-between gap-2 min-w-0">
                                <div className="min-w-0">
                                  <div className="text-xs font-mono text-muted-foreground">{project.code}</div>
                                  <div className="font-medium line-clamp-2" title={project.name}>{project.name}</div>
                                </div>
                                <div className="shrink-0">
                                  {renderStatusMenu(project, "h-6 px-1")}
                                </div>
                              </div>
                              {project.investor?.name && (
                                <div className="text-xs text-muted-foreground truncate mt-1" title={project.investor.name}>
                                  {project.investor.name}
                                </div>
                              )}
                              {showFinance && project.price > 0 && (
                                <div className="text-xs font-semibold text-slate-700 mt-2">
                                  {formatCurrency(project.price)}
                                </div>
                              )}
                              {showReward && rewardDisplay && (
                                <div className="text-xs font-semibold text-slate-700 mt-2">
                                  {rewardDisplay}
                                </div>
                              )}
                            </div>
                          );
                        })
                      ) : (
                        <div className="text-xs text-muted-foreground">Žádné projekty</div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
};

const ProjectCard = ({ project, onClick, showFinance, showReward, rewardDisplay }) => {
  return (
    <Card className="cursor-pointer hover:shadow-md transition-all duration-200 group border-l-4" style={{ borderLeftColor: project.status === 'active' ? '#3b82f6' : 'transparent' }} onClick={onClick}>
      <CardHeader className="p-4 pb-2">
        <div className="flex justify-between items-start gap-2">
          <div>
            <p className="text-xs font-mono text-muted-foreground mb-1">{project.code}</p>
            <CardTitle className="text-base line-clamp-2 group-hover:text-primary transition-colors" title={project.name}>
              {project.name}
            </CardTitle>
          </div>
          <Badge
            className={cn("shrink-0 max-w-full truncate text-xs", projectStatusConfig[project.status]?.color)}
            title={projectStatusConfig[project.status]?.label || project.status}
          >
            {projectStatusConfig[project.status]?.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-2">
        <div className="space-y-2 text-sm text-slate-600">
          {project.investor?.name && (
            <div className="flex items-center gap-2">
              <BuildingIcon className="w-3.5 h-3.5 text-slate-400" />
              <span className="truncate">{project.investor.name}</span>
            </div>
          )}
          {showFinance && project.price > 0 && (
            <div className="flex items-center gap-2 font-medium text-slate-900 mt-3 pt-3 border-t">
              <DollarSign className="w-3.5 h-3.5 text-green-600" />
              <span>{formatCurrency(project.price)}</span>
            </div>
          )}
          {showReward && rewardDisplay && (
            <div className="flex items-center gap-2 font-medium text-slate-900 mt-3 pt-3 border-t">
              <DollarSign className="w-3.5 h-3.5 text-green-600" />
              <span>{rewardDisplay}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

export default Projects;
