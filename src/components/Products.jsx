import React, { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { fetchAllCrmRows, fetchCrmRowsByIds } from '@/lib/crmDataAccess';
import { useNavigate } from 'react-router-dom';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Boxes,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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
import ProductSetManager from '@/components/ProductSetManager';
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
import { createTimedAbortController, isRequestAbortError } from '@/lib/requestControl';
import { formatMoney, formatPercent } from '@/lib/financePresentation';
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

const formatCurrency = (value, currency = 'CZK') => formatMoney(value, { currency: currency || 'CZK' });

const formatQty = (value, unit = 'ks') => `${new Intl.NumberFormat('cs-CZ', {
  maximumFractionDigits: 3,
}).format(Number(value || 0))} ${unit || 'ks'}`;

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
  const [page, setPage] = useState(1);
  const [totalProducts, setTotalProducts] = useState(0);
  const [catalogOverview, setCatalogOverview] = useState(null);
  const pageSize = 100;
  const deferredSearch = useDeferredValue(search);
  const fetchRequestRef = useRef({ id: 0, controller: null });

  const fetchProducts = useCallback(async () => {
    fetchRequestRef.current.controller?.abort();
    const requestId = fetchRequestRef.current.id + 1;
    const request = createTimedAbortController(20_000);
    fetchRequestRef.current = { id: requestId, controller: request.controller };
    setLoading(true);
    setSchemaWarning('');

    try {
      const useServerPage = brandFilter === 'all' && supplierFilter === 'all' && availabilityFilter === 'all' && !deferredSearch.trim();
      const productQueryFactory = () => {
        let productQuery = supabase
          .from('commercial_item_catalog')
          .select('id, sku, code, name, description, category, unit, product_type, default_unit_price, default_vat_rate, purchase_price, currency, stock_min_qty, warehouse_location, allow_backorder, valid_from, valid_until, datasheet_external_web_url, datasheet_file_name, datasheet_preview_image_url, image_url, preferred_supplier_offer_id, is_active, archived_at, metadata, created_at, updated_at', { count: 'exact' })
          .order('name', { ascending: true }).order('id');
        if (activeFilter === 'active') {
          const today = new Date().toISOString().slice(0, 10);
          productQuery = productQuery.eq('is_active', true).is('archived_at', null)
            .or('valid_from.is.null,valid_from.lte.' + today)
            .or('valid_until.is.null,valid_until.gte.' + today);
        }
        if (activeFilter === 'archived') productQuery = productQuery.or('is_active.eq.false,archived_at.not.is.null');
        if (typeFilter !== 'all') productQuery = productQuery.eq('product_type', typeFilter);
        if (categoryFilter !== 'all') productQuery = productQuery.eq('category', categoryFilter);
        return productQuery.abortSignal(request.signal);
      };
      // Advanced search includes supplier and metadata values. Fetch every
      // matching page before local filtering instead of silently truncating at 2,000.
      const { data: productData, error: productError, count: productCount } = useServerPage
        ? await productQueryFactory().range((page - 1) * pageSize, page * pageSize - 1)
        : await fetchAllCrmRows(productQueryFactory);
      if (productError) throw productError;
      setProductSchemaReady(true);

      if (requestId !== fetchRequestRef.current.id) return;
      setTotalProducts(useServerPage ? Number(productCount || 0) : (productData || []).length);
      const productIds = (productData || []).map((product) => product.id);

      const [stockRes, supplierPriceRes, supplierRes, usageRes, overviewRes] = await Promise.all([
        fetchCrmRowsByIds(productIds, (ids) => supabase
          .from('product_stock_status')
          .select('catalog_item_id, stock_qty, reserved_qty, available_qty', { count: 'exact' })
          .in('catalog_item_id', ids).order('catalog_item_id')
          .abortSignal(request.signal)),
        fetchCrmRowsByIds(productIds, (ids) => supabase
          .from('product_supplier_current_prices')
          .select('catalog_item_id, supplier_offer_id, supplier_name, supplier_slug, supplier_sku, supplier_product_url, price_without_vat, currency, availability_note, scraped_at, price_change_amount, price_change_percent, supplier_offer_count, price_rank', { count: 'exact' })
          .in('catalog_item_id', ids)
          .order('catalog_item_id').order('price_rank', { ascending: true }).order('supplier_offer_id')
          .abortSignal(request.signal)),
        supabase
          .from('product_suppliers')
          .select('slug, name, is_active')
          .eq('is_active', true)
          .order('name', { ascending: true })
          .abortSignal(request.signal),
        fetchCrmRowsByIds(productIds, (ids) => supabase
          .from('product_usage_stats')
          .select('catalog_item_id, total_usage_count, last_used_at', { count: 'exact' })
          .in('catalog_item_id', ids).order('catalog_item_id')
          .abortSignal(request.signal)),
        supabase
          .rpc('get_product_catalog_overview')
          .abortSignal(request.signal),
      ]);
      if (requestId !== fetchRequestRef.current.id) return;

      if ((supplierFilter !== 'all' || deferredSearch.trim()) && supplierPriceRes.error) throw supplierPriceRes.error;
      if (availabilityFilter === 'low_stock' && stockRes.error) throw stockRes.error;
      const warnings = [];
      if (stockRes.error) warnings.push('Skladovy prehled zatim neni dostupny.');
      if (supplierPriceRes.error) warnings.push('Dodavatelske ceny zatim nejsou dostupne.');
      if (supplierRes.error) warnings.push('Dodavatele zatim nejsou dostupni.');
      if (usageRes.error) warnings.push('Statistika pouziti produktu zatim neni dostupna.');
      if (overviewRes.error) warnings.push('Souhrn katalogu zatim neni dostupny.');
      if (warnings.length) setSchemaWarning(warnings.join(' '));

      setSuppliers(supplierRes.error ? [] : (supplierRes.data || []));
      setCatalogOverview(overviewRes.error ? null : overviewRes.data);

      if (supplierPriceRes.error) {
        setSupplierPricesByProduct({});
        setSupplierSlugsByProduct({});
        setSupplierSearchByProduct({});
      } else {
        const supplierPriceData = supplierPriceRes.data || [];
        setSupplierPricesByProduct(supplierPriceData.reduce((acc, row) => {
          if (!acc[row.catalog_item_id] || Number(row.price_rank) === 1) {
            acc[row.catalog_item_id] = row;
          }
          return acc;
        }, {}));
        setSupplierSlugsByProduct(supplierPriceData.reduce((acc, row) => {
          if (!row.catalog_item_id || !row.supplier_slug) return acc;
          acc[row.catalog_item_id] = acc[row.catalog_item_id] || [];
          if (!acc[row.catalog_item_id].includes(row.supplier_slug)) acc[row.catalog_item_id].push(row.supplier_slug);
          return acc;
        }, {}));
        setSupplierSearchByProduct(supplierPriceData.reduce((acc, row) => {
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

      const usageByProductId = new Map((usageRes.data || []).map((row) => [row.catalog_item_id, row]));
      setProducts((productData || []).map((product) => {
        const usage = usageByProductId.get(product.id) || {};
        return {
          ...product,
          usage_count: usage.total_usage_count || 0,
          last_used_at: usage.last_used_at || null,
        };
      }));
      setStockByProduct(stockRes.error ? {} : (stockRes.data || []).reduce((acc, row) => ({
        ...acc,
        [row.catalog_item_id]: row,
      }), {}));
    } catch (error) {
      if (requestId !== fetchRequestRef.current.id) return;
      console.error('Product catalog failed to load:', error);
      setProducts([]);
      setStockByProduct({});
      setSuppliers([]);
      setSupplierPricesByProduct({});
      setSupplierSlugsByProduct({});
      setSupplierSearchByProduct({});
      setProductSchemaReady(false);
      setTotalProducts(0);
      setCatalogOverview(null);
      setSchemaWarning(isRequestAbortError(error) ? 'Načítání katalogu překročilo časový limit.' : error?.message || 'Katalog produktů se nepodařilo načíst.');
    } finally {
      request.dispose();
      if (requestId === fetchRequestRef.current.id) setLoading(false);
    }
  }, [activeFilter, availabilityFilter, brandFilter, categoryFilter, deferredSearch, page, supplierFilter, typeFilter]);

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
    return () => fetchRequestRef.current.controller?.abort();
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

  const categories = useMemo(() => {
    const values = catalogOverview?.categories?.length
      ? catalogOverview.categories
      : products.map((product) => product.category).filter(Boolean);
    return Array.from(new Set(values)).sort((a, b) => String(a).localeCompare(String(b), 'cs'));
  }, [catalogOverview, products]);
  const brands = useMemo(() => (
    Array.from(new Set([
      ...(catalogOverview?.brands || []),
      ...products.map(getProductBrand).filter(Boolean),
    ]))
      .sort((a, b) => String(a).localeCompare(String(b), 'cs'))
  ), [catalogOverview, products]);

  const stats = useMemo(() => {
    if (catalogOverview?.stats) {
      return Object.fromEntries(Object.entries(catalogOverview.stats).map(([key, value]) => [key, Number(value || 0)]));
    }
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
  }, [catalogOverview, products, stockByProduct, supplierPricesByProduct]);

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

  const usesServerPage = brandFilter === 'all' && supplierFilter === 'all' && availabilityFilter === 'all' && !deferredSearch.trim();
  const pageCount = Math.max(1, Math.ceil((usesServerPage ? totalProducts : filteredProducts.length) / pageSize));
  const pagedProducts = useMemo(
    () => usesServerPage ? filteredProducts : filteredProducts.slice((page - 1) * pageSize, page * pageSize),
    [filteredProducts, page, usesServerPage]
  );

  useEffect(() => {
    setPage(1);
  }, [activeFilter, availabilityFilter, brandFilter, categoryFilter, search, supplierFilter, typeFilter]);

  useEffect(() => {
    if (page > pageCount) setPage(pageCount);
  }, [page, pageCount]);

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
            { label: 'Aktivní položky', value: loading ? '...' : stats.active, description: loading ? 'Načítám katalog' : `${stats.total} celkem`, icon: Boxes },
            { label: 'Ceníková hodnota', value: loading ? '...' : formatCurrency(stats.saleValue), description: 'Součet aktivních prodejních cen', icon: Package },
            { label: 'Modelová marže', value: loading ? '...' : formatCurrency(stats.marginValue), description: loading ? 'Počítám marži' : `${stats.saleValue > 0 ? ((stats.marginValue / stats.saleValue) * 100).toFixed(1) : '0.0'} %`, icon: BarChart3 },
            { label: 'Skladové produkty', value: loading ? '...' : stats.manufactured, description: 'Pouze realizace odečítá sklad', icon: Warehouse },
            { label: 'Pod minimem', value: loading ? '...' : stats.lowStock, description: 'Vyžaduje doplnění', icon: AlertTriangle, danger: !loading && stats.lowStock > 0 },
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

        <ProductSetManager products={products} canEdit={hasPermission('crm', 'can_edit') || hasPermission('crm', 'can_admin') || hasPermission('settings', 'can_edit') || hasPermission('settings', 'can_admin')} />

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
                    placeholder="Hledat kód, název, značku, SKU dodavatele..."
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
                  <SelectTrigger className="h-9 w-[160px] text-sm"><SelectValue placeholder="Značka" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všechny značky</SelectItem>
                    {brands.map((brand) => <SelectItem key={brand} value={brand}>{brand}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                  <SelectTrigger className="h-9 w-[190px] text-sm"><SelectValue placeholder="Dodavatel" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Všichni dodavatelé</SelectItem>
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
                    <TableRow>
                      <TableCell colSpan={16} className="h-32 text-center">
                        <div className="flex flex-col items-center justify-center gap-2 text-muted-foreground">
                          <RefreshCw className="h-5 w-5 animate-spin text-primary" />
                          <div className="font-medium text-slate-700">Načítám produktový katalog...</div>
                          <div className="text-xs">Počítám ceny, dodavatele a skladovou dostupnost.</div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : filteredProducts.length === 0 ? (
                    <TableRow><TableCell colSpan={16} className="h-32 text-center text-muted-foreground">Žádný produkt neodpovídá filtrům.</TableCell></TableRow>
                  ) : pagedProducts.map((product) => {
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
                      <TableRow
                        key={product.id}
                        className={cn('cursor-pointer bg-white hover:bg-blue-50/40', status.label === 'Archiv' && 'opacity-60')}
                        onClick={() => navigate(`/products/${product.id}/edit`)}
                        role="link"
                        tabIndex={0}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            navigate(`/products/${product.id}/edit`);
                          }
                        }}
                      >
                        <TableCell className="font-mono text-xs font-semibold text-slate-700">{product.sku || product.code || '-'}</TableCell>
                        <TableCell>
                          <div className="flex min-w-0 items-start justify-between gap-2">
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-950">{product.name}</span>
                                {brand && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">{brand}</Badge>}
                              </div>
                              {product.description && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{product.description}</div>}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-7 shrink-0 px-2 text-xs text-primary"
                              onClick={(event) => {
                                event.stopPropagation();
                                navigate(`/products/${product.id}/edit`);
                              }}
                            >
                              <Edit3 className="mr-1 h-3.5 w-3.5" />
                              Detail
                            </Button>
                          </div>
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
                              <Button variant="ghost" size="icon" onClick={() => openMovementDialog(product)} disabled={!canEdit} title="Skladový pohyb" aria-label={`Skladový pohyb produktu ${product.name}`}>
                                <Warehouse className="h-4 w-4" />
                              </Button>
                            )}
                            <Button variant="ghost" size="icon" onClick={() => navigate(`/products/${product.id}/edit`)} disabled={!canEdit} title="Upravit" aria-label={`Upravit produkt ${product.name}`}>
                              <Edit3 className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => archiveProduct(product)} disabled={!canEdit || !product.is_active} title="Archivovat" aria-label={`Archivovat produkt ${product.name}`}>
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
            <div className="flex flex-col gap-3 border-t bg-slate-50 px-3 py-2 text-xs text-muted-foreground lg:flex-row lg:items-center lg:justify-between">
              <span>
                Zobrazeno {filteredProducts.length ? (page - 1) * pageSize + 1 : 0}–{usesServerPage ? Math.min(page * pageSize, totalProducts) : Math.min(page * pageSize, filteredProducts.length)} z {usesServerPage ? totalProducts : filteredProducts.length} produktů
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span>Prodejní ceny jsou snapshotovány do OP/NAB/OBJ při vložení položky.</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page <= 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  aria-label="Předchozí stránka produktů"
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-16 text-center font-medium text-slate-700">{page} / {pageCount}</span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  disabled={page >= pageCount}
                  onClick={() => setPage((current) => Math.min(pageCount, current + 1))}
                  aria-label="Další stránka produktů"
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
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
