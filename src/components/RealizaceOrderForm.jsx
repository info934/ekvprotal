import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Calendar } from '@/components/ui/calendar';
import { format } from 'date-fns';
import { Plus, Trash2, CalendarPlus as CalendarIcon, Send, Mail, ChevronLeft, ShoppingCart, Search, PackagePlus, Save, AlertTriangle } from 'lucide-react';
import { sendEmail } from '@/lib/email';
import { Badge } from './ui/badge';

const emptyOrderItem = () => ({
    catalog_item_id: null,
    description: '',
    quantity: 1,
    unit: 'ks',
    unit_price: 0,
    total_price: 0,
});

const normalizeOrderItem = (item = {}) => {
    const quantity = Number(item.quantity || 0);
    const unitPrice = Number(item.unit_price || 0);
    return {
        catalog_item_id: item.catalog_item_id || item.catalogItemId || null,
        description: item.description || item.name || '',
        quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
        unit: item.unit || 'ks',
        unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
        total_price: Number.isFinite(quantity * unitPrice) ? quantity * unitPrice : 0,
    };
};

const isMissingCatalogError = (error) => {
    if (!error) return false;
    const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
    return ['42P01', '42703', 'PGRST204', 'PGRST205'].includes(error.code) ||
        message.includes('commercial_item_catalog') ||
        message.includes('item_links') ||
        message.includes('commercial_status');
};

