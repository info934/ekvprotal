import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { History, ChevronLeft } from 'lucide-react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { getActivityStatusConfig } from '@/components/engineering/engineeringConfig';

const statusLabels = {
  nabidka: 'Nabídka',
  active: 'Aktivní',
  ready_for_delivery: 'Připraveno k dodání',
  delivered: 'Dodáno',
  closed: 'Uzavřeno'
};

const ProjectHistory = () => {
    const { projectId } = useParams();
    const { toast } = useToast();
    const [projectHistory, setProjectHistory] = useState([]);
    const [project, setProject] = useState(null);
    const [loading, setLoading] = useState(true);

    const fetchHistory = useCallback(async () => {
        setLoading(true);

        const { data: projectData, error: projectError } = await supabase
            .from('projects')
            .select('name')
            .eq('id', projectId)
            .single();

        if (projectError) {
            toast({ title: 'Chyba při načítání projektu', variant: 'destructive' });
            setLoading(false);
            return;
        }
        setProject(projectData);

        const { data: historyData, error: historyError } = await supabase
            .from('audit_logs')
            .select('*')
            .filter('details->>project_id', 'eq', projectId)
            .order('created_at', { ascending: false });

        if (historyError) {
            toast({ title: 'Chyba při načítání historie', variant: 'destructive' });
        } else {
            setProjectHistory(historyData);
        }
        setLoading(false);
    }, [projectId, toast]);

    useEffect(() => {
        fetchHistory();
    }, [fetchHistory]);

    const renderLogDetails = (log) => {
        switch (log.action) {
            case 'update_project_status':
                return `změnil stav projektu z "${statusLabels[log.details.old_status] || log.details.old_status}" na "${statusLabels[log.details.new_status] || log.details.new_status}"`;
            case 'update_task_status':
                return `změnil stav úkolu "${log.details.task_name}" z "${log.details.old_status}" na "${log.details.new_status}"`;
            case 'update_activity_status':
                return `změnil stav činnosti "${log.details.activity_subject}" z "${getActivityStatusConfig(log.details.old_status).label || log.details.old_status}" na "${getActivityStatusConfig(log.details.new_status).label || log.details.new_status}"`;
            default:
                return 'provedl neznámou akci';
        }
    };

    return (
        <div className="space-y-6">
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }}>
                <Link to={`/projects/${projectId}`} className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary mb-4">
                    <ChevronLeft className="w-4 h-4" />
                    Zpět na detail projektu
                </Link>
                <div className="flex items-center justify-between">
                    <div>
                        <h1 className="text-4xl font-bold gradient-text mb-1 flex items-center gap-3"><History /> Historie změn</h1>
                        <p className="text-muted-foreground">Projekt: {project?.name || 'Načítání...'}</p>
                    </div>
                </div>
            </motion.div>

            {loading ? (
                <div className="text-center py-12">Načítání historie...</div>
            ) : (
                <motion.div 
                    initial={{ opacity: 0 }} 
                    animate={{ opacity: 1 }}
                    className="glass-effect rounded-xl p-6"
                >
                    <div className="relative pl-8">
                        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-200"></div>
                        {projectHistory.length > 0 ? (
                            projectHistory.map(log => (
                                <div key={log.id} className="relative mb-8">
                                    <div className="absolute -left-10 -top-1.5 w-6 h-6 bg-white border-2 border-purple-500 rounded-full flex items-center justify-center">
                                        <div className="w-3 h-3 bg-purple-500 rounded-full"></div>
                                    </div>
                                    <p className="text-sm text-muted-foreground">{new Date(log.created_at).toLocaleString('cs-CZ')}</p>
                                    <p className="font-medium mt-1">
                                        <span className="font-bold text-purple-700">{log.user_email}</span> {renderLogDetails(log)}
                                    </p>
                                </div>
                            ))
                        ) : (
                            <p className="text-muted-foreground">Pro tento projekt neexistuje žádná historie změn.</p>
                        )}
                    </div>
                </motion.div>
            )}
        </div>
    );
};

export default ProjectHistory;
