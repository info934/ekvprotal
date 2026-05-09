import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeft,
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  CheckSquare2,
  Clock,
  CircleDollarSign,
  Contact,
  ExternalLink,
  FileText,
  Filter,
  LayoutGrid,
  List,
  Mail,
  MoreHorizontal,
  Package,
  Paperclip,
  Percent,
  Phone,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Target,
  Trash2,
  Users,
} from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import SubjectSelect from '@/components/SubjectSelect';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import {
  downloadGeneratedDocumentDocx,
  downloadGeneratedDocumentHtml,
  downloadGeneratedDocumentPdf,
  downloadOpportunityOverviewDocx,
  downloadOpportunityOverviewHtml,
  downloadOpportunityOverviewPdf,
} from '@/lib/documentGenerationService';
import { DEFAULT_CRM_NUMBERING, formatCrmNumber, normalizeCrmNumbering } from '@/lib/crmNumbering';
import { cn } from '@/lib/utils';

const subjectTypeLabels = {
  customer: 'Zakaznici',
  supplier: 'Dodavatele',
  investor: 'Investori',
  authority: 'Urady',
  other: 'Ostatni',
};

const CRM_CONFIG_STORAGE_KEY = 'ekv-crm-config';

const DEFAULT_STAGE_CONFIG = [
  { value: 'lead', label: 'Lead', color: 'bg-slate-100 text-slate-700 border-slate-200', probability: 10, is_closed: false },
  { value: 'qualified', label: 'Kvalifikovano', color: 'bg-blue-100 text-blue-700 border-blue-200', probability: 25, is_closed: false },
  { value: 'proposal', label: 'Nabidka', color: 'bg-indigo-100 text-indigo-700 border-indigo-200', probability: 45, is_closed: false },
  { value: 'negotiation', label: 'Jednani', color: 'bg-amber-100 text-amber-800 border-amber-200', probability: 70, is_closed: false },
  { value: 'won', label: 'Vyhrano', color: 'bg-emerald-100 text-emerald-700 border-emerald-200', probability: 100, is_closed: true },
  { value: 'lost', label: 'Ztraceno', color: 'bg-rose-100 text-rose-700 border-rose-200', probability: 0, is_closed: true },
];

const DEFAULT_PRIORITY_CONFIG = [
  { value: 'low', label: 'Nizka', tone: 'secondary' },
  { value: 'medium', label: 'Stredni', tone: 'outline' },
  { value: 'high', label: 'Vysoka', tone: 'destructive' },
];

const initialOpportunityForm = {
  id: null,
  title: '',
  subject_id: '',
  project_id: '',
  stage: 'lead',
  priority: 'medium',
  value: '',
  probability: 10,
  expected_close_date: '',
  next_step: '',
  description: '',
  lost_reason: '',
};

const isMissingCrmTableError = (error) => {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return ['42P01', 'PGRST116', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code) ||
    message.includes('crm_opportunities') ||
    message.includes('crm_activities') ||
    message.includes('crm_notes') ||
    message.includes('crm_stage_definitions') ||
    message.includes('crm_priority_definitions') ||
    message.includes('crm_commercial_documents') ||
    message.includes('crm_commercial_document_items');
};

const isMissingColumnError = (error, columns = []) => {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return ['42703', 'PGRST204', 'PGRST205'].includes(error.code) &&
    columns.some((column) => message.includes(String(column).toLowerCase()));
};

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
};

const createEmptyCrmItem = () => ({
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
});

const calculateCrmItemLineTotal = (item) => {
  const quantity = Number(item.quantity || 0);
  const price = Number(item.unit_price || 0);
  const discount = Math.min(100, Math.max(0, Number(item.discount_percent || 0)));
  return Math.round(quantity * price * (1 - (discount / 100)) * 100) / 100;
};

const calculateCrmItemTotals = (items = []) => {
  const total = items.reduce((sum, item) => sum + calculateCrmItemLineTotal(item), 0);
  const taxTotal = items.reduce((sum, item) => sum + (calculateCrmItemLineTotal(item) * (Number(item.vat_rate || 0) / 100)), 0);
  return {
    subtotal: total,
    discount_total: 0,
    tax_total: Math.round(taxTotal * 100) / 100,
    total,
  };
};

const buildCrmOpportunityItemPayload = (item, opportunityId, index) => ({
  opportunity_id: opportunityId,
  catalog_item_id: item.catalog_item_id || null,
  code: item.code || null,
  name: item.name?.trim() || 'Polozka',
  description: item.description || null,
  quantity: Number(item.quantity || 0),
  unit: item.unit || 'ks',
  unit_price: Number(item.unit_price || 0),
  discount_percent: Number(item.discount_percent || 0),
  vat_rate: Number(item.vat_rate || 0),
  line_total: calculateCrmItemLineTotal(item),
  sort_order: (index + 1) * 10,
});

const buildCrmDocumentItemPayload = (item, documentId, index) => {
  const payload = buildCrmOpportunityItemPayload(item, null, index);
  delete payload.opportunity_id;
  return {
    ...payload,
    document_id: documentId,
  };
};

const getStage = (value, stages = DEFAULT_STAGE_CONFIG) => stages.find((stage) => stage.value === value) || stages[0];

const getPriority = (value, priorities = DEFAULT_PRIORITY_CONFIG) => (
  priorities.find((priority) => priority.value === value) || priorities[1] || priorities[0]
);

const loadCrmConfig = () => {
  try {
    const saved = JSON.parse(localStorage.getItem(CRM_CONFIG_STORAGE_KEY));
    return {
      stages: saved?.stages?.length ? saved.stages : DEFAULT_STAGE_CONFIG,
      priorities: saved?.priorities?.length ? saved.priorities : DEFAULT_PRIORITY_CONFIG,
    };
  } catch {
    return { stages: DEFAULT_STAGE_CONFIG, priorities: DEFAULT_PRIORITY_CONFIG };
  }
};

const normalizeStages = (stages) => (
  (stages?.length ? stages : DEFAULT_STAGE_CONFIG).map((stage, index) => ({
    ...stage,
    probability: Number(stage.probability || 0),
    sort_order: Number(stage.sort_order ?? ((index + 1) * 10)),
    is_active: stage.is_active ?? true,
    is_closed: Boolean(stage.is_closed),
  }))
);

const normalizePriorities = (priorities) => (
  (priorities?.length ? priorities : DEFAULT_PRIORITY_CONFIG).map((priority, index) => ({
    ...priority,
    sort_order: Number(priority.sort_order ?? ((index + 1) * 10)),
    is_active: priority.is_active ?? true,
  }))
);

const MetricCard = ({ icon: Icon, title, value, description, tone = 'default' }) => (
  <Card className="overflow-hidden border-slate-200 shadow-sm">
    <CardContent className="flex items-center gap-4 p-4">
      <div className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-md ring-1',
        tone === 'success' ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' :
          tone === 'warning' ? 'bg-amber-50 text-amber-700 ring-amber-100' :
            'bg-primary/10 text-primary ring-primary/10'
      )}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
        <p className="mt-1 text-xl font-semibold tracking-tight text-slate-950">{value}</p>
        {description && <p className="mt-1 truncate text-xs text-muted-foreground">{description}</p>}
      </div>
    </CardContent>
  </Card>
);

