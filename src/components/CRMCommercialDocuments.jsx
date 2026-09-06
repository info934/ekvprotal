import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Ban, Calculator, Copy, FileText, Link2, Mail, MoreHorizontal, Package, Plus, RefreshCw, Save, Search, ShoppingCart, Trash2 } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import FveOfferWizardDialog from '@/components/FveOfferWizardDialog';
import CrmLineItemsTable from '@/components/CrmLineItemsTable';
import CRMCommercialDocumentDelivery from '@/components/CRMCommercialDocumentDelivery';
import CRMOfferApprovalPanel from '@/components/CRMOfferApprovalPanel';
import CrmProductPickerDialog from '@/components/CrmProductPickerDialog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { DEFAULT_CRM_NUMBERING, formatCrmNumber, normalizeCrmNumbering, selectCrmNumberingSettings } from '@/lib/crmNumbering';
import { crmOpportunityPath, findCrmRecordByRef, getCrmRecordRef, filterCrmRecordByRef } from '@/lib/crmRoutes';
import { fetchAllCrmRows, crmWorkflowErrorMessage } from '@/lib/crmDataAccess';
import { formatMoney, formatPercent } from '@/lib/financePresentation';
import {
  buildCrmDocumentItemPayload,
  buildCrmOpportunityItemPayload,
  calculateCrmLineTotal,
  calculateCrmTotals,
  createCrmCatalogItem,
  normalizeCrmItem,
} from '@/lib/crmItemPayloads';
import { cn } from '@/lib/utils';
import { createTimedAbortController, isRequestAbortError } from '@/lib/requestControl';
import { commercialDocumentMatchesSearch, getCommercialDocumentTotals } from '@/lib/crmCommercialDocuments';

const documentTypeConfig = {
  offer: {
    title: 'Nabídky',
    detailTitle: 'Detail nabídky',
    singular: 'Nabídka',
    description: 'Přehled nabídek, jejich hodnoty, stavu a návaznosti na klienta a obchodní případ.',
    summaryTitle: 'Přehled nabídek',
    summaryDescription: 'Rychlá kontrola rozpracovaných nabídek, platnosti a obchodního výsledku.',
    icon: Package,
    listPath: '/crm/offers',
    detailPath: (document) => `/crm/offers/${getCrmRecordRef(document)}`,
    createLabel: 'Nová nabídka',
  },
  order: {
    title: 'Objednávky',
    detailTitle: 'Detail objednávky',
    singular: 'Objednávka',
    description: 'Přehled objednávek, jejich hodnoty, stavu a návaznosti na klienta a obchodní případ.',
    summaryTitle: 'Přehled objednávek',
    summaryDescription: 'Rychlá kontrola objednávek, jejich stavu a obchodního výsledku.',
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

const getDocumentStatusLabel = (status, type) => {
  if (status === 'sent' && type === 'offer') return 'Čeká na klienta';
  return documentStatuses.find((item) => item.value === status)?.label || status;
};

const formatCurrency = formatMoney;

const formatDate = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
};

const formatRecordCount = (count) => {
  if (count === 1) return '1 záznam';
  if (count >= 2 && count <= 4) return `${count} záznamy`;
  return `${count} záznamů`;
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
  section_name: '',
  item_kind: 'standard',
  alternative_group: '',
  included_in_total: true,
  line_total: 0,
  sort_order: 0,
  isNew: true,
});

