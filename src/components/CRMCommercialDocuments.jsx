import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, Package, Plus, RefreshCw, Save, Search, ShoppingCart, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CrmCatalogProductMeta, CrmItemSnapshotBadges } from '@/components/CrmItemSnapshotBadges';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { ManagedTableSection, ManagedTableToolbar, useManagedColumns } from '@/components/ui/managed-table';
import SubjectSelect from '@/components/SubjectSelect';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { DEFAULT_CRM_NUMBERING, formatCrmNumber, incrementCrmNumbering, normalizeCrmNumbering, selectCrmNumberingSettings } from '@/lib/crmNumbering';
import { crmOpportunityPath, findCrmRecordByRef, getCrmRecordRef } from '@/lib/crmRoutes';
import {
  buildCrmDocumentItemPayload,
  buildCrmOpportunityItemPayload,
  calculateCrmLineTotal,
  calculateCrmTotals,
  createCrmCatalogItem,
  isMissingCrmRpcError,
} from '@/lib/crmItemPayloads';
import {
  downloadGeneratedDocumentDocx,
  downloadGeneratedDocumentHtml,
  downloadGeneratedDocumentPdf,
} from '@/lib/documentGenerationService';
import { cn } from '@/lib/utils';

const documentTypeConfig = {
  offer: {
    title: 'Nabídky',
    detailTitle: 'Detail nabídky',
    singular: 'Nabídka',
    icon: Package,
    listPath: '/crm/offers',
    detailPath: (document) => `/crm/offers/${getCrmRecordRef(document)}`,
    createLabel: 'Nová nabídka',
  },
  order: {
    title: 'Objednávky',
    detailTitle: 'Detail objednávky',
    singular: 'Objednávka',
    icon: ShoppingCart,
    listPath: '/crm/orders',
    detailPath: (document) => `/crm/orders/${getCrmRecordRef(document)}`,
    createLabel: 'Nová objednávka',
  },
};

const documentStatuses = [
  { value: 'draft', label: 'Příprava' },
  { value: 'sent', label: 'Odesláno' },
  { value: 'accepted', label: 'Přijato' },
  { value: 'rejected', label: 'Zamítnuto' },
  { value: 'closed', label: 'Uzavřeno' },
];

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
};

const formatCommercialDocumentTitle = (title) => (
  title
    ?.replace(/^Nabidka\b/, 'Nabídka')
    ?.replace(/^Objednavka\b/, 'Objednávka')
    || ''
);

const getStatusBadgeClass = (status) => {
  const value = String(status || '').toLowerCase();
  if (['accepted', 'approved', 'paid', 'completed', 'done'].includes(value)) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (['sent', 'issued', 'ordered'].includes(value)) return 'border-blue-200 bg-blue-50 text-blue-700';
  if (['cancelled', 'canceled', 'rejected', 'lost'].includes(value)) return 'border-rose-200 bg-rose-50 text-rose-700';
  return 'border-amber-200 bg-amber-50 text-amber-700';
};

const emptyItem = () => ({
  id: `new-${Date.now()}`,
  catalog_item_id: null,
  code: '',
  name: '',
  description: '',
  quantity: 1,
  unit: 'ks',
  unit_price: 0,
  discount_percent: 0,
  vat_rate: 21,
  line_total: 0,
  sort_order: 0,
  isNew: true,
});