const isMissingStockSyncError = (error) => {
    if (!error) return false;
    const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
    return ['42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error.code) ||
        message.includes('sync_realizace_order_stock_movements') ||
        message.includes('product_stock_movements');
};

const RealizaceOrderForm = () => {
    const { realizaceId, orderId } = useParams();
    const navigate = useNavigate();
    const { toast } = useToast();
    const { user } = useAuth();
    const [realization, setRealization] = useState(null);
    const [formData, setFormData] = useState({
        supplier_id: '',
        order_number: '',
        items: [{ description: '', quantity: 1, unit: 'ks', unit_price: 0, total_price: 0 }],
        total_amount: 0,
        delivery_date: null,
        notes: '',
        commercial_status: 'order',
        offer_reference: '',
    });
    const [suppliers, setSuppliers] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [catalogItems, setCatalogItems] = useState([]);
    const [catalogReady, setCatalogReady] = useState(true);
    const [itemSearch, setItemSearch] = useState('');
    const [saveNewItems, setSaveNewItems] = useState(true);
    const [selectedTemplateId, setSelectedTemplateId] = useState('');
    const [emails, setEmails] = useState([]);
    const [newEmail, setNewEmail] = useState('');
    const [loading, setLoading] = useState(true);

    const isEditing = !!orderId;

    const fetchInitialData = useCallback(async () => {
        setLoading(true);
        const { data: realizationData } = await supabase.from('realizations').select('name').eq('id', realizaceId).single();
        setRealization(realizationData);

        const { data: suppliersData } = await supabase.from('subjects').select('id, name, email').order('name');
        setSuppliers(suppliersData || []);

        const { data: templatesData } = await supabase.from('order_templates').select('*').order('name');
        setTemplates(templatesData || []);
        if (templatesData?.length > 0) {
            setSelectedTemplateId(templatesData[0].id);
        }

        const { data: catalogData, error: catalogError } = await supabase
            .from('commercial_item_catalog')
            .select('id, code, name, description, category, unit, default_unit_price, default_vat_rate, is_active')
            .eq('is_active', true)
            .order('category', { ascending: true })
            .order('name', { ascending: true });
        if (catalogError) {
            setCatalogReady(false);
            setCatalogItems([]);
        } else {
            setCatalogReady(true);
            setCatalogItems(catalogData || []);
        }

        if (isEditing) {
            const { data: orderData } = await supabase.from('realizace_orders').select('*').eq('id', orderId).single();
            if (orderData) {
                setFormData({
                    supplier_id: orderData.supplier_id || '',
                    order_number: orderData.order_number || '',
                    items: (orderData.items || [emptyOrderItem()]).map(normalizeOrderItem),
                    total_amount: orderData.total_amount || 0,
                    delivery_date: orderData.delivery_date ? new Date(orderData.delivery_date) : null,
                    notes: orderData.notes || '',
                    commercial_status: orderData.commercial_status || 'order',
                    offer_reference: orderData.offer_reference || '',
                });
                setEmails(orderData.sent_to_emails || []);
            } else {
                toast({ title: 'Objednávka nenalezena', variant: 'destructive' });
                navigate(`/realizace/${realizaceId}#orders`);
            }
        } else {
            setFormData({
                supplier_id: '',
                order_number: `OBJ-${realizationData?.name?.slice(0,5).toUpperCase()}-${new Date().getFullYear()}${(new Date().getMonth() + 1).toString().padStart(2, '0')}`,
                items: [emptyOrderItem()],
                total_amount: 0,
                delivery_date: null,
                notes: '',
                commercial_status: 'order',
                offer_reference: '',
            });
            setEmails(user?.email ? [user.email] : []);
        }
        setLoading(false);
    }, [realizaceId, orderId, isEditing, navigate, toast, user]);

    useEffect(() => {
        fetchInitialData();
    }, [fetchInitialData]);

    useEffect(() => {
        const total = formData.items.reduce((sum, item) => sum + (item.total_price || 0), 0);
        setFormData(prev => ({ ...prev, total_amount: total }));
    }, [formData.items]);
    
    useEffect(() => {
        const supplier = suppliers.find(s => s.id === formData.supplier_id);
        if (supplier?.email && !emails.includes(supplier.email)) {
            setEmails(prev => [...prev, supplier.email]);
        }
    }, [formData.supplier_id, suppliers, emails]);

    const handleItemChange = (index, field, value) => {
        const newItems = [...formData.items];
        const item = { ...newItems[index] };
        item[field] = value;
        if (field === 'quantity' || field === 'unit_price') {
            item.total_price = (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_price) || 0);
        }
        newItems[index] = item;
        setFormData(prev => ({ ...prev, items: newItems }));
    };

    const addItem = () => {
        setFormData(prev => ({
            ...prev,
            items: [...prev.items, emptyOrderItem()],
        }));
    };

    const addCatalogItem = (catalogItem) => {
        const orderItem = normalizeOrderItem({
            catalog_item_id: catalogItem.id,
            description: catalogItem.name,
            quantity: 1,
            unit: catalogItem.unit || 'ks',
            unit_price: catalogItem.default_unit_price || 0,
        });

        setFormData(prev => {
            const emptyIndex = prev.items.findIndex(item => !item.description && Number(item.total_price || 0) === 0);
            if (emptyIndex >= 0) {
                const nextItems = [...prev.items];
                nextItems[emptyIndex] = orderItem;
                return { ...prev, items: nextItems };
            }
            return { ...prev, items: [...prev.items, orderItem] };
        });
    };

    const removeItem = (index) => {
        const newItems = formData.items.filter((_, i) => i !== index);
        if (newItems.length === 0) {
            newItems.push(emptyOrderItem());
        }
        setFormData(prev => ({ ...prev, items: newItems }));
    };

    const filteredCatalogItems = catalogItems.filter((item) => {
        const query = itemSearch.trim().toLowerCase();
        if (!query) return true;
        return [
            item.code,
            item.name,
            item.description,
            item.category,
            item.unit,
        ].filter(Boolean).join(' ').toLowerCase().includes(query);
    }).slice(0, 10);

    const saveItemsToCatalog = async (items) => {
        if (!catalogReady || !saveNewItems) return;

        const existingNames = new Set(catalogItems.map(item => item.name.trim().toLowerCase()));
        const newCatalogItems = items
            .filter(item => !item.catalog_item_id && item.description?.trim())
            .filter(item => !existingNames.has(item.description.trim().toLowerCase()))
            .map(item => ({
                name: item.description.trim(),
                description: item.description.trim(),
                unit: item.unit || 'ks',
                default_unit_price: Number(item.unit_price || 0),
                source: 'order',
                is_active: true,
            }));

        if (newCatalogItems.length === 0) return;

        const { error } = await supabase.from('commercial_item_catalog').insert(newCatalogItems);
        if (error && !isMissingCatalogError(error)) {
            toast({ title: 'Polozky se nepodarilo ulozit do katalogu', description: error.message, variant: 'destructive' });
        }
    };

    const syncRealizaceStock = async (savedOrderId) => {
        if (!savedOrderId || !catalogReady) return;

        const { error } = await supabase.rpc('sync_realizace_order_stock_movements', {
            p_order_id: savedOrderId,
        });

        if (error && !isMissingStockSyncError(error)) {
            toast({
                title: 'Objednavka ulozena, ale sklad se nepodarilo prepocitat',
                description: error.message,
                variant: 'destructive',
            });
        }
    };

    const handleEmailAdd = () => {
        if (newEmail && !emails.includes(newEmail)) {
            setEmails([...emails, newEmail]);
            setNewEmail('');
        }
    };
    
    const handleEmailRemove = (emailToRemove) => {
        setEmails(emails.filter(email => email !== emailToRemove));
    };
    
    const handleSave = async (andSend = false) => {
        if (!formData.supplier_id || !formData.order_number) {
            toast({ title: 'Chybějící údaje', description: 'Dodavatel a číslo objednávky jsou povinné.', variant: 'destructive' });
            return;
        }

        const normalizedItems = formData.items.map(normalizeOrderItem).filter(item => item.description.trim());
        if (normalizedItems.length === 0) {
            toast({ title: 'Chybějící položky', description: 'Objednávka musí obsahovat alespoň jednu položku.', variant: 'destructive' });
            return;
        }

        let isSendSuccess = true;
        if (andSend) {
            isSendSuccess = await handleSendEmail();
            if (!isSendSuccess) {
                 toast({ title: 'Odeslání selhalo', description: 'Email se nepodařilo odeslat. Zkontrolujte prosím emailové adresy a zkuste to znovu.', variant: 'destructive' });
                 return; // Stop saving if email sending fails
            }
        }
        
        const currentStatus = isEditing 
            ? ((await supabase.from('realizace_orders').select('status').eq('id', orderId).single()).data?.status || 'nová')
            : 'nová';

        const baseDataToSave = {
            ...formData,
            items: normalizedItems,
            total_amount: normalizedItems.reduce((sum, item) => sum + Number(item.total_price || 0), 0),
            realizace_id: realizaceId,
            sent_to_emails: emails,
            status: andSend ? 'odeslána' : currentStatus,
        };

        const catalogDataToSave = {
            ...baseDataToSave,
            item_links: normalizedItems
                .filter(item => item.catalog_item_id)
                .map((item, index) => ({ index, catalog_item_id: item.catalog_item_id })),
            commercial_status: formData.commercial_status || 'order',
            offer_reference: formData.offer_reference || null,
        };

        const dataToSave = catalogReady ? catalogDataToSave : baseDataToSave;

        const query = isEditing
            ? supabase.from('realizace_orders').update(dataToSave).eq('id', orderId).select('id').single()
            : supabase.from('realizace_orders').insert(dataToSave).select('id').single();

        let { data: savedOrder, error } = await query;
        if (error && isMissingCatalogError(error)) {
            const legacyQuery = isEditing
                ? supabase.from('realizace_orders').update(baseDataToSave).eq('id', orderId).select('id').single()
                : supabase.from('realizace_orders').insert(baseDataToSave).select('id').single();
            const legacyResult = await legacyQuery;
            savedOrder = legacyResult.data;
            error = legacyResult.error;
        }

        if (error) {
            toast({ title: 'Chyba při ukládání objednávky', variant: 'destructive', description: error.message });
        } else {
            await saveItemsToCatalog(normalizedItems);
            await syncRealizaceStock(savedOrder?.id || orderId);
            toast({ title: `Objednávka ${isEditing ? 'upravena' : 'vytvořena'}` });
            navigate(`/realizace/${realizaceId}#orders`);
        }
    };

    const handleSendEmail = async () => {
        const template = templates.find(t => t.id === selectedTemplateId);
        if (!template) {
            toast({ title: 'Šablona nenalezena', variant: 'destructive' });
            return false;
        }
        
        const supplier = suppliers.find(s => s.id === formData.supplier_id);
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const validEmails = emails.filter(email => email && emailRegex.test(email.trim()));

        if (validEmails.length === 0) {
            toast({
                title: 'Chybějící příjemci',
                description: 'Nebyly nalezeny žádné platné emailové adresy pro odeslání.',
                variant: 'destructive',
            });
            return false;
        }

        const documentLabel = formData.commercial_status === 'offer' ? 'Nabídka' : 'Objednávka';
        const itemsTableHtml = `
            <table style="width: 100%; border-collapse: collapse; font-family: sans-serif;">
                <thead>
                    <tr style="background-color: #f2f2f2;">
                        <th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Popis</th>
                        <th style="border: 1px solid #ddd; padding: 12px; text-align: right;">Množství</th>
                        <th style="border: 1px solid #ddd; padding: 12px; text-align: left;">Jednotka</th>
                        <th style="border: 1px solid #ddd; padding: 12px; text-align: right;">Cena/jedn.</th>
                        <th style="border: 1px solid #ddd; padding: 12px; text-align: right;">Celkem</th>
                    </tr>
                </thead>
                <tbody>
                    ${formData.items.map(item => `
                        <tr>
                            <td style="border: 1px solid #ddd; padding: 12px;">${item.description}</td>
                            <td style="border: 1px solid #ddd; padding: 12px; text-align: right;">${item.quantity}</td>
                            <td style="border: 1px solid #ddd; padding: 12px;">${item.unit}</td>
                            <td style="border: 1px solid #ddd; padding: 12px; text-align: right;">${(item.unit_price || 0).toLocaleString('cs-CZ')} Kč</td>
                            <td style="border: 1px solid #ddd; padding: 12px; text-align: right; font-weight: bold;">${(item.total_price || 0).toLocaleString('cs-CZ')} Kč</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        `;
        
        const placeholders = {
            '{supplier_name}': supplier?.name || 'N/A',
            '{order_number}': formData.order_number,
            '{order_date}': new Date().toLocaleDateString('cs-CZ'),
            '{items_table}': itemsTableHtml,
            '{total_amount}': (formData.total_amount || 0).toLocaleString('cs-CZ') + ' Kč',
            '{delivery_date}': formData.delivery_date ? format(formData.delivery_date, 'd.M.yyyy') : 'Nespecifikováno',
            '{notes}': formData.notes || 'Bez poznámky',
            '{realization_name}': realization?.name || 'N/A',
            '{admin_name}': user.user_metadata.full_name || user.email,
        };

        let emailContent = template.content;
        for (const [key, value] of Object.entries(placeholders)) {
            emailContent = emailContent.replace(new RegExp(key.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), value);
        }

        try {
            await sendEmail({
                to: validEmails.join(','),
                subject: `${documentLabel} č. ${formData.order_number}`,
                greeting: `Dobrý den,`,
                content: emailContent,
                salutation: `S pozdravem,<br>${user.user_metadata.full_name || user.email}`
            });
            toast({ title: 'Objednávka úspěšně odeslána' });
            return true;
        } catch (error) {
            toast({ title: 'Chyba při odesílání emailu', description: error.message, variant: 'destructive' });
            return false;
        }
    };

    if (loading) {
        return <div className="flex justify-center items-center h-64"><div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div></div>;
    }

    return (
        <div className="p-2 sm:p-4 md:p-6 space-y-6">
            <Button variant="ghost" onClick={() => navigate(`/realizace/${realizaceId}#orders`)} className="mb-4">
                <ChevronLeft className="w-4 h-4 mr-2" /> Zpět na seznam objednávek
            </Button>
            
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <ShoppingCart className="w-6 h-6 text-primary"/>
                        <div>
                            <CardTitle className="text-xl sm:text-2xl">{isEditing ? 'Upravit objednávku' : 'Nová objednávka'}</CardTitle>
                            <CardDescription>Vyplňte podrobnosti objednávky pro realizaci: {realization?.name}</CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-6 pt-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-base">Typ dokladu</Label>
                            <Select value={formData.commercial_status} onValueChange={(value) => setFormData(prev => ({ ...prev, commercial_status: value }))}>
                                <SelectTrigger className="h-12 text-base"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="offer">Nabídka</SelectItem>
                                    <SelectItem value="order">Objednávka</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="supplier" className="text-base">Dodavatel</Label>
                            <Select value={formData.supplier_id} onValueChange={(value) => setFormData(prev => ({ ...prev, supplier_id: value }))}>
                                <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Vyberte dodavatele" /></SelectTrigger>
                                <SelectContent>{suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="order_number" className="text-base">Číslo objednávky</Label>
                            <Input id="order_number" className="h-12 text-base" value={formData.order_number} onChange={(e) => setFormData(prev => ({ ...prev, order_number: e.target.value }))} />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="offer_reference" className="text-base">Vazba na nabídku</Label>
                            <Input
                                id="offer_reference"
                                className="h-12 text-base"
                                placeholder="Např. NAB-2026-001"
                                value={formData.offer_reference}
                                onChange={(e) => setFormData(prev => ({ ...prev, offer_reference: e.target.value }))}
                            />
                        </div>
                    </div>
                    
                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                        <div className="space-y-3">
                            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                <div>
                                    <Label className="text-base">Položkový seznam nabídky / objednávky</Label>
                                    <p className="text-sm text-muted-foreground">Položky zůstávají v objednávce a po migraci se propojí s centrálním katalogem.</p>
                                </div>
                                <Button variant="outline" size="sm" onClick={addItem} className="w-full sm:w-auto">
                                    <Plus className="w-4 h-4 mr-2" /> Přidat řádek
                                </Button>
                            </div>

                            <div className="overflow-x-auto rounded-lg border">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="min-w-[260px]">Popis položky</TableHead>
                                            <TableHead className="w-28">Množství</TableHead>
                                            <TableHead className="w-28">MJ</TableHead>
                                            <TableHead className="w-36">Cena/MJ</TableHead>
                                            <TableHead className="w-36 text-right">Celkem</TableHead>
                                            <TableHead className="w-16"></TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {formData.items.map((item, index) => (
                                            <TableRow key={`${item.catalog_item_id || 'manual'}-${index}`}>
                                                <TableCell>
                                                    <div className="space-y-1">
                                                        <Input
                                                            placeholder="Např. Montáž SDK příčky"
                                                            value={item.description}
                                                            onChange={(e) => handleItemChange(index, 'description', e.target.value)}
                                                            className="h-11"
                                                        />
                                                        {item.catalog_item_id && (
                                                            <Badge variant="secondary" className="text-[11px]">Z katalogu</Badge>
                                                        )}
                                                    </div>
                                                </TableCell>
                                                <TableCell>
                                                    <Input type="number" min="0" step="0.01" value={item.quantity} onChange={(e) => handleItemChange(index, 'quantity', e.target.value)} className="h-11" />
                                                </TableCell>
                                                <TableCell>
                                                    <Input value={item.unit} onChange={(e) => handleItemChange(index, 'unit', e.target.value)} className="h-11" />
                                                </TableCell>
                                                <TableCell>
                                                    <Input type="number" min="0" step="0.01" placeholder="0" value={item.unit_price} onChange={(e) => handleItemChange(index, 'unit_price', e.target.value)} className="h-11" />
                                                </TableCell>
                                                <TableCell className="text-right font-medium text-base">{(item.total_price || 0).toLocaleString('cs-CZ')} Kč</TableCell>
                                                <TableCell>
                                                    <Button variant="ghost" size="icon" onClick={() => removeItem(index)}>
                                                        <Trash2 className="w-5 h-5 text-red-500" />
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </div>

                            <div className="flex flex-col gap-3 rounded-lg border bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
                                <label className="flex items-center gap-2 text-sm text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={saveNewItems}
                                        onChange={(event) => setSaveNewItems(event.target.checked)}
                                        disabled={!catalogReady}
                                    />
                                    Uložit nové ručně zadané položky do katalogu
                                </label>
                                <div className="text-right">
                                    <div className="text-xs uppercase tracking-wide text-muted-foreground">Celkem bez DPH</div>
                                    <div className="text-2xl font-bold">{formData.total_amount.toLocaleString('cs-CZ')} Kč</div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3 rounded-lg border bg-white p-4">
                            <div className="flex items-start gap-2">
                                <PackagePlus className="mt-0.5 h-5 w-5 text-primary" />
                                <div>
                                    <h3 className="font-semibold">Katalog položek</h3>
                                    <p className="text-xs text-muted-foreground">Rychlé vložení často používaných položek.</p>
                                </div>
                            </div>

                            {!catalogReady && (
                                <Alert className="border-amber-200 bg-amber-50">
                                    <AlertTriangle className="h-4 w-4" />
                                    <AlertTitle>Katalog čeká na migraci</AlertTitle>
                                    <AlertDescription>
                                        Položky můžete zadávat ručně. Katalog se zapne po aplikaci nové migrace.
                                    </AlertDescription>
                                </Alert>
                            )}

                            <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                <Input
                                    value={itemSearch}
                                    onChange={(event) => setItemSearch(event.target.value)}
                                    placeholder="Hledat položku..."
                                    className="pl-9"
                                    disabled={!catalogReady}
                                />
                            </div>

                            <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                                {catalogReady && filteredCatalogItems.length === 0 && (
                                    <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
                                        Žádné položky v katalogu.
                                    </div>
                                )}
                                {filteredCatalogItems.map((item) => (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => addCatalogItem(item)}
                                        className="w-full rounded-md border p-3 text-left transition hover:border-primary/50 hover:bg-primary/5"
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <div className="truncate text-sm font-semibold">{item.name}</div>
                                                <div className="mt-1 truncate text-xs text-muted-foreground">{item.category || item.code || 'Bez kategorie'}</div>
                                            </div>
                                            <Badge variant="outline">{item.unit || 'ks'}</Badge>
                                        </div>
                                        <div className="mt-2 text-sm font-medium">{Number(item.default_unit_price || 0).toLocaleString('cs-CZ')} Kč</div>
                                    </button>
                                ))}
                            </div>

                            <Button variant="secondary" className="w-full" onClick={() => saveItemsToCatalog(formData.items)} disabled={!catalogReady}>
                                <Save className="mr-2 h-4 w-4" />
                                Uložit ruční položky do katalogu
                            </Button>
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                            <Label className="text-base">Předpokládané datum dodání</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant={"outline"} className="w-full justify-start text-left font-normal h-12 text-base">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {formData.delivery_date ? format(formData.delivery_date, "d. M. yyyy") : <span>Vyberte datum</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0"><Calendar mode="single" selected={formData.delivery_date} onSelect={(date) => setFormData(p => ({...p, delivery_date: date}))} initialFocus /></PopoverContent>
                            </Popover>
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="notes" className="text-base">Poznámky</Label>
                            <Textarea id="notes" value={formData.notes} onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))} rows={3} className="text-base"/>
                        </div>
                    </div>
                    
                     <div className="space-y-4 rounded-lg border p-4">
                        <h3 className="font-semibold text-lg flex items-center gap-2"><Mail className="w-5 h-5" /> Odeslání objednávky</h3>
                        <div className="space-y-2">
                            <Label className="text-base">Šablona emailu</Label>
                            <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                                <SelectTrigger className="h-12 text-base"><SelectValue placeholder="Vyberte šablonu" /></SelectTrigger>
                                <SelectContent>{templates.map(t => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}</SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <Label className="text-base">Emailoví příjemci</Label>
                            <div className="flex gap-2">
                                <Input placeholder="Přidat další email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} className="h-12 text-base" />
                                <Button onClick={handleEmailAdd} size="lg"><Plus className="w-5 h-5" /></Button>
                            </div>
                            <div className="flex flex-wrap gap-2 mt-2">
                                {emails.map(email => (
                                    <Badge key={email} variant="secondary" className="flex items-center gap-2 p-2 text-sm">
                                        {email}
                                        <button onClick={() => handleEmailRemove(email)} className="font-bold text-lg leading-none">&times;</button>
                                    </Badge>
                                ))}
                            </div>
                        </div>
                    </div>
                </CardContent>
            </Card>
            
            <div className="h-24"></div>
            <div className="fixed bottom-0 left-0 lg:left-56 right-0 bg-background/80 backdrop-blur-sm border-t p-4 z-10">
                <div className="max-w-7xl mx-auto flex justify-end gap-3">
                    <Button variant="outline" size="lg" onClick={() => navigate(`/realizace/${realizaceId}#orders`)}>Zrušit</Button>
                    <Button size="lg" onClick={() => handleSave(false)}>Uložit jako koncept</Button>
                    <Button size="lg" onClick={() => handleSave(true)}><Send className="w-5 h-5 mr-2"/>Uložit a odeslat</Button>
                </div>
            </div>
        </div>
    );
};

export default RealizaceOrderForm;
