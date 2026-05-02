import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Plus, Edit2, Trash2 } from 'lucide-react';
import OrderTemplateDialog from './OrderTemplateDialog';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from './ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const OrderTemplateManager = () => {
    const { toast } = useToast();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isDialogOpen, setIsDialogOpen] = useState(false);
    const [editingTemplate, setEditingTemplate] = useState(null);

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

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between">
                <div>
                    <CardTitle>Správa šablon objednávek</CardTitle>
                    <CardDescription>Vytvářejte a upravujte šablony pro odesílání objednávek.</CardDescription>
                </div>
                <Button onClick={() => { setEditingTemplate(null); setIsDialogOpen(true); }}>
                    <Plus className="w-4 h-4 mr-2" /> Nová šablona
                </Button>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <p>Načítání šablon...</p>
                ) : (
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Název</TableHead>
                                <TableHead>Popis</TableHead>
                                <TableHead className="text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {templates.map(template => (
                                <TableRow key={template.id}>
                                    <TableCell className="font-medium">{template.name}</TableCell>
                                    <TableCell>{template.description}</TableCell>
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
                )}
                {templates.length === 0 && !loading && <p className="text-center text-muted-foreground py-8">Nebyly nalezeny žádné šablony.</p>}
            </CardContent>

            <OrderTemplateDialog
                isOpen={isDialogOpen}
                onClose={() => setIsDialogOpen(false)}
                onSave={handleSaveTemplate}
                template={editingTemplate}
            />
        </Card>
    );
};

export default OrderTemplateManager;