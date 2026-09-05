import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { ClipboardList, Plus, Edit2, Trash2, LayoutGrid, List, Search, Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import TaskDialog from '@/components/TaskDialog';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogContent, FormDialogHeader, FormDialogBody, FormDialogFooter } from '@/components/ui/form-dialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { cn } from '@/lib/utils';
import { formatProjectDate, loadProjectTasks, projectTaskIsOverdue, projectTaskStatus, projectTaskStatuses, resolveProjectTaskDrop } from '@/lib/projectDetailWorkspace';

const taskStatusConfig = {
    'Nové': { color: 'text-blue-700', bg: 'bg-blue-50', dot: 'bg-blue-500' },
    'V řešení': { color: 'text-amber-800', bg: 'bg-amber-50', dot: 'bg-amber-500' },
    'Blokováno': { color: 'text-red-800', bg: 'bg-red-50', dot: 'bg-red-500' },
    'Hotovo': { color: 'text-emerald-700', bg: 'bg-emerald-50', dot: 'bg-emerald-500' },
    'Zrušeno': { color: 'text-slate-600', bg: 'bg-slate-100', dot: 'bg-slate-400' },
};
const fallbackStatus = { color: 'text-slate-700', bg: 'bg-slate-100', dot: 'bg-slate-500' };
const taskFields = '*, member:members(name)';

