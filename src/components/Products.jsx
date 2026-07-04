import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Boxes,
  CalendarClock,
  CheckCircle2,
  Edit3,
  FileText,
  Link2,
  Package,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Store,
  TrendingDown,
  TrendingUp,
  Minus,
  Warehouse,
  Sparkles,
  XCircle,
} from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
  service: 'Služba',
  manufactured: 'Výrobek / sklad',
};

const movementTypeLabels = {
  receipt: 'Příjem',
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

const formatPercent = (value) => `${new Intl.NumberFormat('cs-CZ', {
  maximumFractionDigits: 1,
}).format(Number(value || 0))} %`;

const compactSearchValue = (value) => String(value || '').toLowerCase();

const metadataSearchValues = (metadata) => {
  if (!metadata || typeof metadata !== 'object') return [];
  return Object.values(metadata)
    .flatMap((value) => {
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object') return Object.values(value);
      return value;
    })
    .filter(Boolean);
};

const inferBrandFromText = (text) => {
  const value = compactSearchValue(text);
  const brands = [
    ['SolaX', ['solax', 'x1-', 'x3-', 't-bat', 'aelio', 'trene']],
    ['Huawei', ['huawei', 'sun2000', 'luna2000']],
    ['GoodWe', ['goodwe']],
    ['SolarEdge', ['solaredge']],
    ['Fronius', ['fronius']],
    ['Growatt', ['growatt']],
    ['SMA', ['sma sunny', 'sunny boy', 'sunny tripower']],
    ['Trina', ['trina']],
    ['AIKO', ['aiko']],
    ['JA Solar', ['ja solar', 'jasolar']],
    ['Tigo', ['tigo']],
  ];
  return brands.find(([, needles]) => needles.some((needle) => value.includes(needle)))?.[0] || '';
};

const getProductBrand = (product) => {
  const metadata = product?.metadata || {};
  return (
    metadata.brand ||
    metadata.manufacturer ||
    metadata.vendor ||
    inferBrandFromText([product?.name, product?.description, product?.sku, product?.code, metadata.supplier_category].filter(Boolean).join(' '))
  );
};

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

const marginValue = (product) => Number(product.default_unit_price || 0) - Number(product.purchase_price || 0);
const marginPercent = (product) => {
  const sale = Number(product.default_unit_price || 0);
  return sale > 0 ? (marginValue(product) / sale) * 100 : 0;
};

const getProductStatus = (product) => {
  const today = new Date().toISOString().slice(0, 10);
  if (!product.is_active || product.archived_at) return { label: 'Archiv', className: 'border-slate-200 bg-slate-100 text-slate-600' };
  if (product.valid_until && product.valid_until < today) return { label: 'Po platnosti', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  if (product.valid_from && product.valid_from > today) return { label: 'Čeká', className: 'border-amber-200 bg-amber-50 text-amber-800' };
  return { label: 'Aktivní', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' };
};

const Products = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const canEdit = hasPermission('crm', 'can_edit') || hasPermission('realizace', 'can_edit') || hasPermission('settings', 'can_admin');
  const [products, setProducts] = useState([]);
  const [stockByProduct, setStockByProduct] = useState({});
  const [supplierPricesByProduct, setSupplierPricesByProduct] = useState({});
  const [supplierSlugsByProduct, setSupplierSlugsByProduct] = useState({});
  const [supplierSearchByProduct, setSupplierSearchByProduct] = useState({});
  const [suppliers, setSuppliers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [activeFilter, setActiveFilter] = useState('active');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [brandFilter, setBrandFilter] = useState('all');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [availabilityFilter, setAvailabilityFilter] = useState('all');
  const [matchSuggestions, setMatchSuggestions] = useState([]);
  const [matchLoading, setMatchLoading] = useState(false);
  const [schemaWarning, setSchemaWarning] = useState('');
  const [productSchemaReady, setProductSchemaReady] = useState(true);
  const [movementDialogOpen, setMovementDialogOpen] = useState(false);
  const [movementForm, setMovementForm] = useState(emptyMovement);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setSchemaWarning('');

    let { data: productData, error: productError } = await supabase
      .from('commercial_item_catalog')
      .select('id, sku, code, name, description, category, unit, product_type, default_unit_price, default_vat_rate, purchase_price, currency, stock_min_qty, warehouse_location, allow_backorder, valid_from, valid_until, datasheet_external_web_url, datasheet_file_name, datasheet_preview_image_url, image_url, preferred_supplier_offer_id, is_active, archived_at, metadata, created_at, updated_at')
      .order('name', { ascending: true });

    if (productError) {
      const fallback = await supabase
        .from('commercial_item_catalog')
        .select('id, code, name, description, category, unit, default_unit_price, default_vat_rate, is_active, metadata, created_at, updated_at')
        .order('name', { ascending: true });

      if (fallback.error) {
        setLoading(false);
        setSchemaWarning(fallback.error.message || 'Katalog produktů se nepodařilo načíst.');
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
      setSchemaWarning('Online databáze ještě nemá produktovou migraci. Zobrazuji původní katalog bez skladu a rozšířené editace.');
    } else {
      setProductSchemaReady(true);
    }

    const { data: stockData, error: stockError } = await supabase
      .from('product_stock_status')
      .select('catalog_item_id, stock_qty, reserved_qty, available_qty');

    if (stockError) {
      setSchemaWarning('Skladový přehled zatím není dostupný. Je potřeba aplikovat produktovou migraci.');
    }

    const { data: supplierPriceData, error: supplierPriceError } = await supabase
      .from('product_supplier_current_prices')
      .select('catalog_item_id, supplier_offer_id, supplier_name, supplier_slug, supplier_sku, supplier_product_url, price_without_vat, currency, availability_note, scraped_at, price_change_amount, price_change_percent, supplier_offer_count, price_rank')
      .order('price_rank', { ascending: true });

    const { data: supplierData } = await supabase
      .from('product_suppliers')
      .select('slug, name, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true });

    setSuppliers(supplierData || []);

    if (supplierPriceError) {
      setSupplierPricesByProduct({});
      setSupplierSlugsByProduct({});
      setSupplierSearchByProduct({});
    } else {
      setSupplierPricesByProduct((supplierPriceData || []).reduce((acc, row) => {
        if (!acc[row.catalog_item_id] || Number(row.price_rank) === 1) {
          acc[row.catalog_item_id] = row;
        }
        return acc;
      }, {}));
      setSupplierSlugsByProduct((supplierPriceData || []).reduce((acc, row) => {
        if (!row.catalog_item_id || !row.supplier_slug) return acc;
        acc[row.catalog_item_id] = acc[row.catalog_item_id] || [];
        if (!acc[row.catalog_item_id].includes(row.supplier_slug)) acc[row.catalog_item_id].push(row.supplier_slug);
        return acc;
      }, {}));
      setSupplierSearchByProduct((supplierPriceData || []).reduce((acc, row) => {
        if (!row.catalog_item_id) return acc;
        acc[row.catalog_item_id] = acc[row.catalog_item_id] || [];
        acc[row.catalog_item_id].push(
          row.supplier_name,
          row.supplier_slug,
          row.supplier_sku,
          row.supplier_product_url,
          row.availability_note
        );
        return acc;
      }, {}));
    }
    setProducts(productData || []);
    setStockByProduct((stockData || []).reduce((acc, row) => ({
      ...acc,
      [row.catalog_item_id]: row,
    }), {}));
    setLoading(false);
  }, []);

  const fetchMatchSuggestions = useCallback(async () => {
    const { data, error } = await supabase
      .from('product_supplier_match_suggestion_details')
      .select('*')
      .eq('status', 'pending')
      .order('confidence', { ascending: false })
      .limit(20);

    if (error) {
      setMatchSuggestions([]);
      return;
    }

    setMatchSuggestions(data || []);
  }, []);

  useEffect(() => {
    fetchProducts();
    fetchMatchSuggestions();
  }, [fetchMatchSuggestions, fetchProducts]);

  const generateMatchSuggestions = async () => {
    if (!canEdit) return;
    setMatchLoading(true);
    const { data, error } = await supabase.rpc('generate_product_supplier_match_suggestions', {
      p_min_confidence: 0.72,
      p_limit: 250,
    });
    setMatchLoading(false);

    if (error) {
      toast({
        title: 'Párování se nepodařilo spustit',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    const result = Array.isArray(data) ? data[0] : data;
    toast({
      title: 'Návrhy párování připraveny',
      description: `Kandidáti: ${result?.candidate_count || 0}, uložené/aktualizované návrhy: ${result?.inserted_count || 0}.`,
    });
    await fetchMatchSuggestions();
  };

  const reviewMatchSuggestion = async (suggestion, status) => {
    if (!canEdit) return;
    setMatchLoading(true);
    const { error } = await supabase.rpc('review_product_supplier_match', {
      p_suggestion_id: suggestion.id,
      p_status: status,
    });
    setMatchLoading(false);

    if (error) {
      toast({
        title: 'Návrh se nepodařilo uložit',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({
      title: status === 'approved' ? 'Produkty spárovány' : 'Návrh odmítnut',
      description: status === 'approved'
        ? 'Dodavatelská nabídka je nově napojená na kanonický produkt a přepočítala se nejlepší nákupní cena.'
        : 'Návrh zůstane mimo aktivní kandidáty.',
    });
    await Promise.all([fetchProducts(), fetchMatchSuggestions()]);
  };

  const categories = useMemo(() => Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'cs')), [products]);
  const brands = useMemo(() => (
    Array.from(new Set(products.map(getProductBrand).filter(Boolean)))
      .sort((a, b) => String(a).localeCompare(String(b), 'cs'))
  ), [products]);

  const stats = useMemo(() => {
    return products.reduce((acc, product) => {
      const stock = stockByProduct[product.id];
      const available = Number(stock?.available_qty || 0);
      const minQty = Number(product.stock_min_qty || 0);
      const active = product.is_active && !product.archived_at;
      const margin = marginValue(product);
      const sale = Number(product.default_unit_price || 0);
      return {
        total: acc.total + 1,
        active: acc.active + (active ? 1 : 0),
        manufactured: acc.manufactured + (product.product_type === 'manufactured' ? 1 : 0),
        lowStock: acc.lowStock + (product.product_type === 'manufactured' && minQty > 0 && available <= minQty ? 1 : 0),
        saleValue: acc.saleValue + (active ? sale : 0),
        marginValue: acc.marginValue + (active ? margin : 0),
        trackedPrices: acc.trackedPrices + (supplierPricesByProduct[product.id]?.price_without_vat ? 1 : 0),
      };
    }, { total: 0, active: 0, manufactured: 0, lowStock: 0, saleValue: 0, marginValue: 0, trackedPrices: 0 });
  }, [products, stockByProduct, supplierPricesByProduct]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((product) => {
      const status = getProductStatus(product);
      const stock = stockByProduct[product.id] || {};
      const available = Number(stock.available_qty || 0);
      const minQty = Number(product.stock_min_qty || 0);
      const lowStock = product.product_type === 'manufactured' && minQty > 0 && available <= minQty;
      const hasDatasheet = Boolean(product.datasheet_external_web_url || product.datasheet_file_name || product.datasheet_preview_image_url || product.image_url);

      if (activeFilter === 'active' && status.label !== 'Aktivní') return false;
      if (activeFilter === 'archived' && status.label !== 'Archiv') return false;
      if (typeFilter !== 'all' && product.product_type !== typeFilter) return false;
      if (categoryFilter !== 'all' && product.category !== categoryFilter) return false;
      const brand = getProductBrand(product);
      if (brandFilter !== 'all' && brand !== brandFilter) return false;
      if (supplierFilter !== 'all' && !supplierSlugsByProduct[product.id]?.includes(supplierFilter)) return false;
      if (availabilityFilter === 'low_stock' && !lowStock) return false;
      if (availabilityFilter === 'with_datasheet' && !hasDatasheet) return false;
      if (availabilityFilter === 'missing_datasheet' && hasDatasheet) return false;
      if (!query) return true;
      return [
        product.sku,
        product.code,
        product.name,
        product.description,
        product.category,
        product.product_type,
        brand,
        ...(supplierSearchByProduct[product.id] || []),
        ...metadataSearchValues(product.metadata),
      ]
        .filter(Boolean)
        .some((value) => compactSearchValue(value).includes(query));
    });
  }, [activeFilter, availabilityFilter, brandFilter, categoryFilter, products, search, stockByProduct, supplierFilter, supplierSearchByProduct, supplierSlugsByProduct, typeFilter]);

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
      toast({ title: 'Produkt se nepodařilo archivovat', description: error.message, variant: 'destructive' });
      return;
    }
    toast({ title: 'Produkt archivován' });
    fetchProducts();
  };

  const saveMovement = async () => {
    const quantity = normalizeMovementQuantity(movementForm.movement_type, movementForm.quantity);
    if (!movementForm.catalog_item_id || !quantity) {
      toast({ title: 'Doplňte produkt a množství', variant: 'destructive' });
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
      toast({ title: 'Skladový pohyb se nepodařilo uložit', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: 'Skladový pohyb uložen' });
    setMovementDialogOpen(false);
    fetchProducts();
  };

  const resetFilters = () => {
    setSearch('');
    setTypeFilter('all');
    setActiveFilter('active');
    setCategoryFilter('all');
    setBrandFilter('all');
    setSupplierFilter('all');
    setAvailabilityFilter('all');
  };

  return (
    <div className="min-h-screen bg-slate-50/70 p-3 sm:p-4">
      <div className="mx-auto flex w-full max-w-none flex-col gap-4">
        <PageHeader
          icon={Package}
          title="Produkty"
          description="Centrální katalog pro CRM, nabídky, objednávky a realizace. CRM položky sklad neodečítají, skladové pohyby vznikají až v realizaci."
          actions={(
            <>
              <Button variant="outline" onClick={fetchProducts} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                Obnovit
              </Button>
              <Button onClick={() => navigate('/products/new')} disabled={!canEdit}>
                <Plus className="mr-2 h-4 w-4" />
                Nový produkt
              </Button>
            </>
          )}
        />

        {schemaWarning && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Produktová databáze není kompletní</AlertTitle>
            <AlertDescription>{schemaWarning}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Aktivní položky', value: stats.active, description: `${stats.total} celkem`, icon: Boxes },
            { label: 'Ceníková hodnota', value: formatCurrency(stats.saleValue), description: 'Součet aktivních prodejních cen', icon: Package },
            { label: 'Modelová marže', value: formatCurrency(stats.marginValue), description: `${stats.saleValue > 0 ? ((stats.marginValue / stats.saleValue) * 100).toFixed(1) : '0.0'} %`, icon: BarChart3 },
            { label: 'Skladové produkty', value: stats.manufactured, description: 'Pouze realizace odečítá sklad', icon: Warehouse },
            { label: 'Pod minimem', value: stats.lowStock, description: 'Vyžaduje doplnění', icon: AlertTriangle, danger: stats.lowStock > 0 },
          ].map((item) => (
            <Card key={item.label} className="border-slate-200 bg-white shadow-sm">
              <CardContent className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">{item.label}</p>
                  <p className="mt-1 truncate text-xl font-semibold text-slate-950">{item.value}</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{item.description}</p>
                </div>
                <div className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-md ring-1',
                  item.danger ? 'bg-rose-50 text-rose-700 ring-rose-100' : 'bg-primary/10 text-primary ring-primary/10'
                )}>
                  <item.icon className="h-4 w-4" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b bg-white px-3 py-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="h-4 w-4 text-primary" />
                  AI párování dodavatelských produktů
                </CardTitle>
                <CardDescription>
                  Návrhy shod mezi e-shopy podle názvu, modelových tokenů, kategorie a ceny. Potvrzení pouze přepojí dodavatelskou nabídku na stejný katalogový produkt.
                </CardDescription>
              </div>
              <Button variant="outline" onClick={generateMatchSuggestions} disabled={!canEdit || matchLoading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', matchLoading && 'animate-spin')} />
                Vygenerovat návrhy
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {matchSuggestions.length === 0 ? (
              <div className="flex flex-col gap-1 px-3 py-4 text-sm text-muted-foreground">
                <span>Žádné čekající návrhy. Spusťte generování po importu nových ceníků.</span>
                <span className="text-xs">Bezpečné shody se potvrzují ručně, aby se nesloučily odlišné produkty jen podle podobného názvu.</span>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-slate-50/95">
                    <TableRow>
                      <TableHead className="min-w-[105px]">Shoda</TableHead>
                      <TableHead className="min-w-[280px]">Zdroj</TableHead>
                      <TableHead className="min-w-[280px]">Cílový produkt</TableHead>
                      <TableHead className="min-w-[150px] text-right">Cena zdroje</TableHead>
                      <TableHead className="min-w-[150px] text-right">Cena cíle</TableHead>
                      <TableHead className="min-w-[240px]">Důvody</TableHead>
                      <TableHead className="w-36 text-right">Akce</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matchSuggestions.map((suggestion) => {
                      const reasons = suggestion.reasons || {};
                      return (
                        <TableRow key={suggestion.id}>
                          <TableCell>
                            <Badge className="border-blue-200 bg-blue-50 text-blue-700" variant="outline">
                              {formatPercent(Number(suggestion.confidence || 0) * 100)}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <div className="font-semibold text-slate-950">{suggestion.source_product_name || suggestion.source_catalog_name}</div>
                            <div className="text-xs text-muted-foreground">
                              {suggestion.source_supplier_name} · {suggestion.source_supplier_sku || suggestion.source_catalog_code || '-'}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-start gap-2">
                              <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                              <div>
                                <div className="font-semibold text-slate-950">{suggestion.target_product_name || suggestion.target_catalog_name}</div>
                                <div className="text-xs text-muted-foreground">
                                  {suggestion.target_supplier_name} · {suggestion.target_supplier_sku || suggestion.target_catalog_code || '-'}
                                </div>
                              </div>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {suggestion.source_price_without_vat == null ? '-' : formatCurrency(suggestion.source_price_without_vat, suggestion.source_currency)}
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {suggestion.target_price_without_vat == null ? '-' : formatCurrency(suggestion.target_price_without_vat, suggestion.target_currency)}
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1 text-xs">
                              <Badge variant="secondary">název {formatPercent(Number(reasons.name_similarity || 0) * 100)}</Badge>
                              <Badge variant="secondary">model {formatPercent(Number(reasons.token_overlap || 0) * 100)}</Badge>
                              <Badge variant="secondary">cena {formatPercent(Number(reasons.price_similarity || 0) * 100)}</Badge>
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Potvrdit shodu"
                                disabled={!canEdit || matchLoading}
                                onClick={() => reviewMatchSuggestion(suggestion, 'approved')}
                              >
                                <CheckCircle2 className="h-4 w-4 text-emerald-700" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Odmítnout návrh"
                                disabled={!canEdit || matchLoading}
                                onClick={() => reviewMatchSuggestion(suggestion, 'rejected')}
                              >
                                <XCircle className="h-4 w-4 text-rose-700" />
                              </Button>
                            </div>
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

        <Card className="overflow-hidden border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b bg-white px-3 py-3">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div>
                <CardTitle className="text-base">Produktový katalog</CardTitle>
                <CardDescription>Raynet-like pracovní seznam s cenami, DPH, marží, platností a dostupností.</CardDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative w-full sm:w-[320px]">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Hledat kod, nazev, znacku, SKU dodavatele..."
                    className="h-9 pl-9 text-sm"
                  />
                </div>
                <Select value={typeFilter} onValueChange={setTypeFilter}>
                  <SelectTrigger className="h-9 w-[170px] text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny typy</SelectItem>
                    <SelectItem value="service">Služby</SelectItem>
                    <SelectItem value="manufactured">Skladové produkty</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                  <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue placeholder="Kategorie" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny kategorie</SelectItem>
                    {categories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={brandFilter} onValueChange={setBrandFilter}>
                  <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue placeholder="Znacka" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Vsechny znacky</SelectItem>
                    {brands.map((brand) => <SelectItem key={brand} value={brand}>{brand}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                  <SelectTrigger className="h-9 w-[190px] text-sm"><SelectValue placeholder="Dodavatel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Vsechny dodavatele</SelectItem>
                    {suppliers.map((supplier) => <SelectItem key={supplier.slug} value={supplier.slug}>{supplier.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={availabilityFilter} onValueChange={setAvailabilityFilter}>
                  <SelectTrigger className="h-9 w-[180px] text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny stavy</SelectItem>
                    <SelectItem value="low_stock">Pod minimem</SelectItem>
                    <SelectItem value="with_datasheet">S datasheetem</SelectItem>
                    <SelectItem value="missing_datasheet">Bez datasheetu</SelectItem>
                  </SelectContent>
                </Select>
                <Select value={activeFilter} onValueChange={setActiveFilter}>
                  <SelectTrigger className="h-9 w-[140px] text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Aktivní</SelectItem>
                    <SelectItem value="archived">Archiv</SelectItem>
                    <SelectItem value="all">Vše</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant="outline" size="sm" className="h-9" onClick={resetFilters}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Vyčistit
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-slate-50/95">
                  <TableRow>
                    <TableHead className="min-w-[120px]">Kód</TableHead>
                    <TableHead className="min-w-[320px]">Název produktu</TableHead>
                    <TableHead className="min-w-[120px]">Stav</TableHead>
                    <TableHead className="min-w-[145px]">Řada / typ</TableHead>
                    <TableHead className="min-w-[150px]">Kategorie</TableHead>
                    <TableHead className="min-w-[120px] text-right">Prodej</TableHead>
                    <TableHead className="min-w-[110px] text-right">DPH</TableHead>
                    <TableHead className="min-w-[120px] text-right">Nákup</TableHead>
                    <TableHead className="min-w-[170px]">Dodavatel</TableHead>
                    <TableHead className="min-w-[120px] text-right">Trend ceny</TableHead>
                    <TableHead className="min-w-[130px] text-right">Marže</TableHead>
                    <TableHead className="min-w-[130px] text-right">Dostupné</TableHead>
                    <TableHead className="min-w-[130px]">Datasheet</TableHead>
                    <TableHead className="min-w-[160px]">Platnost</TableHead>
                    <TableHead className="min-w-[120px]">Lokace</TableHead>
                    <TableHead className="w-28 text-right">Akce</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading ? (
                    <TableRow><TableCell colSpan={16} className="h-32 text-center text-muted-foreground">Načítám produkty...</TableCell></TableRow>
                  ) : filteredProducts.length === 0 ? (
                    <TableRow><TableCell colSpan={16} className="h-32 text-center text-muted-foreground">Žádný produkt neodpovídá filtrům.</TableCell></TableRow>
                  ) : filteredProducts.map((product) => {
                    const stock = stockByProduct[product.id] || {};
                    const available = Number(stock.available_qty || 0);
                    const minQty = Number(product.stock_min_qty || 0);
                    const lowStock = product.product_type === 'manufactured' && minQty > 0 && available <= minQty;
                    const hasDatasheet = Boolean(product.datasheet_external_web_url || product.datasheet_file_name || product.datasheet_preview_image_url || product.image_url);
                    const status = getProductStatus(product);
                    const supplierPrice = supplierPricesByProduct[product.id];
                    const brand = getProductBrand(product);
                    const bestPurchasePrice = Number(supplierPrice?.price_without_vat ?? product.purchase_price ?? 0);
                    const trendAmount = Number(supplierPrice?.price_change_amount || 0);
                    const TrendIcon = trendAmount < 0 ? TrendingDown : trendAmount > 0 ? TrendingUp : Minus;
                    return (
                      <TableRow key={product.id} className={cn('cursor-pointer bg-white hover:bg-blue-50/40', status.label === 'Archiv' && 'opacity-60')} onClick={() => navigate(`/products/${product.id}/edit`)}>
                        <TableCell className="font-mono text-xs font-semibold text-slate-700">{product.sku || product.code || '-'}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold text-slate-950">{product.name}</span>
                            {brand && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{brand}</Badge>}
                          </div>
                          {product.description && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{product.description}</div>}
                        </TableCell>
                        <TableCell><Badge variant="outline" className={status.className}>{status.label}</Badge></TableCell>
                        <TableCell><Badge variant={product.product_type === 'manufactured' ? 'default' : 'secondary'}>{productTypeLabels[product.product_type] || product.product_type || '-'}</Badge></TableCell>
                        <TableCell>{product.category || '-'}</TableCell>
                        <TableCell className="text-right font-semibold">{formatCurrency(product.default_unit_price, product.currency)}</TableCell>
                        <TableCell className="text-right">{Number(product.default_vat_rate ?? 21)} %</TableCell>
                        <TableCell className="text-right font-semibold text-slate-900">
                          {supplierPrice?.price_without_vat ? formatCurrency(bestPurchasePrice, supplierPrice.currency || product.currency) : <span className="text-muted-foreground">Bez ceny</span>}
                        </TableCell>
                        <TableCell>
                          {supplierPrice ? (
                            <div className="min-w-0">
                              <div className="truncate font-medium text-slate-800">{supplierPrice.supplier_name}</div>
                              <div className="truncate text-xs text-muted-foreground">{supplierPrice.supplier_sku || '-'} · {supplierPrice.supplier_offer_count || 1} e-shop</div>
                            </div>
                          ) : <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">Bez aktuální ceny</Badge>}
                        </TableCell>
                        <TableCell className={cn('text-right font-semibold', trendAmount < 0 ? 'text-emerald-700' : trendAmount > 0 ? 'text-rose-700' : 'text-slate-500')}>
                          <div className="flex items-center justify-end gap-1">
                            <TrendIcon className="h-3.5 w-3.5" />
                            {supplierPrice?.price_change_percent == null ? '-' : `${Number(supplierPrice.price_change_percent).toFixed(1)} %`}
                          </div>
                          {supplierPrice?.scraped_at && <div className="text-xs font-normal text-muted-foreground">{new Date(supplierPrice.scraped_at).toLocaleDateString('cs-CZ')}</div>}
                        </TableCell>
                        <TableCell className={cn('text-right font-semibold', marginValue({ ...product, purchase_price: bestPurchasePrice }) < 0 ? 'text-rose-700' : 'text-emerald-700')}>
                          <div>{formatCurrency(Number(product.default_unit_price || 0) - bestPurchasePrice, product.currency)}</div>
                          <div className="text-xs font-normal text-muted-foreground">{Number(product.default_unit_price || 0) > 0 ? (((Number(product.default_unit_price || 0) - bestPurchasePrice) / Number(product.default_unit_price || 0)) * 100).toFixed(1) : '0.0'} %</div>
                        </TableCell>
                        <TableCell className={cn('text-right font-semibold', lowStock && 'text-rose-700')}>
                          {product.product_type === 'manufactured' ? formatQty(available, product.unit) : '-'}
                        </TableCell>
                        <TableCell>
                          {hasDatasheet ? (
                            product.datasheet_external_web_url ? (
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
                                Otevřít
                              </Button>
                            ) : <Badge variant="outline">Připraveno</Badge>
                          ) : <span className="text-muted-foreground">-</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1 text-xs text-muted-foreground">
                            <CalendarClock className="h-3.5 w-3.5" />
                            {(product.valid_from || product.valid_until) ? `${product.valid_from || '-'} - ${product.valid_until || '-'}` : 'Bez omezení'}
                          </div>
                        </TableCell>
                        <TableCell>{product.warehouse_location || '-'}</TableCell>
                        <TableCell onClick={(event) => event.stopPropagation()}>
                          <div className="flex justify-end gap-1">
                            {product.product_type === 'manufactured' && (
                              <Button variant="ghost" size="icon" onClick={() => openMovementDialog(product)} disabled={!canEdit} title="Skladový pohyb">
                                <Warehouse className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => navigate(`/products/${product.id}/edit`)} disabled={!canEdit} title="Upravit">
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => archiveProduct(product)} disabled={!canEdit || !product.is_active} title="Archivovat">
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
            <div className="flex flex-col gap-2 border-t bg-slate-50 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
              <span>Zobrazeno {filteredProducts.length} z {products.length} produktů</span>
              <span>Prodejní ceny jsou snapshotovány do OP/NAB/OBJ při vložení položky.</span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={movementDialogOpen} onOpenChange={setMovementDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Skladový pohyb</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label>Typ pohybu</Label>
              <Select value={movementForm.movement_type} onValueChange={(value) => setMovementForm({ ...movementForm, movement_type: value })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(movementTypeLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Množství</Label>
                <Input type="number" value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Jedn. náklad</Label>
                <Input type="number" value={movementForm.unit_cost} onChange={(event) => setMovementForm({ ...movementForm, unit_cost: event.target.value })} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Poznámka</Label>
              <Textarea value={movementForm.note} onChange={(event) => setMovementForm({ ...movementForm, note: event.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovementDialogOpen(false)}>Zavřít</Button>
            <Button onClick={saveMovement} disabled={saving || !canEdit}>Uložit pohyb</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Products;