import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, BarChart3, CalendarClock, Database, ExternalLink, FileText, Image, Minus, Package, Save, Store, TrendingDown, TrendingUp, UploadCloud, History } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { uploadProductDatasheet } from '@/lib/documentStorageService';
import { crmCommercialDocumentPath, crmOpportunityPath } from '@/lib/crmRoutes';
import { formatMoney, formatPercent, VAT_RATE_OPTIONS } from '@/lib/financePresentation';

const emptyProduct = {
  id: null,
  sku: '',
  code: '',
  name: '',
  description: '',
  category: '',
  unit: 'ks',
  product_type: 'service',
  default_unit_price: 0,
  default_vat_rate: 21,
  purchase_price: 0,
  currency: 'CZK',
  stock_min_qty: '',
  warehouse_location: '',
  allow_backorder: false,
  valid_from: '',
  valid_until: '',
  datasheet_storage_provider: 'sharepoint',
  datasheet_storage_connection_id: '',
  datasheet_external_file_id: '',
  datasheet_external_web_url: '',
  datasheet_file_name: '',
  datasheet_preview_image_url: '',
  datasheet_storage_metadata: {},
  image_url: '',
  is_active: true,
  metadata: {},
};

const normalizeNumber = (value) => {
  if (value === '' || value === null || value === undefined) return null;
  return Number(String(value).replace(',', '.')) || 0;
};

const groupProductFields = (fields = []) => fields.reduce((acc, field) => {
  const group = field.field_group || 'Technicke parametry';
  return { ...acc, [group]: [...(acc[group] || []), field] };
}, {});

const formatCurrency = formatMoney;

const productTypeLabels = {
  service: 'Služba',
  manufactured: 'Výrobek / sklad',
};


const productAuditActionLabels = {
  product_created: 'Produkt vytvoren',
  product_updated: 'Produkt upraven',
  product_deleted: 'Produkt odstranen',
  product_set_created: 'Set produktu vytvoren',
  product_set_updated: 'Set produktu upraven',
  product_set_deleted: 'Set produktu odstranen',
  product_set_item_added: 'Polozka pridana do setu',
  product_set_item_updated: 'Polozka v setu upravena',
  product_set_item_removed: 'Polozka odebrana ze setu',
};

const productAuditFieldLabels = {
  sku: 'SKU',
  code: 'Kod',
  name: 'Nazev',
  description: 'Popis',
  category: 'Kategorie',
  unit: 'MJ',
  product_type: 'Typ produktu',
  default_unit_price: 'Prodejni cena',
  default_vat_rate: 'DPH',
  purchase_price: 'Nakupni cena',
  currency: 'Mena',
  stock_min_qty: 'Minimalni sklad',
  warehouse_location: 'Skladova pozice',
  allow_backorder: 'Povolit minusovy stav',
  valid_from: 'Platnost od',
  valid_until: 'Platnost do',
  datasheet_external_web_url: 'Datasheet URL',
  datasheet_file_name: 'Datasheet',
  datasheet_preview_image_url: 'Nahled datasheetu',
  image_url: 'Obrazek',
  preferred_supplier_offer_id: 'Preferovany dodavatel',
  is_active: 'Aktivni',
  archived_at: 'Archivace',
  metadata: 'Parametry',
  quantity: 'Mnozstvi',
  sort_order: 'Poradi',
  note: 'Poznamka',
  catalog_item_id: 'Produkt',
};

const formatChangedFields = (fields = []) => {
  if (!Array.isArray(fields) || fields.length === 0) return '';
  return fields.map((field) => productAuditFieldLabels[field] || field).join(', ');
};