const ProjectTasks = ({ project, projectId: projectIdProp, tasks: initialTasks = [], onTaskUpdate, canEdit: canEditOverride, loadError, onRetry }) => {
    const { projectId: routeProjectId } = useParams();
    const projectId = projectIdProp || routeProjectId;
    const location = useLocation();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { hasPermission, user } = useAuth();
    const [tasks, setTasks] = useState(initialTasks);
    const [view, setView] = useState('table');
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [editingTask, setEditingTask] = useState(null);
    const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);
    const [taskToDelete, setTaskToDelete] = useState(null);
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [refreshError, setRefreshError] = useState(null);
    const mutationLock = useRef(false);
    const requestRef = useRef(null);
    const scope = `${user?.id || ''}:${projectId}`;
    const currentScope = useRef(scope); currentScope.current = scope;
    const canEdit = canEditOverride ?? hasPermission('projects', 'can_edit');
    const error = loadError || refreshError;

    useEffect(() => { setTasks(initialTasks); }, [initialTasks]);
    useEffect(() => {
        setSearch(''); setStatusFilter('all'); setEditingTask(null); setTaskToDelete(null); setIsTaskDialogOpen(false); setRefreshError(null);
        return () => requestRef.current?.abort();
    }, [scope]);

    const fetchData = useCallback(async () => {
        requestRef.current?.abort();
        const controller = new AbortController(); requestRef.current = controller;
        setRefreshing(true); setRefreshError(null);
        try {
            const rows = await loadProjectTasks(supabase, projectId, controller.signal);
            if (!controller.signal.aborted && currentScope.current === scope) { setTasks(rows); onTaskUpdate?.(rows); }
        } catch (failure) {
            if (!controller.signal.aborted && currentScope.current === scope) setRefreshError(failure.message);
        } finally { if (!controller.signal.aborted && currentScope.current === scope) setRefreshing(false); }
    }, [projectId, scope, onTaskUpdate]);

    const handleSaveTask = async taskData => {
        if (!canEdit || mutationLock.current || error) return;
        if (editingTask && !tasks.some(task => task.id === editingTask.id && task.project_id === projectId)) return;
        mutationLock.current = true; setSaving(true);
        try {
            const dataToSave = { ...taskData, project_id: projectId };
            const query = editingTask ? supabase.from('project_tasks').update(dataToSave).eq('id', editingTask.id).eq('project_id', projectId) : supabase.from('project_tasks').insert(dataToSave);
            const { data, error: failure } = await query.select(taskFields).single();
            if (failure) throw failure;
            if (!data?.id) throw new Error('Uložení úkolu se nepodařilo potvrdit.');
            if (currentScope.current !== scope) return;
            toast({ title: editingTask ? 'Úkol upraven' : 'Úkol vytvořen' });
            const rows = editingTask ? tasks.map(task => task.id === data.id ? data : task) : [...tasks, data];
            setTasks(rows); onTaskUpdate?.(rows); setIsTaskDialogOpen(false); setEditingTask(null);
            await fetchData();
        } catch (failure) { if (currentScope.current === scope) toast({ title: 'Úkol se nepodařilo uložit', description: failure.message, variant: 'destructive' }); }
        finally { mutationLock.current = false; setSaving(false); }
    };

    const handleTaskStatus = async (task, newStatus) => {
        if (!canEdit || mutationLock.current || error || !task || task.project_id !== projectId || !tasks.some(row => row.id === task.id) || !projectTaskStatuses(tasks).includes(newStatus) || task.status === newStatus) return;
        mutationLock.current = true; setSaving(true);
        try {
            const { data, error: failure } = await supabase.from('project_tasks').update({ status: newStatus }).eq('id', task.id).eq('project_id', projectId).select(taskFields).single();
            if (failure) throw failure;
            if (!data?.id) throw new Error('Změnu stavu se nepodařilo potvrdit.');
            if (currentScope.current !== scope) return;
            const rows = tasks.map(row => row.id === task.id ? data : row);
            setTasks(rows); onTaskUpdate?.(rows);
            toast({ title: `Stav úkolu: ${projectTaskStatus(data)}` });
        } catch (failure) { if (currentScope.current === scope) toast({ title: 'Stav úkolu se nepodařilo změnit', description: failure.message, variant: 'destructive' }); }
        finally { mutationLock.current = false; setSaving(false); }
    };

    const handleDeleteTask = async event => {
        event.preventDefault();
        if (!canEdit || mutationLock.current || error || !taskToDelete || taskToDelete.project_id !== projectId) return;
        mutationLock.current = true; setSaving(true);
        try {
            const { data, error: failure } = await supabase.from('project_tasks').delete().eq('id', taskToDelete.id).eq('project_id', projectId).select('id').single();
            if (failure) throw failure;
            if (!data?.id) throw new Error('Smazání úkolu se nepodařilo potvrdit.');
            if (currentScope.current !== scope) return;
            const rows = tasks.filter(task => task.id !== taskToDelete.id);
            setTasks(rows); onTaskUpdate?.(rows); setTaskToDelete(null); toast({ title: 'Úkol smazán' });
        } catch (failure) { if (currentScope.current === scope) toast({ title: 'Úkol se nepodařilo smazat', description: failure.message, variant: 'destructive' }); }
        finally { mutationLock.current = false; setSaving(false); }
    };

    const statuses = useMemo(() => projectTaskStatuses(tasks), [tasks]);
    const shownTasks = useMemo(() => tasks.filter(task => (statusFilter === 'all' || projectTaskStatus(task) === statusFilter) && [task.name, task.member?.name, task.description].some(value => String(value || '').toLocaleLowerCase('cs-CZ').includes(search.trim().toLocaleLowerCase('cs-CZ')))), [tasks, search, statusFilter]);
    const requestedTaskId = new URLSearchParams(location.search).get('task');
    const inspectedTask = tasks.find(task => task.id === requestedTaskId && task.project_id === projectId);
    const inspectTask = task => {
        const params = new URLSearchParams(location.search);
        if (task) params.set('task', task.id); else params.delete('task');
        navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true, state: location.state });
    };
    const openEdit = task => { setEditingTask(task); setIsTaskDialogOpen(true); };
    const taskStateControl = task => {
        const status = projectTaskStatus(task); const config = taskStatusConfig[status] || fallbackStatus;
        return canEdit ? <select aria-label={`Stav úkolu ${task.name}`} value={status} disabled={saving || !!error} onChange={event => handleTaskStatus(task, event.target.value)} className={cn('min-h-11 w-full min-w-[130px] rounded-md border px-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', config.bg, config.color)}>{statuses.map(value => <option key={value} value={value}>{value}</option>)}</select> : <span className={cn('inline-flex rounded-md px-2 py-1 text-xs font-medium', config.bg, config.color)}>{status}</span>;
    };
    const taskActions = task => canEdit ? <div className="flex justify-end"><Button variant="ghost" size="icon" disabled={saving || !!error} aria-label={`Upravit úkol ${task.name}`} onClick={() => openEdit(task)}><Edit2 className="h-4 w-4" /></Button><Button variant="ghost" size="icon" disabled={saving || !!error} aria-label={`Smazat úkol ${task.name}`} onClick={() => setTaskToDelete(task)}><Trash2 className="h-4 w-4 text-red-600" /></Button></div> : null;

    if (!project) return <div role="status">Načítám projekt…</div>;
    return <div className="space-y-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-semibold">Úkoly projektu</h2><p className="mt-1 text-sm text-muted-foreground">Řešitel, termín a stav každého úkolu na jednom místě.</p></div><div className="flex flex-wrap gap-2">{canEdit && <Button disabled={saving || !!error} onClick={() => openEdit(null)}><Plus className="mr-2 h-4 w-4" />Nový úkol</Button>}</div></div>
        <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-white p-3">
            <div className="relative min-w-[180px] flex-1"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={event => setSearch(event.target.value)} placeholder="Hledat úkol nebo řešitele…" aria-label="Hledat v úkolech projektu" /></div>
            <select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} aria-label="Filtrovat stav úkolů" className="min-h-11 min-w-40 rounded-md border bg-white px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"><option value="all">Všechny stavy</option>{statuses.map(status => <option key={status} value={status}>{status}</option>)}</select>
            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Zobrazení úkolů"><Button variant={view === 'table' ? 'secondary' : 'ghost'} size="icon" aria-label="Zobrazit tabulku úkolů" aria-pressed={view === 'table'} onClick={() => setView('table')}><List className="h-4 w-4" /></Button><Button variant={view === 'kanban' ? 'secondary' : 'ghost'} size="icon" aria-label="Zobrazit nástěnku úkolů" aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}><LayoutGrid className="h-4 w-4" /></Button></div>
        </div>
        {error && <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm"><p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Úkoly nemusí být kompletní</p><p className="mt-1">Obnovte seznam před dalšími změnami.</p><Button variant="outline" className="mt-3" disabled={refreshing} onClick={() => loadError && onRetry ? onRetry() : fetchData()}>Zkusit znovu</Button></div>}
        {refreshing && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Obnovuji seznam…</p>}
        <p className="text-xs text-muted-foreground">{error ? 'Počet úkolů není dostupný' : `Zobrazeno ${shownTasks.length} z ${tasks.length} úkolů`}</p>
        {!shownTasks.length ? <div className="rounded-xl border border-dashed p-8 text-center"><ClipboardList className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><h3 className="font-semibold">{error ? 'Seznam není dostupný' : tasks.length ? 'Žádný úkol neodpovídá filtrům' : 'Projekt zatím nemá úkoly'}</h3>{tasks.length > 0 && <Button variant="outline" className="mt-3" onClick={() => { setSearch(''); setStatusFilter('all'); }}>Zrušit filtry</Button>}</div> : view === 'table' ? <>
            <div className="space-y-3 md:hidden">{shownTasks.map(task => <div key={task.id} className="rounded-xl border bg-white p-4"><h3><button type="button" className="break-words text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => inspectTask(task)}>{task.name}</button></h3><p className="mt-1 text-sm text-muted-foreground">{task.member?.name || 'Řešitel nepřiřazen'}</p><p className={cn('mt-2 text-sm', projectTaskIsOverdue(task) ? 'font-medium text-amber-700' : 'text-muted-foreground')}>{formatProjectDate(task.end_date)}{projectTaskIsOverdue(task) ? ' · Po termínu' : ''}</p><div className="mt-3 flex items-center justify-between gap-2"><div className="min-w-0 flex-1">{taskStateControl(task)}</div>{taskActions(task)}</div></div>)}</div>
            <div className="hidden overflow-hidden rounded-xl border bg-white md:block"><Table><TableHeader><TableRow><TableHead>Úkol</TableHead><TableHead>Řešitel</TableHead><TableHead>Termín</TableHead><TableHead>Stav</TableHead>{canEdit && <TableHead className="text-right">Akce</TableHead>}</TableRow></TableHeader><TableBody>{shownTasks.map(task => <TableRow key={task.id}><TableCell className="min-w-[180px] max-w-[420px] whitespace-normal font-medium"><button type="button" className="min-h-11 text-left text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => inspectTask(task)}>{task.name}</button></TableCell><TableCell>{task.member?.name || 'Nepřiřazen'}</TableCell><TableCell className={projectTaskIsOverdue(task) ? 'text-amber-700' : ''}>{formatProjectDate(task.end_date)}{projectTaskIsOverdue(task) && <span className="mt-1 block text-xs">Po termínu</span>}</TableCell><TableCell className="w-44">{taskStateControl(task)}</TableCell>{canEdit && <TableCell>{taskActions(task)}</TableCell>}</TableRow>)}</TableBody></Table></div>
        </> : <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">{(statusFilter === 'all' ? statuses : [statusFilter]).map(status => {
            const config = taskStatusConfig[status] || fallbackStatus; const rows = shownTasks.filter(task => projectTaskStatus(task) === status);
            return <section key={status} aria-label={`Úkoly: ${status}`} className="min-w-0 rounded-xl border bg-slate-50" onDragOver={event => { if (canEdit && !saving && !error) event.preventDefault(); }} onDrop={event => { event.preventDefault(); const task = resolveProjectTaskDrop(event.dataTransfer.getData('task'), tasks, projectId, canEdit); if (task) handleTaskStatus(task, status); }}>
                <h3 className="flex items-center gap-2 border-b p-4 text-sm font-semibold"><span className={cn('h-2 w-2 rounded-full', config.dot)} />{status}<span className="ml-auto text-muted-foreground">{rows.length}</span></h3>
                <div className="space-y-3 p-3">{rows.map(task => <article key={task.id} draggable={canEdit && !saving && !error} onDragStart={event => event.dataTransfer.setData('task', JSON.stringify({ id: task.id }))} className="rounded-lg border bg-white p-3"><h4><button type="button" className="break-words text-left font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" onClick={() => inspectTask(task)}>{task.name}</button></h4><p className="mt-1 text-xs text-muted-foreground">{task.member?.name || 'Řešitel nepřiřazen'}</p><p className={cn('mt-2 text-xs', projectTaskIsOverdue(task) ? 'font-medium text-amber-700' : 'text-muted-foreground')}>{formatProjectDate(task.end_date)}{projectTaskIsOverdue(task) ? ' · Po termínu' : ''}</p><div className="mt-3">{canEdit && taskStateControl(task)}</div>{taskActions(task)}</article>)}{!rows.length && <p className="py-4 text-center text-xs text-muted-foreground">Bez úkolů</p>}</div>
            </section>;
        })}</div>}
        <Dialog open={!!requestedTaskId} onOpenChange={open => { if (!open) inspectTask(null); }}><FormDialogContent><FormDialogHeader icon={ClipboardList} title="Detail úkolu" description={project.name} /><FormDialogBody>
            {inspectedTask ? <div className="space-y-5"><h3 className="break-words text-lg font-semibold">{inspectedTask.name}</h3><dl className="grid gap-4 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Řešitel</dt><dd className="mt-1 text-sm font-medium">{inspectedTask.member?.name || 'Nepřiřazen'}</dd></div><div><dt className="text-xs text-muted-foreground">Stav</dt><dd className="mt-1 text-sm font-medium">{projectTaskStatus(inspectedTask)}</dd></div><div><dt className="text-xs text-muted-foreground">Začátek</dt><dd className="mt-1 text-sm font-medium">{formatProjectDate(inspectedTask.start_date)}</dd></div><div><dt className="text-xs text-muted-foreground">Termín dokončení</dt><dd className={cn('mt-1 text-sm font-medium', projectTaskIsOverdue(inspectedTask) && 'text-amber-700')}>{formatProjectDate(inspectedTask.end_date)}{projectTaskIsOverdue(inspectedTask) ? ' · Po termínu' : ''}</dd></div></dl><div><h4 className="text-sm font-medium">Zadání</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm text-muted-foreground">{inspectedTask.description || 'Popis úkolu není doplněn.'}</p></div></div> : <p className="text-sm text-muted-foreground">{error ? 'Úkol se nepodařilo načíst.' : 'Úkol není dostupný v tomto projektu. Mohl být odstraněn nebo přesunut.'}</p>}
        </FormDialogBody><FormDialogFooter><Button variant="outline" onClick={() => inspectTask(null)}>Zavřít</Button>{canEdit && inspectedTask && <Button disabled={saving || !!error} onClick={() => { inspectTask(null); openEdit(inspectedTask); }}><Edit2 className="mr-2 h-4 w-4" />Upravit úkol</Button>}</FormDialogFooter></FormDialogContent></Dialog>
        {canEdit && <TaskDialog isOpen={isTaskDialogOpen} onClose={() => { if (!saving) { setIsTaskDialogOpen(false); setEditingTask(null); } }} onSave={handleSaveTask} task={editingTask} projectId={projectId} />}
        <AlertDialog open={!!taskToDelete} onOpenChange={open => { if (!open && !saving) setTaskToDelete(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Smazat úkol?</AlertDialogTitle><AlertDialogDescription>Úkol „{taskToDelete?.name}“ bude odstraněn z projektu.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={saving}>Zrušit</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={handleDeleteTask} className="bg-destructive hover:bg-destructive/90">{saving ? 'Mažu…' : 'Smazat úkol'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    </div>;
};
export default ProjectTasks;
