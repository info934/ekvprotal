import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Edit2, Trash2, Search, FileText, Eye } from 'lucide-react';
import { format } from 'date-fns';

const ProjectTemplateDialog = ({ isOpen, onClose, onSave, template }) => {
    const [formData, setFormData] = useState({
        name: '',
        description: '',
        default_budget: '',
        default_timeline_days: '',
    });

    useEffect(() => {
        if (template) {
            setFormData({
                name: template.name || '',
                description: template.description || '',
                default_budget: template.default_budget || '',
                default_timeline_days: template.default_timeline_days || '',
            });
        } else {
            setFormData({
                name: '',
                description: '',
                default_budget: '',
                default_timeline_days: '',
            });
        }
    }, [template, isOpen]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const dataToSave = {
            ...formData,
            default_budget: formData.default_budget ? parseFloat(formData.default_budget) : null,
            default_timeline_days: formData.default_timeline_days ? parseInt(formData.default_timeline_days, 10) : null,
        };
        onSave(dataToSave);
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{template ? 'Upravit šablonu' : 'Nová šablona projektu'}</DialogTitle>
                    <DialogDescription>
                        Vytvořte nebo upravte šablonu pro rychlé zakládání nových projektů.
                    </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-4">
                    <div>
                        <Label htmlFor="name">Název šablony *</Label>
                        <Input id="name" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} required />
                    </div>
                    <div>
                        <Label htmlFor="description">Popis</Label>
                        <Textarea id="description" value={formData.description} onChange={e => setFormData({ ...formData, description: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <Label htmlFor="default_budget">Výchozí rozpočet (Kč)</Label>
                            <Input id="default_budget" type="number" value={formData.default_budget} onChange={e => setFormData({ ...formData, default_budget: e.target.value })} />
                        </div>
                        <div>
                            <Label htmlFor="default_timeline_days">Výchozí délka (dny)</Label>
                            <Input id="default_timeline_days" type="number" value={formData.default_timeline_days} onChange={e => setFormData({ ...formData, default_timeline_days: e.target.value })} />
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="button" variant="outline" onClick={onClose}>Zrušit</Button>
                        <Button type="submit">Uložit</Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
};


const ProjectTemplates = () => {
    const { toast } = useToast();
    const [templates, setTemplates] = useState([]);
    const [filteredTemplates, setFilteredTemplates] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState(null);
    const [templateToDelete, setTemplateToDelete] = useState(null);
    const [previewTemplate, setPreviewTemplate] = useState(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.from('project_templates').select('*').order('name');
        if (error) {
            toast({ title: 'Chyba při načítání šablon', variant: 'destructive', description: error.message });
        } else {
            setTemplates(data);
            setFilteredTemplates(data);
        }
        setLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        const lowercasedFilter = searchTerm.toLowerCase();
        const filteredData = templates.filter(template =>
            template.name.toLowerCase().includes(lowercasedFilter) ||
            (template.description && template.description.toLowerCase().includes(lowercasedFilter))
        );
        setFilteredTemplates(filteredData);
    }, [searchTerm, templates]);

    const handleSave = async (templateData) => {
        const query = editingTemplate?.id
            ? supabase.from('project_templates').update(templateData).eq('id', editingTemplate.id)
            : supabase.from('project_templates').insert(templateData);

        const { error } = await query;
        if (error) {
            toast({ title: 'Chyba při ukládání šablony', variant: 'destructive', description: error.message });
        } else {
            toast({ title: 'Šablona uložena' });
            setIsFormOpen(false);
            setEditingTemplate(null);
            fetchData();
        }
    };

    const handleDelete = async () => {
        if (!templateToDelete) return;
        const { error } = await supabase.from('project_templates').delete().eq('id', templateToDelete.id);
        if (error) {
            toast({ title: 'Chyba při mazání šablony', variant: 'destructive', description: error.message });
        } else {
            toast({ title: 'Šablona smazána' });
            fetchData();
        }
        setTemplateToDelete(null);
    };

    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold flex items-center gap-2"><FileText className="w-6 h-6"/> Šablony Projektů</h2>
                <p className="text-muted-foreground">Správa šablon pro rychlé vytváření nových projektů.</p>
            </div>
            
            <Card>
                <CardHeader className="flex-row items-center justify-between">
                    <div className="relative w-full max-w-sm">
                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Hledat v šablonách..."
                            className="pl-8"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <Button onClick={() => { setEditingTemplate(null); setIsFormOpen(true); }}>
                        <Plus className="w-4 h-4 mr-2" /> Nová šablona
                    </Button>
                </CardHeader>
                <CardContent>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Název</TableHead>
                                <TableHead>Popis</TableHead>
                                <TableHead>Vytvořeno</TableHead>
                                <TableHead className="text-right w-[120px]">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={4} className="text-center">Načítání...</TableCell></TableRow>
                            ) : filteredTemplates.length > 0 ? filteredTemplates.map(template => (
                                <TableRow key={template.id}>
                                    <TableCell className="font-medium">{template.name}</TableCell>
                                    <TableCell className="text-muted-foreground truncate max-w-xs">{template.description}</TableCell>
                                    <TableCell>{format(new Date(template.created_at), 'd.M.yyyy')}</TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => setPreviewTemplate(template)}><Eye className="w-4 h-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => { setEditingTemplate(template); setIsFormOpen(true); }}><Edit2 className="w-4 h-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => setTemplateToDelete(template)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                                    </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow><TableCell colSpan={4} className="text-center">Nebyly nalezeny žádné šablony.</TableCell></TableRow>
                            )}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>

            <ProjectTemplateDialog isOpen={isFormOpen} onClose={() => setIsFormOpen(false)} onSave={handleSave} template={editingTemplate} />
            
            <AlertDialog open={!!templateToDelete} onOpenChange={() => setTemplateToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Opravdu smazat šablonu?</AlertDialogTitle>
                        <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Smazat</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
            
            <Dialog open={!!previewTemplate} onOpenChange={() => setPreviewTemplate(null)}>
                <DialogContent className="max-w-2xl">
                    <DialogHeader>
                        <DialogTitle>{previewTemplate?.name}</DialogTitle>
                        <DialogDescription>{previewTemplate?.description}</DialogDescription>
                    </DialogHeader>
                    <div className="py-4 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div><span className="font-semibold">Výchozí rozpočet:</span> {previewTemplate?.default_budget ? `${previewTemplate.default_budget.toLocaleString('cs-CZ')} Kč` : 'N/A'}</div>
                            <div><span className="font-semibold">Výchozí délka:</span> {previewTemplate?.default_timeline_days ? `${previewTemplate.default_timeline_days} dní` : 'N/A'}</div>
                        </div>
                        {/* Here you could render default_phases and default_team_members if they were structured */}
                        <div>
                            <h4 className="font-semibold mb-2">Výchozí fáze</h4>
                            <p className="text-sm text-muted-foreground">{previewTemplate?.default_phases ? JSON.stringify(previewTemplate.default_phases, null, 2) : 'Nebyly nastaveny.'}</p>
                        </div>
                         <div>
                            <h4 className="font-semibold mb-2">Výchozí členové týmu</h4>
                            <p className="text-sm text-muted-foreground">{previewTemplate?.default_team_members ? JSON.stringify(previewTemplate.default_team_members, null, 2) : 'Nebyly nastaveny.'}</p>
                        </div>
                    </div>
                </DialogContent>
            </Dialog>

        </div>
    );
};

export default ProjectTemplates;