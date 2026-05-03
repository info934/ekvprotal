import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Edit2, Trash2, LayoutGrid, List, Bell, Zap, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger, AlertDialogFooter } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import EngineeringDialog from '@/components/EngineeringDialog';
import EngineeringDetail from '@/components/EngineeringDetail';
import { logAction } from '@/lib/logger';
import { format, isPast, addDays } from 'date-fns';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useMemo } from 'react';
import { activityStatusConfig, getActivityStatusConfig } from '@/components/engineering/engineeringConfig';

const ProjectEngineering = ({ project: initialProject }) => {
    const { projectId } = useParams();
    const { toast } = useToast();
    const { hasPermission } = useAuth();
    const [project, setProject] = useState(initialProject);
    const [activities, setActivities] = useState([]);
    const [view, setView] = useState('kanban');
    const [editingActivity, setEditingActivity] = useState(null);
    const [selectedActivityForDetail, setSelectedActivityForDetail] = useState(null);
    const [isEngineeringDialogOpen, setIsEngineeringDialogOpen] = useState(false);
    const [isDetailOpen, setIsDetailOpen] = useState(false);
    
    const canEdit = useMemo(() => hasPermission('engineering', 'can_edit'), [hasPermission]);
    const canAdmin = useMemo(() => hasPermission('engineering', 'can_admin'), [hasPermission]);


    const fetchData = useCallback(async () => {
        if (!project) {
            const { data: projectData, error: projectError } = await supabase.from('projects').select('name, code').eq('id', projectId).single();
            if (projectError) {
                toast({ title: 'Chyba při načítání projektu', variant: 'destructive' });
            } else {
                setProject(projectData);
            }
        }

        const { data, error } = await supabase.from('engineering_activities').select('*, projects(name, code)').eq('project_id', projectId).order('created_at', { ascending: false });
        if (error) {
            toast({ title: "Chyba při načítání inženýrských činností.", variant: "destructive" });
        } else {
            setActivities(data);
        }
    }, [projectId, toast, project]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleSaveActivity = async (activityData) => {
        const dataToSave = { ...activityData, project_id: projectId };
        const originalActivity = editingActivity ? activities.find(a => a.id === editingActivity.id) : null;
        const originalStatus = originalActivity?.status;
        const newStatus = dataToSave.status;

        if (editingActivity) {
            const { error } = await supabase.from('engineering_activities').update(dataToSave).eq('id', editingActivity.id);
            if (error) { toast({ title: "Chyba při úpravě.", variant: "destructive", description: error.message }); }
            else {
                if (originalStatus !== newStatus) {
                    await logAction('update_activity_status', {
                        project_id: projectId,
                        project_name: project.name,
                        activity_subject: dataToSave.subject,
                        old_status: getActivityStatusConfig(originalStatus).label || originalStatus,
                        new_status: getActivityStatusConfig(newStatus).label || newStatus
                    });
                }
                toast({ title: "✅ Činnost upravena!" });
            }
        } else {
            const { error } = await supabase.from('engineering_activities').insert([dataToSave]);
            if (error) { toast({ title: "Chyba při vytváření.", variant: "destructive", description: error.message }); }
            else { toast({ title: "✅ Nová činnost vytvořena!" }); }
        }
        fetchData();
        setIsEngineeringDialogOpen(false);
        setEditingActivity(null);
    };

    const handleActivityDrop = async (activityId, newStatus) => {
        if (!canEdit) return;
        const activity = activities.find(a => a.id === activityId);
        if (!activity || activity.status === newStatus) return;

        const originalStatus = activity.status;
        const originalActivities = [...activities];
        const updatedActivities = activities.map(a => a.id === activityId ? { ...a, status: newStatus } : a);
        setActivities(updatedActivities);

        const { error } = await supabase.from('engineering_activities').update({ status: newStatus }).eq('id', activityId);

        if (error) {
            setActivities(originalActivities);
            toast({ title: 'Chyba při změně stavu činnosti', variant: 'destructive' });
        } else {
            await logAction('update_activity_status', {
                project_id: activity.project_id,
                project_name: project.name,
                activity_subject: activity.subject,
                old_status: getActivityStatusConfig(originalStatus).label || originalStatus,
                new_status: getActivityStatusConfig(newStatus).label || newStatus
            });
            toast({ title: `Činnost přesunuta do stavu "${getActivityStatusConfig(newStatus).label}"` });
        }
    };
    
    const handleDeleteActivity = async (id) => {
        if (!canAdmin) return;
        const { error } = await supabase.from('engineering_activities').delete().eq('id', id);
        if (error) { toast({ title: "Chyba při mazání.", variant: "destructive" }); }
        else { 
            toast({ title: "🗑️ Činnost smazána." }); 
            fetchData(); 
            setIsDetailOpen(false);
            setSelectedActivityForDetail(null);
        }
    };

    const handleUrgencyToggle = async (activity) => {
        if (!canEdit) return;
        const newUrgency = !activity.is_urgent;
        const { error } = await supabase.from('engineering_activities').update({ is_urgent: newUrgency }).eq('id', activity.id);
        if (error) {
            toast({ title: 'Chyba při změně urgence', variant: 'destructive' });
        } else {
            fetchData();
            if (selectedActivityForDetail && selectedActivityForDetail.id === activity.id) {
                setSelectedActivityForDetail({...activity, is_urgent: newUrgency });
            }
            toast({ title: newUrgency ? 'Činnost označena jako urgentní' : 'Urgence zrušena' });
            await logAction('urgency_toggled', {
                project_id: activity.project_id,
                project_name: project.name,
                activity_subject: activity.subject,
                is_urgent: newUrgency,
            });
        }
    };
    
    const openEditDialog = (activity) => {
        setEditingActivity(activity);
        setIsEngineeringDialogOpen(true);
    };

    const openDetailDialog = (activity) => {
        setSelectedActivityForDetail(activity);
        setIsDetailOpen(true);
    };

    const isOverdue = (activity) => {
        if (activity.status === 'done' || !activity.start_date || !activity.dny_na_vyjadreni) {
          return false;
        }
        const deadline = addDays(new Date(activity.start_date), activity.dny_na_vyjadreni);
        return isPast(deadline);
    };


    if (!project) return <div>Načítání...</div>;

    const ActivityCard = ({ activity }) => {
        const overdue = isOverdue(activity);
        return (
            <motion.div
                layoutId={`activity-${activity.id}`}
                draggable={canEdit}
                onDragStart={(e) => canEdit && e.dataTransfer.setData('activityId', activity.id)}
                onDoubleClick={() => openDetailDialog(activity)}
                className={cn(
                    "bg-white/80 border rounded-lg p-4 mb-4 cursor-grab active:cursor-grabbing relative",
                    overdue && "border-red-500",
                    activity.is_urgent && "border-yellow-500 border-2"
                )}
            >
                {overdue && (
                  <div className="absolute -top-2 -left-2 bg-red-500 text-white p-1 rounded-full animate-pulse" title="Po termínu">
                      <AlertTriangle className="w-4 h-4" />
                  </div>
                )}
                {activity.is_urgent && (
                  <div className="absolute -top-2 -right-2 bg-yellow-500 text-white p-1 rounded-full" title="Urgentní">
                      <Zap className="w-4 h-4" />
                  </div>
                )}
                <p className="font-semibold pr-6">{activity.subject}</p>
                {activity.end_date && <p className="text-xs text-muted-foreground">Termín: {format(new Date(activity.end_date), 'd.M.yyyy')}</p>}
                {canEdit && (
                    <div className="text-right -mb-2 -mr-2 mt-2">
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleUrgencyToggle(activity);}} title={activity.is_urgent ? "Zrušit urgenci" : "Označit jako urgentní"}>
                            <Bell className={cn("w-4 h-4", activity.is_urgent ? "text-yellow-600 fill-yellow-200" : "text-gray-400")} />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEditDialog(activity); }}><Edit2 className="w-4 h-4" /></Button>
                    </div>
                )}
            </motion.div>
        );
    };

    return (
        <div className="space-y-6 mt-6">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex items-center justify-between">
                    {canEdit && (
                        <Button onClick={() => openEditDialog(null)}>
                            <Plus className="w-4 h-4 mr-2" /> Nová činnost
                        </Button>
                    )}
                    <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg">
                        <Button variant={view === 'kanban' ? 'secondary' : 'ghost'} size="icon" onClick={() => setView('kanban')}><LayoutGrid className="w-5 h-5" /></Button>
                        <Button variant={view === 'table' ? 'secondary' : 'ghost'} size="icon" onClick={() => setView('table')}><List className="w-5 h-5" /></Button>
                    </div>
                </div>
            </motion.div>

            <div className="mt-6 space-y-4">
                {view === 'kanban' ? (
                     <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        {Object.entries(activityStatusConfig).map(([status, config]) => (
                            <div key={status} onDragOver={(e) => canEdit && e.preventDefault()} onDrop={(e) => canEdit && handleActivityDrop(e.dataTransfer.getData('activityId'), status)} className="bg-slate-50/50 rounded-xl flex flex-col">
                                <div className={`p-4 border-b-2 ${config.color.replace('text', 'border')}`}>
                                    <h2 className={`font-bold text-lg flex items-center gap-2 ${config.color}`}>
                                        <div className={`w-3 h-3 rounded-full ${config.color.replace('text', 'bg')}`}></div>
                                        {config.label}
                                        <span className="text-sm font-normal text-muted-foreground ml-auto bg-slate-200 rounded-full px-2 py-0.5">{activities.filter(a => a.status === status).length}</span>
                                    </h2>
                                </div>
                                <div className="p-4 overflow-y-auto flex-grow min-h-[200px]">
                                    {activities.filter(a => a.status === status).map(activity => (
                                        <ActivityCard key={activity.id} activity={activity} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="glass-effect rounded-xl p-4">
                         <Table>
                            <TableHeader><TableRow><TableHead>Předmět</TableHead><TableHead>Stav</TableHead><TableHead>Termín</TableHead><TableHead className="text-right">Akce</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {activities.map(activity => {
                                    const overdue = isOverdue(activity);
                                    return (
                                    <TableRow key={activity.id} onDoubleClick={() => openDetailDialog(activity)} className={cn("cursor-pointer", overdue && "bg-red-100/50", activity.is_urgent && "bg-yellow-100/50")}>
                                        <TableCell className="font-medium">{activity.subject}</TableCell>
                                        <TableCell>{(() => { const statusConfig = getActivityStatusConfig(activity.status); return <span className={`px-2 py-1 text-xs font-semibold rounded-full ${statusConfig.bg} ${statusConfig.color}`}>{statusConfig.label}</span>; })()}</TableCell>
                                        <TableCell>{activity.end_date ? format(new Date(activity.end_date), 'd.M.yyyy') : '-'}</TableCell>
                                        <TableCell className="text-right">
                                            {overdue && (
                                                <div className="inline-flex items-center gap-1 text-red-600 mr-2" title="Po termínu">
                                                    <AlertTriangle className="w-4 h-4" />
                                                </div>
                                            )}
                                            {canEdit && (
                                                <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); handleUrgencyToggle(activity); }} title={activity.is_urgent ? "Zrušit urgenci" : "Označit jako urgentní"}>
                                                    <Bell className={cn("w-4 h-4", activity.is_urgent ? "text-yellow-600 fill-yellow-200" : "text-gray-400")} />
                                                </Button>
                                            )}
                                            {canEdit && <Button variant="ghost" size="icon" onClick={(e) => { e.stopPropagation(); openEditDialog(activity); }}><Edit2 className="w-4 h-4" /></Button>}
                                            {canAdmin && (
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild><Button variant="ghost" size="icon" onClick={e => e.stopPropagation()}><Trash2 className="w-4 h-4 text-red-500" /></Button></AlertDialogTrigger>
                                                    <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Smazat činnost?</AlertDialogTitle></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Zrušit</AlertDialogCancel><AlertDialogAction onClick={() => handleDeleteActivity(activity.id)} className="bg-red-600">Smazat</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
                                                </AlertDialog>
                                            )}
                                        </TableCell>
                                    </TableRow>
                                )})}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>
            <EngineeringDialog isOpen={isEngineeringDialogOpen} onClose={() => { setIsEngineeringDialogOpen(false); setEditingActivity(null); }} onSave={handleSaveActivity} activity={editingActivity} projectId={projectId}/>
            
            <EngineeringDetail
                isOpen={isDetailOpen}
                onClose={() => { setIsDetailOpen(false); setSelectedActivityForDetail(null); }}
                activity={selectedActivityForDetail}
                onEdit={(act) => { setIsDetailOpen(false); openEditDialog(act); }}
                onDelete={handleDeleteActivity}
                onToggleUrgency={handleUrgencyToggle}
                onStatusChange={fetchData}
            />
        </div>
    );
};

export default ProjectEngineering;
