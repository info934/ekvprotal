import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  Boxes,
  Edit3,
  FileText,
  Package,
  Plus,
  RefreshCw,
  Search,
  Warehouse,
} from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { cn } from '@/lib/utils';

const emptyMovement = {
  catalog_item_id: '',
  movement_type: 'receipt',
  quantity: 1,
  unit_cost: '',
  note: '',
};

const productTypeLabels = {
  service: 'Sluzba',
  manufactured: 'Vyrobek / sklad',
};

const movementTypeLabels = {
  receipt: 'Prijem',
  adjustment: 'Korekce',
};

const formatCurrency = (value, currency = 'CZK') => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: currency || 'CZK',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const formatQty = (value, unit = 'ks') => `${new Intl.NumberFormat('cs-CZ', {
  maximumFractionDigits: 3,
}).format(Number(value || 0))} ${unit || 'ks'}`;

const normalizeNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  return Number(String(value).replace(',', '.')) || 0;
};

const normalizeMovementQuantity = (type, value) => {
  const quantity = Math.abs(normalizeNumber(value) || 0);
  if (type === 'issue') return -quantity;
  if (type === 'adjustment') return normalizeNumber(value) || 0;
  return quantity;
};

const Products = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const canEdit = hasPermission('crm', 'can_edit') || hasPermission('realizace', 'can_edit') || hasPermission('settings', 'can_admin');
  const [products, setProducts] = useState([]);
  const [stockByProduct, setStockByProduct] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('active');
  const [schemaWarning, setSchemaWarning] = useState('');
  const [productSchemaReady, setProductSchemaReady] = useState(true);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [movementForm, setMovementForm] = useState(emptyMovement);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setSchemaWarning('');

    let { data: productData, error: productError } = await supabase
      .from('commercial_item_catalog')
      .select('id, sku, code, name, description, category, unit, product_type, default_unit_price, default_vat_rate, purchase_price, currency, stock_min_qty, warehouse_location, allow_backorder, valid_from, valid_until, datasheet_external_web_url, datasheet_file_name, datasheet_preview_image_url, image_url, is_active, archived_at, metadata, created_at, updated_at')
      .order('name', { ascending: true });

    if (productError) {
      const fallback = await supabase
        .from('commercial_item_catalog')
        .select('id, code, name, description, category, unit, default_unit_price, default_vat_rate, is_active, metadata, created_at, updated_at')
        .order('name', { ascending: true });

      if (fallback.error) {
        setLoading(false);
        setSchemaWarning(fallback.error.message || 'Katalog produktu se nepodarilo nacist.');
        return;
      }

      productData = (fallback.data || []).map((product) => ({
        ...product,
        sku: product.code || '',
        product_type: 'service',
        purchase_price: 0,
        currency: 'CZK',
        stock_min_qty: null,
        warehouse_location: null,
        allow_backorder: false,
        valid_from: null,
        valid_until: null,
        datasheet_external_web_url: null,
        datasheet_file_name: null,
        datasheet_preview_image_url: null,
        image_url: null,
        archived_at: null,
      }));
      setProductSchemaReady(false);
      setSchemaWarning('Online databaze jeste nema produktovou migraci. Zobrazuji puvodni katalog bez skladu a rozsirene editace.');
    } else {
      setProductSchemaReady(true);
    }

    const { data: stockData, error: stockError } = await supabase
      .from('product_stock_status')
      .select('catalog_item_id, stock_qty, reserved_qty, available_qty');

    if (stockError) {
      setSchemaWarning('Skladovy prehled zatim neni dostupny. Je potreba aplikovat produktovou migraci.');
    }

    setProducts(productData || []);
    setStockByProduct((stockData || []).reduce((acc, row) => ({
      ...acc,
      [row.catalog_item_id]: row,
    }), {}));
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const stats = useMemo(() => {
    return products.reduce((acc, product) => {
      const stock = stockByProduct[product.id];
      const available = Number(stock?.available_qty || 0);
      const minQty = Number(product.stock_min_qty || 0);
      return {
        total: acc.total + 1,
        active: acc.active + (product.is_active && !product.archived_at ? 1 : 0),
        manufactured: acc.manufactured + (product.product_type === 'manufactured' ? 1 : 0),
        lowStock: acc.lowStock + (product.product_type === 'manufactured' && minQty > 0 && available <= minQty ? 1 : 0),
      };
    }, { total: 0, active: 0, manufactured: 0, lowStock: 0 });
  }, [products, stockByProduct]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const isActive = product.is_active && !product.archived_at;
      if (activeFilter === 'active' && !isActive) return false;
      if (activeFilter === 'archived' && isActive) return false;
      if (typeFilter !== 'all' && product.product_type !== typeFilter) return false;
      if (!query) return true;
      return [product.sku, product.code, product.name, product.description, product.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [activeFilter, products, search, typeFilter]);

  const openMovementDialog = (product) => {
    setMovementForm({
      ...emptyMovement,
      catalog_item_id: product.id,
      unit_cost: product.purchase_price || '',
    });
    setMovementDialogOpen(true);
  };

  const archiveProduct = async (product) => {
    if (!canEdit) return;
    const payload = productSchemaReady
      ? { is_active: false, archived_at: new Date().toISOString(), updated_by: user?.id || null }
      : { is_active: false };
    const { error } = await supabase
      .from('commercial_item_catalog')
      .update(payload)
      .eq('id', product.id);

    if (error) {
      toast({ title: 'Produkt se nepodarilo archivovat', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Produkt archivovan' });
    fetchProducts();
  };

  const saveMovement = async () => {
    const quantity = normalizeMovementQuantity(movementForm.movement_type, movementForm.quantity);
    if (!movementForm.catalog_item_id || !quantity) {
      toast({ title: 'Doplnte produkt a mnozstvi', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('product_stock_movements').insert({
      catalog_item_id: movementForm.catalog_item_id,
      movement_type: movementForm.movement_type,
      quantity,
      unit_cost: normalizeNumber(movementForm.unit_cost),
      source_type: 'manual',
      request_id: `manual-${movementForm.catalog_item_id}-${Date.now()}`,
      note: movementForm.note || null,
      created_by: user?.id || null,
    });
    setSaving(false);

    if (error) {
      toast({ title: 'Skladovy pohyb se nepodarilo ulozit', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Skladovy pohyb ulozen' });
    setMovementDialogOpen(false);
    fetchProducts();
  };

  return (
    <div className="min-h-screen bg-slate-50/70 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-5">
        <PageHeader
          icon={Package}
          title="Produkty"
          description="Centralni katalog pro CRM, nabidky, objednavky a realizace."
          actions={(
            <>
              <Button variant="outline" onClick={fetchProducts} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                Obnovit
              </Button>
              <Button onClick={() => navigate('/products/new')} disabled={!canEdit}>
                <Plus className="mr-2 h-4 w-4" />
                Novy produkt
              </Button>
            </>
          )}
        />

        {schemaWarning && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Produktova databaze neni kompletni</AlertTitle>
            <AlertDescription>{schemaWarning}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-4">
          {[
            { label: 'Celkem polozek', value: stats.total, icon: Boxes },
            { label: 'Aktivni', value: stats.active, icon: Package },
            { label: 'Skladove', value: stats.manufactured, icon: Warehouse },
            { label: 'Pod minimem', value: stats.lowStock, icon: AlertTriangle, danger: stats.lowStock > 0 },
          ].map((item) => (
            <Card key={item.label} className="border-slate-200 bg-white shadow-sm">
              <CardContent className="flex items-center justify-between gap-3 p-4">
                <div>
                  <p className="text-sm text-muted-foreground">{item.label}</p>
                  <p className="mt-1 text-2xl font-semibold text-slate-950">{item.value}</p>
                </div>
                <div className={cn(
                  'flex h-10 w-10 items-center justify-center rounded-md ring-1',
                  item.danger ? 'bg-rose-50 text-rose-700 ring-rose-100' : 'bg-primary/10 text-primary ring-primary/10'
                )}>
                  <item.icon className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <CardTitle className="text-base">Katalog produktu</CardTitle>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative sm:w-[320px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Hledat kod, nazev, kategorii..."
                    className="pl-9"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="sm:w-[180px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Vsechny typy</SelectItem>
                    <SelectItem value="service">Sluzby</SelectItem>
                    <SelectItem value="manufactured">Skladove produkty</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={activeFilter} onValueChange={setActiveFilter}>
                  <SelectTrigger className="sm:w-[160px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktivni</SelectItem>
                    <SelectItem value="archived">Archiv</SelectItem>
                    <SelectItem value="all">Vse</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80">
                    <TableHead className="min-w-[120px]">SKU</TableHead>
                    <TableHead className="min-w-[260px]">Nazev</TableHead>
                    <TableHead className="min-w-[140px]">Typ</TableHead>
                    <TableHead className="min-w-[140px]">Kategorie</TableHead>
                    <TableHead className="min-w-[120px] text-right">Prodej</TableHead>
                    <TableHead className="min-w-[120px] text-right">Nakup</TableHead>
                    <TableHead className="min-w-[130px] text-right">Skladem</TableHead>
                    <TableHead className="min-w-[130px] text-right">Rezervace</TableHead>
                    <TableHead className="min-w-[130px] text-right">Dostupne</TableHead>
                    <TableHead className="min-w-[130px]">Datasheet</TableHead>
                    <TableHead className="min-w-[180px]">Platnost</TableHead>
                    <TableHead className="min-w-[150px]">Lokace</TableHead>
                    <TableHead className="w-28 text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={13} className="h-32 text-center text-muted-foreground">Nacitam produkty...</TableCell>
                    </TableRow>
                  ) : filteredProducts.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={13} className="h-32 text-center text-muted-foreground">Zadny produkt neodpovida filtrum.</TableCell>
                    </TableRow>
                  ) : filteredProducts.map((product) => {
                    const stock = stockByProduct[product.id] || {};
                    const available = Number(stock.available_qty || 0);
                    const minQty = Number(product.stock_min_qty || 0);
                    const lowStock = product.product_type === 'manufactured' && minQty > 0 && available <= minQty;
                    const today = new Date().toISOString().slice(0, 10);
                    const expired = product.valid_until && product.valid_until < today;
                    const notYetValid = product.valid_from && product.valid_from > today;
                    return (
                      <TableRow key={product.id} className={!product.is_active || product.archived_at ? 'opacity-60' : undefined}>
                        <TableCell className="font-mono text-sm">{product.sku || product.code || '-'}</TableCell>
                        <TableCell>
                          <div className="font-semibold text-slate-950">{product.name}</div>
                          {product.description && <div className="mt-1 line-clamp-1 text-xs text-muted-foreground">{product.description}</div>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={product.product_type === 'manufactured' ? 'default' : 'secondary'}>
                            {productTypeLabels[product.product_type] || product.product_type}
                          </Badge>
                        </TableCell>
                        <TableCell>{product.category || '-'}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(product.default_unit_price, product.currency)}</TableCell>
                        <TableCell className="text-right text-muted-foreground">{formatCurrency(product.purchase_price, product.currency)}</TableCell>
                        <TableCell className="text-right">{product.product_type === 'manufactured' ? formatQty(stock.stock_qty, product.unit) : '-'}</TableCell>
                        <TableCell className="text-right">{product.product_type === 'manufactured' ? formatQty(stock.reserved_qty, product.unit) : '-'}</TableCell>
                        <TableCell className={cn('text-right font-semibold', lowStock && 'text-rose-700')}>
                          {product.product_type === 'manufactured' ? formatQty(available, product.unit) : '-'}
                        </TableCell>
                        <TableCell>
                          {product.datasheet_external_web_url ? (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-8 px-2"
                              onClick={(event) => {
                                event.stopPropagation();
                                window.open(product.datasheet_external_web_url, '_blank', 'noopener,noreferrer');
                              }}
                            >
                              <FileText className="mr-1.5 h-4 w-4" />
                              Soubor
                            </Button>
                          ) : product.datasheet_file_name || product.datasheet_preview_image_url || product.image_url ? (
                            <Badge variant="outline">Pripraveno</Badge>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <span className="text-xs text-muted-foreground">
                              {(product.valid_from || product.valid_until) ? `${product.valid_from || '-'} - ${product.valid_until || '-'}` : 'Bez omezeni'}
                            </span>
                            {(expired || notYetValid) && (
                              <Badge variant="outline" className={expired ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-amber-200 bg-amber-50 text-amber-800'}>
                                {expired ? 'Po platnosti' : 'Ceka na platnost'}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{product.warehouse_location || '-'}</TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            {product.product_type === 'manufactured' && (
                              <Button variant="ghost" size="icon" onClick={() => openMovementDialog(product)} disabled={!canEdit}>
                                <Warehouse className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => navigate(`/products/${product.id}/edit`)} disabled={!canEdit}>
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => archiveProduct(product)} disabled={!canEdit || !product.is_active}>
                              <Archive className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={movementDialogOpen} onOpenChange={setMovementDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Skladovy pohyb</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Typ pohybu</Label>
              <Select value={movementForm.movement_type} onValueChange={(value) => setMovementForm({ ...movementForm, movement_type: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(movementTypeLabels).map(([value, label]) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Mnozstvi</Label>
                <Input type="number" value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Jedn. naklad</Label>
                <Input type="number" value={movementForm.unit_cost} onChange={(event) => setMovementForm({ ...movementForm, unit_cost: event.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Poznamka</Label>
              <Textarea value={movementForm.note} onChange={(event) => setMovementForm({ ...movementForm, note: event.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementDialogOpen(false)}>Zavrit</Button>
            <Button onClick={saveMovement} disabled={saving || !canEdit}>Ulozit pohyb</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Products;
