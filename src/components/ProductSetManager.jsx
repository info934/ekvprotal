import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Boxes, Edit3, Plus, Search, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/financePresentation';

const emptySetForm = {
  id: null,
  code: '',
  name: '',
  category: '',
  description: '',
  is_active: true,
};

const formatCurrency = (value, currency = 'CZK') => formatMoney(value, { currency: currency || 'CZK' });

const productUsageCount = (product) => Number(product?.usage_count ?? product?.total_usage_count ?? product?.metadata?.usage_count ?? 0);

const productSearchValue = (product) => [
  product?.code,
  product?.sku,
  product?.name,
  product?.description,
  product?.category,
  product?.product_type,
].filter(Boolean).join(' ').toLowerCase();

const getItemProduct = (row, productsById) => row.item || productsById.get(row.catalog_item_id) || {};

const ProductSetManager = ({ products = [], canEdit = false, userId = null }) => {
  const { toast } = useToast();
  const [sets, setSets] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptySetForm);
  const [items, setItems] = useState([]);
  const [productSearch, setProductSearch] = useState('');
  const [schemaWarning, setSchemaWarning] = useState('');

  const productsById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const fetchSets = useCallback(async () => {
    setLoading(true);
    setSchemaWarning('');
    const { data, error } = await supabase
      .from('product_sets')
      .select('id, code, name, description, category, is_active, created_at, updated_at, items:product_set_items(id, catalog_item_id, quantity, sort_order, note, item:commercial_item_catalog(id, code, sku, name, unit, purchase_price, default_unit_price, default_vat_rate, category, product_type, metadata))')
      .order('name', { ascending: true });

    if (error) {
      setSets([]);
      setSchemaWarning('Produktové sety budou dostupné po aplikaci poslední databázové migrace.');
    } else {
      setSets((data || []).map((set) => ({
        ...set,
        items: [...(set.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSets();
  }, [fetchSets]);

  const openNewSet = () => {
    setForm(emptySetForm);
    setItems([]);
    setProductSearch('');
    setDialogOpen(true);
  };

  const openEditSet = (set) => {
    setForm({
      id: set.id,
      code: set.code || '',
      name: set.name || '',
      category: set.category || '',
      description: set.description || '',
      is_active: set.is_active !== false,
    });
    setItems((set.items || []).map((row) => ({
      catalog_item_id: row.catalog_item_id,
      quantity: Number(row.quantity || 1),
      note: row.note || '',
      item: getItemProduct(row, productsById),
    })));
    setProductSearch('');
    setDialogOpen(true);
  };

  const availableProducts = useMemo(() => {
    const needle = productSearch.trim().toLowerCase();
    const selectedIds = new Set(items.map((item) => item.catalog_item_id));
    return products
      .filter((product) => product?.id && !selectedIds.has(product.id))
      .filter((product) => !needle || productSearchValue(product).includes(needle))
      .sort((a, b) => {
        const usageDiff = productUsageCount(b) - productUsageCount(a);
        if (usageDiff !== 0) return usageDiff;
        return String(a.name || a.code || '').localeCompare(String(b.name || b.code || ''), 'cs');
      })
      .slice(0, 80);
  }, [items, productSearch, products]);

  const addProduct = (product) => {
    setItems((current) => [
      ...current,
      {
        catalog_item_id: product.id,
        quantity: 1,
        note: '',
        item: product,
      },
    ]);
  };

  const updateQuantity = (catalogItemId, value) => {
    const quantity = Math.max(0.001, Number(String(value).replace(',', '.')) || 1);
    setItems((current) => current.map((item) => (
      item.catalog_item_id === catalogItemId ? { ...item, quantity } : item
    )));
  };

  const removeProduct = (catalogItemId) => {
    setItems((current) => current.filter((item) => item.catalog_item_id !== catalogItemId));
  };

  const setTotals = (set) => (set.items || []).reduce((acc, row) => {
    const product = getItemProduct(row, productsById);
    const quantity = Number(row.quantity || 1);
    return {
      count: acc.count + 1,
      purchase: acc.purchase + quantity * Number(product.purchase_price || 0),
      sale: acc.sale + quantity * Number(product.default_unit_price || 0),
    };
  }, { count: 0, purchase: 0, sale: 0 });

  const draftTotals = useMemo(() => items.reduce((acc, row) => {
    const product = row.item || productsById.get(row.catalog_item_id) || {};
    const quantity = Number(row.quantity || 1);
    return {
      purchase: acc.purchase + quantity * Number(product.purchase_price || 0),
      sale: acc.sale + quantity * Number(product.default_unit_price || 0),
    };
  }, { purchase: 0, sale: 0 }), [items, productsById]);

  const saveSet = async () => {
    if (!canEdit) return;
    if (!form.name.trim() || items.length === 0) {
      toast({ title: 'Doplnte nazev a alespon jednu polozku setu.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const payload = {
      code: form.code.trim() || null,
      name: form.name.trim(),
      category: form.category.trim() || null,
      description: form.description.trim() || null,
      is_active: form.is_active !== false,
      created_by: form.id ? undefined : userId,
    };

    let setId = form.id;
    let error = null;
    if (setId) {
      const result = await supabase.from('product_sets').update(payload).eq('id', setId);
      error = result.error;
    } else {
      const result = await supabase.from('product_sets').insert(payload).select('id').single();
      error = result.error;
      setId = result.data?.id;
    }

    if (!error && setId) {
      const deleteResult = await supabase.from('product_set_items').delete().eq('set_id', setId);
      error = deleteResult.error;
      if (!error) {
        const rows = items.map((item, index) => ({
          set_id: setId,
          catalog_item_id: item.catalog_item_id,
          quantity: Number(item.quantity || 1),
          sort_order: (index + 1) * 10,
          note: item.note || null,
        }));
        const insertResult = await supabase.from('product_set_items').insert(rows);
        error = insertResult.error;
      }
    }

    setSaving(false);
    if (error) {
      toast({ title: 'Set se nepodařilo uložit', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Produktový set uložen' });
    setDialogOpen(false);
    fetchSets();
  };

  return (
    <>
      <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
        <CardHeader className="border-b bg-white px-3 py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Boxes className="h-4 w-4 text-primary" />
                Produktové sety
              </CardTitle>
              <CardDescription>Skupiny katalogových položek pro rychlé vložení typických FVE sestav a balíčků.</CardDescription>
            </div>
            <Button size="sm" onClick={openNewSet} disabled={!canEdit || Boolean(schemaWarning)}>
              <Plus className="mr-2 h-4 w-4" />
              Nový set
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {schemaWarning ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">{schemaWarning}</div>
          ) : loading ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Načítám produktové sety...</div>
          ) : sets.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground">Zatím není vytvořen žádný set. Vytvořte např. základní FVE sestavu z panelů, střídače, baterie a montáže.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="text-xs">
                <TableHeader className="bg-slate-50/95">
                  <TableRow>
                    <TableHead className="min-w-[110px]">Kód</TableHead>
                    <TableHead className="min-w-[260px]">Název setu</TableHead>
                    <TableHead className="min-w-[130px]">Kategorie</TableHead>
                    <TableHead className="min-w-[90px] text-right">Položky</TableHead>
                    <TableHead className="min-w-[120px] text-right">Nákup</TableHead>
                    <TableHead className="min-w-[120px] text-right">Prodej</TableHead>
                    <TableHead className="min-w-[100px]">Stav</TableHead>
                    <TableHead className="w-24 text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sets.map((set) => {
                    const totals = setTotals(set);
                    return (
                      <TableRow key={set.id} className="hover:bg-blue-50/40 [&>td]:py-2">
                        <TableCell className="font-mono text-[11px] font-semibold text-slate-700">{set.code || '-'}</TableCell>
                        <TableCell>
                          <div className="font-semibold text-slate-950">{set.name}</div>
                          {set.description && <div className="line-clamp-1 text-[11px] text-muted-foreground">{set.description}</div>}
                        </TableCell>
                        <TableCell>{set.category || '-'}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.count}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(totals.purchase)}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(totals.sale)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn(set.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600')}>
                            {set.is_active ? 'Aktivní' : 'Archiv'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="icon" disabled={!canEdit} onClick={() => openEditSet(set)} title="Upravit set">
                            <Edit3 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1280px] overflow-hidden p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Boxes className="h-4 w-4 text-primary" />
              Produktový set
            </DialogTitle>
          </DialogHeader>
          <div className="grid max-h-[76vh] gap-3 overflow-auto p-4 xl:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                <div className="space-y-1.5">
                  <Label>Kód setu</Label>
                  <Input className="h-8 text-sm" value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value })} placeholder="např. SET-FVE-10" />
                </div>
                <div className="space-y-1.5">
                  <Label>Název</Label>
                  <Input className="h-8 text-sm" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Základní FVE set" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Kategorie</Label>
                <Input className="h-8 text-sm" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="FVE sestavy" />
              </div>
              <div className="space-y-1.5">
                <Label>Popis</Label>
                <Textarea className="min-h-[84px] text-sm" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
              </div>
              <div className="rounded-md border bg-slate-50 p-3 text-sm">
                <div className="flex items-center justify-between"><span>Nákup</span><strong>{formatCurrency(draftTotals.purchase)}</strong></div>
                <div className="mt-1 flex items-center justify-between"><span>Prodej</span><strong>{formatCurrency(draftTotals.sale)}</strong></div>
                <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground"><span>Položek</span><span>{items.length}</span></div>
              </div>
            </div>

            <div className="grid gap-3 lg:grid-cols-2">
              <div className="rounded-md border bg-white">
                <div className="border-b p-2">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input className="h-8 pl-8 text-xs" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Hledat produkt do setu..." />
                  </div>
                </div>
                <div className="max-h-[420px] overflow-auto">
                  <Table className="text-xs">
                    <TableHeader className="sticky top-0 bg-slate-50">
                      <TableRow>
                        <TableHead>Kód</TableHead>
                        <TableHead>Produkt</TableHead>
                        <TableHead className="text-right">Nákup</TableHead>
                        <TableHead className="w-14" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {availableProducts.map((product) => (
                        <TableRow key={product.id} className="[&>td]:py-1.5">
                          <TableCell className="font-mono text-[11px]">{product.code || product.sku || '-'}</TableCell>
                          <TableCell>
                            <div className="font-medium text-slate-950">{product.name}</div>
                            <div className="text-[11px] text-muted-foreground">Použití: {productUsageCount(product) || 0}</div>
                          </TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(product.purchase_price)}</TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => addProduct(product)}>+</Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>

              <div className="rounded-md border bg-white">
                <div className="border-b px-3 py-2 text-sm font-semibold">Položky setu</div>
                <div className="max-h-[420px] overflow-auto">
                  <Table className="text-xs">
                    <TableHeader className="sticky top-0 bg-slate-50">
                      <TableRow>
                        <TableHead>Produkt</TableHead>
                        <TableHead className="w-24 text-right">Množství</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {items.length === 0 ? (
                        <TableRow><TableCell colSpan={3} className="h-24 text-center text-muted-foreground">Vyberte produkty vlevo.</TableCell></TableRow>
                      ) : items.map((row) => {
                        const product = row.item || productsById.get(row.catalog_item_id) || {};
                        return (
                          <TableRow key={row.catalog_item_id} className="[&>td]:py-1.5">
                            <TableCell>
                              <div className="font-medium text-slate-950">{product.name || row.catalog_item_id}</div>
                              <div className="text-[11px] text-muted-foreground">{product.code || product.sku || '-'}</div>
                            </TableCell>
                            <TableCell>
                              <Input className="h-7 text-right text-xs" type="number" min="0.001" step="0.001" value={row.quantity} onChange={(event) => updateQuantity(row.catalog_item_id, event.target.value)} />
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeProduct(row.catalog_item_id)} title="Odebrat">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="border-t bg-slate-50 px-4 py-3">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Zavřít</Button>
            <Button onClick={saveSet} disabled={!canEdit || saving}>{saving ? 'Ukládám...' : 'Uložit set'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ProductSetManager;