const CRMCommercialDocuments = ({ type = 'offer' }) => {
  const config = documentTypeConfig[type] || documentTypeConfig.offer;
  const Icon = config.icon;
  const { documentId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('crm', 'can_edit');
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [documentTemplates, setDocumentTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('default');
  const [numbering, setNumbering] = useState(() => normalizeCrmNumbering(Object.values(DEFAULT_CRM_NUMBERING)));
  const [query, setQuery] = useState('');
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [documentsRes, opportunitiesRes, numberingRes, templatesRes] = await Promise.all([
      supabase
        .from('crm_commercial_documents')
        .select('id, opportunity_id, subject_id, type, status, number, title, issue_date, valid_until, subtotal, discount_total, tax_total, total, notes, sync_items, created_at, subject:subject_id(id, name, ico), opportunity:opportunity_id(id, number, title, value, stage, subject:subject_id(id, name), project:project_id(id, name, code), opportunity_items:crm_opportunity_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot)), items:crm_commercial_document_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot)')
        .eq('type', type)
        .order('created_at', { ascending: false }),
      supabase
        .from('crm_opportunities')
        .select('id, number, title, value, subject_id, subject:subject_id(id, name), items:crm_opportunity_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot)')
        .order('created_at', { ascending: false }),
      selectCrmNumberingSettings(supabase),
      supabase
        .from('order_templates')
        .select('id, name, content')
        .eq('is_active', true)
        .order('name'),
    ]);

    const error = documentsRes.error || opportunitiesRes.error;
    if (error) {
      toast({ title: `${config.title} se nepodařilo načíst`, description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    const opportunities = opportunitiesRes.data || [];
    const opportunityById = new Map(opportunities.map((opportunity) => [opportunity.id, opportunity]));
    const normalizedDocuments = (documentsRes.data || []).map((document) => {
      const fallbackOpportunity = opportunityById.get(document.opportunity_id);
      const opportunity = document.opportunity?.number ? document.opportunity : {
        ...fallbackOpportunity,
        ...document.opportunity,
        number: document.opportunity?.number || fallbackOpportunity?.number,
      };
      return {
        ...document,
        opportunity,
        sync_items: document.sync_items ?? true,
        items: [...((document.sync_items ?? true) ? (opportunity?.opportunity_items || fallbackOpportunity?.items || []) : (document.items || []))]
          .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
      };
    });
    setDocuments(normalizedDocuments);
    setOpportunities(opportunities);
    setDocumentTemplates(templatesRes.error ? [] : (templatesRes.data || []));
    setNumbering(normalizeCrmNumbering(numberingRes.error ? [] : numberingRes.data));
    setSelectedDocument(documentId ? findCrmRecordByRef(normalizedDocuments, documentId) : null);

    const [catalogRes, stockRes] = await Promise.all([
      supabase
        .from('commercial_item_catalog')
        .select('id, code, sku, name, description, category, unit, default_unit_price, default_vat_rate, product_type, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true }),
      supabase
        .from('product_stock_status')
        .select('catalog_item_id, available_qty'),
    ]);
    const stockByProductId = new Map((stockRes.data || []).map((row) => [row.catalog_item_id, row]));
    setCatalogProducts(catalogRes.error ? [] : (catalogRes.data || []).map((product) => ({
      ...product,
      available_qty: stockByProductId.get(product.id)?.available_qty ?? null,
    })));

    setLoading(false);
  }, [config.title, documentId, toast, type]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredDocuments = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((document) => [
      document.number,
      document.title,
      document.subject?.name,
      document.opportunity?.number,
      document.opportunity?.title,
      document.opportunity?.subject?.name,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(needle)));
  }, [documents, query]);

  const documentSummary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return documents.reduce((acc, document) => {
      const isDraft = document.status === 'draft';
      const isSent = document.status === 'sent';
      const isExpired = Boolean(document.valid_until && document.valid_until < today && !['accepted', 'closed', 'rejected'].includes(document.status));
      const hasItems = (document.items || []).length > 0;
      return {
        total: acc.total + 1,
        draft: acc.draft + (isDraft ? 1 : 0),
        sent: acc.sent + (isSent ? 1 : 0),
        expired: acc.expired + (isExpired ? 1 : 0),
        withoutItems: acc.withoutItems + (!hasItems ? 1 : 0),
        value: acc.value + Number(document.total || 0),
      };
    }, { total: 0, draft: 0, sent: 0, expired: 0, withoutItems: 0, value: 0 });
  }, [documents]);

  const listColumns = useMemo(() => [
    { id: 'number', label: 'Kód', hideable: false },
    { id: 'title', label: 'Předmět' },
    { id: 'client', label: 'Klient' },
    { id: 'opportunity', label: 'Obchodní případ' },
    { id: 'created', label: 'Vytvořeno' },
    { id: 'status', label: 'Stav' },
    { id: 'total', label: 'Konečná cena' },
    { id: 'validUntil', label: 'Konec platnosti' },
    { id: 'actions', label: 'Akce', hideable: false },
  ], []);
  const managedList = useManagedColumns(`ekv-table-crm-${type}s`, listColumns);
  const visibleListColumns = managedList.visibleColumns;
  const listHeadClasses = {
    number: 'min-w-[120px]',
    title: 'min-w-[280px]',
    client: 'min-w-[180px]',
    opportunity: 'min-w-[190px]',
    created: 'min-w-[110px]',
    status: 'min-w-[110px]',
    total: 'min-w-[130px] text-right',
    validUntil: 'min-w-[130px]',
    actions: 'w-12 text-right',
  };
  const listCellClasses = {
    number: 'font-semibold text-slate-950',
    title: 'max-w-[360px] truncate',
    client: 'font-medium',
    total: 'text-right font-semibold',
    actions: 'text-right',
  };
  const renderListCell = (document, columnId) => {
    switch (columnId) {
      case 'number':
        return document.number || '-';
      case 'title':
        return formatCommercialDocumentTitle(document.title);
      case 'client':
        return document.subject?.name || document.opportunity?.subject?.name || '-';
      case 'opportunity':
        return (
          <>
            <span className="text-muted-foreground">{document.opportunity?.number || 'OP'}</span>
            <span className="ml-1">{document.opportunity?.title || ''}</span>
          </>
        );
      case 'created':
        return formatDate(document.created_at);
      case 'status':
        return (
          <Badge variant="outline" className={cn('font-semibold', getStatusBadgeClass(document.status))}>
            {documentStatuses.find((status) => status.value === document.status)?.label || document.status}
          </Badge>
        );
      case 'total':
        return formatCurrency(document.total);
      case 'validUntil':
        return formatDate(document.valid_until);
      case 'sync':
        return (
          <Badge variant="outline" className={document.sync_items === false ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>
            {document.sync_items === false ? 'Vlastní položky' : 'Sync s OP'}
          </Badge>
        );
      case 'actions':
        return (
          <Button asChild variant="ghost" size="icon" onClick={(event) => event.stopPropagation()}>
            <Link to={config.detailPath(document)}>
              <FileText className="h-4 w-4" />
            </Link>
          </Button>
        );
      default:
        return null;
    }
  };

  const updateSelectedDocument = (field, value) => {
    setSelectedDocument((current) => current ? { ...current, [field]: value } : current);
  };

  const updateSelectedDocumentSubject = (subjectId, subject = null) => {
    setSelectedDocument((current) => current ? {
      ...current,
      subject_id: subjectId,
      subject: subjectId ? (subject || current.subject) : null,
    } : current);
  };

  const updateItem = (itemId, field, value) => {
    setSelectedDocument((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item) => {
          if (item.id !== itemId) return item;
          const next = { ...item, [field]: ['quantity', 'unit_price', 'discount_percent', 'vat_rate'].includes(field) ? Number(value || 0) : value };
          return { ...next, line_total: calculateCrmLineTotal(next) };
        }),
      };
    });
  };

  const addItem = () => {
    setSelectedDocument((current) => current ? { ...current, items: [...current.items, emptyItem()] } : current);
  };

  const filteredCatalogProducts = useMemo(() => {
    const needle = catalogQuery.trim().toLowerCase();
    return catalogProducts
      .filter((product) => {
        if (!needle) return true;
        return [product.code, product.name, product.description, product.category]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(needle));
      })
      .slice(0, 14);
  }, [catalogProducts, catalogQuery]);

  const addCatalogItem = (product) => {
    const nextItem = createCrmCatalogItem(product, {
      ...emptyItem(),
      id: `new-${Date.now()}-${product.id}`,
    });
    setSelectedDocument((current) => current ? {
      ...current,
      items: [...current.items, { ...nextItem, line_total: calculateCrmLineTotal(nextItem) }],
    } : current);
    setCatalogQuery('');
  };

  const removeItem = (itemId) => {
    setSelectedDocument((current) => current ? { ...current, items: current.items.filter((item) => item.id !== itemId) } : current);
  };

  const syncItemsToOpportunityDocuments = async (sourceDocument, itemPayloads) => {
    if (!sourceDocument.sync_items) return null;

    const targets = documents.filter((document) => (
      document.opportunity_id === sourceDocument.opportunity_id &&
      (document.sync_items ?? true)
    ));

    for (const target of targets) {
      const clonedItems = itemPayloads.map(({ document_id, ...item }, index) => ({
        ...item,
        document_id: target.id,
        sort_order: (index + 1) * 10,
      }));
      const totals = calculateCrmTotals(clonedItems);
      const { error: deleteError } = await supabase
        .from('crm_commercial_document_items')
        .delete()
        .eq('document_id', target.id);
      if (deleteError) return deleteError;

      if (clonedItems.length > 0) {
        const { error: insertError } = await supabase
          .from('crm_commercial_document_items')
          .insert(clonedItems);
        if (insertError) return insertError;
      }

      const { error: updateError } = await supabase
        .from('crm_commercial_documents')
        .update({ ...totals, updated_at: new Date().toISOString() })
        .eq('id', target.id);
      if (updateError) return updateError;
    }

    return null;
  };

  const handleSaveDocument = async () => {
    if (!selectedDocument || !canEdit) return;
    setSaving(true);

    const items = selectedDocument.items.map((item, index) => buildCrmDocumentItemPayload(item, selectedDocument.id, index));
    const totals = calculateCrmTotals(items);
    const { error: docError } = await supabase
      .from('crm_commercial_documents')
      .update({
        title: formatCommercialDocumentTitle(selectedDocument.title?.trim()) || config.singular,
        status: selectedDocument.status || 'draft',
        issue_date: selectedDocument.issue_date || new Date().toISOString().slice(0, 10),
        valid_until: selectedDocument.valid_until || null,
        notes: selectedDocument.notes || null,
        subject_id: selectedDocument.subject_id || null,
        sync_items: selectedDocument.sync_items ?? true,
        ...totals,
        updated_at: new Date().toISOString(),
      })
      .eq('id', selectedDocument.id);

    if (docError) {
      setSaving(false);
      toast({ title: 'Dokument se nepodařilo uložit', description: docError.message, variant: 'destructive' });
      return;
    }

    const sourceIsOpportunity = selectedDocument.sync_items ?? true;
    const itemTable = sourceIsOpportunity ? 'crm_opportunity_items' : 'crm_commercial_document_items';
    const itemFilterColumn = sourceIsOpportunity ? 'opportunity_id' : 'document_id';
    const itemFilterValue = sourceIsOpportunity ? selectedDocument.opportunity_id : selectedDocument.id;
    const itemRows = sourceIsOpportunity
      ? selectedDocument.items.map((item, index) => buildCrmOpportunityItemPayload(item, selectedDocument.opportunity_id, index))
      : items;

    const rpcPayload = itemRows.map(({ opportunity_id, document_id, ...item }) => item);
    const { error: replaceError } = sourceIsOpportunity
      ? await supabase.rpc('replace_crm_opportunity_items', {
        p_opportunity_id: selectedDocument.opportunity_id,
        p_items: rpcPayload,
        p_sync_documents: true,
      })
      : await supabase.rpc('replace_crm_document_items', {
        p_document_id: selectedDocument.id,
        p_items: rpcPayload,
      });

    if (!replaceError) {
      setSaving(false);
      toast({ title: selectedDocument.sync_items ? 'Dokument uložen a položky synchronizovány' : 'Dokument uložen' });
      fetchData();
      return;
    }

    if (!isMissingCrmRpcError(replaceError)) {
      setSaving(false);
      toast({ title: 'Položky se nepodařilo uložit', description: replaceError.message, variant: 'destructive' });
      return;
    }

    const { error: deleteError } = await supabase
      .from(itemTable)
      .delete()
      .eq(itemFilterColumn, itemFilterValue);

    if (deleteError) {
      setSaving(false);
      toast({ title: 'Položky se nepodařilo uložit', description: deleteError.message, variant: 'destructive' });
      return;
    }

    if (itemRows.length > 0) {
      const { error: insertError } = await supabase
        .from(itemTable)
        .insert(itemRows);
      if (insertError) {
        setSaving(false);
        toast({ title: 'Položky se nepodařilo uložit', description: insertError.message, variant: 'destructive' });
        return;
      }
    }

    const syncError = sourceIsOpportunity
      ? await syncItemsToOpportunityDocuments({ ...selectedDocument, ...totals }, items)
      : null;
    setSaving(false);
    if (syncError) {
      toast({ title: 'Dokument uložen, synchronizace položek selhala', description: syncError.message, variant: 'destructive' });
    } else {
      toast({ title: selectedDocument.sync_items ? 'Dokument uložen a položky synchronizovány' : 'Dokument uložen' });
    }
    fetchData();
  };

  const handleCreateDocument = async () => {
    if (!canEdit || opportunities.length === 0) return;
    const opportunity = opportunities[0];
    const number = formatCrmNumber(numbering, type);
    const sourceItems = [...(opportunity.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const totals = calculateCrmTotals(sourceItems.length > 0 ? sourceItems : [{
      quantity: 1,
      unit_price: Number(opportunity.value || 0),
      discount_percent: 0,
      vat_rate: 21,
    }]);
    setSaving(true);
    const { data, error } = await supabase
      .from('crm_commercial_documents')
      .insert({
        opportunity_id: opportunity.id,
        subject_id: opportunity.subject_id,
        type,
        status: 'draft',
        number,
        title: `${config.singular} - ${opportunity.title}`,
        issue_date: new Date().toISOString().slice(0, 10),
        valid_until: null,
        sync_items: true,
        ...totals,
      })
      .select('id, number, type')
      .single();

    if (!error) {
      const documentRows = (sourceItems.length > 0 ? sourceItems : [{
        code: 'CRM-001',
        name: opportunity.title,
        quantity: 1,
        unit: 'ks',
        unit_price: Number(opportunity.value || 0),
        discount_percent: 0,
        vat_rate: 21,
      }]).map((item, index) => buildCrmDocumentItemPayload(item, data.id, index));
      if (documentRows.length > 0) {
        await supabase.from('crm_commercial_document_items').insert(documentRows);
      }
      const nextNumber = Number(numbering[type]?.next_number || 1) + 1;
      await incrementCrmNumbering(supabase, type, nextNumber);
    }

    setSaving(false);
    if (error) {
      toast({ title: `${config.singular} se nepodařilo vytvořit`, description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: `${config.singular} vytvořena` });
    navigate(config.detailPath(data || { number, type }));
  };

  const handleGenerateSelectedDocument = async (format = 'docx') => {
    if (!selectedDocument) return;
    setSaving(true);
    try {
      const template = documentTemplates.find((item) => item.id === selectedTemplateId) || null;
      const generationInput = {
        document: selectedDocument,
        opportunity: {
          ...selectedDocument.opportunity,
          subject: selectedDocument.subject || selectedDocument.opportunity?.subject,
        },
        template,
      };

      if (format === 'pdf') {
        downloadGeneratedDocumentPdf(generationInput);
      } else if (format === 'html') {
        downloadGeneratedDocumentHtml(generationInput);
      } else {
        await downloadGeneratedDocumentDocx(generationInput);
      }

      toast({
        title: 'Dokument vygenerován',
        description: `${template?.name ? `Šablona "${template.name}" byla vyplněna. ` : ''}Výstup ${format.toUpperCase()} byl připraven ke stažení.`,
      });
    } catch (error) {
      toast({
        title: 'Dokument se nepodařilo vygenerovat',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  if (documentId) {
    const totalWithTax = Number(selectedDocument?.total || 0) + Number(selectedDocument?.tax_total || 0);
    return (
      <div className="app-page-wide space-y-6">
        <PageHeader
          icon={Icon}
          title={formatCommercialDocumentTitle(selectedDocument?.title) || config.detailTitle}
          description={selectedDocument?.number || 'Načítání detailu dokumentu'}
          actions={(
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={() => navigate(config.listPath)}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zpět na seznam
              </Button>
              <div className="flex items-center gap-2 rounded-md border bg-white p-1">
                <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
                  <SelectTrigger className="h-9 w-[210px] border-0 bg-transparent shadow-none focus:ring-0">
                    <SelectValue placeholder="Šablona dokumentu" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Výchozí šablona</SelectItem>
                    {documentTemplates.map((template) => (
                      <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="h-9" disabled={saving || !selectedDocument}>
                      <FileText className="mr-2 h-4 w-4" />
                      Generovat
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuLabel>Výstup dokumentu</DropdownMenuLabel>
                    <DropdownMenuItem onSelect={() => handleGenerateSelectedDocument('docx')}>DOCX</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleGenerateSelectedDocument('pdf')}>PDF</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => handleGenerateSelectedDocument('html')}>HTML</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem disabled>Vybraná šablona se použije automaticky</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <Button onClick={handleSaveDocument} disabled={!canEdit || saving || !selectedDocument}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Ukládám...' : 'Uložit'}
              </Button>
            </div>
          )}
        />

        {loading || !selectedDocument ? (
          <Card><CardContent className="p-8 text-sm text-muted-foreground">Načítám dokument...</CardContent></Card>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.55fr)]">
            <Card className="crm-panel">
              <CardHeader className="crm-panel-header">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {config.singular} {selectedDocument.number || ''}
                    </div>
                    <CardTitle className="mt-1 text-3xl font-semibold tracking-tight">{formatCommercialDocumentTitle(selectedDocument.title)}</CardTitle>
                    <CardDescription className="mt-2">
                      <Link to={crmOpportunityPath(selectedDocument.opportunity || selectedDocument.opportunity_id)} className="font-medium text-primary hover:underline">
                        {selectedDocument.opportunity?.number || 'OP'} - {selectedDocument.opportunity?.title}
                      </Link>
                    </CardDescription>
                  </div>
                  <Badge variant="outline" className="w-fit">{documentStatuses.find((status) => status.value === selectedDocument.status)?.label || selectedDocument.status}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 bg-white p-5 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>Název dokumentu</Label>
                  <Input value={selectedDocument.title || ''} onChange={(event) => updateSelectedDocument('title', event.target.value)} disabled={!canEdit || saving} />
                </div>
                <div className="space-y-2">
                  <Label>Stav</Label>
                  <Select value={selectedDocument.status || 'draft'} onValueChange={(value) => updateSelectedDocument('status', value)} disabled={!canEdit || saving}>
                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {documentStatuses.map((status) => <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <SubjectSelect
                    label="Subjekt dokumentu"
                    value={selectedDocument.subject_id || ''}
                    onChange={(value, subject) => updateSelectedDocumentSubject(value || null, subject)}
                    onCreated={(subject) => updateSelectedDocumentSubject(subject.id, subject)}
                    placeholder="Vyberte nebo vytvořte subjekt"
                    disabled={!canEdit || saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vystaveno</Label>
                  <Input type="date" value={selectedDocument.issue_date || ''} onChange={(event) => updateSelectedDocument('issue_date', event.target.value)} disabled={!canEdit || saving} />
                </div>
                <div className="space-y-2">
                  <Label>Platnost do</Label>
                  <Input type="date" value={selectedDocument.valid_until || ''} onChange={(event) => updateSelectedDocument('valid_until', event.target.value)} disabled={!canEdit || saving} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Popis / poznámka</Label>
                  <Textarea value={selectedDocument.notes || ''} onChange={(event) => updateSelectedDocument('notes', event.target.value)} rows={5} disabled={!canEdit || saving} />
                </div>
              </CardContent>
            </Card>

            <div className="space-y-4">
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <CardTitle className="text-base">Souhrn</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-4 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Před slevou bez DPH</span><strong>{formatCurrency(selectedDocument.subtotal)}</strong></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Sleva bez DPH</span><strong>{formatCurrency(selectedDocument.discount_total)}</strong></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Bez DPH</span><strong>{formatCurrency(selectedDocument.total)}</strong></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">DPH</span><strong>{formatCurrency(selectedDocument.tax_total)}</strong></div>
                  <div className="flex justify-between gap-3 rounded-md bg-primary px-3 py-2 text-primary-foreground"><span>Celkem s DPH</span><strong>{formatCurrency(totalWithTax)}</strong></div>
                  <p className="text-xs text-muted-foreground">Souhrn rozlišuje základ bez DPH před slevou, slevu a výsledný základ pro DPH.</p>
                </CardContent>
              </Card>
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <CardTitle className="text-base">Synchronizace položek</CardTitle>
                  <CardDescription>Zapnuto znamená, že položky se při uložení propíšou do ostatních synchronizovaných nabídek a objednávek stejného obchodního případu.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <Label htmlFor="sync-items">Synchronizovat s obchodním případem</Label>
                  <Switch id="sync-items" checked={selectedDocument.sync_items ?? true} onCheckedChange={(checked) => updateSelectedDocument('sync_items', checked)} disabled={!canEdit || saving} />
                </CardContent>
              </Card>
            </div>

            <Card className="crm-panel xl:col-span-2">
              <CardHeader className="crm-panel-header">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <CardTitle>Položkový seznam</CardTitle>
                    <CardDescription>Položky jsou společné pro obchodní případ, pokud u dokumentu nevypnete synchronizaci.</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button type="button" variant="outline" disabled={!canEdit || saving}>
                          <Plus className="mr-2 h-4 w-4" />
                          Přidat z katalogu
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-80">
                        <DropdownMenuLabel>Produktový katalog</DropdownMenuLabel>
                        <div className="px-2 py-1.5">
                          <Input
                            value={catalogQuery}
                            onChange={(event) => setCatalogQuery(event.target.value)}
                            placeholder="Hledat produkt..."
                            className="h-8"
                          />
                        </div>
                        <DropdownMenuSeparator />
                        {filteredCatalogProducts.length === 0 ? (
                          <DropdownMenuItem disabled>Žádný produkt nenalezen</DropdownMenuItem>
                        ) : filteredCatalogProducts.map((product) => (
                          <DropdownMenuItem key={product.id} onSelect={() => addCatalogItem(product)} className="flex flex-col items-start gap-0.5">
                            <span className="font-medium">{product.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {product.code || '-'} - {formatCurrency(product.default_unit_price)}
                            </span>
                            <CrmCatalogProductMeta product={product} />
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button type="button" variant="secondary" onClick={addItem} disabled={!canEdit || saving}>
                      Ruční položka
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="crm-table-wrap">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="min-w-[110px]">Kód</TableHead>
                        <TableHead className="min-w-[260px]">Název</TableHead>
                        <TableHead className="min-w-[100px] text-right">Množství</TableHead>
                        <TableHead className="min-w-[90px]">MJ</TableHead>
                        <TableHead className="min-w-[130px] text-right">Cena</TableHead>
                        <TableHead className="min-w-[100px] text-right">Sleva %</TableHead>
                        <TableHead className="min-w-[120px] text-right">Celkem</TableHead>
                        <TableHead className="w-12" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {selectedDocument.items.length === 0 ? (
                        <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Zatím bez položek.</TableCell></TableRow>
                      ) : selectedDocument.items.map((item) => (
                        <TableRow key={item.id}>
                          <TableCell><Input value={item.code || ''} onChange={(event) => updateItem(item.id, 'code', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell>
                            <Input value={item.name || ''} onChange={(event) => updateItem(item.id, 'name', event.target.value)} disabled={!canEdit || saving} />
                            <CrmItemSnapshotBadges item={item} />
                          </TableCell>
                          <TableCell><Input className="text-right" type="number" value={item.quantity || 0} onChange={(event) => updateItem(item.id, 'quantity', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell><Input value={item.unit || 'ks'} onChange={(event) => updateItem(item.id, 'unit', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell><Input className="text-right" type="number" value={item.unit_price || 0} onChange={(event) => updateItem(item.id, 'unit_price', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell><Input className="text-right" type="number" value={item.discount_percent || 0} onChange={(event) => updateItem(item.id, 'discount_percent', event.target.value)} disabled={!canEdit || saving} /></TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(calculateCrmLineTotal(item))}</TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)} disabled={!canEdit || saving}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-page-wide space-y-6">
      <PageHeader
        icon={Icon}
        title={config.title}
        description="Tabulkový seznam CRM dokumentů napojených na obchodní případy."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Obnovit
            </Button>
            <Button onClick={handleCreateDocument} disabled={!canEdit || saving || opportunities.length === 0}>
              <Plus className="mr-2 h-4 w-4" />
              {config.createLabel}
            </Button>
          </div>
        )}
      />

      <Card className="crm-panel">
        <CardHeader className="crm-panel-header">
          <CardTitle className="text-base">Freeze kontrola dokladů</CardTitle>
          <CardDescription>Rychlý stav rozpracovaných nabídek/objednávek před uzavřením baseline.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
          {[
            { label: 'Návrhy', value: documentSummary.draft, tone: 'amber' },
            { label: 'Odesláno', value: documentSummary.sent, tone: 'blue' },
            { label: 'Po platnosti', value: documentSummary.expired, tone: documentSummary.expired > 0 ? 'rose' : 'emerald' },
            { label: 'Bez položek', value: documentSummary.withoutItems, tone: documentSummary.withoutItems > 0 ? 'rose' : 'emerald' },
            { label: 'Hodnota celkem', value: formatCurrency(documentSummary.value), tone: 'slate' },
          ].map((item) => (
            <div
              key={item.label}
              className={cn(
                'rounded-md border p-3',
                item.tone === 'rose' ? 'border-rose-200 bg-rose-50 text-rose-900' :
                  item.tone === 'amber' ? 'border-amber-200 bg-amber-50 text-amber-900' :
                    item.tone === 'blue' ? 'border-blue-200 bg-blue-50 text-blue-900' :
                      item.tone === 'emerald' ? 'border-emerald-200 bg-emerald-50 text-emerald-900' :
                        'border-slate-200 bg-slate-50 text-slate-900'
              )}
            >
              <p className="text-xs font-semibold uppercase">{item.label}</p>
              <p className="mt-1 text-2xl font-semibold">{item.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="crm-panel overflow-hidden">
        <CardHeader className="border-b border-slate-200 bg-white px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative w-full lg:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Hledat číslo, klienta, OP..." className="pl-9" />
            </div>
            <p className="text-sm text-muted-foreground">{filteredDocuments.length} záznamů v seznamu</p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <ManagedTableSection
            title={config.title}
            count={filteredDocuments.length}
            toolbar={(
              <ManagedTableToolbar
                className="text-slate-700"
                columns={managedList.columns}
                visibility={managedList.visibility}
                onMoveColumn={managedList.moveColumn}
                onToggleColumn={managedList.toggleColumn}
                onReset={managedList.resetColumns}
              />
            )}
          >
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  {visibleListColumns.map((column) => (
                    <TableHead key={column.id} className={listHeadClasses[column.id]}>{column.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow><TableCell colSpan={visibleListColumns.length} className="h-24 text-center text-muted-foreground">Načítám...</TableCell></TableRow>
                ) : filteredDocuments.length === 0 ? (
                  <TableRow><TableCell colSpan={visibleListColumns.length} className="h-24 text-center text-muted-foreground">Žádné záznamy.</TableCell></TableRow>
                ) : filteredDocuments.map((document) => (
                  <TableRow key={document.id} className="cursor-pointer bg-white hover:bg-blue-50/35" onClick={() => navigate(config.detailPath(document))}>
                    {visibleListColumns.map((column) => (
                      <TableCell key={column.id} className={listCellClasses[column.id]}>
                        {renderListCell(document, column.id)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ManagedTableSection>
        </CardContent>
      </Card>
    </div>
  );
};

export default CRMCommercialDocuments;
