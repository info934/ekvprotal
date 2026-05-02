import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Loader2, Edit2, Trash2, Eye, Copy, FileText, Search, RefreshCw, Layers, CheckSquare, Milestone } from 'lucide-react';
import ProjectTemplateEditModal from './ProjectTemplateEditModal';
import ProjectTemplatePreviewModal from './ProjectTemplatePreviewModal';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';

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
    const [searchTerm, setSearchTerm] = useState('');

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

    const filteredTemplates = templates.filter(template => {
        const query = searchTerm.trim().toLowerCase();
        if (!query) return true;
        return `${template.name || ''} ${template.description || ''}`.toLowerCase().includes(query);
    });

    const templateStats = templates.reduce((acc, template) => {
        acc.tasks += Array.isArray(template.tasks_data) ? template.tasks_data.length : 0;
        acc.phases += Array.isArray(template.phases_data) ? template.phases_data.length : 0;
        acc.milestones += Array.isArray(template.milestones_data) ? template.milestones_data.length : 0;
        return acc;
    }, { tasks: 0, phases: 0, milestones: 0 });

    return (
        <div className="space-y-6">
            <PageHeader
                icon={FileText}
                title="Šablony projektů"
                description="Spravujte uložené projektové struktury pro rychlé vytváření projektů."
                actions={
                    <Button variant="outline" onClick={fetchTemplates} disabled={loading || isProcessing} className="w-full sm:w-auto">
                        <RefreshCw className="w-4 h-4 mr-2" /> Aktualizovat
                    </Button>
                }
            />

            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="app-surface p-4">
                    <p className="text-sm text-muted-foreground">Šablony</p>
                    <p className="mt-1 text-2xl font-semibold">{templates.length}</p>
                </div>
                <div className="app-surface p-4">
                    <div className="flex items-center gap-3">
                        <CheckSquare className="h-5 w-5 text-blue-600" />
                        <div>
                            <p className="text-sm text-muted-foreground">Úkoly</p>
                            <p className="text-2xl font-semibold">{templateStats.tasks}</p>
                        </div>
                    </div>
                </div>
                <div className="app-surface p-4">
                    <div className="flex items-center gap-3">
                        <Layers className="h-5 w-5 text-purple-600" />
                        <div>
                            <p className="text-sm text-muted-foreground">Fáze</p>
                            <p className="text-2xl font-semibold">{templateStats.phases}</p>
                        </div>
                    </div>
                </div>
                <div className="app-surface p-4">
                    <div className="flex items-center gap-3">
                        <Milestone className="h-5 w-5 text-emerald-600" />
                        <div>
                            <p className="text-sm text-muted-foreground">Milníky</p>
                            <p className="text-2xl font-semibold">{templateStats.milestones}</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="app-surface overflow-hidden">
                <div className="border-b bg-slate-50/60 p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-semibold">Moje projektové šablony</h2>
                                <Badge variant="secondary">{filteredTemplates.length} zobrazeno</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">Duplikujte, upravujte nebo otevřete náhled uložené struktury.</p>
                        </div>
                        <div className="relative w-full lg:w-80">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Hledat šablonu..."
                                className="pl-8"
                            />
                        </div>
                    </div>
                </div>

                {loading ? (
                    <div className="flex h-48 items-center justify-center text-muted-foreground">
                        <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                        Načítání šablon...
                    </div>
                ) : templates.length === 0 ? (
                    <div className="p-12 text-center flex flex-col items-center">
                        <FileText className="w-12 h-12 text-slate-300 mb-4" />
                        <h3 className="text-lg font-medium text-slate-900 mb-1">Žádné šablony</h3>
                        <p className="text-slate-500 mb-4">Zatím nemáte vytvořené žádné vlastní šablony projektů.</p>
                    </div>
                ) : filteredTemplates.length === 0 ? (
                    <div className="p-12 text-center">
                        <Search className="mx-auto mb-3 h-10 w-10 text-slate-300" />
                        <h3 className="text-lg font-medium">Nic nenalezeno</h3>
                        <p className="text-sm text-muted-foreground">Zkuste změnit hledaný výraz.</p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-[220px]">Název</TableHead>
                                <TableHead className="min-w-[240px]">Popis</TableHead>
                                <TableHead className="min-w-[120px]">Vytvořeno</TableHead>
                                <TableHead className="text-center">Počet úkolů</TableHead>
                                <TableHead className="text-center">Počet fází</TableHead>
                                <TableHead className="text-center">Počet milníků</TableHead>
                                <TableHead className="text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredTemplates.map((template) => (
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
                    </div>
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