const DealWorkspace = ({
  opportunity,
  documents = [],
  documentTemplates = [],
  selectedTemplateIds = {},
  stages,
  priorities,
  onEdit,
  onCreateDocument,
  onCreateProject,
  onCreateRealization,
  onGenerateDocument,
  onGenerateOverview,
  onTemplateChange,
  onStageChange,
  onUpdateOpportunity,
  onUpdateOpportunityItems,
  canEdit,
  creatingDocument,
  generatingDocument,
  updatingOpportunity,
}) => {
  const [catalogProducts, setCatalogProducts] = useState([]);
  const [catalogQuery, setCatalogQuery] = useState('');
  const [catalogLoading, setCatalogLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchCatalogProducts = async () => {
      setCatalogLoading(true);
      const { data, error } = await supabase
        .from('commercial_item_catalog')
        .select('id, code, name, description, category, unit, default_unit_price, default_vat_rate, is_active')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (active && !error) {
        setCatalogProducts(data || []);
      }
      if (active) {
        setCatalogLoading(false);
      }
    };

    fetchCatalogProducts();

    return () => {
      active = false;
    };
  }, []);

  if (!opportunity) {
    return (
      <Card className="border-dashed bg-slate-50/70">
        <CardContent className="flex min-h-[220px] flex-col items-center justify-center p-8 text-center">
          <Target className="mb-3 h-10 w-10 text-muted-foreground" />
          <h3 className="text-lg font-semibold text-slate-950">Vyberte obchodni pripad</h3>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Kliknutim na kartu v pipeline se zde zobrazi detail pro pripravu produktu, nabidky a objednavky.
          </p>
        </CardContent>
      </Card>
    );
  }

  const stage = getStage(opportunity.stage, stages);
  const priority = getPriority(opportunity.priority, priorities);
  const value = Number(opportunity.value || 0);
  const expectedCosts = Math.round(value * 0.72);
  const expectedProfit = value - expectedCosts;
  const offerDocuments = documents.filter((document) => document.type === 'offer');
  const orderDocuments = documents.filter((document) => document.type === 'order');
  const opportunityItems = [...(opportunity.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
  const productRows = opportunityItems.length > 0 ? opportunityItems.map((item) => ({
    id: item.id,
    code: item.code || '-',
    name: item.name,
    unit: item.unit || 'ks',
    unitPrice: Number(item.unit_price || 0),
    quantity: Number(item.quantity || 0),
    discount: Number(item.discount_percent || 0),
    vatRate: Number(item.vat_rate || 0),
    total: calculateCrmItemLineTotal(item),
  })) : [
    {
      id: 'fallback',
      code: 'CRM-001',
      name: opportunity.title,
      unit: 'ks',
      unitPrice: value,
      quantity: 1,
      discount: 0,
      vatRate: 21,
      total: value,
    },
  ];
  const itemTotals = calculateCrmItemTotals(opportunityItems.length > 0 ? opportunityItems : productRows.map((item) => ({
    ...item,
    unit_price: item.unitPrice,
    discount_percent: item.discount,
    vat_rate: item.vatRate,
  })));
  const subtotal = itemTotals.subtotal;
  const discountTotal = itemTotals.discount_total;
  const total = itemTotals.total;
  const taxValue = itemTotals.total + itemTotals.tax_total;

  const updateOpportunityItem = (itemId, field, nextValue) => {
    const baseItems = opportunityItems.length > 0 ? opportunityItems : [{
      ...createEmptyCrmItem(),
      id: 'fallback',
      code: 'CRM-001',
      name: opportunity.title,
      unit_price: value,
      line_total: value,
    }];

    const nextItems = baseItems.map((item) => {
      if (item.id !== itemId) return item;
      const valueToStore = ['quantity', 'unit_price', 'discount_percent', 'vat_rate'].includes(field)
        ? Number(nextValue || 0)
        : nextValue;
      const next = { ...item, [field]: valueToStore };
      return { ...next, line_total: calculateCrmItemLineTotal(next) };
    });
    onUpdateOpportunityItems?.(opportunity.id, nextItems);
  };

  const addOpportunityItem = () => {
    onUpdateOpportunityItems?.(opportunity.id, [...opportunityItems, createEmptyCrmItem()]);
  };

  const removeOpportunityItem = (itemId) => {
    onUpdateOpportunityItems?.(opportunity.id, opportunityItems.filter((item) => item.id !== itemId));
  };

  const filteredCatalogProducts = catalogProducts
    .filter((product) => {
      const query = catalogQuery.trim().toLowerCase();
      if (!query) return true;
      return [product.code, product.name, product.description, product.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    })
    .slice(0, 12);

  const addCatalogProduct = (product) => {
    const nextItem = {
      ...createEmptyCrmItem(),
      id: `new-${Date.now()}-${product.id}`,
      catalog_item_id: product.id,
      code: product.code || '',
      name: product.name || 'Polozka',
      description: product.description || '',
      unit: product.unit || 'ks',
      unit_price: Number(product.default_unit_price || 0),
      vat_rate: Number(product.default_vat_rate || 21),
    };
    onUpdateOpportunityItems?.(opportunity.id, [...opportunityItems, { ...nextItem, line_total: calculateCrmItemLineTotal(nextItem) }]);
    setCatalogQuery('');
  };

  return (
    <div className="space-y-5">
      <Card className="crm-panel">
        <CardHeader className="crm-panel-header">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Obchodni pripad {opportunity.number || ''} {opportunity.subject?.name ? `- ${opportunity.subject.name}` : ''}
              </div>
              <CardTitle className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">
                {opportunity.title}
              </CardTitle>
              <CardDescription className="mt-3 flex flex-wrap items-center gap-2">
                <Badge className={stage.color}>{stage.label}</Badge>
                <Badge variant="outline">{opportunity.probability || 0} % pravdepodobnost</Badge>
                <span className="font-semibold text-slate-700">{formatCurrency(value)}</span>
              </CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="shrink-0">
                  <MoreHorizontal className="mr-2 h-4 w-4" />
                  Akce
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>Obchodni pripad</DropdownMenuLabel>
                {canEdit && (
                  <DropdownMenuItem onSelect={() => onEdit(opportunity)}>
                    Upravit pripad
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={!canEdit || creatingDocument} onSelect={() => onCreateDocument?.('offer')}>
                  Vytvorit nabidku
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!canEdit || creatingDocument} onSelect={() => onCreateDocument?.('order')}>
                  Vytvorit objednavku
                </DropdownMenuItem>
                {stage.value === 'won' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Predat do vyroby</DropdownMenuLabel>
                    <DropdownMenuItem disabled={!canEdit} onSelect={() => onCreateProject?.()}>
                      Vytvorit projekt z OP
                    </DropdownMenuItem>
                    <DropdownMenuItem disabled={!canEdit} onSelect={() => onCreateRealization?.()}>
                      Vytvorit realizaci z OP
                    </DropdownMenuItem>
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Generovat overview</DropdownMenuLabel>
                <DropdownMenuItem disabled={generatingDocument} onSelect={() => onGenerateOverview?.('docx')}>
                  <FileText className="mr-2 h-4 w-4" />
                  DOCX
                </DropdownMenuItem>
                <DropdownMenuItem disabled={generatingDocument} onSelect={() => onGenerateOverview?.('pdf')}>
                  PDF
                </DropdownMenuItem>
                <DropdownMenuItem disabled={generatingDocument} onSelect={() => onGenerateOverview?.('html')}>
                  HTML
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 bg-white p-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.65fr)]">
          <div className="space-y-5">
            <Tabs defaultValue="basic" className="space-y-4">
              <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border bg-slate-100 p-1">
                <TabsTrigger value="basic">Zakladni udaje</TabsTrigger>
                <TabsTrigger value="commerce">Nabidky a objednavky</TabsTrigger>
                <TabsTrigger value="history">Historie</TabsTrigger>
                <TabsTrigger value="discussion">Diskuse</TabsTrigger>
              </TabsList>
              <TabsContent value="basic" className="space-y-5">
                <div className="grid gap-4 rounded-lg border bg-white p-4 shadow-sm md:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Subjekt</Label>
                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm">{opportunity.subject?.name || '-'}</div>
                  </div>
                  <div className="space-y-1">
                    <Label>Odhad uzavreni</Label>
                    <Input
                      type="date"
                      value={opportunity.expected_close_date || ''}
                      disabled={!canEdit || updatingOpportunity}
                      onChange={(event) => onUpdateOpportunity?.(opportunity.id, { expected_close_date: event.target.value || null })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Stav</Label>
                    <Select
                      value={opportunity.stage}
                      disabled={!canEdit || updatingOpportunity}
                      onValueChange={(value) => {
                        onStageChange?.(opportunity.id, value);
                      }}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {stages.map((stageOption) => (
                          <SelectItem key={stageOption.value} value={stageOption.value}>{stageOption.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>Priorita</Label>
                    <Select
                      value={opportunity.priority || 'medium'}
                      disabled={!canEdit || updatingOpportunity}
                      onValueChange={(value) => onUpdateOpportunity?.(opportunity.id, { priority: value })}
                    >
                      <SelectTrigger className="bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {priorities.map((priorityOption) => (
                          <SelectItem key={priorityOption.value} value={priorityOption.value}>{priorityOption.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-center justify-between text-sm">
                      <Label>Pravdepodobnost</Label>
                      <span className="font-semibold text-slate-950">{opportunity.probability || 0} %</span>
                    </div>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      value={opportunity.probability || 0}
                      disabled={!canEdit || updatingOpportunity}
                      onChange={(event) => onUpdateOpportunity?.(opportunity.id, { probability: Number(event.target.value || 0) })}
                    />
                    <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                      <div className="h-full rounded-full bg-emerald-500" style={{ width: `${opportunity.probability || 0}%` }} />
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border bg-white p-4 shadow-sm">
                  <h3 className="mb-4 text-sm font-semibold text-slate-800">Hodnota obchodniho pripadu</h3>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
                    <div className="space-y-3 text-sm">
                      <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                        <span className="text-muted-foreground">Konecna cena</span>
                        <Input
                          type="number"
                          min="0"
                          value={opportunity.value ?? 0}
                          disabled={!canEdit || updatingOpportunity}
                          onChange={(event) => onUpdateOpportunity?.(opportunity.id, { value: Number(event.target.value || 0) })}
                          className="h-8 w-40 bg-white text-right font-semibold"
                        />
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2">
                        <span className="text-muted-foreground">Predpokladane naklady</span>
                        <strong>{formatCurrency(expectedCosts)}</strong>
                      </div>
                      <div className="flex items-center justify-between gap-3 rounded-md bg-emerald-50 px-3 py-2">
                        <span className="text-muted-foreground">Predpokladany zisk</span>
                        <strong>{formatCurrency(expectedProfit)}</strong>
                      </div>
                    </div>
                    <div className="flex items-center justify-center">
                      <div className="flex h-24 w-24 items-center justify-center rounded-full bg-slate-100 text-slate-700 ring-8 ring-white">
                        <Percent className="h-8 w-8" />
                      </div>
                    </div>
                  </div>
                </div>

                {stage.value === 'lost' && (
                  <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-950 shadow-sm">
                    <h3 className="font-semibold">Duvod prohry</h3>
                    <p className="mt-2 whitespace-pre-wrap text-rose-900">
                      {opportunity.lost_reason || 'Duvod zatim neni vyplnen.'}
                    </p>
                    {opportunity.lost_at && (
                      <p className="mt-2 text-xs text-rose-700">Uzavreno jako prohrane: {formatDate(opportunity.lost_at)}</p>
                    )}
                  </div>
                )}

                <div className="min-h-[150px] rounded-lg border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-amber-900">Popis</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                    {opportunity.description || 'Zatim bez popisu.'}
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="commerce">
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">Nabidky</h3>
                      <Badge variant="outline">{offerDocuments.length}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">Nabidkove dokumenty jsou navazane na tento obchodni pripad a sdili polozky s obchodnim rozpoctem.</p>
                  </div>
                  <div className="rounded-lg border bg-white p-4 shadow-sm">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">Objednavky</h3>
                      <Badge variant="outline">{orderDocuments.length}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">Objednavky navazuji na stejny obchodni pripad a lze je vytvaret ze stejneho polozkoveho zakladu.</p>
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="history">
                <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Historie zmen a aktivit bude navazana na CRM aktivity.</div>
              </TabsContent>
              <TabsContent value="discussion">
                <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Diskuse bude sdilet logiku s internimi poznamkami a notifikacemi.</div>
              </TabsContent>
            </Tabs>
          </div>

          <div className="space-y-4">
            {stage.value === 'won' && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 text-emerald-700" />
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-emerald-950">Vyhrany obchodni pripad</h3>
                    <p className="mt-1 text-sm text-emerald-800">
                      Predvyplnte navazny projekt nebo realizaci z dat obchodniho pripadu. Vazba na OP zustane ulozena v zaznamu.
                    </p>
                    {opportunity.project_id && (
                      <Button asChild variant="link" className="mt-2 h-auto p-0 text-emerald-800">
                        <Link to={`/projects/${opportunity.project_id}`}>
                          Otevrit navazany projekt
                          <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    )}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                      <Button size="sm" onClick={() => onCreateProject?.()} disabled={!canEdit}>
                        <Building2 className="mr-2 h-4 w-4" />
                        Vytvorit projekt
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => onCreateRealization?.()} disabled={!canEdit}>
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        Vytvorit realizaci
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="rounded-lg border bg-white p-5 text-center shadow-sm">
              <Paperclip className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium text-muted-foreground">Zatim bez priloh</p>
              <Button className="mt-4" variant="secondary" disabled>Nahrat soubor</Button>
            </div>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Clock className="h-4 w-4" />
                Nejblizsi naplanovana aktivita
              </div>
              <Textarea
                key={opportunity.id}
                className="mt-3 min-h-[90px]"
                defaultValue={opportunity.next_step || ''}
                disabled={!canEdit || updatingOpportunity}
                placeholder="Zatim neni naplanovana."
                onBlur={(event) => {
                  if ((event.target.value || '') !== (opportunity.next_step || '')) {
                    onUpdateOpportunity?.(opportunity.id, { next_step: event.target.value || null });
                  }
                }}
              />
            </div>
            <div className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                Posledni realizovana aktivita
              </div>
              <p className="mt-3 text-sm text-muted-foreground">Pripraveno pro napojeni na CRM aktivity.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="crm-panel">
        <CardHeader className="crm-panel-header">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" />
              Produkty ({productRows.length})
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled>Hromadne akce</Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" disabled={!canEdit || updatingOpportunity}>
                    <Plus className="mr-2 h-4 w-4" />
                    Pridat z katalogu
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-80">
                  <DropdownMenuLabel>Produktovy katalog</DropdownMenuLabel>
                  <div className="px-2 py-1.5">
                    <Input
                      value={catalogQuery}
                      onChange={(event) => setCatalogQuery(event.target.value)}
                      placeholder="Hledat produkt..."
                      className="h-8"
                    />
                  </div>
                  <DropdownMenuSeparator />
                  {catalogLoading ? (
                    <DropdownMenuItem disabled>Nacitam katalog...</DropdownMenuItem>
                  ) : filteredCatalogProducts.length === 0 ? (
                    <DropdownMenuItem disabled>Zadny produkt nenalezen</DropdownMenuItem>
                  ) : filteredCatalogProducts.map((product) => (
                    <DropdownMenuItem key={product.id} onSelect={() => addCatalogProduct(product)} className="flex flex-col items-start gap-0.5">
                      <span className="font-medium">{product.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {product.code || '-'} - {formatCurrency(product.default_unit_price)}
                      </span>
                    </DropdownMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={addOpportunityItem}>
                    Rucni polozka
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="crm-table-wrap">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kod</TableHead>
                  <TableHead>Nazev</TableHead>
                  <TableHead className="text-right">Jedn. cena</TableHead>
                  <TableHead className="text-right">Mnozstvi</TableHead>
                  <TableHead>MJ</TableHead>
                  <TableHead className="text-right">Sleva %</TableHead>
                  <TableHead className="text-right">Cena celkem</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {productRows.map((item) => (
                  <TableRow key={item.id || item.code}>
                    <TableCell className="min-w-[120px]">
                      <Input value={item.code === '-' ? '' : item.code} onChange={(event) => updateOpportunityItem(item.id, 'code', event.target.value)} disabled={!canEdit || updatingOpportunity} />
                    </TableCell>
                    <TableCell className="min-w-[320px]">
                      <Input value={item.name} onChange={(event) => updateOpportunityItem(item.id, 'name', event.target.value)} disabled={!canEdit || updatingOpportunity} />
                    </TableCell>
                    <TableCell className="min-w-[130px]">
                      <Input className="text-right" type="number" value={item.unitPrice} onChange={(event) => updateOpportunityItem(item.id, 'unit_price', event.target.value)} disabled={!canEdit || updatingOpportunity} />
                    </TableCell>
                    <TableCell className="min-w-[110px]">
                      <Input className="text-right" type="number" value={item.quantity} onChange={(event) => updateOpportunityItem(item.id, 'quantity', event.target.value)} disabled={!canEdit || updatingOpportunity} />
                    </TableCell>
                    <TableCell className="min-w-[90px]">
                      <Input value={item.unit} onChange={(event) => updateOpportunityItem(item.id, 'unit', event.target.value)} disabled={!canEdit || updatingOpportunity} />
                    </TableCell>
                    <TableCell className="min-w-[110px]">
                      <Input className="text-right" type="number" value={item.discount} onChange={(event) => updateOpportunityItem(item.id, 'discount_percent', event.target.value)} disabled={!canEdit || updatingOpportunity} />
                    </TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(item.total)}</TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" onClick={() => removeOpportunityItem(item.id)} disabled={!canEdit || updatingOpportunity || item.id === 'fallback'}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-2 border-t bg-slate-50 p-5 text-sm md:ml-auto md:w-[480px]">
            <div className="flex justify-between"><span>Cena celkem pred slevou</span><strong>{formatCurrency(subtotal)}</strong></div>
            <div className="flex justify-between"><span>Celkova sleva</span><strong>{formatCurrency(discountTotal)}</strong></div>
            <div className="flex justify-between text-base"><span>Konecna cena</span><strong>{formatCurrency(total)}</strong></div>
            <div className="flex justify-between text-muted-foreground"><span>Celkem s dani</span><strong>{formatCurrency(taxValue)}</strong></div>
          </div>
        </CardContent>
      </Card>

      <Card className="crm-panel">
        <CardHeader className="crm-panel-header">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4" />
              Nabidky / objednavky
            </CardTitle>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!canEdit || creatingDocument}>
                  <Plus className="mr-2 h-4 w-4" />
                  Pridat dokument
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onSelect={() => onCreateDocument?.('offer')}>Nabidka</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCreateDocument?.('order')}>Objednavka</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 p-5 xl:grid-cols-2">
          <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-sm text-muted-foreground xl:col-span-2">
            Generator dokumentu je pripraveny jako spolecna vrstva pro nabidky, objednavky a smlouvy. Aktualne generuje HTML vystup pro tisk/stazeni; stejny payload bude pouzity pro PDF/DOCX a Edge Function frontu.
          </div>
          {documents.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-slate-50 p-6 text-sm text-muted-foreground xl:col-span-2">
              Zatim neni zalozena zadna nabidka ani objednavka. Vytvorte prvni dokument tlacitkem nahore.
            </div>
          ) : (
            <>
              {[ 
                { type: 'offer', title: 'Nabidky', icon: Package, rows: offerDocuments, empty: 'Zatim neni vytvorena zadna nabidka.' },
                { type: 'order', title: 'Objednavky', icon: ShoppingCart, rows: orderDocuments, empty: 'Zatim neni vytvorena zadna objednavka.' },
              ].map((module) => (
                <div key={module.type} className="overflow-hidden rounded-lg border bg-white">
                  <div className="flex flex-col gap-3 border-b bg-slate-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-2">
                      <module.icon className="h-4 w-4 text-primary" />
                      <h3 className="text-sm font-semibold text-slate-900">{module.title}</h3>
                      <Badge variant="outline">{module.rows.length}</Badge>
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Select
                        value={selectedTemplateIds[module.type] || 'default'}
                        onValueChange={(value) => onTemplateChange?.(module.type, value === 'default' ? null : value)}
                      >
                        <SelectTrigger className="h-8 w-full bg-white text-xs sm:w-[190px]">
                          <SelectValue placeholder="Sablona" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="default">Vychozi sablona</SelectItem>
                          {documentTemplates.map((template) => (
                            <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => onCreateDocument?.(module.type)}
                        disabled={!canEdit || creatingDocument}
                      >
                        Pridat
                      </Button>
                    </div>
                  </div>
                  {module.rows.length === 0 ? (
                    <div className="p-5 text-sm text-muted-foreground">{module.empty}</div>
                  ) : (
                    <div className="divide-y">
                      {module.rows.map((document) => (
                        <div key={document.id} className="grid gap-2 p-4 text-sm sm:grid-cols-[minmax(0,1fr)_130px]">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                to={document.type === 'order' ? `/crm/orders/${document.id}` : `/crm/offers/${document.id}`}
                                className="font-semibold text-slate-950 hover:text-primary hover:underline"
                              >
                                {document.number || '-'}
                              </Link>
                              <Badge variant="outline">{document.status}</Badge>
                              {document.sync_items === false && <Badge variant="secondary">sync vypnuty</Badge>}
                            </div>
                            <div className="mt-1 truncate text-muted-foreground">{document.title}</div>
                            <div className="mt-2 text-xs text-muted-foreground">{formatDate(document.issue_date)} - {document.items?.length || 0} polozek</div>
                          </div>
                          <div className="text-left sm:text-right">
                            <div className="font-semibold text-slate-950">{formatCurrency(document.total)}</div>
                            <div className="mt-1 text-xs text-muted-foreground">bez DPH</div>
                            <div className="mt-3 flex flex-wrap justify-start gap-1 sm:justify-end">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2"
                                disabled={generatingDocument}
                                onClick={() => onGenerateDocument?.(document, 'docx', documentTemplates.find((template) => template.id === selectedTemplateIds[module.type]))}
                              >
                                DOCX
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 px-2"
                                disabled={generatingDocument}
                                onClick={() => onGenerateDocument?.(document, 'pdf', documentTemplates.find((template) => template.id === selectedTemplateIds[module.type]))}
                              >
                                PDF
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 px-2"
                                disabled={generatingDocument}
                                onClick={() => onGenerateDocument?.(document, 'html', documentTemplates.find((template) => template.id === selectedTemplateIds[module.type]))}
                              >
                                HTML
                              </Button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const OpportunityBoard = ({ stages, priorities, selectedOpportunity, crmTablesReady, onSelectOpportunity, onMoveOpportunity }) => (
  <div className="overflow-x-auto pb-2">
    <div className="grid min-w-[1180px] gap-3 xl:grid-cols-6">
      {stages.map((stage) => {
        const total = stage.opportunities.reduce((sum, opportunity) => sum + Number(opportunity.value || 0), 0);
        return (
          <section
            key={stage.value}
            className="min-h-[340px] rounded-md border border-slate-200 bg-slate-50 p-2"
            onDragOver={(event) => {
              event.preventDefault();
              event.currentTarget.classList.add('ring-2', 'ring-primary/30');
            }}
            onDragLeave={(event) => {
              event.currentTarget.classList.remove('ring-2', 'ring-primary/30');
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.currentTarget.classList.remove('ring-2', 'ring-primary/30');
              const opportunityId = event.dataTransfer.getData('text/plain');
              if (opportunityId) onMoveOpportunity?.(opportunityId, stage.value);
            }}
          >
            <div className={cn('mb-2 rounded-md border px-3 py-2 shadow-sm', stage.color)}>
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-xs font-bold uppercase">{stage.label}</h3>
                <button type="button" className="text-base leading-none opacity-70" aria-label={`Pridat do stavu ${stage.label}`}>
                  +
                </button>
              </div>
              <div className="mt-1 flex items-center gap-2 text-xs font-semibold">
                <span className="rounded-full bg-white/70 px-1.5">{stage.opportunities.length}</span>
                <span className="truncate">{formatCurrency(total)}</span>
              </div>
            </div>
            <div className="space-y-2">
              {stage.opportunities.map((opportunity) => {
                const priority = getPriority(opportunity.priority, priorities);
                return (
                  <button
                    key={opportunity.id}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', opportunity.id);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    onClick={() => onSelectOpportunity(opportunity.id)}
                    className={cn(
                      'group w-full rounded-md border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:border-primary/30 hover:shadow-md',
                      selectedOpportunity?.id === opportunity.id && 'border-primary ring-2 ring-primary/15'
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">{opportunity.title}</div>
                        <div className="mt-1 truncate text-xs font-medium text-slate-500">{opportunity.subject?.name || 'Bez subjektu'}</div>
                      </div>
                      <span className="mt-1 h-2 w-6 shrink-0 rounded-full bg-primary/70" />
                    </div>
                    <div className="mt-3 flex items-center justify-between gap-2 text-xs">
                      <span className="inline-flex items-center gap-1 text-slate-400">
                        <CircleDollarSign className="h-3.5 w-3.5" />
                        {formatCurrency(opportunity.value)}
                      </span>
                      <Badge variant={priority?.tone || 'secondary'} className="h-5 text-[10px]">
                        {opportunity.probability || 0} %
                      </Badge>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-400">
                      <span className="inline-flex min-w-0 items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0" />
                        <span className="truncate">{opportunity.next_step || 'bez aktivity'}</span>
                      </span>
                      <span className="shrink-0">{formatDate(opportunity.expected_close_date)}</span>
                    </div>
                  </button>
                );
              })}
              {stage.opportunities.length === 0 && (
                <div className="rounded-md border border-dashed bg-white/70 p-4 text-center text-xs text-muted-foreground">
                  {crmTablesReady ? 'Zatim prazdne' : 'Ceka na CRM migraci'}
                </div>
              )}
            </div>
          </section>
        );
      })}
    </div>
  </div>
);

const OpportunityTable = ({ opportunities, stages, priorities, selectedOpportunity, onSelectOpportunity }) => (
  <div className="overflow-x-auto">
    <Table>
      <TableHeader>
        <TableRow className="bg-slate-50">
          <TableHead className="w-10"><CheckSquare2 className="h-4 w-4 text-muted-foreground" /></TableHead>
          <TableHead className="min-w-[120px]">Kod</TableHead>
          <TableHead className="min-w-[280px]">Predmet</TableHead>
          <TableHead className="min-w-[220px]">Klient</TableHead>
          <TableHead className="min-w-[150px]">Typ obchodu</TableHead>
          <TableHead className="min-w-[180px]">Stav</TableHead>
          <TableHead className="min-w-[220px]">Naplanovana aktivita</TableHead>
          <TableHead className="min-w-[150px] text-right">Konecna cena</TableHead>
          <TableHead className="min-w-[130px]">Priorita</TableHead>
          <TableHead className="w-12 text-right">Akce</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {opportunities.length === 0 ? (
          <TableRow>
            <TableCell colSpan={10} className="h-28 text-center text-muted-foreground">
              Zadny obchodni pripad neodpovida filtru.
            </TableCell>
          </TableRow>
        ) : opportunities.map((opportunity, index) => {
          const stage = getStage(opportunity.stage, stages);
          const priority = getPriority(opportunity.priority, priorities);
          return (
            <TableRow
              key={opportunity.id}
              onClick={() => onSelectOpportunity(opportunity.id)}
              className={cn('cursor-pointer bg-white hover:bg-slate-50', selectedOpportunity?.id === opportunity.id && 'bg-slate-50')}
            >
              <TableCell>
                <span className="block h-4 w-4 rounded border border-slate-300 bg-white" />
              </TableCell>
              <TableCell className="font-semibold text-slate-900">OP-{String(index + 1).padStart(3, '0')}</TableCell>
              <TableCell>
                <div className="font-semibold text-slate-800">{opportunity.title}</div>
                {opportunity.project?.code && <div className="text-xs text-muted-foreground">{opportunity.project.code}</div>}
              </TableCell>
              <TableCell className="font-medium">{opportunity.subject?.name || '-'}</TableCell>
              <TableCell className="text-muted-foreground">{opportunity.project ? 'EKV - Project' : 'EKV - FVE'}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="h-6 w-1 rounded-full bg-primary" />
                  <Badge className={stage.color}>{stage.label}</Badge>
                </div>
              </TableCell>
              <TableCell className="text-muted-foreground">{opportunity.next_step || 'bez aktivity'}</TableCell>
              <TableCell className="text-right font-semibold">{formatCurrency(opportunity.value)}</TableCell>
              <TableCell><Badge variant={priority?.tone || 'secondary'}>{priority?.label || '-'}</Badge></TableCell>
              <TableCell className="text-right">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={(event) => event.stopPropagation()}>
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  </div>
);

const CRM = () => {
  const { toast } = useToast();
  const { hasPermission, memberId } = useAuth();
  const navigate = useNavigate();
  const { opportunityId } = useParams();
  const [subjects, setSubjects] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [activities, setActivities] = useState([]);
  const [commercialDocuments, setCommercialDocuments] = useState([]);
  const [documentTemplates, setDocumentTemplates] = useState([]);
  const [crmNumbering, setCrmNumbering] = useState(() => normalizeCrmNumbering(Object.values(DEFAULT_CRM_NUMBERING)));
  const [crmTablesReady, setCrmTablesReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingOpportunity, setSavingOpportunity] = useState(false);
  const [updatingOpportunity, setUpdatingOpportunity] = useState(false);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [generatingDocument, setGeneratingDocument] = useState(false);
  const [opportunityDialogOpen, setOpportunityDialogOpen] = useState(false);
  const [opportunityForm, setOpportunityForm] = useState(initialOpportunityForm);
  const [crmStages, setCrmStages] = useState(() => normalizeStages(loadCrmConfig().stages));
  const [crmPriorities, setCrmPriorities] = useState(() => normalizePriorities(loadCrmConfig().priorities));
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(null);
  const [query, setQuery] = useState('');
  const [opportunityQuery, setOpportunityQuery] = useState('');
  const [opportunityView, setOpportunityView] = useState('kanban');
  const [sortMode, setSortMode] = useState('updated');
  const [stageFilter, setStageFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('all');
  const [selectedTemplateIds, setSelectedTemplateIds] = useState({ offer: 'default', order: 'default' });
  const [lossDialogOpen, setLossDialogOpen] = useState(false);
  const [pendingLostOpportunity, setPendingLostOpportunity] = useState(null);
  const [lossReason, setLossReason] = useState('');

  const canEditCrm = hasPermission('crm', 'can_edit');
  const canAdminCrm = hasPermission('crm', 'can_admin');

  useEffect(() => {
    localStorage.setItem(CRM_CONFIG_STORAGE_KEY, JSON.stringify({
      stages: crmStages,
      priorities: crmPriorities,
    }));
  }, [crmPriorities, crmStages]);

  const fetchCrmData = useCallback(async () => {
    setLoading(true);

    const [subjectsRes, projectsRes, contactsRes, opportunitiesRes, activitiesRes, commercialDocumentsRes, stagesRes, prioritiesRes, templatesRes, numberingRes] = await Promise.all([
      supabase
        .from('subjects')
        .select('id, name, ico, email, phone, contact_person, created_at, subject_types(name)')
        .order('name', { ascending: true }),
      supabase
        .from('projects')
        .select('id, name, code, status, created_at, client:client_id(id, name), investor:investor_id(id, name)')
        .order('created_at', { ascending: false })
        .limit(18),
      supabase
        .from('project_contacts')
        .select('id, name, role, email, phone, project_id, projects(id, name, code)')
        .order('name', { ascending: true })
        .limit(60),
      supabase
        .from('crm_opportunities')
        .select('id, number, title, stage, status, priority, value, probability, expected_close_date, next_step, description, lost_reason, lost_at, subject_id, project_id, subject:subject_id(id, name), project:project_id(id, name, code), owner:owner_member_id(id, name), items:crm_opportunity_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order)')
        .order('updated_at', { ascending: false }),
      supabase
        .from('crm_activities')
        .select('id, title, type, status, due_at, completed_at, subject:subject_id(id, name), opportunity:opportunity_id(id, title), assigned:assigned_member_id(id, name)')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from('crm_commercial_documents')
        .select('id, opportunity_id, subject_id, type, status, number, title, issue_date, valid_until, subtotal, discount_total, tax_total, total, notes, sync_items, items:crm_commercial_document_items(id, code, name, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order)')
        .order('created_at', { ascending: false }),
      supabase
        .from('crm_stage_definitions')
        .select('value, label, color, probability, sort_order, is_active, is_closed')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('crm_priority_definitions')
        .select('value, label, tone, sort_order, is_active')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      supabase
        .from('order_templates')
        .select('id, name, description, content, created_at')
        .order('created_at', { ascending: false }),
      supabase
        .from('crm_numbering_settings')
        .select('document_type, prefix, next_number, padding'),
    ]);

    let effectiveOpportunitiesRes = opportunitiesRes;
    if (isMissingColumnError(opportunitiesRes.error, ['lost_reason', 'lost_at', 'realization_id'])) {
      effectiveOpportunitiesRes = await supabase
        .from('crm_opportunities')
        .select('id, number, title, stage, status, priority, value, probability, expected_close_date, next_step, description, subject_id, project_id, subject:subject_id(id, name), project:project_id(id, name, code), owner:owner_member_id(id, name), items:crm_opportunity_items(id, catalog_item_id, code, name, description, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order)')
        .order('updated_at', { ascending: false });
    }

    const coreError = subjectsRes.error || projectsRes.error || contactsRes.error;
    if (coreError) {
      toast({
        title: 'CRM data se nepodarilo nacist',
        description: coreError.message,
        variant: 'destructive',
      });
    } else {
      setSubjects(subjectsRes.data || []);
      setProjects(projectsRes.data || []);
      setContacts(contactsRes.data || []);
    }

    if (effectiveOpportunitiesRes.error || activitiesRes.error || commercialDocumentsRes.error || stagesRes.error || prioritiesRes.error) {
      const crmError = effectiveOpportunitiesRes.error || activitiesRes.error || commercialDocumentsRes.error || stagesRes.error || prioritiesRes.error;
      if (isMissingCrmTableError(crmError)) {
        setCrmTablesReady(false);
        setOpportunities([]);
        setActivities([]);
        setCommercialDocuments([]);
      } else {
        setCrmTablesReady(true);
        toast({
          title: 'Pipeline CRM se nepodarilo nacist',
          description: crmError.message,
          variant: 'destructive',
        });
      }
    } else {
      setCrmTablesReady(true);
      setOpportunities((effectiveOpportunitiesRes.data || []).map((opportunity) => ({
        lost_reason: null,
        lost_at: null,
        realization_id: null,
        ...opportunity,
        items: [...(opportunity.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
      })));
      setActivities(activitiesRes.data || []);
      setCommercialDocuments((commercialDocumentsRes.data || []).map((document) => ({
        ...document,
        items: [...(document.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
      })));
      setCrmStages(normalizeStages(stagesRes.data));
      setCrmPriorities(normalizePriorities(prioritiesRes.data));
    }

    if (templatesRes.error) {
      setDocumentTemplates([]);
    } else {
      setDocumentTemplates(templatesRes.data || []);
    }
    setCrmNumbering(normalizeCrmNumbering(numberingRes.error ? [] : numberingRes.data));

    setLoading(false);
  }, [toast]);

  useEffect(() => {
    fetchCrmData();
  }, [fetchCrmData]);

  const metrics = useMemo(() => {
    const countsByType = subjects.reduce((acc, subject) => {
      const type = subject.subject_types?.name || 'other';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});

    const activeRelations = projects.filter((project) => project.client || project.investor).length;
    const openOpportunities = opportunities.filter((opportunity) => opportunity.status === 'open' && !getStage(opportunity.stage, crmStages).is_closed);
    const wonOpportunities = opportunities.filter((opportunity) => getStage(opportunity.stage, crmStages).is_closed && Number(opportunity.probability || 0) === 100);
    const lostOpportunities = opportunities.filter((opportunity) => opportunity.stage === 'lost' || (getStage(opportunity.stage, crmStages).is_closed && Number(opportunity.probability || 0) === 0));
    const pipelineValue = openOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.value || 0), 0);
    const weightedPipeline = openOpportunities.reduce((sum, opportunity) => (
      sum + (Number(opportunity.value || 0) * (Number(opportunity.probability || 0) / 100))
    ), 0);
    const wonValue = wonOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.value || 0), 0);
    const lostValue = lostOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.value || 0), 0);
    const closedCount = wonOpportunities.length + lostOpportunities.length;
    const conversionRate = closedCount > 0 ? Math.round((wonOpportunities.length / closedCount) * 100) : 0;
    const averageOpenValue = openOpportunities.length > 0 ? Math.round(pipelineValue / openOpportunities.length) : 0;
    const expectedGrossProfit = Math.round(weightedPipeline * 0.28);

    return {
      subjects: subjects.length,
      customers: countsByType.customer || 0,
      investors: countsByType.investor || 0,
      suppliers: countsByType.supplier || 0,
      contacts: contacts.length,
      activeRelations,
      opportunities: openOpportunities.length,
      won: wonOpportunities.length,
      lost: lostOpportunities.length,
      pipelineValue,
      weightedPipeline,
      wonValue,
      lostValue,
      conversionRate,
      averageOpenValue,
      expectedGrossProfit,
      countsByType,
    };
  }, [subjects, projects, contacts, opportunities, crmStages]);

  const filteredSubjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return subjects.slice(0, 14);

    return subjects
      .filter((subject) => {
        const searchable = [
          subject.name,
          subject.ico,
          subject.email,
          subject.phone,
          subject.contact_person,
          subject.subject_types?.name,
        ].filter(Boolean).join(' ').toLowerCase();
        return searchable.includes(normalizedQuery);
      })
      .slice(0, 30);
  }, [subjects, query]);

  const filteredOpportunities = useMemo(() => {
    const normalizedQuery = opportunityQuery.trim().toLowerCase();
    const filtered = opportunities.filter((opportunity) => {
      const stage = getStage(opportunity.stage, crmStages);
      const matchesStage = stageFilter === 'all' ||
        (stageFilter === 'open' && opportunity.status === 'open' && !stage.is_closed) ||
        opportunity.stage === stageFilter;
      const matchesPriority = priorityFilter === 'all' || opportunity.priority === priorityFilter;
      const searchable = [
        opportunity.title,
        opportunity.subject?.name,
        opportunity.project?.name,
        opportunity.project?.code,
        opportunity.next_step,
      ].filter(Boolean).join(' ').toLowerCase();
      const matchesQuery = !normalizedQuery || searchable.includes(normalizedQuery);
      return matchesStage && matchesPriority && matchesQuery;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'value_desc') return Number(b.value || 0) - Number(a.value || 0);
      if (sortMode === 'close_date') return new Date(a.expected_close_date || '9999-12-31') - new Date(b.expected_close_date || '9999-12-31');
      if (sortMode === 'probability_desc') return Number(b.probability || 0) - Number(a.probability || 0);
      return String(b.id).localeCompare(String(a.id));
    });
  }, [crmStages, opportunities, opportunityQuery, priorityFilter, sortMode, stageFilter]);

  const opportunitiesByStage = useMemo(() => {
    return crmStages.map((stage) => ({
      ...stage,
      opportunities: filteredOpportunities.filter((opportunity) => opportunity.stage === stage.value),
    }));
  }, [crmStages, filteredOpportunities]);

  const selectedOpportunity = useMemo(() => {
    if (!opportunities.length) return null;
    return opportunities.find((opportunity) => opportunity.id === (opportunityId || selectedOpportunityId)) || null;
  }, [opportunities, opportunityId, selectedOpportunityId]);

  const selectedOpportunityDocuments = useMemo(() => {
    if (!selectedOpportunity) return [];
    return commercialDocuments.filter((document) => document.opportunity_id === selectedOpportunity.id);
  }, [commercialDocuments, selectedOpportunity]);

  useEffect(() => {
    if (opportunityId) {
      setSelectedOpportunityId(opportunityId);
      return;
    }
    if (!selectedOpportunityId && opportunities.length > 0) {
      setSelectedOpportunityId(opportunities[0].id);
    }
    if (selectedOpportunityId && opportunities.length > 0 && !opportunities.some((opportunity) => opportunity.id === selectedOpportunityId)) {
      setSelectedOpportunityId(opportunities[0].id);
    }
  }, [opportunities, opportunityId, selectedOpportunityId]);

  const openOpportunityDetail = useCallback((id) => {
    setSelectedOpportunityId(id);
    navigate(`/crm/${id}`);
  }, [navigate]);

  const updateOpportunityState = useCallback((opportunityId, patch) => {
    setOpportunities((current) => current.map((opportunity) => (
      opportunity.id === opportunityId ? { ...opportunity, ...patch } : opportunity
    )));
  }, []);

  const handleInlineOpportunityUpdate = useCallback(async (opportunityId, patch) => {
    if (!canEditCrm || !opportunityId) return;

    updateOpportunityState(opportunityId, patch);
    setUpdatingOpportunity(true);

    const { error } = await supabase
      .from('crm_opportunities')
      .update(patch)
      .eq('id', opportunityId);

    setUpdatingOpportunity(false);

    if (error) {
      if (['42703', 'PGRST204'].includes(error.code) && ('lost_reason' in patch || 'lost_at' in patch)) {
        const { lost_reason, lost_at, ...legacyPatch } = patch;
        const { error: legacyError } = await supabase
          .from('crm_opportunities')
          .update(legacyPatch)
          .eq('id', opportunityId);

        if (!legacyError) {
          toast({
            title: 'Stav ulozen bez duvodu prohry',
            description: 'Online databaze jeste nema sloupce lost_reason/lost_at. Aplikujte CRM migraci.',
          });
          fetchCrmData();
          return;
        }
      }

      toast({
        title: 'Zmenu se nepodarilo ulozit',
        description: error.message,
        variant: 'destructive',
      });
      fetchCrmData();
    }
  }, [canEditCrm, fetchCrmData, toast, updateOpportunityState]);

  const handleOpportunityItemsUpdate = useCallback(async (opportunityId, nextItems) => {
    if (!canEditCrm || !opportunityId) return;

    const normalizedItems = nextItems.map((item, index) => ({
      ...item,
      sort_order: (index + 1) * 10,
      line_total: calculateCrmItemLineTotal(item),
    }));
    const totals = calculateCrmItemTotals(normalizedItems);

    updateOpportunityState(opportunityId, {
      items: normalizedItems,
      value: totals.total,
    });
    setUpdatingOpportunity(true);

    const { error: deleteError } = await supabase
      .from('crm_opportunity_items')
      .delete()
      .eq('opportunity_id', opportunityId);

    if (deleteError) {
      setUpdatingOpportunity(false);
      toast({ title: 'Polozky OP se nepodarilo ulozit', description: deleteError.message, variant: 'destructive' });
      fetchCrmData();
      return;
    }

    const opportunityItemRows = normalizedItems.map((item, index) => buildCrmOpportunityItemPayload(item, opportunityId, index));
    if (opportunityItemRows.length > 0) {
      const { error: insertError } = await supabase
        .from('crm_opportunity_items')
        .insert(opportunityItemRows);

      if (insertError) {
        setUpdatingOpportunity(false);
        toast({ title: 'Polozky OP se nepodarilo ulozit', description: insertError.message, variant: 'destructive' });
        fetchCrmData();
        return;
      }
    }

    const { error: opportunityError } = await supabase
      .from('crm_opportunities')
      .update({ value: totals.total, updated_at: new Date().toISOString() })
      .eq('id', opportunityId);

    if (opportunityError) {
      setUpdatingOpportunity(false);
      toast({ title: 'Hodnota OP se nepodarila ulozit', description: opportunityError.message, variant: 'destructive' });
      fetchCrmData();
      return;
    }

    const syncedDocuments = commercialDocuments.filter((document) => (
      document.opportunity_id === opportunityId &&
      (document.sync_items ?? true)
    ));

    for (const document of syncedDocuments) {
      const { error: deleteDocumentItemsError } = await supabase
        .from('crm_commercial_document_items')
        .delete()
        .eq('document_id', document.id);
      if (deleteDocumentItemsError) {
        setUpdatingOpportunity(false);
        toast({ title: 'Synchronizace dokumentu selhala', description: deleteDocumentItemsError.message, variant: 'destructive' });
        fetchCrmData();
        return;
      }

      const documentItemRows = normalizedItems.map((item, index) => buildCrmDocumentItemPayload(item, document.id, index));
      if (documentItemRows.length > 0) {
        const { error: insertDocumentItemsError } = await supabase
          .from('crm_commercial_document_items')
          .insert(documentItemRows);
        if (insertDocumentItemsError) {
          setUpdatingOpportunity(false);
          toast({ title: 'Synchronizace dokumentu selhala', description: insertDocumentItemsError.message, variant: 'destructive' });
          fetchCrmData();
          return;
        }
      }

      const { error: updateDocumentError } = await supabase
        .from('crm_commercial_documents')
        .update({ ...totals, updated_at: new Date().toISOString() })
        .eq('id', document.id);
      if (updateDocumentError) {
        setUpdatingOpportunity(false);
        toast({ title: 'Synchronizace dokumentu selhala', description: updateDocumentError.message, variant: 'destructive' });
        fetchCrmData();
        return;
      }
    }

    setCommercialDocuments((current) => current.map((document) => (
      document.opportunity_id === opportunityId && (document.sync_items ?? true)
        ? { ...document, ...totals, items: normalizedItems.map((item, index) => ({ ...item, sort_order: (index + 1) * 10 })) }
        : document
    )));
    setUpdatingOpportunity(false);
  }, [canEditCrm, commercialDocuments, fetchCrmData, toast, updateOpportunityState]);

  const requestOpportunityStageChange = useCallback((opportunityId, targetStageValue) => {
    const targetStage = getStage(targetStageValue, crmStages);
    const opportunity = opportunities.find((item) => item.id === opportunityId);
    if (!opportunity || opportunity.stage === targetStageValue) return;

    if (targetStageValue === 'lost') {
      setPendingLostOpportunity({ id: opportunityId, targetStageValue });
      setLossReason(opportunity.lost_reason || '');
      setLossDialogOpen(true);
      return;
    }

    handleInlineOpportunityUpdate(opportunityId, {
      stage: targetStageValue,
      probability: targetStage.probability,
      status: targetStage.is_closed ? 'closed' : 'open',
      lost_reason: null,
      lost_at: null,
    });
  }, [crmStages, handleInlineOpportunityUpdate, opportunities]);

  const handleMoveOpportunity = useCallback((opportunityId, targetStageValue) => {
    requestOpportunityStageChange(opportunityId, targetStageValue);
  }, [requestOpportunityStageChange]);

  const confirmLostOpportunity = useCallback(() => {
    const reason = lossReason.trim();
    if (!pendingLostOpportunity || !reason) {
      toast({ title: 'Doplnte duvod prohry', variant: 'destructive' });
      return;
    }

    const targetStage = getStage(pendingLostOpportunity.targetStageValue, crmStages);
    handleInlineOpportunityUpdate(pendingLostOpportunity.id, {
      stage: pendingLostOpportunity.targetStageValue,
      probability: targetStage.probability,
      status: 'closed',
      lost_reason: reason,
      lost_at: new Date().toISOString(),
    });
    setLossDialogOpen(false);
    setPendingLostOpportunity(null);
    setLossReason('');
  }, [crmStages, handleInlineOpportunityUpdate, lossReason, pendingLostOpportunity, toast]);

  const upcomingActivities = useMemo(() => (
    activities.filter((activity) => activity.status !== 'done' && activity.status !== 'completed').slice(0, 8)
  ), [activities]);

  const handleOpportunityChange = (field, value) => {
    setOpportunityForm((current) => ({ ...current, [field]: value }));

    if (field === 'stage') {
      const stage = getStage(value, crmStages);
      setOpportunityForm((current) => ({
        ...current,
        stage: value,
        probability: stage.probability,
      }));
    }
  };

  const openOpportunityDialog = (opportunity = null) => {
    if (opportunity) {
      setOpportunityForm({
        id: opportunity.id,
        title: opportunity.title || '',
        subject_id: opportunity.subject_id || opportunity.subject?.id || '',
        project_id: opportunity.project_id || opportunity.project?.id || '',
        stage: opportunity.stage || 'lead',
        priority: opportunity.priority || 'medium',
        value: opportunity.value ?? '',
        probability: opportunity.probability ?? getStage(opportunity.stage, crmStages).probability,
        expected_close_date: opportunity.expected_close_date || '',
        next_step: opportunity.next_step || '',
        description: opportunity.description || '',
        lost_reason: opportunity.lost_reason || '',
      });
    } else {
      setOpportunityForm(initialOpportunityForm);
    }
    setOpportunityDialogOpen(true);
  };

  const handleSaveOpportunity = async (event) => {
    event.preventDefault();

    if (!crmTablesReady) {
      toast({
        title: 'CRM tabulky nejsou v databazi',
        description: 'Nejdriv je potreba aplikovat CRM migrace.',
        variant: 'destructive',
      });
      return;
    }

    if (!opportunityForm.title.trim() || !opportunityForm.subject_id) {
      toast({
        title: 'Doplnte nazev a subjekt',
        variant: 'destructive',
      });
      return;
    }

    if (opportunityForm.stage === 'lost' && !opportunityForm.lost_reason.trim()) {
      toast({
        title: 'Doplnte duvod prohry',
        variant: 'destructive',
      });
      return;
    }

    setSavingOpportunity(true);
    const isNewOpportunity = !opportunityForm.id;
    const opportunityNumber = isNewOpportunity ? formatCrmNumber(crmNumbering, 'opportunity') : null;
    const payload = {
      ...(opportunityNumber ? { number: opportunityNumber } : {}),
      title: opportunityForm.title.trim(),
      subject_id: opportunityForm.subject_id,
      project_id: opportunityForm.project_id || null,
      owner_member_id: memberId || null,
      stage: opportunityForm.stage,
      priority: opportunityForm.priority,
      value: Number(opportunityForm.value || 0),
      probability: Number(opportunityForm.probability || 0),
      expected_close_date: opportunityForm.expected_close_date || null,
      next_step: opportunityForm.next_step.trim() || null,
      description: opportunityForm.description.trim() || null,
      lost_reason: opportunityForm.stage === 'lost' ? opportunityForm.lost_reason.trim() : null,
      lost_at: opportunityForm.stage === 'lost' ? new Date().toISOString() : null,
      status: getStage(opportunityForm.stage, crmStages).is_closed ? 'closed' : 'open',
    };

    const request = opportunityForm.id
      ? supabase.from('crm_opportunities').update(payload).eq('id', opportunityForm.id)
      : supabase.from('crm_opportunities').insert(payload);

    let { error } = await request;

    if (error && ['42703', 'PGRST204'].includes(error.code) && ('lost_reason' in payload || 'lost_at' in payload)) {
      const { lost_reason, lost_at, ...legacyPayload } = payload;
      const legacyRequest = opportunityForm.id
        ? supabase.from('crm_opportunities').update(legacyPayload).eq('id', opportunityForm.id)
        : supabase.from('crm_opportunities').insert(legacyPayload);
      const legacyResult = await legacyRequest;
      error = legacyResult.error;
    }

    if (error) {
      setSavingOpportunity(false);
      toast({
        title: 'Prilezitost se nepodarilo ulozit',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    if (isNewOpportunity) {
      await supabase
        .from('crm_numbering_settings')
        .update({ next_number: Number(crmNumbering.opportunity?.next_number || 1) + 1, updated_at: new Date().toISOString() })
        .eq('document_type', 'opportunity');
    }

    setSavingOpportunity(false);
    toast({ title: opportunityForm.id ? 'CRM prilezitost aktualizovana' : 'CRM prilezitost ulozena' });
    setOpportunityDialogOpen(false);
    fetchCrmData();
  };

  const handleCreateCommercialDocument = async (type) => {
    if (!selectedOpportunity || !crmTablesReady) return;

    setCreatingDocument(true);

    const baseValue = Number(selectedOpportunity.value || 0);
    const sourceItems = selectedOpportunity.items?.length ? selectedOpportunity.items : [{
      ...createEmptyCrmItem(),
      code: 'CRM-001',
      name: selectedOpportunity.title,
      unit_price: baseValue,
      line_total: baseValue,
    }];
    const totals = calculateCrmItemTotals(sourceItems);
    const vatRate = 21;
    const number = formatCrmNumber(crmNumbering, type);

    const { data: documentData, error: documentError } = await supabase
      .from('crm_commercial_documents')
      .insert({
        opportunity_id: selectedOpportunity.id,
        subject_id: selectedOpportunity.subject_id || selectedOpportunity.subject?.id || null,
        type,
        status: 'draft',
        number,
        title: `${type === 'offer' ? 'Nabidka' : 'Objednavka'} - ${selectedOpportunity.title}`,
        subtotal: totals.subtotal,
        discount_total: totals.discount_total,
        tax_total: totals.tax_total,
        total: totals.total,
        notes: selectedOpportunity.description || null,
        sync_items: true,
      })
      .select('id')
      .single();

    if (documentError) {
      setCreatingDocument(false);
      toast({
        title: 'Dokument se nepodarilo vytvorit',
        description: documentError.message,
        variant: 'destructive',
      });
      return;
    }

    const documentItems = sourceItems.map((item, index) => buildCrmDocumentItemPayload({
      ...item,
      vat_rate: item.vat_rate ?? vatRate,
    }, documentData.id, index));
    const { error: itemError } = documentItems.length > 0
      ? await supabase.from('crm_commercial_document_items').insert(documentItems)
      : { error: null };

    if (itemError) {
      setCreatingDocument(false);
      toast({
        title: 'Polozka dokumentu se nepodarila vytvorit',
        description: itemError.message,
        variant: 'destructive',
      });
      return;
    }

    await supabase
      .from('crm_numbering_settings')
      .update({ next_number: Number(crmNumbering[type]?.next_number || 1) + 1, updated_at: new Date().toISOString() })
      .eq('document_type', type);

    setCreatingDocument(false);
    toast({ title: type === 'offer' ? 'Nabidka vytvorena' : 'Objednavka vytvorena' });
    fetchCrmData();
  };

  const handleCreateProjectFromOpportunity = useCallback(() => {
    if (!selectedOpportunity) return;
    navigate(`/projects/new?crmOpportunityId=${selectedOpportunity.id}`);
  }, [navigate, selectedOpportunity]);

  const handleCreateRealizationFromOpportunity = useCallback(() => {
    if (!selectedOpportunity) return;
    navigate(`/realizace/new?crmOpportunityId=${selectedOpportunity.id}`);
  }, [navigate, selectedOpportunity]);

  const handleGenerateCommercialDocument = async (document, format = 'docx', template = null) => {
    if (!selectedOpportunity || !document) return;

    setGeneratingDocument(true);
    try {
      const generationInput = { opportunity: selectedOpportunity, document, template };
      if (format === 'pdf') {
        downloadGeneratedDocumentPdf(generationInput);
      } else if (format === 'html') {
        downloadGeneratedDocumentHtml(generationInput);
      } else {
        await downloadGeneratedDocumentDocx(generationInput);
      }
      toast({
        title: 'Dokument vygenerovan',
        description: `${template?.name ? `Sablona "${template.name}" byla vyplnena. ` : ''}Vystup ${format.toUpperCase()} byl pripraven ke stazeni.`,
      });
    } catch (error) {
      toast({
        title: 'Dokument se nepodarilo vygenerovat',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setGeneratingDocument(false);
    }
  };

  const handleGenerateOpportunityOverview = async (format = 'docx') => {
    if (!selectedOpportunity) return;

    setGeneratingDocument(true);
    try {
      const generationInput = {
        opportunity: selectedOpportunity,
        documents: selectedOpportunityDocuments,
      };
      if (format === 'pdf') {
        downloadOpportunityOverviewPdf(generationInput);
      } else if (format === 'html') {
        downloadOpportunityOverviewHtml(generationInput);
      } else {
        await downloadOpportunityOverviewDocx(generationInput);
      }
      toast({
        title: 'Overview obchodniho pripadu vygenerovan',
        description: `Vystup ${format.toUpperCase()} byl pripraven ke stazeni.`,
      });
    } catch (error) {
      toast({
        title: 'Overview se nepodarilo vygenerovat',
        description: error.message,
        variant: 'destructive',
      });
    } finally {
      setGeneratingDocument(false);
    }
  };

  return (
    <div className="app-page-wide">
      <div className="space-y-6">
        <PageHeader
          icon={Contact}
          title="CRM"
          description="Obchodni vrstva nad subjekty, kontakty, projekty a pripravenou pipeline."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={fetchCrmData} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                Obnovit
              </Button>
              {canAdminCrm && (
                <Button asChild variant="outline">
                  <Link to="/settings/crm">
                    <Target className="mr-2 h-4 w-4" />
                  Nastaveni CRM
                  </Link>
                </Button>
              )}
              {canEditCrm && (
                <Button onClick={() => openOpportunityDialog()} disabled={!crmTablesReady}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nova prilezitost
                </Button>
              )}
              <Button asChild variant="secondary">
                <Link to="/subjects">
                  <Building2 className="mr-2 h-4 w-4" />
                  Adresar subjektu
                </Link>
              </Button>
            </div>
          }
        />

        {!crmTablesReady && (
          <Alert className="border-amber-200 bg-amber-50 text-amber-950">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>CRM pipeline ceka na databazove migrace</AlertTitle>
            <AlertDescription>
              Adresar subjektu a kontakty funguji. Prilezitosti, aktivity a editace pipeline se odemknou po aplikaci CRM migraci na databazi.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Building2} title="Subjekty celkem" value={metrics.subjects} description="Zakaznici, dodavatele, investori a urady" />
          <MetricCard icon={Users} title="Zakaznici" value={metrics.customers} description={`${metrics.investors} investoru, ${metrics.suppliers} dodavatelu`} />
          <MetricCard icon={Target} title="Otevrene prilezitosti" value={crmTablesReady ? metrics.opportunities : '-'} description={crmTablesReady ? formatCurrency(metrics.pipelineValue) : 'Ceka na migraci'} tone="warning" />
          <MetricCard icon={CircleDollarSign} title="Vazena pipeline" value={crmTablesReady ? formatCurrency(metrics.weightedPipeline) : '-'} description={`${metrics.contacts} kontaktu v projektech`} tone="success" />
        </div>

        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="border-b bg-white p-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <BarChart3 className="h-4 w-4 text-primary" />
              Financni pohled CRM
            </CardTitle>
            <CardDescription>Souhrn pipeline, vyhranych a prohranych obchodnich pripadu.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Vyhrano</p>
              <p className="mt-1 text-xl font-semibold text-emerald-700">{crmTablesReady ? formatCurrency(metrics.wonValue) : '-'}</p>
              <p className="text-xs text-muted-foreground">{metrics.won} OP</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Prohrano</p>
              <p className="mt-1 text-xl font-semibold text-rose-700">{crmTablesReady ? formatCurrency(metrics.lostValue) : '-'}</p>
              <p className="text-xs text-muted-foreground">{metrics.lost} OP</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Konverze</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{crmTablesReady ? `${metrics.conversionRate} %` : '-'}</p>
              <p className="text-xs text-muted-foreground">vyhrane z uzavrenych</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Prumer aktivni OP</p>
              <p className="mt-1 text-xl font-semibold text-slate-950">{crmTablesReady ? formatCurrency(metrics.averageOpenValue) : '-'}</p>
              <p className="text-xs text-muted-foreground">otevrena pipeline</p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase text-muted-foreground">Ocekavany hruby zisk</p>
              <p className="mt-1 text-xl font-semibold text-primary">{crmTablesReady ? formatCurrency(metrics.expectedGrossProfit) : '-'}</p>
              <p className="text-xs text-muted-foreground">orientacne 28 % z vazene pipeline</p>
            </div>
          </CardContent>
        </Card>

        {opportunityId ? (
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <Button variant="ghost" className="mb-2 h-8 px-0 text-muted-foreground" onClick={() => navigate('/crm')}>
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Zpet na obchodni prehled
                </Button>
                <h2 className="truncate text-2xl font-semibold text-slate-950">
                  {selectedOpportunity?.title || 'Obchodni pripad'}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Detail obchodniho pripadu, polozek, nabidek a objednavek.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {canEditCrm && selectedOpportunity && (
                  <Button variant="outline" onClick={() => openOpportunityDialog(selectedOpportunity)}>
                    Upravit pripad
                  </Button>
                )}
                <Button variant="secondary" onClick={fetchCrmData} disabled={loading}>
                  <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                  Obnovit
                </Button>
              </div>
            </div>
            <DealWorkspace
              opportunity={selectedOpportunity}
              documents={selectedOpportunityDocuments}
              documentTemplates={documentTemplates}
              selectedTemplateIds={selectedTemplateIds}
              stages={crmStages}
              priorities={crmPriorities}
              canEdit={canEditCrm}
              onEdit={openOpportunityDialog}
              onCreateDocument={handleCreateCommercialDocument}
              onCreateProject={handleCreateProjectFromOpportunity}
              onCreateRealization={handleCreateRealizationFromOpportunity}
              onGenerateDocument={handleGenerateCommercialDocument}
              onGenerateOverview={handleGenerateOpportunityOverview}
              onTemplateChange={(type, templateId) => setSelectedTemplateIds((current) => ({
                ...current,
                [type]: templateId || 'default',
              }))}
              onStageChange={requestOpportunityStageChange}
              onUpdateOpportunity={handleInlineOpportunityUpdate}
              onUpdateOpportunityItems={handleOpportunityItemsUpdate}
              creatingDocument={creatingDocument}
              generatingDocument={generatingDocument}
              updatingOpportunity={updatingOpportunity}
            />
          </div>
        ) : (
        <Tabs defaultValue="pipeline" className="space-y-6">
          <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border bg-slate-100 p-1 sm:w-auto">
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="subjects">Adresar</TabsTrigger>
            <TabsTrigger value="activities">Aktivity</TabsTrigger>
            <TabsTrigger value="relations">Vazby</TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline" className="space-y-6">
            <Card className="crm-panel">
              <CardHeader className="crm-panel-header">
                <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-center 2xl:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
                      <Select value={sortMode} onValueChange={setSortMode}>
                        <SelectTrigger className="h-9 w-[250px] bg-white text-xs font-semibold">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="updated">Seradit podle posledni zmeny</SelectItem>
                          <SelectItem value="value_desc">Seradit podle hodnoty</SelectItem>
                          <SelectItem value="close_date">Seradit podle odhadu uzavreni</SelectItem>
                          <SelectItem value="probability_desc">Seradit podle pravdepodobnosti</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <CardTitle className="mt-1 text-3xl font-semibold tracking-tight text-slate-950">Obchodni pripady</CardTitle>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-64">
                      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={opportunityQuery}
                        onChange={(event) => setOpportunityQuery(event.target.value)}
                        placeholder="Hledat..."
                        className="h-9 bg-white pl-9"
                      />
                    </div>
                    <div className="flex rounded-md border bg-white p-1 shadow-sm">
                      <Button
                        type="button"
                        size="sm"
                        variant={opportunityView === 'kanban' ? 'default' : 'ghost'}
                        className="h-8 px-3"
                        onClick={() => setOpportunityView('kanban')}
                      >
                        <LayoutGrid className="mr-2 h-4 w-4" />
                        Kanban
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={opportunityView === 'table' ? 'default' : 'ghost'}
                        className="h-8 px-3"
                        onClick={() => setOpportunityView('table')}
                      >
                        <List className="mr-2 h-4 w-4" />
                        Tabulka
                      </Button>
                    </div>
                    <Select value={stageFilter} onValueChange={setStageFilter}>
                      <SelectTrigger className="h-9 w-[170px] bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Aktivni</SelectItem>
                        <SelectItem value="all">Vsechny</SelectItem>
                        {crmStages.map((stage) => (
                          <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                      <SelectTrigger className="h-9 w-[150px] bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Priorita</SelectItem>
                        {crmPriorities.map((priority) => (
                          <SelectItem key={priority.value} value={priority.value}>{priority.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button variant="outline" className="h-9">
                      <Filter className="mr-2 h-4 w-4" />
                      Filtrovani
                    </Button>
                    {canEditCrm && (
                      <Button onClick={() => openOpportunityDialog()} disabled={!crmTablesReady} className="h-9 w-9 p-0">
                        <Plus className="h-5 w-5" />
                      </Button>
                    )}
                  </div>
                </div>

                {(stageFilter !== 'open' || priorityFilter !== 'all' || opportunityQuery) && (
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Badge className="bg-orange-100 text-orange-700 hover:bg-orange-100">Filtrovano</Badge>
                    {stageFilter !== 'open' && (
                      <Badge variant="outline">Stav: {stageFilter === 'all' ? 'Vsechny' : getStage(stageFilter, crmStages).label}</Badge>
                    )}
                    {priorityFilter !== 'all' && (
                      <Badge variant="outline">Priorita: {getPriority(priorityFilter, crmPriorities)?.label}</Badge>
                    )}
                    {opportunityQuery && <Badge variant="outline">Hledani: {opportunityQuery}</Badge>}
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        setStageFilter('open');
                        setPriorityFilter('all');
                        setOpportunityQuery('');
                      }}
                    >
                      Vycistit filtry
                    </Button>
                  </div>
                )}
              </CardHeader>
              <CardContent className="p-3 sm:p-4">
                {opportunityView === 'kanban' ? (
                  <OpportunityBoard
                    stages={opportunitiesByStage}
                    priorities={crmPriorities}
                    selectedOpportunity={selectedOpportunity}
                    crmTablesReady={crmTablesReady}
                    onSelectOpportunity={openOpportunityDetail}
                    onMoveOpportunity={handleMoveOpportunity}
                  />
                ) : (
                  <OpportunityTable
                    opportunities={filteredOpportunities}
                    stages={crmStages}
                    priorities={crmPriorities}
                    selectedOpportunity={selectedOpportunity}
                    onSelectOpportunity={openOpportunityDetail}
                  />
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subjects">
            <Card className="min-w-0">
              <CardHeader className="crm-panel-header">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <CardTitle>Adresar CRM</CardTitle>
                    <CardDescription>Rychly obchodni pohled na subjekty, ktere uz v systemu existuji.</CardDescription>
                  </div>
                  <div className="relative w-full lg:w-80">
                    <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Hledat subjekt, ICO, kontakt..."
                      className="pl-9"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Subjekt</TableHead>
                        <TableHead>Typ</TableHead>
                        <TableHead>Kontakt</TableHead>
                        <TableHead>Email</TableHead>
                        <TableHead className="text-right">Detail</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Nacitani CRM dat...</TableCell>
                        </TableRow>
                      ) : filteredSubjects.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={5} className="py-10 text-center text-muted-foreground">Zadny subjekt neodpovida filtru.</TableCell>
                        </TableRow>
                      ) : (
                        filteredSubjects.map((subject) => {
                          const type = subject.subject_types?.name || 'other';
                          return (
                            <TableRow key={subject.id}>
                              <TableCell>
                                <div className="font-semibold text-slate-950">{subject.name}</div>
                                {subject.ico && <div className="text-xs text-muted-foreground">ICO {subject.ico}</div>}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{subjectTypeLabels[type] || subjectTypeLabels.other}</Badge>
                              </TableCell>
                              <TableCell>{subject.contact_person || subject.phone || '-'}</TableCell>
                              <TableCell className="max-w-[220px] truncate">{subject.email || '-'}</TableCell>
                              <TableCell className="text-right">
                                <Button asChild variant="ghost" size="sm">
                                  <Link to={`/subjects/${subject.id}`}>
                                    <ExternalLink className="h-4 w-4" />
                                  </Link>
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activities">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]">
              <Card>
                <CardHeader className="crm-panel-header">
                  <CardTitle>Nasledujici aktivity</CardTitle>
                  <CardDescription>Ukoly, schuzky a follow-upy navazane na CRM.</CardDescription>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  {!crmTablesReady ? (
                    <div className="p-6 text-sm text-muted-foreground">Aktivity se zobrazi po nasazeni CRM migraci.</div>
                  ) : upcomingActivities.length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground">Zadne planovane CRM aktivity.</div>
                  ) : (
                    upcomingActivities.map((activity) => (
                      <div key={activity.id} className="flex items-start gap-3 p-4">
                        <div className="mt-1 rounded-md bg-primary/10 p-2 text-primary">
                          <CheckCircle2 className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-slate-950">{activity.title}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {activity.subject?.name || activity.opportunity?.title || 'CRM'} · {formatDate(activity.due_at)}
                          </div>
                        </div>
                        <Badge variant="outline">{activity.status}</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="crm-panel-header">
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Typy subjektu
                  </CardTitle>
                  <CardDescription>Zaklad segmentace pro obchod a kampane.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 p-4">
                  {Object.entries(subjectTypeLabels).map(([type, label]) => {
                    const count = metrics.countsByType[type] || 0;
                    const share = metrics.subjects ? Math.round((count / metrics.subjects) * 100) : 0;
                    return (
                      <div key={type} className="rounded-lg border p-3">
                        <div className="mb-2 flex items-center justify-between text-sm">
                          <span className="font-medium">{label}</span>
                          <span className="text-muted-foreground">{count} ({share} %)</span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div className="h-full rounded-full bg-primary" style={{ width: `${share}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="relations">
            <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
              <Card>
                <CardHeader className="crm-panel-header">
                  <CardTitle>Posledni obchodni vazby</CardTitle>
                  <CardDescription>Projekty s klientem nebo investorem.</CardDescription>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  {projects.length === 0 ? (
                    <div className="p-6 text-sm text-muted-foreground">Zadne projekty k zobrazeni.</div>
                  ) : (
                    projects.slice(0, 9).map((project) => (
                      <motion.div key={project.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <Link to={`/projects/${project.id}`} className="font-semibold text-slate-950 hover:text-primary">
                              {project.name}
                            </Link>
                            <p className="truncate text-xs text-muted-foreground">{project.code || project.status || 'Bez kodu'}</p>
                          </div>
                          <Badge variant="secondary">{project.status || 'stav'}</Badge>
                        </div>
                        <div className="mt-3 grid gap-2 text-xs text-muted-foreground">
                          {project.client && <span>Klient: {project.client.name}</span>}
                          {project.investor && <span>Investor: {project.investor.name}</span>}
                        </div>
                      </motion.div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="crm-panel-header">
                  <CardTitle>Projektove kontakty</CardTitle>
                  <CardDescription>Osoby pouzitelne pro obchodni historii a follow-upy.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-3 p-4 md:grid-cols-2">
                  {contacts.slice(0, 12).map((contact) => (
                    <div key={contact.id} className="rounded-lg border bg-white p-4">
                      <div className="font-semibold text-slate-950">{contact.name}</div>
                      <div className="text-sm text-muted-foreground">{contact.role || contact.projects?.name || 'Kontakt'}</div>
                      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                        {contact.email && <div className="flex items-center gap-2"><Mail className="h-3.5 w-3.5" /> {contact.email}</div>}
                        {contact.phone && <div className="flex items-center gap-2"><Phone className="h-3.5 w-3.5" /> {contact.phone}</div>}
                      </div>
                      {contact.projects && (
                        <Button asChild variant="link" className="mt-3 h-auto p-0 text-xs">
                          <Link to={`/projects/${contact.projects.id}`}>{contact.projects.name}</Link>
                        </Button>
                      )}
                    </div>
                  ))}
                  {contacts.length === 0 && (
                    <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground md:col-span-2">
                      Zadne projektove kontakty k zobrazeni.
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
        )}

        <Dialog open={opportunityDialogOpen} onOpenChange={setOpportunityDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>{opportunityForm.id ? 'Upravit CRM prilezitost' : 'Nova CRM prilezitost'}</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSaveOpportunity} className="space-y-5">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="opportunity-title">Nazev *</Label>
                  <Input
                    id="opportunity-title"
                    value={opportunityForm.title}
                    onChange={(event) => handleOpportunityChange('title', event.target.value)}
                    placeholder="Napr. Nova projektova poptavka"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <SubjectSelect
                    label="Subjekt *"
                    value={opportunityForm.subject_id}
                    onChange={(value) => handleOpportunityChange('subject_id', value || '')}
                    onCreated={(subject) => {
                      setSubjects((current) => [...current, subject].sort((a, b) => a.name.localeCompare(b.name)));
                      handleOpportunityChange('subject_id', subject.id);
                    }}
                    placeholder="Vyberte nebo vytvorte subjekt"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Navazany projekt</Label>
                  <Select value={opportunityForm.project_id || 'none'} onValueChange={(value) => handleOpportunityChange('project_id', value === 'none' ? '' : value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Volitelne" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Bez projektu</SelectItem>
                      {projects.map((project) => (
                        <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Faze</Label>
                  <Select value={opportunityForm.stage} onValueChange={(value) => handleOpportunityChange('stage', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {crmStages.map((stage) => (
                        <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Priorita</Label>
                  <Select value={opportunityForm.priority} onValueChange={(value) => handleOpportunityChange('priority', value)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {crmPriorities.map((priority) => (
                        <SelectItem key={priority.value} value={priority.value}>{priority.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="opportunity-value">Hodnota</Label>
                  <Input
                    id="opportunity-value"
                    type="number"
                    min="0"
                    value={opportunityForm.value}
                    onChange={(event) => handleOpportunityChange('value', event.target.value)}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="opportunity-probability">Pravdepodobnost (%)</Label>
                  <Input
                    id="opportunity-probability"
                    type="number"
                    min="0"
                    max="100"
                    value={opportunityForm.probability}
                    onChange={(event) => handleOpportunityChange('probability', event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="opportunity-close-date">Ocekavane uzavreni</Label>
                  <Input
                    id="opportunity-close-date"
                    type="date"
                    value={opportunityForm.expected_close_date}
                    onChange={(event) => handleOpportunityChange('expected_close_date', event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Stav</Label>
                  <div className={cn('rounded-md border px-3 py-2 text-sm', getStage(opportunityForm.stage, crmStages).color)}>
                    {getStage(opportunityForm.stage, crmStages).is_closed ? 'Uzavreno' : 'Otevreno'} · {getPriority(opportunityForm.priority, crmPriorities)?.label}
                  </div>
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="opportunity-next-step">Dalsi krok</Label>
                  <Input
                    id="opportunity-next-step"
                    value={opportunityForm.next_step}
                    onChange={(event) => handleOpportunityChange('next_step', event.target.value)}
                    placeholder="Napr. Zavolat klientovi, poslat podklady..."
                  />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="opportunity-description">Poznamka</Label>
                  <Textarea
                    id="opportunity-description"
                    value={opportunityForm.description}
                    onChange={(event) => handleOpportunityChange('description', event.target.value)}
                    rows={4}
                  />
                </div>
                {opportunityForm.stage === 'lost' && (
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="opportunity-lost-reason">Duvod prohry *</Label>
                    <Textarea
                      id="opportunity-lost-reason"
                      value={opportunityForm.lost_reason}
                      onChange={(event) => handleOpportunityChange('lost_reason', event.target.value)}
                      rows={4}
                      placeholder="Napr. cena, termin, konkurence, zrusena poptavka..."
                      required
                    />
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpportunityDialogOpen(false)}>
                  Zrusit
                </Button>
                <Button type="submit" disabled={savingOpportunity || !crmTablesReady}>
                  {savingOpportunity ? 'Ukladam...' : (opportunityForm.id ? 'Ulozit zmeny' : 'Ulozit prilezitost')}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog
          open={lossDialogOpen}
          onOpenChange={(open) => {
            setLossDialogOpen(open);
            if (!open) {
              setPendingLostOpportunity(null);
              setLossReason('');
            }
          }}
        >
          <DialogContent className="max-w-xl">
            <DialogHeader>
              <DialogTitle>Uzavrit obchodni pripad jako prohrany</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
                Pro prohrany obchodni pripad je potreba zapsat duvod. Pomuze to pozdeji vyhodnocovat, proc ztracime zakazky.
              </div>
              <div className="space-y-2">
                <Label htmlFor="loss-reason">Duvod prohry *</Label>
                <Textarea
                  id="loss-reason"
                  value={lossReason}
                  onChange={(event) => setLossReason(event.target.value)}
                  rows={5}
                  placeholder="Napr. cena, termin, konkurence, zrusena poptavka..."
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setLossDialogOpen(false)}>
                Zrusit
              </Button>
              <Button type="button" variant="destructive" onClick={confirmLostOpportunity} disabled={!lossReason.trim()}>
                Uzavrit jako prohrane
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export default CRM;
