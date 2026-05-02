import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Edit2, Trash2, BookOpen, Search } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';

const DictionaryTable = ({ tableName, columns }) => {
    const { toast } = useToast();
    const [items, setItems] = useState([]);
    const [filteredItems, setFilteredItems] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [loading, setLoading] = useState(true);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingItem, setEditingItem] = useState(null);
    const [itemToDelete, setItemToDelete] = useState(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        const { data, error } = await supabase.from(tableName).select('*').order('name');
        if (error) {
            toast({ title: `Chyba při načítání (${tableName})`, variant: 'destructive', description: error.message });
        } else {
            setItems(data);
            setFilteredItems(data);
        }
        setLoading(false);
    }, [tableName, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    useEffect(() => {
        const lowercasedFilter = searchTerm.toLowerCase();
        const filteredData = items.filter(item => {
            return Object.values(item).some(val => 
                String(val).toLowerCase().includes(lowercasedFilter)
            );
        });
        setFilteredItems(filteredData);
    }, [searchTerm, items]);

    const handleSave = async (e) => {
        e.preventDefault();
        const formData = new FormData(e.target);
        const itemData = Object.fromEntries(formData.entries());
        
        const query = editingItem?.id
            ? supabase.from(tableName).update(itemData).eq('id', editingItem.id)
            : supabase.from(tableName).insert(itemData).select();

        const { error } = await query;
        
        if (error) {
            toast({ title: 'Chyba při ukládání', variant: 'destructive', description: error.message });
        } else {
            toast({ title: 'Položka uložena' });
            setIsFormOpen(false);
            setEditingItem(null);
            fetchData();
        }
    };

    const handleDelete = async () => {
        if (!itemToDelete) return;
        const { error } = await supabase.from(tableName).delete().eq('id', itemToDelete.id);
        if (error) {
            toast({ title: 'Chyba při mazání', variant: 'destructive', description: error.message });
        } else {
            toast({ title: 'Položka smazána' });
            fetchData();
        }
        setItemToDelete(null);
    };

    return (
        <Card>
            <CardHeader className="flex-row items-center justify-between">
                 <div className="relative w-full max-w-sm">
                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                    <Input
                        type="search"
                        placeholder="Hledat v číselníku..."
                        className="pl-8"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>
                <Button onClick={() => { setEditingItem(null); setIsFormOpen(true); }}><Plus className="w-4 h-4 mr-2" /> Přidat</Button>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableHeader>
                        <TableRow>
                            {columns.map(col => <TableHead key={col.key}>{col.label}</TableHead>)}
                            <TableHead className="text-right w-[100px]">Akce</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {loading ? (
                            <TableRow><TableCell colSpan={columns.length + 1} className="text-center">Načítání...</TableCell></TableRow>
                        ) : filteredItems.length > 0 ? filteredItems.map(item => (
                            <TableRow key={item.id}>
                                {columns.map(col => <TableCell key={col.key}>
                                    {col.key === 'color' && item[col.key] ? 
                                        <div className="flex items-center gap-2">
                                            <div className="w-4 h-4 rounded-full border" style={{ backgroundColor: item[col.key] }}></div>
                                            <span>{item[col.key]}</span>
                                        </div>
                                    : item[col.key]}
                                </TableCell>)}
                                <TableCell className="text-right">
                                    <Button variant="ghost" size="icon" onClick={() => { setEditingItem(item); setIsFormOpen(true); }}><Edit2 className="w-4 h-4" /></Button>
                                    <Button variant="ghost" size="icon" onClick={() => setItemToDelete(item)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                                </TableCell>
                            </TableRow>
                        )) : (
                            <TableRow><TableCell colSpan={columns.length + 1} className="text-center">Nebyly nalezeny žádné položky.</TableCell></TableRow>
                        )}
                    </TableBody>
                </Table>
            </CardContent>

            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>{editingItem?.id ? 'Upravit' : 'Přidat'} položku</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleSave} className="space-y-4 py-4">
                        {columns.map(col => (
                            <div key={col.key}>
                                <Label htmlFor={col.key}>{col.label}</Label>
                                {col.type === 'textarea' ? (
                                    <Textarea id={col.key} name={col.key} defaultValue={editingItem?.[col.key] || ''} />
                                ) : (
                                    <Input id={col.key} name={col.key} type={col.type || 'text'} defaultValue={editingItem?.[col.key] || ''} />
                                )}
                            </div>
                        ))}
                        <DialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Zrušit</Button>
                            <Button type="submit">Uložit</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            <AlertDialog open={!!itemToDelete} onOpenChange={() => setItemToDelete(null)}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Opravdu smazat položku?</AlertDialogTitle>
                        <AlertDialogDescription>
                            Chystáte se smazat položku '{itemToDelete?.name}'. Tato akce je nevratná.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Zrušit</AlertDialogCancel>
                        <AlertDialogAction onClick={handleDelete}>Smazat</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </Card>
    );
};

const dictionaries = [
    { name: 'Typy realizací', tableName: 'realization_types', columns: [{key: 'name', label: 'Název'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { name: 'Stavy realizací', tableName: 'realization_statuses', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { name: 'Stavy objednávek', tableName: 'order_statuses', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { name: 'Jednotky', tableName: 'units', columns: [{key: 'name', label: 'Název'}, {key: 'abbreviation', label: 'Zkratka'}] },
    { name: 'Typy projekce', tableName: 'project_types', columns: [{key: 'name', label: 'Název'}] },
    { name: 'Stavy projekce', tableName: 'projection_statuses', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { name: 'Fáze projektu', tableName: 'project_stages', columns: [{key: 'name', label: 'Název'}] },
    { name: 'Stavy úkolů', tableName: 'task_statuses', columns: [{key: 'name', label: 'Název'}] },
    { name: 'Typy dokumentů', tableName: 'document_types', columns: [{key: 'name', label: 'Název'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { name: 'Úrovně rizika', tableName: 'risk_levels', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { name: 'Úrovně priority', tableName: 'priority_levels', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
];

const SettingsDictionaries = () => {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold flex items-center gap-2"><BookOpen className="w-6 h-6"/> Číselníky</h2>
                <p className="text-muted-foreground">Správa centrálních seznamů a hodnot používaných v aplikaci.</p>
            </div>
            <Tabs defaultValue={dictionaries[0].tableName} className="w-full">
                <TabsList className="overflow-x-auto h-auto w-full justify-start flex-wrap">
                    {dictionaries.map(dict => (
                        <TabsTrigger key={dict.tableName} value={dict.tableName}>{dict.name}</TabsTrigger>
                    ))}
                </TabsList>
                {dictionaries.map(dict => (
                    <TabsContent key={dict.tableName} value={dict.tableName}>
                        <DictionaryTable tableName={dict.tableName} columns={dict.columns} />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
};

export default SettingsDictionaries;