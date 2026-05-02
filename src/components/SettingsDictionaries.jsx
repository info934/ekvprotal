import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { FormDialogBody, FormDialogContent, FormDialogFooter, FormDialogHeader } from '@/components/ui/form-dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Edit2, Trash2, BookOpen, Search, ListChecks } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const DictionaryTable = ({ dictionary }) => {
    const { toast } = useToast();
    const { tableName, columns } = dictionary;
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
        <Card className="overflow-hidden">
            <CardHeader className="gap-4 border-b bg-slate-50/60">
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h2 className="text-xl font-semibold">{dictionary.name}</h2>
                            <Badge variant="secondary">{items.length} položek</Badge>
                        </div>
                        <p className="mt-1 text-sm text-muted-foreground">{dictionary.description}</p>
                        <div className="mt-2 text-xs text-muted-foreground">Tabulka: <span className="font-mono">{tableName}</span></div>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <div className="relative w-full sm:w-72">
                            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input
                                type="search"
                                placeholder="Hledat v číselníku..."
                                className="pl-8"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                        </div>
                        <Button onClick={() => { setEditingItem(null); setIsFormOpen(true); }}>
                            <Plus className="w-4 h-4 mr-2" /> Přidat
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="p-0">
                <div className="overflow-x-auto">
                    <Table>
                        <TableHeader>
                            <TableRow>
                                {columns.map(col => <TableHead key={col.key} className="min-w-[160px]">{col.label}</TableHead>)}
                                <TableHead className="sticky right-0 w-[100px] bg-background text-right">Akce</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {loading ? (
                                <TableRow><TableCell colSpan={columns.length + 1} className="h-24 text-center text-muted-foreground">Načítání...</TableCell></TableRow>
                            ) : filteredItems.length > 0 ? filteredItems.map(item => (
                                <TableRow key={item.id}>
                                    {columns.map(col => <TableCell key={col.key} className="align-top">
                                        {col.key === 'color' && item[col.key] ? 
                                            <div className="flex items-center gap-2">
                                                <div className="h-4 w-4 rounded-full border" style={{ backgroundColor: item[col.key] }}></div>
                                                <span className="font-mono text-xs">{item[col.key]}</span>
                                            </div>
                                        : <span className="break-words">{item[col.key]}</span>}
                                    </TableCell>)}
                                    <TableCell className="sticky right-0 bg-background text-right">
                                        <Button variant="ghost" size="icon" onClick={() => { setEditingItem(item); setIsFormOpen(true); }}><Edit2 className="w-4 h-4" /></Button>
                                        <Button variant="ghost" size="icon" onClick={() => setItemToDelete(item)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                                    </TableCell>
                                </TableRow>
                            )) : (
                                <TableRow>
                                    <TableCell colSpan={columns.length + 1} className="h-28 text-center">
                                        <div className="text-sm font-medium">Žádné položky</div>
                                        <div className="text-sm text-muted-foreground">Zkuste změnit hledání nebo přidat novou hodnotu.</div>
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>

            <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
                <FormDialogContent size="sm">
                    <FormDialogHeader
                        icon={editingItem?.id ? Edit2 : Plus}
                        title={`${editingItem?.id ? 'Upravit' : 'Přidat'} položku`}
                        description={dictionary.name}
                    />
                    <form onSubmit={handleSave} className="flex min-h-0 flex-1 flex-col">
                        <FormDialogBody className="space-y-4">
                            {columns.map(col => (
                                <div key={col.key} className="space-y-2">
                                    <Label htmlFor={col.key}>{col.label}</Label>
                                    {col.type === 'textarea' ? (
                                        <Textarea id={col.key} name={col.key} defaultValue={editingItem?.[col.key] || ''} />
                                    ) : (
                                        <Input id={col.key} name={col.key} type={col.type || 'text'} defaultValue={editingItem?.[col.key] || ''} />
                                    )}
                                </div>
                            ))}
                        </FormDialogBody>
                        <FormDialogFooter>
                            <Button type="button" variant="outline" onClick={() => setIsFormOpen(false)}>Zrušit</Button>
                            <Button type="submit">Uložit</Button>
                        </FormDialogFooter>
                    </form>
                </FormDialogContent>
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
    { category: 'Realizace', name: 'Typy realizací', description: 'Druhy zakázek v části realizací.', tableName: 'realization_types', columns: [{key: 'name', label: 'Název'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { category: 'Realizace', name: 'Stavy realizací', description: 'Stavový workflow realizací včetně barev.', tableName: 'realization_statuses', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { category: 'Objednávky', name: 'Stavy objednávek', description: 'Stavy objednávek a jejich barevné odlišení.', tableName: 'order_statuses', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { category: 'Objednávky', name: 'Jednotky', description: 'Měrné jednotky používané v položkách.', tableName: 'units', columns: [{key: 'name', label: 'Název'}, {key: 'abbreviation', label: 'Zkratka'}] },
    { category: 'Projekce', name: 'Typy projekce', description: 'Typy projektů v projekční části.', tableName: 'project_types', columns: [{key: 'name', label: 'Název'}] },
    { category: 'Projekce', name: 'Stavy projekce', description: 'Stavy projekčního workflow včetně barev.', tableName: 'projection_statuses', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { category: 'Projekce', name: 'Fáze projektu', description: 'Fáze používané při členění projektů.', tableName: 'project_stages', columns: [{key: 'name', label: 'Název'}] },
    { category: 'Úkoly', name: 'Stavy úkolů', description: 'Hodnoty stavů pro úkoly.', tableName: 'task_statuses', columns: [{key: 'name', label: 'Název'}] },
    { category: 'Dokumenty', name: 'Typy dokumentů', description: 'Kategorie dokumentů v evidenci.', tableName: 'document_types', columns: [{key: 'name', label: 'Název'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { category: 'Rizika', name: 'Úrovně rizika', description: 'Rizikovost položek a vizuální barvy.', tableName: 'risk_levels', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
    { category: 'Rizika', name: 'Úrovně priority', description: 'Priority napříč úkoly a procesy.', tableName: 'priority_levels', columns: [{key: 'name', label: 'Název'}, {key: 'color', label: 'Barva'}, {key: 'description', label: 'Popis', type: 'textarea'}] },
];

const SettingsDictionaries = () => {
    const [activeDictionary, setActiveDictionary] = useState(dictionaries[0].tableName);
    const categories = [...new Set(dictionaries.map(dict => dict.category))];

    return (
        <div className="space-y-6">
            <PageHeader
                icon={BookOpen}
                title="Číselníky"
                description="Správa centrálních seznamů a hodnot používaných napříč aplikací."
                actions={<Badge variant="secondary">{dictionaries.length} číselníků</Badge>}
            />
            <Tabs value={activeDictionary} onValueChange={setActiveDictionary} className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">
                <TabsList className="app-surface h-auto flex-col items-stretch justify-start gap-5 p-3">
                    {categories.map(category => (
                        <div key={category} className="space-y-2">
                            <div className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category}</div>
                            <div className="space-y-1">
                                {dictionaries.filter(dict => dict.category === category).map(dict => (
                                    <TabsTrigger
                                        key={dict.tableName}
                                        value={dict.tableName}
                                        className={cn(
                                            'h-auto w-full justify-start rounded-lg px-3 py-3 text-left data-[state=active]:bg-primary data-[state=active]:text-primary-foreground'
                                        )}
                                    >
                                        <span className="flex min-w-0 items-start gap-3">
                                            <ListChecks className="mt-0.5 h-4 w-4 shrink-0" />
                                            <span className="min-w-0">
                                                <span className="block font-semibold leading-5">{dict.name}</span>
                                                <span className="block truncate text-xs font-normal opacity-75">{dict.tableName}</span>
                                            </span>
                                        </span>
                                    </TabsTrigger>
                                ))}
                            </div>
                        </div>
                    ))}
                </TabsList>
                {dictionaries.map(dict => (
                    <TabsContent key={dict.tableName} value={dict.tableName} className="mt-0 min-w-0">
                        <DictionaryTable dictionary={dict} />
                    </TabsContent>
                ))}
            </Tabs>
        </div>
    );
};

export default SettingsDictionaries;
