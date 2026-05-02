import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ClipboardList, Plus, Edit2, Trash2, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import TaskDialog from '@/components/TaskDialog';
import { format, parseISO } from 'date-fns';
import { useAuth } from '@/contexts/SupabaseAuthContext';

const taskStatusConfig = {
  'Nové': { label: 'Nové', color: 'text-blue-700', bg: 'bg-blue-100', dot: 'bg-blue-500' },
  'V řešení': { label: 'V řešení', color: 'text-orange-700', bg: 'bg-orange-100', dot: 'bg-orange-500' },
  'Hotovo': { label: 'Hotovo', color: 'text-green-700', bg: 'bg-green-100', dot: 'bg-green-500' },
};

const ProjectTasks = ({ project }) => {
    const { projectId } = useParams();
    const { toast } = useToast();
    const { hasPermission } = useAuth();
    const [tasks, setTasks] = useState([]);
    const [view, setView] = useState('kanban');
    const [editingTask, setEditingTask] = useState(null);
    const [isTaskDialogOpen, setIsTaskDialogOpen] = useState(false);

    const canEdit = useMemo(() => hasPermission('projects', 'can_edit'), [hasPermission]);

    const fetchData = useCallback(async () => {
        const { data, error } = await supabase.from('project_tasks').select('*, member:members!project_tasks_member_id_fkey(name)').eq('project_id', projectId).order('end_date', { ascending: true });
        if (error) {
            toast({ title: "Chyba při načítání úkolů.", variant: "destructive" });
        } else {
            setTasks(data);
        }
    }, [projectId, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSaveTask = async (taskData) => {
        const dataToSave = { ...taskData, project_id: projectId };
        
        if (editingTask) {
            const { error } = await supabase.from('project_tasks').update(dataToSave).eq('id', editingTask.id);
            if (error) { toast({ title: "Chyba při úpravě úkolu.", variant: "destructive" }); }
            else { toast({ title: "✅ Úkol upraven!" }); }
        } else {
            const { error } = await supabase.from('project_tasks').insert([dataToSave]);
            if (error) { toast({ title: "Chyba při vytváření úkolu.", variant: "destructive" }); }
            else { toast({ title: "✅ Nový úkol vytvořen!" }); }
        }
        fetchData();
        setIsTaskDialogOpen(false);
        setEditingTask(null);
    };

    const handleTaskDrop = async (task, newStatus) => {
        if (task.status !== newStatus) {
            const originalTasks = [...tasks];
            const updatedTasks = tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t);
            setTasks(updatedTasks);

            const { error } = await supabase.from('project_tasks').update({ status: newStatus }).eq('id', task.id);
            if (error) {
                setTasks(originalTasks);
                toast({ title: 'Chyba při změně stavu úkolu', variant: 'destructive' });
            } else {
                toast({ title: `Úkol přesunut do stavu "${taskStatusConfig[newStatus].label}"` });
            }
        }
    };
    
    const handleDeleteTask = async (id) => {
        const { error } = await supabase.from('project_tasks').delete().eq('id', id);
        if (error) { toast({ title: "Chyba při mazání úkolu.", variant: "destructive" }); }
        else { toast({ title: "🗑️ Úkol smazán." }); fetchData(); }
    };

    if (!project) return <div>Načítání...</div>;

    return (
        <div className="space-y-6">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-center justify-between">
                    <h3 className="text-xl font-bold flex items-center gap-3">
                        <ClipboardList className="w-6 h-6 gradient-text" />
                        Úkoly projektu
                    </h3>
                    <div className="flex items-center gap-2">
                        {canEdit && (
                            <Button onClick={() => { setEditingTask(null); setIsTaskDialogOpen(true); }}>
                                <Plus className="w-4 h-4 mr-2" /> Nový úkol
                            </Button>
                        )}
                        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                            <Button variant={view === 'kanban' ? 'secondary' : 'ghost'} size="icon" onClick={() => setView('kanban')}><LayoutGrid className="w-5 h-5" /></Button>
                            <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="icon" onClick={() => setView('table')}><List className="w-5 h-5" /></Button>
                        </div>
                    </div>
                </div>
            </motion.div>

            <div className="mt-6 space-y-4">
                {view === 'kanban' ? (
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {Object.entries(taskStatusConfig).map(([status, config]) => (
                            <div key={status} onDragOver={(e) => e.preventDefault()} onDrop={(e) => handleTaskDrop(JSON.parse(e.dataTransfer.getData('task')), status)} className="bg-slate-50/50 rounded-xl flex flex-col">
                                <div className={`p-4 border-b-2 ${config.color.replace('text', 'border')}`}>
                                    <h2 className={`font-bold text-lg flex items-center gap-2 ${config.color}`}>
                                        <div className={`w-3 h-3 rounded-full ${config.dot}`}></div>
                                        {config.label}
                                        <span className="text-sm font-normal text-muted-foreground ml-auto bg-slate-200 rounded-full px-2 py-0.5">{tasks.filter(t => t.status === status).length}</span>
                                    </h2>
                                </div>
                                <div className="p-4 overflow-y-auto flex-grow min-h-[200px] space-y-4">
                                    {tasks.filter(t => t.status === status).map(task => (
                                        <motion.div key={task.id} layout layoutId={`task-${task.id}`} draggable={canEdit} onDragStart={(e) => e.dataTransfer.setData('task', JSON.stringify(task))} className="bg-white/80 border rounded-lg p-4 cursor-grab active:cursor-grabbing">
                                            <p className="font-semibold">{task.name}</p>
                                            <p className="text-sm text-muted-foreground">{task.member?.name || 'Nepřiřazeno'}</p>
                                            <p className="text-xs text-muted-foreground">Termín: {format(parseISO(task.end_date), 'd.M.yyyy')}</p>
                                            {canEdit && (
                                                <div className="text-right -mb-2 -mr-2 mt-2">
                                                    <Button variant="ghost" size="icon" onClick={() => {setEditingTask(task); setIsTaskDialogOpen(true);}}><Edit2 className="w-4 h-4" /></Button>
                                                </div>
                                            )}
                                        </motion.div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="glass-effect rounded-xl p-4">
                         <Table>
                            <TableHeader><TableRow><TableHead>Úkol</TableHead><TableHead>Řešitel</TableHead><TableHead>Termín</TableHead><TableHead>Stav</TableHead><TableHead className="text-right">Akce</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {tasks.map(task => (
                                    <TableRow key={task.id}>
                                        <TableCell className="font-medium">{task.name}</TableCell>
                                        <TableCell>{task.member?.name || 'N/A'}</TableCell>
                                        <TableCell>{format(parseISO(task.end_date), 'd.M.yyyy')}</TableCell>
                                        <TableCell><span className={`px-2 py-1 text-xs font-semibold rounded-full ${taskStatusConfig[task.status].bg} ${taskStatusConfig[task.status].color}`}>{task.status}</span></TableCell>
                                        <TableCell className="text-right">
                                            {canEdit && (
                                                <>
                                                    <Button variant="ghost" size="icon" onClick={() => {setEditingTask(task); setIsTaskDialogOpen(true);}}><Edit2 className="w-4 h-4" /></Button>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild><Button variant="ghost" size="icon"><Trash2 className="w-4 h-4 text-red-500" /></Button></AlertDialogTrigger>
                                                        <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Smazat úkol?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Zrušit</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteTask(task.id)} className="bg-red-600">Smazat</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                                    </AlertDialog>
                                                </>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
            {canEdit && <TaskDialog isOpen={isTaskDialogOpen} onClose={() => { setIsTaskDialogOpen(false); setEditingTask(null); }} onSave={handleSaveTask} task={editingTask} projectId={projectId}/>}
        </div>
    );
};

export default ProjectTasks;