const CRMCommercialDocuments = ({ type = 'offer' }) => {
  const config = documentTypeConfig[type] || documentTypeConfig.offer;
  const Icon = config.icon;
  const { documentId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { hasPermission, isAdmin } = useAuth();
  const canEdit = hasPermission('crm', 'can_edit');
  const canViewFinancials = isAdmin || hasPermission('finance', 'can_read') || hasPermission('crm', 'can_admin');
  const [documents, setDocuments] = useState([]);
  const [selectedDocument, setSelectedDocument] = useState(null);
  const [opportunities, setOpportunities] = useState([]);
  const [documentTemplates, setDocumentTemplates] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('default');
  const [numbering, setNumbering] = useState(() => normalizeCrmNumbering(Object.values(DEFAULT_CRM_NUMBERING)));
  const query = searchParams.get('q') || '';
  const statusFilter = searchParams.get('status') || 'all';
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogPickerOpen, setCatalogPickerOpen] = useState(false);
  const [fveWizardOpen, setFveWizardOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [createMode, setCreateMode] = useState('existing');
  const [createOpportunityId, setCreateOpportunityId] = useState('');
  const [createOpportunityTitle, setCreateOpportunityTitle] = useState('');
  const [createSubjectId, setCreateSubjectId] = useState(null);
  const [createSubject, setCreateSubject] = useState(null);
  const [createOpportunityValue, setCreateOpportunityValue] = useState('0');
  const [lifecycleAction, setLifecycleAction] = useState(null);
  const [lifecycleReason, setLifecycleReason] = useState('');
  const [relationDialogOpen, setRelationDialogOpen] = useState(false);
  const [relationTargetOpportunityId, setRelationTargetOpportunityId] = useState('');
  const [relationAction, setRelationAction] = useState('move');
  const [relationItemMode, setRelationItemMode] = useState('target-sync');
  const [deliveryDialogOpen, setDeliveryDialogOpen] = useState(false);
  const [copyItemsDialogOpen, setCopyItemsDialogOpen] = useState(false);
  const [copyItemSources, setCopyItemSources] = useState([]);
  const [copyItemSourceId, setCopyItemSourceId] = useState('');
  const [copyItemsLoading, setCopyItemsLoading] = useState(false);
  const [approvalRequired, setApprovalRequired] = useState(false);
  const fetchRequestRef = useRef({ id: 0, controller: null });
  useEffect(() => { setApprovalRequired(false); }, [selectedDocument?.id, type]);

  const fetchData = useCallback(async () => {
    fetchRequestRef.current.controller?.abort();
    const requestId = fetchRequestRef.current.id + 1;
    const request = createTimedAbortController(20_000);
    fetchRequestRef.current = { id: requestId, controller: request.controller };
    setLoading(true);
    try {
      const documentItemsSelect = documentId
        ? 'id, catalog_item_id, code, name, description, quantity, unit, unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate, commission_percent, line_total, margin_total, margin_percent, commission_total, profit_after_commission, profit_after_commission_percent, sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot, supplier_offer_id, supplier_name, supplier_sku_snapshot, section_name, item_kind, alternative_group, included_in_total'
        : 'id';
      const documentsQueryFactory = () => supabase
        .from('crm_commercial_documents')
        .select(`id, opportunity_id, subject_id, type, status, approval_status, approval_requested_at, approved_at, approved_by_member_id, number, title, issue_date, valid_until, gross_subtotal, subtotal, discount_total, tax_total, total, total_with_tax, cost_total, total_cost, margin_total, margin_value, margin_percent, commission_total, profit_after_commission, profit_after_commission_percent, notes, sync_items, current_version, sent_at, accepted_at, rejected_at, responded_at, response_note, reminder_count, last_reminder_at, source_document_id, created_at, cancelled_at, cancelled_reason, archived_at, archived_reason, deleted_at, deleted_reason, subject:subject_id(id, name, ico, dic, address, contact_person, email, phone), opportunity:opportunity_id(id, number, title, value, stage, description, subject:subject_id(id, name, ico, dic, address, contact_person, email, phone), project:project_id(id, name, code)${documentId ? ', opportunity_items:crm_opportunity_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate, commission_percent, line_total, margin_total, margin_percent, commission_total, profit_after_commission, profit_after_commission_percent, sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot, supplier_offer_id, supplier_name, supplier_sku_snapshot, section_name, item_kind, alternative_group, included_in_total)' : ''}), items:crm_commercial_document_items(${documentItemsSelect})`)
        .eq('type', type)
        .is('deleted_at', null)
        .order('created_at', { ascending: false }).order('id').abortSignal(request.signal);
      const documentsQuery = documentId
        ? filterCrmRecordByRef(documentsQueryFactory(), documentId).limit(1)
        : fetchAllCrmRows(documentsQueryFactory);

      const [documentsRes, opportunitiesRes, numberingRes, templatesRes] = await Promise.all([
        documentsQuery,
      fetchAllCrmRows(() => supabase
        .from('crm_opportunities')
        .select('id, number, title, value, subject_id, deleted_at, subject:subject_id(id, name, ico, dic, address, contact_person, email, phone)')
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .order('id')
        .abortSignal(request.signal)),
      selectCrmNumberingSettings(supabase, request.signal),
      supabase
        .from('order_templates')
        .select('id, name, content, document_category')
        .eq('is_active', true)
        .order('name')
        .abortSignal(request.signal),
      ]);
      if (requestId !== fetchRequestRef.current.id) return;

      const error = documentsRes.error || opportunitiesRes.error;
      if (error) throw error;

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
        _item_count: (document.items || []).length,
        _persisted_status: document.status,
        opportunity,
        sync_items: document.sync_items ?? true,
        items: [...((document.sync_items ?? true) ? (opportunity?.opportunity_items || fallbackOpportunity?.items || []) : (document.items || []))]
          .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
      };
    });
    setDocuments(normalizedDocuments);
    setOpportunities(opportunities);
    setDocumentTemplates(templatesRes.error ? [] : (templatesRes.data || []).filter((template) => (
      !template.document_category
      || template.document_category === 'generic'
      || template.document_category === type
    )));
    setNumbering(normalizeCrmNumbering(numberingRes.error ? [] : numberingRes.data));
    setSelectedDocument(documentId ? findCrmRecordByRef(normalizedDocuments, documentId) : null);

      if (!documentId) {
        setCatalogProducts([]);
        return;
      }

    const catalogRes = await supabase
        .from('commercial_item_catalog')
        .select('id, code, sku, name, description, category, unit, default_unit_price, default_vat_rate, purchase_price, preferred_supplier_offer_id, product_type, is_active, metadata')
        .eq('is_active', true)
        .order('name', { ascending: true })
        .limit(1_000)
        .abortSignal(request.signal);
    if (catalogRes.error) throw catalogRes.error;
    const catalogIds = (catalogRes.data || []).map((product) => product.id);
    const emptyCatalogResult = Promise.resolve({ data: [], error: null });
    const [stockRes, usageRes] = await Promise.all([
      catalogIds.length ? supabase
        .from('product_stock_status')
        .select('catalog_item_id, available_qty')
        .in('catalog_item_id', catalogIds)
        .abortSignal(request.signal) : emptyCatalogResult,
      catalogIds.length ? supabase
        .from('product_usage_stats')
        .select('catalog_item_id, total_usage_count, last_used_at')
        .in('catalog_item_id', catalogIds)
        .abortSignal(request.signal) : emptyCatalogResult,
    ]);
    if (requestId !== fetchRequestRef.current.id) return;
    const stockByProductId = new Map((stockRes.data || []).map((row) => [row.catalog_item_id, row]));
    const usageByProductId = new Map((usageRes.data || []).map((row) => [row.catalog_item_id, row]));
    setCatalogProducts(catalogRes.error ? [] : (catalogRes.data || []).map((product) => {
      const usage = usageByProductId.get(product.id) || {};
      return {
        ...product,
        available_qty: stockByProductId.get(product.id)?.available_qty ?? null,
        usage_count: usage.total_usage_count || 0,
        last_used_at: usage.last_used_at || null,
      };
    }));

    } catch (error) {
      if (requestId !== fetchRequestRef.current.id) return;
      setDocuments([]);
      setOpportunities([]);
      setSelectedDocument(null);
      toast({
        title: `${config.title} se nepodařilo načíst`,
        description: isRequestAbortError(error) ? 'Načítání překročilo časový limit.' : error.message,
        variant: 'destructive',
      });
    } finally {
      request.dispose();
      if (requestId === fetchRequestRef.current.id) setLoading(false);
    }
  }, [config.title, documentId, toast, type]);

  useEffect(() => {
    fetchData();
    return () => fetchRequestRef.current.controller?.abort();
  }, [fetchData]);

  const updateListFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (!value || value === 'all') next.delete(key);
    else next.set(key, value);
    setSearchParams(next, { replace: true });
  };

  const filteredDocuments = useMemo(() => documents.filter((document) => (
    commercialDocumentMatchesSearch(document, query) &&
    (statusFilter === 'all' || document.status === statusFilter)
  )), [documents, query, statusFilter]);
  const hasActiveFilters = Boolean(query.trim()) || statusFilter !== 'all';

  const documentSummary = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return documents.reduce((acc, document) => {
      const isDraft = document.status === 'draft';
      const isSent = document.status === 'sent';
      const isExpired = Boolean(document.valid_until && document.valid_until < today && !['accepted', 'closed', 'rejected', 'cancelled', 'deleted'].includes(document.status));
      const hasItems = Number(document._item_count || 0) > 0 || (document.items || []).length > 0;
      const totals = getCommercialDocumentTotals(document);
      return {
        total: acc.total + 1,
        draft: acc.draft + (isDraft ? 1 : 0),
        sent: acc.sent + (isSent ? 1 : 0),
        expired: acc.expired + (isExpired ? 1 : 0),
        withoutItems: acc.withoutItems + (!hasItems ? 1 : 0),
        value: acc.value + totals.total,
        cost: acc.cost + totals.cost_total,
        margin: acc.margin + totals.margin_total,
        commission: acc.commission + totals.commission_total,
        profitAfterCommission: acc.profitAfterCommission + totals.profit_after_commission,
      };
    }, { total: 0, draft: 0, sent: 0, expired: 0, withoutItems: 0, value: 0, cost: 0, margin: 0, commission: 0, profitAfterCommission: 0 });
  }, [documents]);

  const listColumns = useMemo(() => [
    { id: 'number', label: 'K\u00f3d', hideable: false },
    { id: 'title', label: 'P\u0159edm\u011bt' },
    { id: 'client', label: 'Klient' },
    { id: 'opportunity', label: 'Obchodn\u00ed p\u0159\u00edpad' },
    { id: 'created', label: 'Vytvo\u0159eno' },
    { id: 'status', label: 'Stav' },
    { id: 'total', label: 'Cena bez DPH' },
    ...(canViewFinancials ? [
      { id: 'margin', label: 'Mar\u017ee' },
      { id: 'profitAfterCommission', label: 'Zisk po provizi' },
    ] : []),
    { id: 'validUntil', label: 'Konec platnosti' },
    { id: 'actions', label: 'Akce', hideable: false },
  ], [canViewFinancials]);
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
    margin: 'min-w-[120px] text-right',
    profitAfterCommission: 'min-w-[150px] text-right',
    validUntil: 'min-w-[130px]',
    actions: 'w-12 text-right',
  };
  const listCellClasses = {
    number: 'font-semibold text-slate-950',
    title: 'max-w-[360px] truncate',
    client: 'font-medium',
    total: 'text-right font-semibold',
    margin: 'text-right font-semibold text-emerald-700',
    profitAfterCommission: 'text-right font-semibold text-slate-950',
    actions: 'text-right',
  };
  const renderListCell = (document, columnId) => {
    const totals = getCommercialDocumentTotals(document);
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
            {getDocumentStatusLabel(document.status, document.type)}
          </Badge>
        );
      case 'total':
        return formatCurrency(totals.total);
      case 'margin':
        return (
          <div>
            <div>{formatCurrency(totals.margin_total)}</div>
            <div className="text-xs font-normal text-muted-foreground">{formatPercent(totals.margin_percent)}</div>
          </div>
        );
      case 'profitAfterCommission':
        return (
          <div>
            <div>{formatCurrency(totals.profit_after_commission)}</div>
            <div className="text-xs font-normal text-muted-foreground">Provize {formatCurrency(totals.commission_total)}</div>
          </div>
        );
      case 'validUntil':
        return formatDate(document.valid_until);
      case 'sync':
        return (
          <Badge variant="outline" className={document.sync_items === false ? 'border-slate-200 bg-slate-50 text-slate-600' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}>
            {document.sync_items === false ? 'Vlastn\u00ed polo\u017eky' : 'Sync s OP'}
          </Badge>
        );
      case 'actions':
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="icon" aria-label="Akce dokumentu">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem asChild>
                <Link to={config.detailPath(document)}>
                  <FileText className="mr-2 h-4 w-4" />
                  Otev\u0159\u00edt detail
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!canEdit || document.status === 'cancelled'} onSelect={() => openDocumentLifecycleAction('cancel', document)}>
                <Ban className="mr-2 h-4 w-4" />
                Stornovat
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!canEdit} className="text-rose-700 focus:text-rose-700" onSelect={() => openDocumentLifecycleAction('delete', document)}>
                <Trash2 className="mr-2 h-4 w-4" />
                Odstranit
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
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

  const updateItem = (itemId, field, value, rowIndex = 0) => {
    const numericFields = ['quantity', 'unit_price', 'unit_cost', 'purchase_price_snapshot', 'discount_percent', 'vat_rate', 'commission_percent'];
    setSelectedDocument((current) => {
      if (!current) return current;
      return {
        ...current,
        items: current.items.map((item, index) => {
          if (item.id !== itemId && index !== rowIndex) return item;
          const valueToStore = numericFields.includes(field) ? Number(value || 0) : value;
          return normalizeCrmItem({ ...item, [field]: valueToStore }, index);
        }),
      };
    });
  };

  const addItem = () => {
    setSelectedDocument((current) => current ? { ...current, items: [...current.items, normalizeCrmItem(emptyItem(), current.items.length)] } : current);
  };

  const addCatalogItems = (products = []) => {
    if (!products.length) return;
    const timestamp = Date.now();
    setSelectedDocument((current) => current ? {
      ...current,
      items: [
        ...current.items,
        ...products.map((product, index) => createCrmCatalogItem(product, {
          ...emptyItem(),
          id: `new-${timestamp}-${index}-${product.id || product.code}`,
        })),
      ],
    } : current);
    setCatalogQuery('');
  };

  const removeItem = (itemId, rowIndex) => {
    setSelectedDocument((current) => current ? { ...current, items: current.items.filter((item, index) => item.id !== itemId && index !== rowIndex) } : current);
  };

  const openCopyItemsDialog = async () => {
    setCopyItemsDialogOpen(true);
    setCopyItemsLoading(true);
    setCopyItemSourceId('');
    try {
      const { data, error } = await supabase.from('crm_commercial_documents')
        .select('id, number, title, type, created_at')
        .neq('id', selectedDocument.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      setCopyItemSources(data || []);
    } catch (error) {
      toast({ title: 'Dokumenty se nepodařilo načíst', description: crmWorkflowErrorMessage(error), variant: 'destructive' });
    } finally {
      setCopyItemsLoading(false);
    }
  };

  const copyItemsFromDocument = async () => {
    if (!copyItemSourceId) return;
    setCopyItemsLoading(true);
    try {
      const { data, error } = await supabase.from('crm_commercial_document_items')
        .select('catalog_item_id, code, name, description, quantity, unit, unit_price, unit_cost, purchase_price_snapshot, discount_percent, vat_rate, commission_percent, sort_order, product_sku, product_type, stock_available_snapshot, catalog_price_snapshot, supplier_offer_id, supplier_name, supplier_sku_snapshot, section_name, item_kind, alternative_group, included_in_total')
        .eq('document_id', copyItemSourceId)
        .order('sort_order');
      if (error) throw error;
      const copied = (data || []).map((item, index) => normalizeCrmItem({ ...item, id: `copy-${Date.now()}-${index}` }, index));
      setSelectedDocument((current) => current ? { ...current, items: copied, sync_items: false } : current);
      setCopyItemsDialogOpen(false);
      toast({ title: 'Položky byly zkopírovány', description: `${copied.length} položek je připraveno k uložení jako vlastní snapshot.` });
    } catch (error) {
      toast({ title: 'Položky se nepodařilo zkopírovat', description: crmWorkflowErrorMessage(error), variant: 'destructive' });
    } finally {
      setCopyItemsLoading(false);
    }
  };

  const applyFveOfferItems = (items) => {
    const nextItems = items.map((item, index) => ({ ...item, id: `fve-${Date.now()}-${index}` }));
    const totals = calculateCrmTotals(nextItems);
    setSelectedDocument((current) => current ? {
      ...current,
      ...totals,
      items: nextItems,
    } : current);
    setFveWizardOpen(false);
    toast({ title: 'FVE položky vloženy', description: 'Před uložením je můžete ručně upravit.' });
  };



  const handleSaveDocument = async () => {
    if (!selectedDocument || !canEdit) return;
    if (selectedDocument._persisted_status && selectedDocument._persisted_status !== 'draft') {
      toast({ title: 'Dokument je uzavřený', description: 'Položky a finanční údaje lze měnit pouze u rozpracovaného dokumentu.', variant: 'destructive' });
      return;
    }
    setSaving(true);

    const items = selectedDocument.items.map((item, index) => buildCrmDocumentItemPayload(item, selectedDocument.id, index));
    const sourceIsOpportunity = selectedDocument.sync_items ?? true;
    const itemRows = sourceIsOpportunity
      ? selectedDocument.items.map((item, index) => buildCrmOpportunityItemPayload(item, selectedDocument.opportunity_id, index))
      : items;

    const rpcPayload = itemRows.map(({ opportunity_id, document_id, ...item }) => item);
    const nextStatus = selectedDocument.status || 'draft';
    const { data: updatedDocument, error: docError } = await supabase.rpc('save_crm_commercial_document_draft', {
      p_document_id: selectedDocument.id,
      p_document: {
        title: formatCommercialDocumentTitle(selectedDocument.title?.trim()) || config.singular,
        status: nextStatus,
        issue_date: selectedDocument.issue_date || new Date().toISOString().slice(0, 10),
        valid_until: selectedDocument.valid_until || null,
        notes: selectedDocument.notes || null,
        subject_id: selectedDocument.subject_id || null,
      },
      p_items: rpcPayload,
      p_sync_items: sourceIsOpportunity,
    });

    if (docError) {
      setSaving(false);
      toast({ title: 'Dokument se nepodařilo uložit', description: docError.message, variant: 'destructive' });
      return;
    }
    if (!updatedDocument?.id) {
      setSaving(false);
      toast({
        title: 'Dokument mezitím změnil stav',
        description: 'Obnovte stránku. Finální dokument nelze přepsat rozpracovanými hodnotami.',
        variant: 'destructive',
      });
      await fetchData();
      return;
    }

    setSaving(false);
    if (type === 'offer') await supabase.rpc('refresh_crm_offer_approval_state', { p_document_id: selectedDocument.id });
    toast({ title: selectedDocument.sync_items ? 'Dokument uložen a položky synchronizovány' : 'Dokument uložen' });
    fetchData();
  };

  const openCreateDocumentDialog = () => {
    const defaultOpportunity = opportunities[0];
    setCreateMode(defaultOpportunity ? 'existing' : 'new');
    setCreateOpportunityId(defaultOpportunity?.id || '');
    setCreateOpportunityTitle('');
    setCreateSubjectId(null);
    setCreateSubject(null);
    setCreateOpportunityValue('0');
    setCreateDialogOpen(true);
  };

  const handleCreateDocument = async () => {
    if (!canEdit || saving) return;
    if (createMode === 'existing' && !createOpportunityId) return;
    if (createMode === 'new' && (!createOpportunityTitle.trim() || !createSubjectId)) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('create_crm_commercial_document_atomic', {
        p_opportunity_id: createMode === 'existing' ? createOpportunityId : null,
        p_type: type,
        p_new_opportunity: createMode === 'new' ? {
          title: createOpportunityTitle.trim(),
          subject_id: createSubjectId,
          value: Number(createOpportunityValue || 0),
        } : null,
      });
      if (error) throw error;
      if (!data?.id) throw new Error('Server nepotvrdil vytvoření dokumentu. Obnovte seznam před opakováním.');
      setCreateDialogOpen(false);
      toast({ title: config.singular + ' vytvořena' });
      navigate(config.detailPath(data));
    } catch (error) {
      toast({ title: config.singular + ' se nepodařilo vytvořit', description: crmWorkflowErrorMessage(error), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const getSortedOpportunityItems = (opportunity) => (
    [...(opportunity?.items || opportunity?.opportunity_items || [])]
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
  );

  const openRelationDialog = (action = 'move') => {
    if (!selectedDocument) return;
    setRelationAction(action);
    setRelationTargetOpportunityId(selectedDocument.opportunity_id || '');
    setRelationItemMode(action === 'copy' ? 'current-copy' : 'target-sync');
    setRelationDialogOpen(true);
  };

  const buildRelationItems = (targetOpportunity) => {
    if (relationItemMode === 'current-copy') {
      return [...(selectedDocument?.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    }
    return getSortedOpportunityItems(targetOpportunity);
  };

  const handleApplyDocumentRelation = async () => {
    if (!selectedDocument || !canEdit || saving || !relationTargetOpportunityId) return;
    setSaving(true);
    try {
      const { data, error } = await supabase.rpc('relate_crm_commercial_document_atomic', {
        p_document_id: selectedDocument.id,
        p_target_opportunity_id: relationTargetOpportunityId,
        p_action: relationAction,
        p_item_mode: relationItemMode,
        p_items: relationItemMode === 'current-copy'
          ? selectedDocument.items.map((item, index) => {
            const { document_id, ...row } = buildCrmDocumentItemPayload(item, selectedDocument.id, index);
            return row;
          }) : null,
      });
      if (error) throw error;
      if (!data?.id) throw new Error('Server nepotvrdil změnu dokumentu. Obnovte seznam před opakováním.');
      setRelationDialogOpen(false);
      toast({ title: relationAction === 'copy' ? 'Dokument zkopírován' : 'Obchodní případ dokumentu změněn' });
      if (relationAction === 'copy') navigate(config.detailPath(data));
      else await fetchData();
    } catch (error) {
      toast({ title: 'Změnu dokumentu se nepodařilo uložit', description: crmWorkflowErrorMessage(error), variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateSelectedDocument = async (format = 'docx') => {
    if (!selectedDocument) return;
    setSaving(true);
    try {
      const {
        downloadGeneratedDocumentDocx,
        downloadGeneratedDocumentHtml,
        downloadGeneratedDocumentPdf,
      } = await import('@/lib/documentGenerationService');
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
        await downloadGeneratedDocumentPdf(generationInput);
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

  const openDocumentLifecycleAction = (kind, document = selectedDocument) => {
    if (!document) return;
    setLifecycleAction({ kind, document });
    setLifecycleReason(kind === 'cancel' ? (document.cancelled_reason || '') : (document.deleted_reason || ''));
  };

  const closeLifecycleAction = () => {
    if (saving) return;
    setLifecycleAction(null);
    setLifecycleReason('');
  };

  const handleConfirmDocumentLifecycleAction = async () => {
    if (!lifecycleAction?.document || !canEdit) return;
    const isDelete = lifecycleAction.kind === 'delete';
    const reason = lifecycleReason.trim();
    if (!reason) {
      toast({ title: 'Doplnte duvod', description: 'Duvod zustane ulozeny v audit historii pro admina.', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const rpcName = isDelete ? 'crm_soft_delete_commercial_document' : 'crm_cancel_commercial_document';
    const { error } = await supabase.rpc(rpcName, {
      p_document_id: lifecycleAction.document.id,
      p_reason: reason,
    });
    setSaving(false);

    if (error) {
      toast({ title: isDelete ? 'Dokument se nepodarilo odstranit' : 'Dokument se nepodarilo stornovat', description: error.message, variant: 'destructive' });
      return;
    }

    toast({ title: isDelete ? 'Dokument odstranen' : 'Dokument stornovan', description: 'Zaznam zustava ulozeny v audit historii pro admina.' });
    setLifecycleAction(null);
    setLifecycleReason('');
    await fetchData();
    if (isDelete && documentId) navigate(config.listPath);
  };


  const renderRelationDialog = () => {
    const targetOpportunity = opportunities.find((opportunity) => opportunity.id === relationTargetOpportunityId);
    const sourceItems = buildRelationItems(targetOpportunity);
    const totals = calculateCrmTotals(sourceItems);
    const sameOpportunity = relationAction === 'move' && relationTargetOpportunityId === selectedDocument?.opportunity_id;
    const copyCurrentItems = relationItemMode === 'current-copy';

    return (
      <Dialog open={relationDialogOpen} onOpenChange={(open) => !saving && setRelationDialogOpen(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Zmenit OP / kopirovat dokument</DialogTitle>
            <DialogDescription>
              Nabídku nebo objednávku můžete přepnout na jiný obchodní případ nebo vytvořit kopii pro další OP.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setRelationAction('move')}
                className={cn('rounded-lg border p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/50', relationAction === 'move' ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white')}
              >
                <div className="flex items-center gap-2 font-semibold text-slate-950"><Link2 className="h-4 w-4" />Prepnout tento dokument</div>
                <div className="mt-1 text-sm text-slate-500">Zmeni vazbu existujiciho dokumentu na vybrany OP.</div>
              </button>
              <button
                type="button"
                onClick={() => setRelationAction('copy')}
                className={cn('rounded-lg border p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/50', relationAction === 'copy' ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white')}
              >
                <div className="flex items-center gap-2 font-semibold text-slate-950"><Copy className="h-4 w-4" />Vytvořit kopii</div>
                <div className="mt-1 text-sm text-slate-500">Puvodni dokument zustane beze zmeny a vznikne novy zaznam.</div>
              </button>
            </div>

            <div className="space-y-2">
              <Label>Cilovy obchodni pripad</Label>
              <Select value={relationTargetOpportunityId} onValueChange={setRelationTargetOpportunityId} disabled={saving}>
                <SelectTrigger className="bg-white"><SelectValue placeholder="Vyberte OP" /></SelectTrigger>
                <SelectContent>
                  {opportunities.map((opportunity) => (
                    <SelectItem key={opportunity.id} value={opportunity.id}>{(opportunity.number || 'OP') + ' - ' + opportunity.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Polozky dokumentu</Label>
              <Select value={relationItemMode} onValueChange={setRelationItemMode} disabled={saving}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="target-sync">Napojit na polozky ciloveho OP</SelectItem>
                  <SelectItem value="current-copy">Zkopirovat aktualni polozky jako vlastni</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {copyCurrentItems ? 'Dokument bude mít vlastní snapshot položek a nebude se dál automaticky měnit podle OP.' : 'Dokument zůstane synchronizovaný s cílovým OP. Úpravy položek se budou řídit položkami OP.'}
              </p>
            </div>

            <div className="grid gap-3 rounded-lg border bg-slate-50 p-3 text-sm sm:grid-cols-3">
              <div><div className="text-xs uppercase text-muted-foreground">Položky</div><div className="font-semibold text-slate-950">{copyCurrentItems ? sourceItems.length : 'Dle cílového OP'}</div></div>
              <div><div className="text-xs uppercase text-muted-foreground">Bez DPH</div><div className="font-semibold text-slate-950">{copyCurrentItems ? formatCurrency(totals.total) : 'Přepočítá se při uložení'}</div></div>
              <div><div className="text-xs uppercase text-muted-foreground">S DPH</div><div className="font-semibold text-slate-950">{copyCurrentItems ? formatCurrency(Number(totals.total || 0) + Number(totals.tax_total || 0)) : 'Přepočítá se při uložení'}</div></div>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRelationDialogOpen(false)} disabled={saving}>Zrušit</Button>
            <Button type="button" onClick={handleApplyDocumentRelation} disabled={saving || !relationTargetOpportunityId || sameOpportunity}>
              {saving ? 'Ukládám…' : (relationAction === 'copy' ? 'Vytvořit kopii' : 'Přepnout OP')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  const renderLifecycleActionDialog = () => {
    const isDelete = lifecycleAction?.kind === 'delete';
    const document = lifecycleAction?.document;
    return (
      <Dialog open={Boolean(lifecycleAction)} onOpenChange={(open) => !open && closeLifecycleAction()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{isDelete ? 'Odstranit dokument' : 'Stornovat dokument'}</DialogTitle>
            <DialogDescription>
              {document?.number ? document.number + ' - ' : ''}{formatCommercialDocumentTitle(document?.title)}.
              Zaznam se nebude zobrazovat v beznych seznamech, ale zustane dohledatelny v admin audit historii.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Duvod *</Label>
            <Textarea
              value={lifecycleReason}
              onChange={(event) => setLifecycleReason(event.target.value)}
              rows={4}
              placeholder={isDelete ? 'Proc se dokument odstranuje?' : 'Proc se dokument stornuje?'}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeLifecycleAction} disabled={saving}>Zrušit</Button>
            <Button type="button" variant={isDelete ? 'destructive' : 'default'} onClick={handleConfirmDocumentLifecycleAction} disabled={saving || !lifecycleReason.trim()}>
              {saving ? 'Ukladam...' : (isDelete ? 'Odstranit' : 'Stornovat')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  if (documentId) {
    const detailTotals = calculateCrmTotals(selectedDocument?.items || []);
    const selectedTemplate = documentTemplates.find((item) => item.id === selectedTemplateId) || null;
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
                    <SelectItem value="default">Firemní EKV (doporučeno)</SelectItem>
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
              <Button variant="outline" onClick={() => setDeliveryDialogOpen(true)} disabled={!canEdit || saving || !selectedDocument || selectedDocument.status === 'cancelled' || (type === 'offer' && approvalRequired && selectedDocument.approval_status !== 'approved')}>
                <Mail className="mr-2 h-4 w-4" />
                Odeslat klientovi
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" disabled={!canEdit || saving || !selectedDocument}>
                    <MoreHorizontal className="mr-2 h-4 w-4" />
                    Akce
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuLabel>Dokument</DropdownMenuLabel>
                  <DropdownMenuItem onSelect={() => openRelationDialog('move')}>
                    <Link2 className="mr-2 h-4 w-4" />
                    Zmenit OP / polozky
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openRelationDialog('copy')}>
                    <Copy className="mr-2 h-4 w-4" />
                    Kopirovat k jinemu OP
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Lifecycle dokumentu</DropdownMenuLabel>
                  <DropdownMenuItem disabled={selectedDocument?.status === 'cancelled'} onSelect={() => openDocumentLifecycleAction('cancel')}>
                    <Ban className="mr-2 h-4 w-4" />
                    Stornovat
                  </DropdownMenuItem>
                  <DropdownMenuItem className="text-rose-700 focus:text-rose-700" onSelect={() => openDocumentLifecycleAction('delete')}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Odstranit
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button onClick={handleSaveDocument} disabled={!canEdit || saving || !selectedDocument || selectedDocument._persisted_status !== 'draft'}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? 'Ukládám...' : 'Uložit'}
              </Button>
            </div>
          )}
        />

        {renderLifecycleActionDialog()}
        {renderRelationDialog()}
        <Dialog open={copyItemsDialogOpen} onOpenChange={(open) => !copyItemsLoading && setCopyItemsDialogOpen(open)}>
          <DialogContent className="max-w-xl">
            <DialogHeader><DialogTitle>Kopírovat položky z dokumentu</DialogTitle><DialogDescription>Aktuální položky se nahradí kopií vybraného dokumentu. Změna se uloží až tlačítkem Uložit.</DialogDescription></DialogHeader>
            <div className="space-y-2 py-2"><Label>Zdrojový dokument</Label><Select value={copyItemSourceId} onValueChange={setCopyItemSourceId} disabled={copyItemsLoading}><SelectTrigger><SelectValue placeholder={copyItemsLoading ? 'Načítám…' : 'Vyberte nabídku nebo objednávku'} /></SelectTrigger><SelectContent>{copyItemSources.map((source) => <SelectItem key={source.id} value={source.id}>{source.number || source.type} - {formatCommercialDocumentTitle(source.title)}</SelectItem>)}</SelectContent></Select></div>
            <DialogFooter><Button variant="outline" onClick={() => setCopyItemsDialogOpen(false)} disabled={copyItemsLoading}>Zrušit</Button><Button onClick={copyItemsFromDocument} disabled={copyItemsLoading || !copyItemSourceId}>{copyItemsLoading ? 'Kopíruji…' : 'Použít položky'}</Button></DialogFooter>
          </DialogContent>
        </Dialog>

        {loading || !selectedDocument ? (
          <Card><CardContent className="p-8 text-sm text-muted-foreground">Načítám dokument...</CardContent></Card>
        ) : (
          <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(300px,0.55fr)]">
      
      <Card className="min-w-0 crm-panel">
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
                  <Badge variant="outline" className="w-fit">{getDocumentStatusLabel(selectedDocument.status, selectedDocument.type)}</Badge>
                </div>
              </CardHeader>
              <CardContent className="grid gap-4 bg-white p-5 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label>Název dokumentu</Label>
                  <Input value={selectedDocument.title || ''} onChange={(event) => updateSelectedDocument('title', event.target.value)} disabled={!canEdit || saving || selectedDocument._persisted_status !== 'draft'} />
                </div>
                <div className="space-y-2">
                  <Label>Stav</Label>
                  <Input value={getDocumentStatusLabel(selectedDocument.status, selectedDocument.type)} disabled className="bg-slate-50" />
                  {selectedDocument._persisted_status === 'draft' && (
                    <p className="text-xs text-muted-foreground">Stav se změní automaticky po odeslání nebo po odpovědi klienta.</p>
                  )}
                </div>
                <div className="space-y-2">
                  <SubjectSelect
                    label="Subjekt dokumentu"
                    value={selectedDocument.subject_id || ''}
                    onChange={(value, subject) => updateSelectedDocumentSubject(value || null, subject)}
                    onCreated={(subject) => updateSelectedDocumentSubject(subject.id, subject)}
                    placeholder="Vyberte nebo vytvořte subjekt"
                    disabled={!canEdit || saving || selectedDocument._persisted_status !== 'draft'}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vystaveno</Label>
                  <Input type="date" value={selectedDocument.issue_date || ''} onChange={(event) => updateSelectedDocument('issue_date', event.target.value)} disabled={!canEdit || saving || selectedDocument._persisted_status !== 'draft'} />
                </div>
                <div className="space-y-2">
                  <Label>Platnost do</Label>
                  <Input type="date" value={selectedDocument.valid_until || ''} onChange={(event) => updateSelectedDocument('valid_until', event.target.value)} disabled={!canEdit || saving || selectedDocument._persisted_status !== 'draft'} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Popis / poznámka</Label>
                  <Textarea value={selectedDocument.notes || ''} onChange={(event) => updateSelectedDocument('notes', event.target.value)} rows={5} disabled={!canEdit || saving || selectedDocument._persisted_status !== 'draft'} />
                </div>
              </CardContent>
            </Card>

            <div className="min-w-0 space-y-4">
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <CardTitle className="text-base">Souhrn</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 p-4 text-sm">
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">{'P\u0159ed slevou bez DPH'}</span><strong>{formatCurrency(detailTotals.subtotal)}</strong></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Sleva bez DPH</span><strong>{formatCurrency(detailTotals.discount_total)}</strong></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">Bez DPH</span><strong>{formatCurrency(detailTotals.total)}</strong></div>
                  <div className="flex justify-between gap-3"><span className="text-muted-foreground">DPH</span><strong>{formatCurrency(detailTotals.tax_total)}</strong></div>
                  <div className="flex justify-between gap-3 rounded-md bg-primary px-3 py-2 text-primary-foreground"><span>Celkem s DPH</span><strong>{formatCurrency(detailTotals.total_with_tax)}</strong></div>
                  {canViewFinancials && <div className="space-y-2 border-t pt-3">
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">{'N\u00e1klady'}</span><strong>{formatCurrency(detailTotals.cost_total)}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">{'Hrub\u00e1 mar\u017ee'}</span><strong>{formatCurrency(detailTotals.margin_total)} {'\u00b7'} {formatPercent(detailTotals.margin_percent)}</strong></div>
                    <div className="flex justify-between gap-3"><span className="text-muted-foreground">Provize</span><strong>{formatCurrency(detailTotals.commission_total)}</strong></div>
                    <div className="flex justify-between gap-3 rounded-md bg-emerald-50 px-3 py-2 text-emerald-900"><span>Zisk po provizi</span><strong>{formatCurrency(detailTotals.profit_after_commission)} {'\u00b7'} {formatPercent(detailTotals.profit_after_commission_percent)}</strong></div>
                  </div>}
                  <p className="text-xs text-muted-foreground">{'Souhrn se po\u010d\u00edt\u00e1 p\u0159\u00edmo z polo\u017eek: n\u00e1kupn\u00ed cena, sleva, DPH, mar\u017ee a provize.'}</p>
                </CardContent>
              </Card>
              <Card className="crm-panel">
                <CardHeader className="crm-panel-header">
                  <CardTitle className="text-base">Synchronizace položek</CardTitle>
                  <CardDescription>Zapnuto znamená, že položky se při uložení propíšou do ostatních synchronizovaných nabídek a objednávek stejného obchodního případu.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-between gap-4 p-4">
                  <Label htmlFor="sync-items">Synchronizovat s obchodním případem</Label>
                  <Switch id="sync-items" checked={selectedDocument.sync_items ?? true} onCheckedChange={(checked) => updateSelectedDocument('sync_items', checked)} disabled={!canEdit || saving || selectedDocument._persisted_status !== 'draft'} />
                </CardContent>
              </Card>
            </div>

            <div className="min-w-0 space-y-3 xl:col-span-2">
              {type === 'offer' && (
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={openCopyItemsDialog} disabled={!canEdit || saving || selectedDocument._persisted_status !== 'draft'}>
                    <Copy className="mr-2 h-4 w-4" />Kopírovat položky
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setFveWizardOpen(true)} disabled={!canEdit || saving || selectedDocument._persisted_status !== 'draft'}>
                    <Calculator className="mr-2 h-4 w-4" />Jednoduchá FVE
                  </Button>
                </div>
              )}
              <CrmProductPickerDialog
                open={catalogPickerOpen}
                onOpenChange={setCatalogPickerOpen}
                products={catalogProducts}
                loading={loading}
                onApply={addCatalogItems}
              />
              <CrmLineItemsTable
                title="Položkový seznam"
                description="Položky jsou společné pro obchodní případ, pokud u dokumentu nevypnete synchronizaci. Po vypnutí sync jsou vlastní pro tento záznam."
                items={selectedDocument.items}
                canEdit={canEdit && selectedDocument._persisted_status === 'draft'}
                disabled={saving}
                onUpdateItem={updateItem}
                onRemoveItem={removeItem}
                onAddManual={addItem}
                onOpenCatalog={() => setCatalogPickerOpen(true)}
                showFinancials={canViewFinancials}
              />
              {type === 'offer' && <CRMOfferApprovalPanel document={selectedDocument} canEdit={canEdit} isAdmin={isAdmin} onChanged={fetchData} onRequirement={setApprovalRequired} />}
              <CRMCommercialDocumentDelivery
                document={selectedDocument}
                template={selectedTemplate}
                open={deliveryDialogOpen}
                onOpenChange={setDeliveryDialogOpen}
                canSend={canEdit}
                onSent={fetchData}
              />
            </div>
          </div>
        )}
        <FveOfferWizardDialog
          open={fveWizardOpen}
          onOpenChange={setFveWizardOpen}
          onApply={applyFveOfferItems}
        />
      </div>
    );
  }

  return (
    <div className="app-page-wide space-y-6">
      <PageHeader
        icon={Icon}
        title={config.title}
        description={config.description}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={fetchData} disabled={loading}>
              <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
              Obnovit
            </Button>
            <Button onClick={openCreateDocumentDialog} disabled={!canEdit || saving}>
              <Plus className="mr-2 h-4 w-4" />
              {config.createLabel}
            </Button>
          </div>
        )}
      />

      {renderLifecycleActionDialog()}

      <Dialog open={createDialogOpen} onOpenChange={(open) => !saving && setCreateDialogOpen(open)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{config.createLabel}</DialogTitle>
            <DialogDescription>
              Vyberte, zda dokument přiřadíte k existujícímu obchodnímu případu, nebo spolu s ním založíte nový.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setCreateMode('existing')}
                className={cn(
                  'rounded-lg border p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/50',
                  createMode === 'existing' ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white'
                )}
              >
                <div className="font-semibold text-slate-950">Přiřadit k existujícímu případu</div>
                <div className="mt-1 text-sm text-slate-500">Dokument převezme klienta, položky a hodnotu z vybraného obchodního případu.</div>
              </button>
              <button
                type="button"
                onClick={() => setCreateMode('new')}
                className={cn(
                  'rounded-lg border p-4 text-left transition hover:border-blue-300 hover:bg-blue-50/50',
                  createMode === 'new' ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-100' : 'border-slate-200 bg-white'
                )}
              >
                <div className="font-semibold text-slate-950">Vytvořit nový obchodní případ</div>
                <div className="mt-1 text-sm text-slate-500">Nejdříve se založí nový obchodní případ a dokument se k němu automaticky připojí.</div>
              </button>
            </div>

            {createMode === 'existing' ? (
              <div className="space-y-2">
                <Label>Obchodní případ</Label>
                <Select value={createOpportunityId} onValueChange={setCreateOpportunityId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vyberte obchodní případ" />
                  </SelectTrigger>
                  <SelectContent>
                    {opportunities.map((opportunity) => (
                      <SelectItem key={opportunity.id} value={opportunity.id}>
                        {(opportunity.number || 'OP') + ' - ' + opportunity.title + (opportunity.subject?.name ? ' (' + opportunity.subject.name + ')' : '')}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {opportunities.length === 0 && (
                  <p className="text-sm text-amber-700">Zatím není dostupný žádný obchodní případ. Založte nový společně s dokumentem.</p>
                )}
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Název obchodního případu</Label>
                  <Input value={createOpportunityTitle} onChange={(event) => setCreateOpportunityTitle(event.target.value)} placeholder="Např. FVE – Rodinný dům" />
                </div>
                <div className="sm:col-span-2">
                  <SubjectSelect
                    value={createSubjectId}
                    onChange={(subjectId, subject) => {
                      setCreateSubjectId(subjectId);
                      setCreateSubject(subject);
                    }}
                    label="Subjekt"
                    placeholder="Vybrat nebo založit klienta..."
                    disabled={saving}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Odhadovaná hodnota bez DPH</Label>
                  <Input type="number" min="0" value={createOpportunityValue} onChange={(event) => setCreateOpportunityValue(event.target.value)} />
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                  Nový obchodní případ dostane číslo {formatCrmNumber(numbering, 'opportunity')} a dokument číslo {formatCrmNumber(numbering, type)}.
                  {createSubject?.name ? <div className="mt-1 font-medium text-slate-800">Klient: {createSubject.name}</div> : null}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateDialogOpen(false)} disabled={saving}>Zrušit</Button>
            <Button type="button" onClick={handleCreateDocument} disabled={saving || (createMode === 'existing' ? !createOpportunityId : (!createOpportunityTitle.trim() || !createSubjectId))}>
              {saving ? 'Vytvářím…' : config.createLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card className="crm-panel">
        <CardHeader className="crm-panel-header">
          <CardTitle className="text-base">{config.summaryTitle}</CardTitle>
          <CardDescription>{config.summaryDescription}</CardDescription>
        </CardHeader>
        <CardContent className={cn('grid grid-cols-2 gap-3 p-4', canViewFinancials ? 'xl:grid-cols-7' : 'xl:grid-cols-5')}>
          {[
            { label: 'Návrhy', value: documentSummary.draft, tone: 'amber' },
            { label: 'Odesláno', value: documentSummary.sent, tone: 'blue' },
            { label: 'Po platnosti', value: documentSummary.expired, tone: documentSummary.expired > 0 ? 'rose' : 'emerald' },
            { label: 'Bez položek', value: documentSummary.withoutItems, tone: documentSummary.withoutItems > 0 ? 'rose' : 'emerald' },
            { label: 'Hodnota celkem', value: formatCurrency(documentSummary.value), tone: 'slate' },
            ...(canViewFinancials ? [
              { label: 'Mar\u017ee celkem', value: formatCurrency(documentSummary.margin), tone: 'emerald' },
              { label: 'Zisk po provizi', value: formatCurrency(documentSummary.profitAfterCommission), tone: 'blue' },
            ] : []),
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
            <div className="flex w-full flex-col gap-2 sm:flex-row lg:w-auto">
              <div className="relative w-full lg:w-96">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input value={query} onChange={(event) => updateListFilter('q', event.target.value)} placeholder="Hledat číslo, klienta, IČO nebo obchodní případ…" className="pl-9" />
              </div>
              <Select value={statusFilter} onValueChange={(value) => updateListFilter('status', value)}>
                <SelectTrigger className="w-full sm:w-48" aria-label="Filtrovat podle stavu">
                  <SelectValue placeholder="Všechny stavy" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Všechny stavy</SelectItem>
                  {documentStatuses.map((status) => (
                    <SelectItem key={status.value} value={status.value}>{status.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {hasActiveFilters ? (
                <Button type="button" variant="ghost" onClick={() => setSearchParams({}, { replace: true })}>Vymazat filtry</Button>
              ) : null}
            </div>
            <p className="text-sm text-muted-foreground">{formatRecordCount(filteredDocuments.length)} v seznamu</p>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="space-y-3 p-3 md:hidden">
            {loading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Načítám…</p>
            ) : filteredDocuments.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-slate-700">{hasActiveFilters ? 'Žádný dokument neodpovídá filtrům.' : 'Zatím zde nejsou žádné dokumenty.'}</p>
                {hasActiveFilters ? <Button type="button" variant="link" onClick={() => setSearchParams({}, { replace: true })}>Vymazat filtry</Button> : null}
              </div>
            ) : filteredDocuments.map((document) => {
              const totals = getCommercialDocumentTotals(document);
              return (
                <article key={document.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <button type="button" className="min-w-0 flex-1 text-left" onClick={() => navigate(config.detailPath(document))}>
                      <span className="text-sm font-semibold text-primary">{document.number || '-'}</span>
                      <h3 className="mt-1 truncate font-semibold text-slate-950">{formatCommercialDocumentTitle(document.title) || config.singular}</h3>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant="outline" className={cn('font-semibold', getStatusBadgeClass(document.status))}>
                        {getDocumentStatusLabel(document.status, document.type)}
                      </Badge>
                      {renderListCell(document, 'actions')}
                    </div>
                  </div>
                  <button type="button" className="mt-3 grid w-full grid-cols-2 gap-x-4 gap-y-3 text-left text-sm" onClick={() => navigate(config.detailPath(document))}>
                    <span><span className="block text-xs text-muted-foreground">Klient</span><strong className="font-medium text-slate-800">{document.subject?.name || document.opportunity?.subject?.name || '-'}</strong></span>
                    <span><span className="block text-xs text-muted-foreground">Cena bez DPH</span><strong className="font-semibold text-slate-950">{formatCurrency(totals.total)}</strong></span>
                    <span><span className="block text-xs text-muted-foreground">Obchodní případ</span><strong className="font-medium text-slate-800">{document.opportunity?.number || '-'}</strong></span>
                    {canViewFinancials && <span><span className="block text-xs text-muted-foreground">Marže</span><strong className="font-semibold text-emerald-700">{formatCurrency(totals.margin_total)} · {formatPercent(totals.margin_percent)}</strong></span>}
                    <span><span className="block text-xs text-muted-foreground">Vytvořeno</span><strong className="font-medium text-slate-800">{formatDate(document.created_at)}</strong></span>
                    <span><span className="block text-xs text-muted-foreground">Platnost do</span><strong className="font-medium text-slate-800">{formatDate(document.valid_until)}</strong></span>
                  </button>
                </article>
              );
            })}
          </div>
          <ManagedTableSection
            className="hidden md:block"
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
                  <TableRow><TableCell colSpan={visibleListColumns.length} className="h-24 text-center text-muted-foreground">{hasActiveFilters ? 'Žádný dokument neodpovídá filtrům.' : 'Zatím zde nejsou žádné dokumenty.'}</TableCell></TableRow>
                ) : filteredDocuments.map((document) => (
                  <TableRow
                    key={document.id}
                    className="cursor-pointer bg-white hover:bg-blue-50/35"
                    onClick={() => navigate(config.detailPath(document))}
                    role="link"
                    tabIndex={0}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        navigate(config.detailPath(document));
                      }
                    }}
                  >
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
