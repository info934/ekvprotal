import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Edit2, Trash2, Eye, Plus, FileText, Loader2, Copy } from 'lucide-react';
import EditTemplateModal from './EditTemplateModal';
import PageHeader from '@/components/ui/page-header';

const ProjectTemplatesPage = () => {
    const { toast } = useToast();
    const { user } = useAuth();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState(null);
    
    const [templateToDelete, setTemplateToDelete] = useState(null);
    
    const [previewTemplate, setPreviewTemplate] = useState(null);

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
        }
    };

    const openEditModal = (template = null) => {
        setEditingTemplate(template);
        setIsEditModalOpen(true);
    };

    return (
        <div className="app-page-wide">
            <PageHeader
                icon={Copy}
                title="Šablony projektů"
                description="Spravujte své uložené šablony pro rychlé vytváření projektů."
                actions={<Button onClick={() => openEditModal()}><Plus className="w-4 h-4 mr-2"/> Nová šablona</Button>}
                className="mb-8"
            />
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} className="hidden">
                <div>
                    <h1 className="text-3xl font-bold flex items-center gap-3 text-slate-800">
                        <div className="p-2.5 bg-primary/10 rounded-xl">
                            <Copy className="w-7 h-7 text-primary" />
                        </div>
                        Šablony projektů
                    </h1>
                    <p className="text-muted-foreground mt-1">Spravujte své uložené šablony pro rychlé vytváření projektů.</p>
                </div>
                <Button onClick={() => openEditModal()}><Plus className="w-4 h-4 mr-2"/> Nová šablona</Button>
            </motion.div>

            <div className="bg-white rounded-lg border shadow-sm">
                {loading ? (
                    <div className="p-8 text-center text-muted-foreground">
                        <Loader2 className="w-8 h-8 animate-spin mx-auto mb-2"/>
                        Načítání šablon...
                    </div>
                ) : templates.length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center">
                        <FileText className="w-12 h-12 text-slate-300 mb-4" />
                        <h3 className="text-lg font-medium text-slate-900 mb-1">Zatím nemáte žádné šablony</h3>
                        <p className="text-slate-500 mb-4">Šablony můžete vytvořit zde nebo uložit existující projekt jako šablonu z jeho detailu.</p>
                        <Button variant="outline" onClick={() => openEditModal()}>Vytvořit první šablonu</Button>
                    </div>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Název šablony</TableHead>
                                <TableHead>Popis</TableHead>
                                <TableHead>Vytvořeno</TableHead>
                                <TableHead className="text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {templates.map((template) => (
                                <TableRow key={template.id}>
                                    <TableCell className="font-medium text-slate-900">{template.name}</TableCell>
                                    <TableCell className="text-slate-500 max-w-md truncate">
                                        {template.description || <span className="italic text-slate-400">Bez popisu</span>}
                                    </TableCell>
                                    <TableCell className="text-slate-500">
                                        {format(new Date(template.created_at), 'dd.MM.yyyy')}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <div className="flex justify-end gap-2">
                                            <Button variant="ghost" size="icon" onClick={() => setPreviewTemplate(template)} title="Náhled">
                                                <Eye className="w-4 h-4 text-slate-500" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => openEditModal(template)} title="Upravit">
                                                <Edit2 className="w-4 h-4 text-blue-500" />
                                            </Button>
                                            <Button variant="ghost" size="icon" onClick={() => setTemplateToDelete(template)} title="Smazat">
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

            {/* Modals */}
            <EditTemplateModal 
                isOpen={isEditModalOpen} 
                onClose={() => setIsEditModalOpen(false)} 
                templateData={editingTemplate}
                onSuccess={fetchTemplates}
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
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">Smazat</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Dialog open={!!previewTemplate} onOpenChange={(open) => !open && setPreviewTemplate(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>Náhled šablony: {previewTemplate?.name}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div>
                            <h4 className="text-sm font-semibold text-slate-700 mb-1">Popis</h4>
                            <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-md border">{previewTemplate?.description || 'Není zadán'}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                            <div className="bg-slate-50 p-3 rounded-md border">
                                <span className="text-xs text-slate-500 block mb-1">Počet úkolů</span>
                                <span className="text-lg font-semibold">{previewTemplate?.tasks_data?.length || 0}</span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-md border">
                                <span className="text-xs text-slate-500 block mb-1">Počet fází</span>
                                <span className="text-lg font-semibold">{previewTemplate?.phases_data?.length || 0}</span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-md border">
                                <span className="text-xs text-slate-500 block mb-1">Počet milníků</span>
                                <span className="text-lg font-semibold">{previewTemplate?.milestones_data?.length || 0}</span>
                            </div>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default ProjectTemplatesPage;