const ProductForm = () => {
  const { productId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, hasPermission } = useAuth();
  const canEdit = hasPermission('crm', 'can_edit') || hasPermission('realizace', 'can_edit') || hasPermission('settings', 'can_admin');
  const isEditing = Boolean(productId);

  const [form, setForm] = useState(emptyProduct);
  const [productFields, setProductFields] = useState([]);
  const [usageHistory, setUsageHistory] = useState([]);
  const [auditHistory, setAuditHistory] = useState([]);
  const [supplierPrices, setSupplierPrices] = useState([]);
  const [priceHistory, setPriceHistory] = useState([]);
  const [storageConnections, setStorageConnections] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [auditHistoryLoading, setAuditHistoryLoading] = useState(false);
  const [datasheetFile, setDatasheetFile] = useState(null);
  const [productSchemaReady, setProductSchemaReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState('');

  const groupedProductFields = useMemo(() => groupProductFields(productFields), [productFields]);

  const fetchUsageHistory = useCallback(async () => {
    if (!productId) {
      setUsageHistory([]);
      return;
    }

    setHistoryLoading(true);
    const [opportunityItemsRes, documentItemsRes, realizaceOrdersRes] = await Promise.all([
      supabase
        .from('crm_opportunity_items')
        .select('id, opportunity_id, code, name, quantity, unit, unit_price, line_total, opportunity:opportunity_id(id, number, title, subject:subject_id(id, name))')
        .eq('catalog_item_id', productId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('crm_commercial_document_items')
        .select('id, document_id, code, name, quantity, unit, unit_price, line_total, document:document_id(id, number, title, type, subject:subject_id(id, name), opportunity:opportunity_id(id, number, title))')
        .eq('catalog_item_id', productId)
        .order('sort_order', { ascending: true }),
      supabase
        .from('realizace_orders')
        .select('id, realizace_id, order_number, commercial_status, total_amount, items, item_links')
        .filter('item_links', 'cs', JSON.stringify([{ catalog_item_id: productId }]))
        .order('created_at', { ascending: false }),
    ]);

    const opportunityRows = (opportunityItemsRes.data || []).map((item) => ({
      id: `op-${item.id}`,
      type: 'Obchodní případ',
      number: item.opportunity?.number || 'OP',
      title: item.opportunity?.title || item.name,
      subject: item.opportunity?.subject?.name || '-',
      quantity: item.quantity,
      unit: item.unit,
      total: item.line_total,
      href: item.opportunity ? crmOpportunityPath(item.opportunity) : '/crm',
    }));

    const documentRows = (documentItemsRes.data || []).map((item) => ({
      id: `doc-${item.id}`,
      type: item.document?.type === 'order' ? 'Objednávka' : 'Nabídka',
      number: item.document?.number || '-',
      title: item.document?.title || item.name,
      subject: item.document?.subject?.name || item.document?.opportunity?.title || '-',
      quantity: item.quantity,
      unit: item.unit,
      total: item.line_total,
      href: item.document ? crmCommercialDocumentPath(item.document) : (item.document?.type === 'order' ? `/crm/orders/${item.document_id}` : `/crm/offers/${item.document_id}`),
    }));

    const realizaceRows = (realizaceOrdersRes.data || []).flatMap((order) => {
      const links = Array.isArray(order.item_links) ? order.item_links : [];
      const items = Array.isArray(order.items) ? order.items : [];

      return links
        .filter((link) => link.catalog_item_id === productId)
        .map((link, rowIndex) => {
          const item = items[Number(link.index)] || {};
          return {
            id: `realizace-${order.id}-${rowIndex}`,
            type: 'Realizace',
            number: order.order_number || 'Realizace',
            title: item.description || order.order_number || 'Položka realizace',
            subject: order.commercial_status === 'offer' ? 'Nabídka v realizaci' : 'Objednávka v realizaci',
            quantity: item.quantity,
            unit: item.unit,
            total: item.total_price || order.total_amount,
            href: order.realizace_id ? `/realizace/${order.realizace_id}#orders` : '/realizace',
          };
        });
    });

    setUsageHistory([...opportunityRows, ...documentRows, ...realizaceRows]);
    setHistoryLoading(false);
  }, [productId]);


  const fetchAuditHistory = useCallback(async () => {
    if (!productId) {
      setAuditHistory([]);
      return;
    }

    setAuditHistoryLoading(true);
    const [productLogsRes, setItemLogsRes] = await Promise.all([
      supabase
        .from('audit_logs')
        .select('id, created_at, user_email, action, details')
        .in('action', ['product_created', 'product_updated', 'product_deleted'])
        .filter('details->>catalog_item_id', 'eq', productId)
        .order('created_at', { ascending: false })
        .limit(60),
      supabase
        .from('audit_logs')
        .select('id, created_at, user_email, action, details')
        .in('action', ['product_set_item_added', 'product_set_item_updated', 'product_set_item_removed'])
        .filter('details->>product_id', 'eq', productId)
        .order('created_at', { ascending: false })
        .limit(60),
    ]);

    if (productLogsRes.error && setItemLogsRes.error) {
      setAuditHistory([]);
      setAuditHistoryLoading(false);
      return;
    }

    const merged = [...(productLogsRes.data || []), ...(setItemLogsRes.data || [])]
      .filter((log, index, all) => all.findIndex((candidate) => candidate.id === log.id) === index)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    setAuditHistory(merged);
    setAuditHistoryLoading(false);
  }, [productId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setWarning('');

    const { data: fieldData } = await supabase
      .from('product_field_definitions')
      .select('field_key, label, field_type, field_group, unit, options, ai_hint, is_required, sort_order')
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    setProductFields(fieldData || []);

    const { data: storageData } = await supabase
      .from('document_storage_connections')
      .select('id, provider, name, status, is_default')
      .in('provider', ['sharepoint', 'google_drive', 'supabase'])
      .order('is_default', { ascending: false });
    setStorageConnections(storageData || []);
    fetchUsageHistory();
    fetchAuditHistory();

    if (productId) {
      const [currentPriceRes, priceHistoryRes] = await Promise.all([
        supabase
          .from('product_supplier_current_prices')
          .select('catalog_item_id, supplier_offer_id, supplier_name, supplier_slug, supplier_sku, supplier_product_url, price_without_vat, currency, availability_note, scraped_at, price_change_amount, price_change_percent, supplier_offer_count, price_rank')
          .eq('catalog_item_id', productId)
          .order('price_rank', { ascending: true }),
        supabase
          .from('product_supplier_price_history')
          .select('supplier_offer_id, supplier_name, supplier_sku, scraped_at, price_without_vat, currency, availability_note, price_raw')
          .eq('catalog_item_id', productId)
          .order('scraped_at', { ascending: true }),
      ]);
      setSupplierPrices(currentPriceRes.error ? [] : (currentPriceRes.data || []));
      setPriceHistory(priceHistoryRes.error ? [] : (priceHistoryRes.data || []));
    } else {
      setSupplierPrices([]);
      setPriceHistory([]);
    }

    if (!isEditing) {
      const { error: schemaCheckError } = await supabase
        .from('commercial_item_catalog')
        .select('id, sku')
        .limit(1);
      if (schemaCheckError) {
        setProductSchemaReady(false);
        setWarning('Online databáze ještě nemá produktovou migraci. Nový produkt se uloží jen do původního katalogu bez skladu a datasheet polí.');
      } else {
        setProductSchemaReady(true);
      }
      setForm(emptyProduct);
      setLoading(false);
      return;
    }

    let { data, error } = await supabase
      .from('commercial_item_catalog')
      .select('id, sku, code, name, description, category, unit, product_type, default_unit_price, default_vat_rate, purchase_price, currency, stock_min_qty, warehouse_location, allow_backorder, valid_from, valid_until, datasheet_storage_provider, datasheet_storage_connection_id, datasheet_external_file_id, datasheet_external_web_url, datasheet_file_name, datasheet_preview_image_url, datasheet_storage_metadata, image_url, is_active, archived_at, metadata')
      .eq('id', productId)
      .single();

    if (error) {
      const fallback = await supabase
        .from('commercial_item_catalog')
        .select('id, code, name, description, category, unit, default_unit_price, default_vat_rate, is_active, metadata')
        .eq('id', productId)
        .single();

      if (fallback.error) {
        toast({ title: 'Produkt se nepodařilo načíst', description: fallback.error.message, variant: 'destructive' });
        setLoading(false);
        return;
      }

      data = {
        ...fallback.data,
        sku: fallback.data.code || '',
        product_type: 'service',
        purchase_price: 0,
        currency: 'CZK',
        stock_min_qty: '',
        warehouse_location: '',
        allow_backorder: false,
        valid_from: '',
        valid_until: '',
        datasheet_storage_provider: 'sharepoint',
        datasheet_storage_connection_id: '',
        datasheet_external_file_id: '',
        datasheet_external_web_url: '',
        datasheet_file_name: '',
        datasheet_preview_image_url: '',
        datasheet_storage_metadata: {},
        image_url: '',
        archived_at: null,
      };
      setProductSchemaReady(false);
      setWarning('Online databáze ještě nemá produktovou migraci. Uloží se jen základní katalogová pole.');
    } else {
      setProductSchemaReady(true);
    }

    setForm({
      ...emptyProduct,
      ...data,
      metadata: data.metadata || {},
      valid_from: data.valid_from || '',
      valid_until: data.valid_until || '',
      datasheet_storage_connection_id: data.datasheet_storage_connection_id || '',
      datasheet_storage_metadata: data.datasheet_storage_metadata || {},
      stock_min_qty: data.stock_min_qty ?? '',
      warehouse_location: data.warehouse_location || '',
    });
    setLoading(false);
  }, [fetchAuditHistory, fetchUsageHistory, isEditing, productId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateMetadata = (fieldKey, value) => {
    setForm((current) => ({
      ...current,
      metadata: {
        ...(current.metadata || {}),
        [fieldKey]: value,
      },
    }));
  };

  const renderProductFieldInput = (field, inputId) => {
    const value = form.metadata?.[field.field_key] ?? '';
    const disabled = saving || !canEdit;

    if (field.field_type === 'textarea') {
      return <Textarea id={inputId} value={value} onChange={(event) => updateMetadata(field.field_key, event.target.value)} disabled={disabled} placeholder={field.ai_hint || undefined} />;
    }

    if (field.field_type === 'boolean') {
      return (
        <div className="flex h-10 items-center justify-between rounded-md border px-3">
          <span className="text-sm text-muted-foreground">{value ? 'Ano' : 'Ne'}</span>
          <Switch id={inputId} checked={Boolean(value)} onCheckedChange={(checked) => updateMetadata(field.field_key, checked)} disabled={disabled} />
        </div>
      );
    }

    if (field.field_type === 'select') {
      const options = Array.isArray(field.options) ? field.options : [];
      return (
        <Select value={String(value || '')} onValueChange={(nextValue) => updateMetadata(field.field_key, nextValue)} disabled={disabled}>
          <SelectTrigger id={inputId}>
            <SelectValue placeholder="Vyberte hodnotu" />
          </SelectTrigger>
          <SelectContent>
            {options.length === 0 ? (
              <SelectItem value="__empty" disabled>Bez definovaných možností</SelectItem>
            ) : options.map((option) => (
              <SelectItem key={option} value={option}>{option}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    }

    return (
      <div className="flex gap-2">
        <Input
          id={inputId}
          type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'}
          value={value}
          onChange={(event) => updateMetadata(field.field_key, field.field_type === 'number' ? normalizeNumber(event.target.value) : event.target.value)}
          disabled={disabled}
          placeholder={field.ai_hint || undefined}
        />
        {field.unit && <div className="flex min-w-12 items-center justify-center rounded-md border bg-slate-50 px-2 text-sm text-muted-foreground">{field.unit}</div>}
      </div>
    );
  };

  const uploadDatasheetForProduct = async (savedProduct) => {
    if (!datasheetFile || !productSchemaReady) return null;

    const upload = await uploadProductDatasheet({
      file: datasheetFile,
      product: {
        id: savedProduct.id,
        sku: savedProduct.sku || form.sku,
        code: savedProduct.code || form.code,
        name: savedProduct.name || form.name,
      },
      connectionId: form.datasheet_storage_connection_id || null,
    });

    const { error } = await supabase
      .from('commercial_item_catalog')
      .update(upload.storageFields)
      .eq('id', savedProduct.id);

    if (error) throw error;
    return upload;
  };

  const saveProduct = async () => {
    if (!canEdit) return;
    if (!form.name.trim()) {
      toast({ title: 'Doplňte název produktu', variant: 'destructive' });
      return;
    }
    const normalizedCode = (form.sku || form.code || '').trim();
    if (!normalizedCode) {
      toast({ title: 'Doplňte unikátní kód produktu', variant: 'destructive' });
      return;
    }
    if (form.valid_from && form.valid_until && form.valid_from > form.valid_until) {
      toast({ title: 'Platnost od nemůže být později než platnost do', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const payload = {
      sku: normalizedCode,
      code: normalizedCode,
      name: form.name.trim(),
      description: form.description || null,
      category: form.category || null,
      unit: form.unit || 'ks',
      product_type: form.product_type || 'service',
      default_unit_price: normalizeNumber(form.default_unit_price) || 0,
      default_vat_rate: normalizeNumber(form.default_vat_rate) || 0,
      purchase_price: normalizeNumber(form.purchase_price) || 0,
      currency: form.currency || 'CZK',
      stock_min_qty: form.product_type === 'manufactured' ? normalizeNumber(form.stock_min_qty) : null,
      warehouse_location: form.product_type === 'manufactured' ? (form.warehouse_location || null) : null,
      allow_backorder: Boolean(form.allow_backorder),
      valid_from: form.valid_from || null,
      valid_until: form.valid_until || null,
      datasheet_storage_provider: form.datasheet_storage_provider || 'sharepoint',
      datasheet_storage_connection_id: form.datasheet_storage_connection_id || null,
      datasheet_external_file_id: form.datasheet_external_file_id || null,
      datasheet_external_web_url: form.datasheet_external_web_url || null,
      datasheet_file_name: form.datasheet_file_name || null,
      datasheet_preview_image_url: form.datasheet_preview_image_url || null,
      datasheet_storage_metadata: form.datasheet_storage_metadata || {},
      image_url: form.image_url || form.datasheet_preview_image_url || null,
      is_active: Boolean(form.is_active),
      metadata: form.metadata || {},
      archived_at: form.is_active ? null : (form.archived_at || new Date().toISOString()),
      updated_by: user?.id || null,
      source: 'manual',
    };

    const requestPayload = productSchemaReady ? payload : {
      code: payload.code,
      name: payload.name,
      description: payload.description,
      category: payload.category,
      unit: payload.unit,
      default_unit_price: payload.default_unit_price,
      default_vat_rate: payload.default_vat_rate,
      metadata: payload.metadata,
      is_active: payload.is_active,
      source: 'manual',
    };

    const returnColumns = productSchemaReady ? 'id, sku, code, name' : 'id, code, name';
    const request = isEditing
      ? supabase.from('commercial_item_catalog').update(requestPayload).eq('id', productId).select(returnColumns).single()
      : supabase.from('commercial_item_catalog').insert(requestPayload).select(returnColumns).single();

    const { data, error } = await request;

    if (error) {
      setSaving(false);
      toast({ title: 'Produkt se nepodařilo uložit', description: error.message, variant: 'destructive' });
      return;
    }

    try {
      const upload = await uploadDatasheetForProduct(data);
      if (upload) {
        toast({ title: 'Produkt uložen a datasheet nahrán', description: upload.provider === 'sharepoint' ? 'Soubor byl propojen přes SharePoint úložiště.' : 'Soubor byl uložen do nakonfigurovaného úložiště.' });
      } else {
        toast({ title: 'Produkt uložen' });
      }
      setDatasheetFile(null);
    } catch (uploadError) {
      toast({
        title: 'Produkt uložen, ale datasheet se nepodařilo nahrát',
        description: uploadError.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }

    navigate(`/products/${data.id}/edit`);
  };

  const salePrice = Number(form.default_unit_price || 0);
  const purchasePrice = Number(form.purchase_price || 0);
  const productMargin = salePrice - purchasePrice;
  const productMarginPercent = salePrice > 0 ? (productMargin / salePrice) * 100 : 0;
  const productStatusClass = form.is_active ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-100 text-slate-600';
  const productStatusLabel = form.is_active ? 'Aktivní' : 'Archivovaný';
  const validityText = form.valid_until ? `Platí do ${new Date(form.valid_until).toLocaleDateString('cs-CZ')}` : 'Bez konce platnosti';
  const bestSupplierPrice = supplierPrices.find((item) => Number(item.price_rank) === 1) || supplierPrices[0] || null;
  const bestSupplierHistory = bestSupplierPrice ? priceHistory.filter((item) => item.supplier_offer_id === bestSupplierPrice.supplier_offer_id && item.price_without_vat != null) : [];
  const historyValues = bestSupplierHistory.map((item) => Number(item.price_without_vat || 0));
  const minHistoryPrice = historyValues.length ? Math.min(...historyValues) : 0;
  const maxHistoryPrice = historyValues.length ? Math.max(...historyValues) : 0;
  const historyRange = Math.max(1, maxHistoryPrice - minHistoryPrice);
  const trendAmount = Number(bestSupplierPrice?.price_change_amount || 0);
  const SupplierTrendIcon = trendAmount < 0 ? TrendingDown : trendAmount > 0 ? TrendingUp : Minus;

  return (
    <div className="min-h-screen bg-slate-50/70 p-4 sm:p-6">
      <div className="mx-auto flex w-full max-w-none flex-col gap-5">
        <PageHeader
          icon={Package}
          title={isEditing ? 'Detail produktu' : 'Nový produkt'}
          description={isEditing ? 'Pracovní karta katalogové položky pro CRM, nabídky, objednávky a realizace.' : 'Založení katalogové položky pro CRM, nabídky, objednávky a realizace.'}
          actions={(
            <>
              <Button variant="outline" onClick={() => navigate('/products')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zpět na produkty
              </Button>
              <Button onClick={saveProduct} disabled={loading || saving || !canEdit}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Ukládám...' : 'Uložit produkt'}
              </Button>
            </>
          )}
        />

        {warning && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-900">
            <AlertTitle>Omezené uložení</AlertTitle>
            <AlertDescription>{warning}</AlertDescription>
          </Alert>
        )}

        <Card className="overflow-hidden border-slate-200">
          <CardContent className="p-0">
            <div className="grid gap-0 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div className="border-b p-5 xl:border-b-0 xl:border-r">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>Produkt</span>
                  <span className="font-mono font-semibold text-slate-700">{form.sku || form.code || 'Nový kód'}</span>
                  <Badge variant="outline" className={productStatusClass}>{productStatusLabel}</Badge>
                  <Badge variant="secondary">{productTypeLabels[form.product_type] || form.product_type}</Badge>
                  {form.category && <Badge variant="outline">{form.category}</Badge>}
                </div>
                <h1 className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-950">{form.name || 'Nový produkt'}</h1>
                <p className="mt-1 line-clamp-2 max-w-5xl text-sm text-muted-foreground">
                  {form.description || 'Katalogová položka pro obchodní kalkulace. Ceny se do dokumentů ukládají jako snapshot.'}
                </p>
              </div>
              <div className="grid grid-cols-3 gap-px bg-slate-200 xl:grid-cols-1">
                <div className="bg-white p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase text-muted-foreground"><BarChart3 className="h-3.5 w-3.5" />Prodej / marže</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">{formatCurrency(salePrice)}</div>
                  <div className="text-xs text-muted-foreground">{formatPercent(productMarginPercent)} marže</div>
                </div>
                <div className="bg-white p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase text-muted-foreground"><Database className="h-3.5 w-3.5" />Nákup / DPH</div>
                  <div className="mt-1 text-lg font-semibold text-slate-950">{formatCurrency(purchasePrice)}</div>
                  <div className="text-xs text-muted-foreground">DPH {formatPercent(form.default_vat_rate)}</div>
                </div>
                <div className="bg-white p-3">
                  <div className="flex items-center gap-2 text-[11px] uppercase text-muted-foreground"><CalendarClock className="h-3.5 w-3.5" />Platnost</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950">{validityText}</div>
                  <div className="text-xs text-muted-foreground">{form.valid_from ? `Od ${new Date(form.valid_from).toLocaleDateString('cs-CZ')}` : 'Bez začátku platnosti'}</div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Card>
              <CardHeader className="border-b bg-white">
                <CardTitle>Základní údaje</CardTitle>
                <CardDescription>Identifikace produktu a prodejní parametry.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 p-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="product-name">Název</Label>
                  <Input id="product-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} disabled={loading || saving || !canEdit} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-sku">Unikátní kód produktu</Label>
                  <Input
                    id="product-sku"
                    value={form.sku || form.code || ''}
                    onChange={(event) => setForm({ ...form, sku: event.target.value.toUpperCase(), code: event.target.value.toUpperCase() })}
                    disabled={loading || saving || !canEdit}
                    className="font-mono"
                    placeholder="NAPR. FVEPANEL-001"
                  />
                  <p className="text-xs text-muted-foreground">Kód musí být jedinečný. Používá se v nabídkách, objednávkách a historii.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-type">Typ</Label>
                  <Select value={form.product_type} onValueChange={(value) => setForm({ ...form, product_type: value })} disabled={loading || saving || !canEdit}>
                    <SelectTrigger id="product-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="service">Služba</SelectItem>
                      <SelectItem value="manufactured">Výrobek / sklad</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-category">Kategorie</Label>
                  <Input id="product-category" value={form.category || ''} onChange={(event) => setForm({ ...form, category: event.target.value })} disabled={loading || saving || !canEdit} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-unit">MJ</Label>
                  <Input id="product-unit" value={form.unit || ''} onChange={(event) => setForm({ ...form, unit: event.target.value })} disabled={loading || saving || !canEdit} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-currency">Měna</Label>
                  <Input id="product-currency" value={form.currency || 'CZK'} onChange={(event) => setForm({ ...form, currency: event.target.value.toUpperCase() })} disabled={loading || saving || !canEdit} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-sales-price">Prodejní cena</Label>
                  <Input id="product-sales-price" type="number" value={form.default_unit_price ?? 0} onChange={(event) => setForm({ ...form, default_unit_price: event.target.value })} disabled={loading || saving || !canEdit} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-purchase-price">Nákupni cena</Label>
                  <Input id="product-purchase-price" type="number" value={form.purchase_price ?? 0} onChange={(event) => setForm({ ...form, purchase_price: event.target.value })} disabled={loading || saving || !canEdit} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-vat-rate">Výchozí sazba DPH</Label>
                  <Select value={String(form.default_vat_rate ?? 21)} onValueChange={(value) => setForm({ ...form, default_vat_rate: Number(value) })} disabled={loading || saving || !canEdit}>
                    <SelectTrigger id="product-vat-rate"><SelectValue /></SelectTrigger>
                    <SelectContent>{VAT_RATE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-valid-from">Platnost od</Label>
                  <Input id="product-valid-from" type="date" value={form.valid_from || ''} onChange={(event) => setForm({ ...form, valid_from: event.target.value })} disabled={loading || saving || !canEdit || !productSchemaReady} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="product-valid-until">Platnost do</Label>
                  <Input id="product-valid-until" type="date" value={form.valid_until || ''} onChange={(event) => setForm({ ...form, valid_until: event.target.value })} disabled={loading || saving || !canEdit || !productSchemaReady} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="product-description">Popis</Label>
                  <Textarea id="product-description" value={form.description || ''} onChange={(event) => setForm({ ...form, description: event.target.value })} disabled={loading || saving || !canEdit} />
                </div>
              </CardContent>
            </Card>

            {Object.keys(groupedProductFields).length > 0 && (
              <Card>
                <CardHeader className="border-b bg-white">
                  <CardTitle>Volitelná produktová pole</CardTitle>
                  <CardDescription>Pole definovaná v nastavení CRM. Později je bude možné předvyplnit z datasheetu pomocí AI.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  {Object.entries(groupedProductFields).map(([groupName, fields]) => (
                    <div key={groupName} className="space-y-3 rounded-lg border bg-slate-50/70 p-4">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{groupName}</div>
                      <div className="grid gap-4 md:grid-cols-2">
                        {fields.map((field) => (
                          <div key={field.field_key} className="space-y-2">
                            <Label htmlFor={`product-meta-${field.field_key}`}>{field.label}{field.is_required && <span className="ml-1 text-rose-600">*</span>}</Label>
                            {renderProductFieldInput(field, `product-meta-${field.field_key}`)}
                            {field.ai_hint && <p className="text-[11px] text-muted-foreground">{field.ai_hint}</p>}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}
          </div>

          <div className="space-y-5">
            {isEditing && (
              <Card>
                <CardHeader className="border-b bg-white">
                  <CardTitle className="flex items-center gap-2">
                    <Store className="h-4 w-4" />
                    Dodavatelé a ceny
                  </CardTitle>
                  <CardDescription>Aktuální nejnižší nákupní cena a historie podle scrapingů.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  {bestSupplierPrice ? (
                    <>
                      <div className="rounded-lg border bg-slate-50 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="text-xs uppercase tracking-wide text-muted-foreground">Nejlepší nákup</div>
                            <div className="mt-1 text-xl font-semibold text-slate-950">{formatCurrency(bestSupplierPrice.price_without_vat)}</div>
                            <div className="text-xs text-muted-foreground">{bestSupplierPrice.supplier_name} · {bestSupplierPrice.supplier_sku || '-'}</div>
                          </div>
                          <div className={`flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${trendAmount < 0 ? 'bg-emerald-50 text-emerald-700' : trendAmount > 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                            <SupplierTrendIcon className="h-3.5 w-3.5" />
                            {bestSupplierPrice.price_change_percent == null ? 'beze změny' : `${Number(bestSupplierPrice.price_change_percent).toFixed(1)} %`}
                          </div>
                        </div>
                        {bestSupplierHistory.length > 1 && (
                          <svg viewBox="0 0 240 70" className="mt-3 h-20 w-full overflow-visible">
                            <polyline
                              fill="none"
                              stroke="#2563eb"
                              strokeWidth="3"
                              points={bestSupplierHistory.map((point, index) => {
                                const x = bestSupplierHistory.length === 1 ? 0 : (index / (bestSupplierHistory.length - 1)) * 240;
                                const y = 62 - ((Number(point.price_without_vat || 0) - minHistoryPrice) / historyRange) * 54;
                                return `${x},${y}`;
                              }).join(' ')}
                            />
                          </svg>
                        )}
                      </div>
                      <div className="overflow-hidden rounded-lg border">
                        <div className="max-h-72 overflow-auto">
                          <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-slate-50 text-xs uppercase text-muted-foreground">
                              <tr>
                                <th className="px-3 py-2 text-left">E-shop</th>
                                <th className="px-3 py-2 text-left">SKU</th>
                                <th className="px-3 py-2 text-right">Cena</th>
                                <th className="px-3 py-2 text-left">Stav</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y">
                              {supplierPrices.map((price) => (
                                <tr key={price.supplier_offer_id} className={Number(price.price_rank) === 1 ? 'bg-emerald-50/50' : 'bg-white'}>
                                  <td className="px-3 py-2">
                                    <div className="font-medium text-slate-900">{price.supplier_name}</div>
                                    {price.supplier_product_url && (
                                      <button type="button" className="text-xs text-primary hover:underline" onClick={() => window.open(price.supplier_product_url, '_blank', 'noopener,noreferrer')}>Otevřít e-shop</button>
                                    )}
                                  </td>
                                  <td className="px-3 py-2 font-mono text-xs">{price.supplier_sku || '-'}</td>
                                  <td className="px-3 py-2 text-right font-semibold">{price.price_without_vat ? formatCurrency(price.price_without_vat) : '-'}</td>
                                  <td className="max-w-[180px] truncate px-3 py-2 text-xs text-muted-foreground">{price.availability_note || 'Bez dostupnosti'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground">Produkt zatím nemá aktuální cenu z e-shopu.</div>
                  )}
                </CardContent>
              </Card>
            )}


            {isEditing && (
              <Card>
                <CardHeader className="border-b bg-white">
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-4 w-4" />
                    Historie zmen
                  </CardTitle>
                  <CardDescription>Kdo a kdy produkt nebo jeho zarazeni v produktovych setech zmenil.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {auditHistoryLoading ? (
                    <div className="p-5 text-sm text-muted-foreground">Nacitam historii zmen...</div>
                  ) : auditHistory.length === 0 ? (
                    <div className="p-5 text-sm text-muted-foreground">Zatim nejsou evidovane zadne zmeny produktu.</div>
                  ) : (
                    <div className="divide-y">
                      {auditHistory.map((log) => {
                        const details = log.details || {};
                        const changedFields = details.changed_fields || [];
                        const changedLabel = formatChangedFields(changedFields);
                        const quantityInfo = details.quantity_before || details.quantity_after
                          ? 'Mnozstvi: ' + (details.quantity_before || '-') + ' -> ' + (details.quantity_after || '-')
                          : '';
                        const contextLabel = details.set_name
                          ? ['Set: ' + details.set_name, quantityInfo].filter(Boolean).join(' / ')
                          : changedLabel;

                        return (
                          <div key={log.id} className="grid gap-1 px-5 py-3 text-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="font-semibold text-slate-950">{productAuditActionLabels[log.action] || log.action}</div>
                              <div className="text-xs text-muted-foreground">{new Date(log.created_at).toLocaleString('cs-CZ')}</div>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {log.user_email || 'Neznamy uzivatel'}{contextLabel ? ' - ' + contextLabel : ''}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {isEditing && (
              <Card>
                <CardHeader className="border-b bg-white">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Historie použití
                  </CardTitle>
                  <CardDescription>Kde byl produkt použit v CRM a v realizačních objednávkách.</CardDescription>
                </CardHeader>
                <CardContent className="p-0">
                  {historyLoading ? (
                    <div className="p-5 text-sm text-muted-foreground">Načítám historii...</div>
                  ) : usageHistory.length === 0 ? (
                    <div className="p-5 text-sm text-muted-foreground">Produkt zatím není použit v CRM ani v realizacích.</div>
                  ) : (
                    <div className="divide-y">
                      {usageHistory.map((item) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => navigate(item.href)}
                          className="grid w-full gap-2 px-5 py-3 text-left text-sm transition-colors hover:bg-slate-50"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <span className="font-semibold text-slate-950">{item.number}</span>
                            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">{item.type}</span>
                          </div>
                          <div className="line-clamp-1 text-muted-foreground">{item.title}</div>
                          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                            <span>{item.subject}</span>
                            <span>{Number(item.quantity || 0)} {item.unit || 'ks'} / {formatCurrency(item.total)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {form.product_type === 'manufactured' && (
              <Card>
                <CardHeader className="border-b bg-white">
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Datasheet
                  </CardTitle>
                  <CardDescription>Připraveno pro SharePoint nebo jiné externí úložiště. Upload se aktivuje po finální konfiguraci storage.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 p-5">
                  <div className="rounded-lg border border-dashed bg-slate-50 p-4">
                    <div className="flex items-start gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <UploadCloud className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-950">Upload bude napojen na externí úložiště</div>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Vyberte PDF nebo obrázek datasheetu. Po uložení produktu se soubor nahraje přes nakonfigurované úložiště a uloží se vazba na produkt.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="product-datasheet-file">Soubor datasheetu</Label>
                    <Input
                      id="product-datasheet-file"
                      type="file"
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp"
                      onChange={(event) => setDatasheetFile(event.target.files?.[0] || null)}
                      disabled={loading || saving || !canEdit || !productSchemaReady}
                    />
                    {datasheetFile && (
                      <p className="text-xs text-muted-foreground">
                        Připraveno k nahrani: {datasheetFile.name}
                      </p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="product-datasheet-storage">Úložiště</Label>
                    <Select
                      value={form.datasheet_storage_connection_id || 'manual-sharepoint'}
                      onValueChange={(value) => {
                        const connection = storageConnections.find((item) => item.id === value);
                        setForm({
                          ...form,
                          datasheet_storage_connection_id: value === 'manual-sharepoint' ? '' : value,
                          datasheet_storage_provider: connection?.provider || 'sharepoint',
                        });
                      }}
                      disabled={loading || saving || !canEdit || !productSchemaReady}
                    >
                      <SelectTrigger id="product-datasheet-storage">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="manual-sharepoint">SharePoint - bude nastaveno</SelectItem>
                        {storageConnections.map((connection) => (
                          <SelectItem key={connection.id} value={connection.id}>
                            {connection.name} ({connection.provider})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="product-datasheet-file-name">Název souboru</Label>
                    <Input
                      id="product-datasheet-file-name"
                      value={form.datasheet_file_name || ''}
                      onChange={(event) => setForm({ ...form, datasheet_file_name: event.target.value })}
                      disabled={loading || saving || !canEdit || !productSchemaReady}
                      placeholder="datasheet.pdf"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-datasheet-url">Odkaz na datasheet</Label>
                    <div className="flex gap-2">
                      <Input
                        id="product-datasheet-url"
                        value={form.datasheet_external_web_url || ''}
                        onChange={(event) => setForm({ ...form, datasheet_external_web_url: event.target.value })}
                        disabled={loading || saving || !canEdit || !productSchemaReady}
                        placeholder="https://..."
                      />
                      {form.datasheet_external_web_url && (
                        <Button type="button" variant="outline" size="icon" aria-label="Otevřít datasheet" onClick={() => window.open(form.datasheet_external_web_url, '_blank', 'noopener,noreferrer')}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-datasheet-external-id">Externí ID souboru</Label>
                    <Input
                      id="product-datasheet-external-id"
                      value={form.datasheet_external_file_id || ''}
                      onChange={(event) => setForm({ ...form, datasheet_external_file_id: event.target.value })}
                      disabled={loading || saving || !canEdit || !productSchemaReady}
                      placeholder="SharePoint driveItem id"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="product-preview-url">URL náhledu / obrázku</Label>
                    <Input
                      id="product-preview-url"
                      value={form.datasheet_preview_image_url || form.image_url || ''}
                      onChange={(event) => setForm({ ...form, datasheet_preview_image_url: event.target.value, image_url: event.target.value })}
                      disabled={loading || saving || !canEdit || !productSchemaReady}
                      placeholder="https://..."
                    />
                  </div>
                  {(form.datasheet_preview_image_url || form.image_url) ? (
                    <div className="overflow-hidden rounded-lg border bg-white">
                      <img
                        src={form.datasheet_preview_image_url || form.image_url}
                        alt="Náhled datasheetu"
                        className="h-44 w-full object-contain bg-slate-50"
                      />
                    </div>
                  ) : (
                    <div className="flex h-36 items-center justify-center rounded-lg border border-dashed bg-slate-50 text-sm text-muted-foreground">
                      <Image className="mr-2 h-4 w-4" />
                      Bez náhledu
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader className="border-b bg-white">
                <CardTitle>Sklad</CardTitle>
                <CardDescription>Zobrazuje se pro skladové produkty.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-5">
                {form.product_type === 'manufactured' ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="product-stock-min-qty">Minimální sklad</Label>
                      <Input id="product-stock-min-qty" type="number" value={form.stock_min_qty ?? ''} onChange={(event) => setForm({ ...form, stock_min_qty: event.target.value })} disabled={loading || saving || !canEdit} />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="product-warehouse-location">Skladová lokace</Label>
                      <Input id="product-warehouse-location" value={form.warehouse_location || ''} onChange={(event) => setForm({ ...form, warehouse_location: event.target.value })} disabled={loading || saving || !canEdit} />
                    </div>
                    <div className="flex items-center justify-between rounded-md border p-3">
                      <div>
                        <Label htmlFor="product-allow-backorder">Povolit minusový sklad</Label>
                        <p className="text-xs text-muted-foreground">Použije se pro budoucí kontrolu objednávek a rezervací.</p>
                      </div>
                      <Switch id="product-allow-backorder" checked={Boolean(form.allow_backorder)} onCheckedChange={(checked) => setForm({ ...form, allow_backorder: checked })} disabled={loading || saving || !canEdit} />
                    </div>
                  </>
                ) : (
                  <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Skladové parametry se pouzivaji jen pro typ Výrobek / sklad.</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="border-b bg-white">
                <CardTitle>Stav</CardTitle>
              </CardHeader>
              <CardContent className="p-5">
                <div className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <Label htmlFor="product-is-active">Aktivní produkt</Label>
                    <p className="text-xs text-muted-foreground">Neaktivní produkty zůstanou v historii, ale nenabízí se pro nové položky.</p>
                  </div>
                  <Switch id="product-is-active" checked={Boolean(form.is_active)} onCheckedChange={(checked) => setForm({ ...form, is_active: checked })} disabled={loading || saving || !canEdit} />
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProductForm;
