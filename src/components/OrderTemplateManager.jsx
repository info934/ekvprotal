import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Plus, Edit2, Trash2, ShoppingCart, Search, FileText } from 'lucide-react';
import OrderTemplateDialog from './OrderTemplateDialog';
import { Card, CardContent, CardHeader } from './ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import PageHeader from '@/components/ui/page-header';

const OrderTemplateManager = () => {
    const { toast } = useToast();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');

    const fetchTemplates = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.from('order_templates').select('*').order('name');
        if (error) {
            toast({ title: 'Chyba při načítání šablon', variant: 'destructive', description: error.message });
        } else {
            setTemplates(data || []);
        }
        setLoading(false);
    }, [toast]);

    useEffect(() => {
        fetchTemplates();
    }, [fetchTemplates]);

    const handleSaveTemplate = async (templateData) => {
        const { id, ...dataToSave } = templateData;
        const query = id
            ? supabase.from('order_templates').update(dataToSave).eq('id', id)
            : supabase.from('order_templates').insert(dataToSave);
        
        const { error } = await query;
        if (error) {
            toast({ title: 'Chyba při ukládání šablony', variant: 'destructive', description: error.message });
        } else {
            toast({ title: 'Šablona uložena' });
            setIsDialogOpen(false);
            setEditingTemplate(null);
            fetchTemplates();
        }
    };

    const handleDeleteTemplate = async (templateId) => {
        const { error } = await supabase.from('order_templates').delete().eq('id', templateId);
        if (error) {
            toast({ title: 'Chyba při mazání šablony', variant: 'destructive', description: error.message });
        } else {
            toast({ title: 'Šablona smazána' });
            fetchTemplates();
        }
    };

    const filteredTemplates = templates.filter(template => {
        const query = searchTerm.trim().toLowerCase();
        if (!query) return true;
        return `${template.name || ''} ${template.description || ''}`.toLowerCase().includes(query);
    });

    return (
        <div className="space-y-6">
            <PageHeader
                icon={ShoppingCart}
                title="Šablony objednávek"
                description="Vytvářejte a upravujte textové šablony pro odesílání objednávek."
                actions={
                    <Button onClick={() => { setEditingTemplate(null); setIsDialogOpen(true); }} className="w-full sm:w-auto">
                        <Plus className="w-4 h-4 mr-2" /> Nová šablona
                    </Button>
                }
            />

            <Card className="overflow-hidden">
                <CardHeader className="gap-4 border-b bg-slate-50/60">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                            <div className="flex flex-wrap items-center gap-2">
                                <h2 className="text-lg font-semibold">Knihovna šablon</h2>
                                <Badge variant="secondary">{templates.length} šablon</Badge>
                            </div>
                            <p className="text-sm text-muted-foreground">Šablony používají zástupné symboly pro dodavatele, položky a částky.</p>
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
                </CardHeader>
                <CardContent className="p-0">
                {loading ? (
                    <div className="p-10 text-center text-muted-foreground">Načítání šablon...</div>
                ) : filteredTemplates.length === 0 ? (
                    <div className="p-12 text-center">
                        <FileText className="mx-auto mb-3 h-12 w-12 text-slate-300" />
                        <h3 className="text-lg font-medium">Žádné šablony</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                            {templates.length === 0 ? 'Zatím nejsou vytvořené žádné šablony objednávek.' : 'Zkuste upravit hledání.'}
                        </p>
                    </div>
                ) : (
                    <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead className="min-w-[220px]">Název</TableHead>
                                <TableHead className="min-w-[260px]">Popis</TableHead>
                                <TableHead className="w-[120px] text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {filteredTemplates.map(template => (
                                <TableRow key={template.id}>
                                    <TableCell className="font-medium">{template.name}</TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {template.description || <span className="italic text-slate-400">Bez popisu</span>}
                                    </TableCell>
                                    <TableCell className="text-right">
                                        <Button variant="ghost" size="icon" onClick={() => { setEditingTemplate(template); setIsDialogOpen(true); }}>
                                            <Edit2 className="w-4 h-4" />
                                        </Button>
                                        <AlertDialog>
                                            <AlertDialogTrigger asChild>
                                                <Button variant="ghost" size="icon">
                                                    <Trash2 className="w-4 h-4 text-red-500" />
                                                </Button>
                                            </AlertDialogTrigger>
                                            <AlertDialogContent>
                                                <AlertDialogHeader>
                                                    <AlertDialogTitle>Opravdu smazat šablonu?</AlertDialogTitle>
                                                    <AlertDialogDescription>Tato akce je nevratná.</AlertDialogDescription>
                                                </AlertDialogHeader>
                                                <AlertDialogFooter>
                                                    <AlertDialogCancel>Zrušit</AlertDialogCancel>
                                                    <AlertDialogAction onClick={() => handleDeleteTemplate(template.id)}>Smazat</AlertDialogAction>
                                                </AlertDialogFooter>
                                            </AlertDialogContent>
                                        </AlertDialog>
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    </div>
                )}
                </CardContent>

                <OrderTemplateDialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                onSave={handleSaveTemplate}
                template={editingTemplate}
                />
            </Card>
        </div>
    );
};

export default OrderTemplateManager;
