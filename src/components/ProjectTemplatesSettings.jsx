import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Edit2, Trash2, Eye, Copy, FileText } from 'lucide-react';
import ProjectTemplateEditModal from './ProjectTemplateEditModal';
import ProjectTemplatePreviewModal from './ProjectTemplatePreviewModal';

const ProjectTemplatesSettings = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState(null);
    
    const [isPreviewModalOpen, setIsPreviewModalOpen] = useState(false);
    const [previewTemplate, setPreviewTemplate] = useState(null);

    const [templateToDelete, setTemplateToDelete] = useState(null);
    const [isProcessing, setIsProcessing] = useState(false);

    const fetchTemplates = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            const { data, error } = await supabase
                .from('project_templates_custom')
                .select('*')
                .eq('user_id', user.id)
                .order('created_at', { ascending: false });

            if (error) throw error;
            setTemplates(data || []);
        } catch (error) {
            console.error('Error fetching templates:', error);
            toast({ title: 'Chyba načítání šablon', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);

    useEffect(() => {
        fetchTemplates();
    }, [fetchTemplates]);

    const handleDelete = async () => {
        if (!templateToDelete) return;
        setIsProcessing(true);
        try {
            const { error } = await supabase
                .from('project_templates_custom')
                .delete()
                .eq('id', templateToDelete.id);

            if (error) throw error;
            
            toast({ title: 'Šablona smazána', variant: 'default' });
            setTemplateToDelete(null);
            fetchTemplates();
        } catch (error) {
            toast({ title: 'Chyba při mazání', description: error.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDuplicate = async (template) => {
        setIsProcessing(true);
        try {
            const newTemplate = {
                user_id: user.id,
                name: `${template.name} (Kopie)`,
                description: template.description,
                tasks_data: template.tasks_data,
                phases_data: template.phases_data,
                milestones_data: template.milestones_data
            };

            const { error } = await supabase
                .from('project_templates_custom')
                .insert([newTemplate]);

            if (error) throw error;
            
            toast({ title: 'Šablona úspěšně duplikována', variant: 'default' });
            fetchTemplates();
        } catch (error) {
            toast({ title: 'Chyba při duplikaci', description: error.message, variant: 'destructive' });
        } finally {
            setIsProcessing(false);
        }
    };

    const openEditModal = (template) => {
        setEditingTemplate(template);
        setIsEditModalOpen(true);
    };

    const openPreviewModal = (template) => {
        setPreviewTemplate(template);
        setIsPreviewModalOpen(true);
    };

    if (loading) {
        return (
            <div className="flex justify-center items-center h-64 text-muted-foreground">
                <Loader2 className="w-8 h-8 animate-spin mr-2" />
                Načítání šablon...
            </div>
        );
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold tracking-tight">Šablony projektů</h2>
                    <p className="text-muted-foreground">Spravujte své uložené šablony pro rychlé vytváření projektů.</p>
                </div>
            </div>

            <div className="bg-white rounded-lg border shadow-sm">
                {templates.length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center">
                        <FileText className="w-12 h-12 text-slate-300 mb-4" />
                        <h3 className="text-lg font-medium text-slate-900 mb-1">Žádné šablony</h3>
                        <p className="text-slate-500 mb-4">Zatím nemáte vytvořené žádné vlastní šablony projektů.</p>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Název</TableHead>
                                <TableHead>Popis</TableHead>
                                <TableHead>Vytvořeno</TableHead>
                                <TableHead className="text-center">Počet úkolů</TableHead>
                                <TableHead className="text-center">Počet fází</TableHead>
                                <TableHead className="text-center">Počet milníků</TableHead>
                                <TableHead className="text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {templates.map((template) => (
                                <TableRow key={template.id}>
                                    <TableCell className="font-medium text-slate-900">{template.name}</TableCell>
                                    <TableCell className="text-slate-500 max-w-[200px] truncate">
                                        {template.description || <span className="italic text-slate-400">Bez popisu</span>}
                                    </TableCell>
                                    <TableCell className="text-slate-500 whitespace-nowrap">
                                        {format(new Date(template.created_at), 'dd.MM.yyyy')}
                                    </TableCell>
                                    <TableCell className="text-center font-medium">
                                        {Array.isArray(template.tasks_data) ? template.tasks_data.length : 0}
                                    </TableCell>
                                    <TableCell className="text-center font-medium">
                                        {Array.isArray(template.phases_data) ? template.phases_data.length : 0}
                                    </TableCell>
                                    <TableCell className="text-center font-medium">
                                        {Array.isArray(template.milestones_data) ? template.milestones_data.length : 0}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => openPreviewModal(template)} title="Náhled" disabled={isProcessing}>
                                                <Eye className="w-4 h-4 text-slate-500" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleDuplicate(template)} title="Duplikovat" disabled={isProcessing}>
                                                <Copy className="w-4 h-4 text-green-600" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => openEditModal(template)} title="Upravit" disabled={isProcessing}>
                                                <Edit2 className="w-4 h-4 text-blue-500" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => setTemplateToDelete(template)} title="Smazat" disabled={isProcessing}>
                                                <Trash2 className="w-4 h-4 text-red-500" />
                                            </Button>
                                        </div>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                )}
            </div>

            <ProjectTemplateEditModal 
                isOpen={isEditModalOpen} 
                onClose={() => setIsEditModalOpen(false)} 
                templateData={editingTemplate}
                onSuccess={fetchTemplates}
            />

            <ProjectTemplatePreviewModal 
                isOpen={isPreviewModalOpen} 
                onClose={() => setIsPreviewModalOpen(false)} 
                templateData={previewTemplate}
            />

            <AlertDialog open={!!templateToDelete} onOpenChange={(open) => !open && setTemplateToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Smazat šablonu?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Opravdu chcete smazat šablonu "{templateToDelete?.name}"? Tato akce je nevratná.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel disabled={isProcessing}>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} disabled={isProcessing} className="bg-red-600 hover:bg-red-700">
                            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : "Smazat"}
                        </AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
};

export default ProjectTemplatesSettings;