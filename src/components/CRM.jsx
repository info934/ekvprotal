import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  BarChart3,
  Building2,
  CalendarClock,
  CheckCircle2,
  Clock,
  CircleDollarSign,
  Contact,
  ExternalLink,
  Mail,
  MoreHorizontal,
  Package,
  Paperclip,
  Percent,
  Phone,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  ShoppingCart,
  Target,
  Users,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
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
};

const isMissingCrmTableError = (error) => {
  if (!error) return false;
  const message = `${error.code || ''} ${error.message || ''}`.toLowerCase();
  return ['42P01', 'PGRST116', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error.code) ||
    message.includes('crm_opportunities') ||
    message.includes('crm_activities') ||
    message.includes('crm_notes') ||
    message.includes('crm_commercial_documents') ||
    message.includes('crm_commercial_document_items');
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

const MetricCard = ({ icon: Icon, title, value, description, tone = 'default' }) => (
  <Card className="overflow-hidden">
    <CardContent className="flex items-center gap-4 p-4">
      <div className={cn(
        'flex h-11 w-11 shrink-0 items-center justify-center rounded-md ring-1',
        tone === 'success' ? 'bg-emerald-50 text-emerald-700 ring-emerald-100' :
          tone === 'warning' ? 'bg-amber-50 text-amber-700 ring-amber-100' :
            'bg-primary/10 text-primary ring-primary/10'
      )}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-muted-foreground">{title}</p>
        <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
        {description && <p className="mt-1 truncate text-xs text-muted-foreground">{description}</p>}
      </div>
    </CardContent>
  </Card>
);

const DealWorkspace = ({ opportunity, documents = [], stages, priorities, onEdit, onCreateDocument, canEdit, creatingDocument }) => {
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
  const primaryDocument = documents[0] || null;
  const primaryItems = primaryDocument?.items || [];
  const productRows = primaryItems.length > 0 ? primaryItems.map((item) => ({
    code: item.code || '-',
    name: item.name,
    standardPrice: Number(item.unit_price || 0),
    salePrice: Number(item.unit_price || 0),
    quantity: Number(item.quantity || 0),
    discount: Number(item.discount_percent || 0),
    total: Number(item.line_total || 0),
  })) : [
    {
      code: 'CRM-001',
      name: opportunity.title,
      standardPrice: value,
      salePrice: value,
      quantity: 1,
      discount: 0,
      total: value,
    },
  ];
  const subtotal = primaryDocument ? Number(primaryDocument.subtotal || 0) : value;
  const discountTotal = primaryDocument ? Number(primaryDocument.discount_total || 0) : 0;
  const total = primaryDocument ? Number(primaryDocument.total || 0) : value;
  const taxValue = primaryDocument ? Number(primaryDocument.total || 0) + Number(primaryDocument.tax_total || 0) : Math.round(value * 1.21);

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="border-b bg-white px-5 py-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                Obchodni pripad {opportunity.subject?.name ? `- ${opportunity.subject.name}` : ''}
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
            <div className="flex flex-wrap gap-2">
              {canEdit && (
                <Button variant="outline" onClick={() => onEdit(opportunity)}>
                  Upravit
                </Button>
              )}
              <Button variant="secondary" disabled className="rounded-full">
                Ulozit
              </Button>
              <Button disabled className="rounded-full bg-slate-900 hover:bg-slate-800">
                <Plus className="mr-2 h-4 w-4" />
                Vlastni akce
              </Button>
              <Button variant="ghost" size="icon" disabled className="rounded-full bg-slate-100">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5 bg-slate-50/50 p-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <div className="space-y-5">
            <Tabs defaultValue="basic" className="space-y-4">
              <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b bg-transparent p-0">
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
                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm">{formatDate(opportunity.expected_close_date)}</div>
                  </div>
                  <div className="space-y-1">
                    <Label>Stav</Label>
                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm">{stage.label}</div>
                  </div>
                  <div className="space-y-1">
                    <Label>Priorita</Label>
                    <div className="rounded-md border bg-slate-50 px-3 py-2 text-sm">{priority?.label || '-'}</div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <div className="flex items-center justify-between text-sm">
                      <Label>Pravdepodobnost</Label>
                      <span className="font-semibold text-slate-950">{opportunity.probability || 0} %</span>
                    </div>
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
                        <strong>{formatCurrency(value)}</strong>
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

                <div className="min-h-[150px] rounded-lg border border-amber-200 bg-amber-50/80 p-4 shadow-sm">
                  <h3 className="text-sm font-semibold text-amber-900">Popis</h3>
                  <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
                    {opportunity.description || 'Zatim bez popisu.'}
                  </p>
                </div>
              </TabsContent>
              <TabsContent value="commerce">
                <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                  Tady bude navazani nabidek, objednavek, online podpisu a verzovani dokumentu. Datovy model je pripraveny jako dalsi krok.
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
              <p className="mt-3 text-sm text-muted-foreground">{opportunity.next_step || 'Zatim neni naplanovana.'}</p>
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

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="border-b bg-slate-900 px-5 py-3 text-white">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Package className="h-4 w-4" />
              Produkty ({productRows.length})
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="rounded-full" disabled>Hromadne akce</Button>
              <Button variant="secondary" size="sm" className="rounded-full" disabled={!primaryDocument}>Pridat produkty</Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kod</TableHead>
                  <TableHead>Nazev</TableHead>
                  <TableHead className="text-right">Standardni cena</TableHead>
                  <TableHead className="text-right">Prodejni cena</TableHead>
                  <TableHead className="text-right">Mnozstvi</TableHead>
                  <TableHead className="text-right">Sleva %</TableHead>
                  <TableHead className="text-right">Cena celkem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {productRows.map((item) => (
                  <TableRow key={item.code}>
                    <TableCell className="font-medium text-primary">{item.code}</TableCell>
                    <TableCell className="min-w-[260px]">{item.name}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.standardPrice)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(item.salePrice)}</TableCell>
                    <TableCell className="text-right">{item.quantity}</TableCell>
                    <TableCell className="text-right">{item.discount.toFixed(2)} %</TableCell>
                    <TableCell className="text-right font-semibold">{formatCurrency(item.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-2 border-t bg-slate-50 p-5 text-sm md:ml-auto md:w-[420px]">
            <div className="flex justify-between"><span>Cena celkem pred slevou</span><strong>{formatCurrency(subtotal)}</strong></div>
            <div className="flex justify-between"><span>Celkova sleva</span><strong>{formatCurrency(discountTotal)}</strong></div>
            <div className="flex justify-between text-base"><span>Konecna cena</span><strong>{formatCurrency(total)}</strong></div>
            <div className="flex justify-between text-muted-foreground"><span>Celkem s dani</span><strong>{formatCurrency(taxValue)}</strong></div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-slate-200 shadow-sm">
        <CardHeader className="border-b bg-slate-900 px-5 py-3 text-white">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <ShoppingCart className="h-4 w-4" />
              Nabidky / objednavky
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" className="rounded-full" onClick={() => onCreateDocument?.('offer')} disabled={!canEdit || creatingDocument}>
                Pridat nabidku
              </Button>
              <Button variant="secondary" size="sm" className="rounded-full" onClick={() => onCreateDocument?.('order')} disabled={!canEdit || creatingDocument}>
                Pridat objednavku
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          {documents.length === 0 ? (
            <div className="rounded-lg border border-dashed bg-slate-50 p-6 text-sm text-muted-foreground">
              Zatim neni zalozena zadna nabidka ani objednavka. Vytvorte prvni dokument tlacitkem nahore.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Typ</TableHead>
                    <TableHead>Cislo</TableHead>
                    <TableHead>Nazev</TableHead>
                    <TableHead>Stav</TableHead>
                    <TableHead>Datum</TableHead>
                    <TableHead className="text-right">Celkem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {documents.map((document) => (
                    <TableRow key={document.id}>
                      <TableCell>{document.type === 'offer' ? 'Nabidka' : 'Objednavka'}</TableCell>
                      <TableCell className="font-medium">{document.number || '-'}</TableCell>
                      <TableCell>{document.title}</TableCell>
                      <TableCell><Badge variant="outline">{document.status}</Badge></TableCell>
                      <TableCell>{formatDate(document.issue_date)}</TableCell>
                      <TableCell className="text-right font-semibold">{formatCurrency(document.total)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const CRM = () => {
  const { toast } = useToast();
  const { hasPermission, memberId } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [activities, setActivities] = useState([]);
  const [commercialDocuments, setCommercialDocuments] = useState([]);
  const [crmTablesReady, setCrmTablesReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [savingOpportunity, setSavingOpportunity] = useState(false);
  const [creatingDocument, setCreatingDocument] = useState(false);
  const [opportunityDialogOpen, setOpportunityDialogOpen] = useState(false);
  const [opportunityForm, setOpportunityForm] = useState(initialOpportunityForm);
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [crmStages, setCrmStages] = useState(() => loadCrmConfig().stages);
  const [crmPriorities, setCrmPriorities] = useState(() => loadCrmConfig().priorities);
  const [selectedOpportunityId, setSelectedOpportunityId] = useState(null);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState('open');
  const [priorityFilter, setPriorityFilter] = useState('all');

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

    const [subjectsRes, projectsRes, contactsRes, opportunitiesRes, activitiesRes, commercialDocumentsRes] = await Promise.all([
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
        .select('id, title, stage, status, priority, value, probability, expected_close_date, next_step, description, subject_id, project_id, subject:subject_id(id, name), project:project_id(id, name, code), owner:owner_member_id(id, name)')
        .order('updated_at', { ascending: false }),
      supabase
        .from('crm_activities')
        .select('id, title, type, status, due_at, completed_at, subject:subject_id(id, name), opportunity:opportunity_id(id, title), assigned:assigned_member_id(id, name)')
        .order('due_at', { ascending: true, nullsFirst: false })
        .limit(20),
      supabase
        .from('crm_commercial_documents')
        .select('id, opportunity_id, subject_id, type, status, number, title, issue_date, valid_until, subtotal, discount_total, tax_total, total, notes, items:crm_commercial_document_items(id, code, name, quantity, unit, unit_price, discount_percent, vat_rate, line_total, sort_order)')
        .order('created_at', { ascending: false }),
    ]);

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

    if (opportunitiesRes.error || activitiesRes.error || commercialDocumentsRes.error) {
      const crmError = opportunitiesRes.error || activitiesRes.error || commercialDocumentsRes.error;
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
      setOpportunities(opportunitiesRes.data || []);
      setActivities(activitiesRes.data || []);
      setCommercialDocuments((commercialDocumentsRes.data || []).map((document) => ({
        ...document,
        items: [...(document.items || [])].sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)),
      })));
    }

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
    const pipelineValue = openOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.value || 0), 0);
    const weightedPipeline = openOpportunities.reduce((sum, opportunity) => (
      sum + (Number(opportunity.value || 0) * (Number(opportunity.probability || 0) / 100))
    ), 0);

    return {
      subjects: subjects.length,
      customers: countsByType.customer || 0,
      investors: countsByType.investor || 0,
      suppliers: countsByType.supplier || 0,
      contacts: contacts.length,
      activeRelations,
      opportunities: openOpportunities.length,
      won: wonOpportunities.length,
      pipelineValue,
      weightedPipeline,
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
    return opportunities.filter((opportunity) => {
      const stage = getStage(opportunity.stage, crmStages);
      const matchesStage = stageFilter === 'all' ||
        (stageFilter === 'open' && opportunity.status === 'open' && !stage.is_closed) ||
        opportunity.stage === stageFilter;
      const matchesPriority = priorityFilter === 'all' || opportunity.priority === priorityFilter;
      return matchesStage && matchesPriority;
    });
  }, [crmStages, opportunities, priorityFilter, stageFilter]);

  const opportunitiesByStage = useMemo(() => {
    return crmStages.map((stage) => ({
      ...stage,
      opportunities: filteredOpportunities.filter((opportunity) => opportunity.stage === stage.value),
    }));
  }, [crmStages, filteredOpportunities]);

  const selectedOpportunity = useMemo(() => {
    if (!opportunities.length) return null;
    return opportunities.find((opportunity) => opportunity.id === selectedOpportunityId) || opportunities[0];
  }, [opportunities, selectedOpportunityId]);

  const selectedOpportunityDocuments = useMemo(() => {
    if (!selectedOpportunity) return [];
    return commercialDocuments.filter((document) => document.opportunity_id === selectedOpportunity.id);
  }, [commercialDocuments, selectedOpportunity]);

  useEffect(() => {
    if (!selectedOpportunityId && opportunities.length > 0) {
      setSelectedOpportunityId(opportunities[0].id);
    }
    if (selectedOpportunityId && opportunities.length > 0 && !opportunities.some((opportunity) => opportunity.id === selectedOpportunityId)) {
      setSelectedOpportunityId(opportunities[0].id);
    }
  }, [opportunities, selectedOpportunityId]);

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

    setSavingOpportunity(true);
    const payload = {
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
      status: getStage(opportunityForm.stage, crmStages).is_closed ? 'closed' : 'open',
    };

    const request = opportunityForm.id
      ? supabase.from('crm_opportunities').update(payload).eq('id', opportunityForm.id)
      : supabase.from('crm_opportunities').insert(payload);

    const { error } = await request;

    setSavingOpportunity(false);

    if (error) {
      toast({
        title: 'Prilezitost se nepodarilo ulozit',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({ title: opportunityForm.id ? 'CRM prilezitost aktualizovana' : 'CRM prilezitost ulozena' });
    setOpportunityDialogOpen(false);
    fetchCrmData();
  };

  const handleCreateCommercialDocument = async (type) => {
    if (!selectedOpportunity || !crmTablesReady) return;

    setCreatingDocument(true);

    const baseValue = Number(selectedOpportunity.value || 0);
    const vatRate = 21;
    const taxTotal = Math.round(baseValue * (vatRate / 100));
    const prefix = type === 'offer' ? 'NAB' : 'OBJ';
    const number = `${prefix}-${new Date().getFullYear()}-${String(selectedOpportunityDocuments.length + 1).padStart(3, '0')}`;

    const { data: documentData, error: documentError } = await supabase
      .from('crm_commercial_documents')
      .insert({
        opportunity_id: selectedOpportunity.id,
        subject_id: selectedOpportunity.subject_id || selectedOpportunity.subject?.id || null,
        type,
        status: 'draft',
        number,
        title: `${type === 'offer' ? 'Nabidka' : 'Objednavka'} - ${selectedOpportunity.title}`,
        subtotal: baseValue,
        discount_total: 0,
        tax_total: taxTotal,
        total: baseValue,
        notes: selectedOpportunity.description || null,
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

    const { error: itemError } = await supabase
      .from('crm_commercial_document_items')
      .insert({
        document_id: documentData.id,
        code: 'CRM-001',
        name: selectedOpportunity.title,
        quantity: 1,
        unit: 'ks',
        unit_price: baseValue,
        discount_percent: 0,
        vat_rate: vatRate,
        line_total: baseValue,
        sort_order: 1,
      });

    setCreatingDocument(false);

    if (itemError) {
      toast({
        title: 'Polozka dokumentu se nepodarila vytvorit',
        description: itemError.message,
        variant: 'destructive',
      });
      return;
    }

    toast({ title: type === 'offer' ? 'Nabidka vytvorena' : 'Objednavka vytvorena' });
    fetchCrmData();
  };

  const updateStageConfig = (index, field, value) => {
    setCrmStages(current => current.map((stage, stageIndex) => (
      stageIndex === index ? { ...stage, [field]: field === 'probability' ? Number(value || 0) : value } : stage
    )));
  };

  const updatePriorityConfig = (index, field, value) => {
    setCrmPriorities(current => current.map((priority, priorityIndex) => (
      priorityIndex === index ? { ...priority, [field]: value } : priority
    )));
  };

  const addStageConfig = () => {
    setCrmStages(current => ([
      ...current,
      {
        value: `stage_${Date.now()}`,
        label: 'Novy stav',
        color: 'bg-slate-100 text-slate-700 border-slate-200',
        probability: 50,
        is_closed: false,
      },
    ]));
  };

  const addPriorityConfig = () => {
    setCrmPriorities(current => ([
      ...current,
      { value: `priority_${Date.now()}`, label: 'Nova priorita', tone: 'secondary' },
    ]));
  };

  const resetCrmConfig = () => {
    setCrmStages(DEFAULT_STAGE_CONFIG);
    setCrmPriorities(DEFAULT_PRIORITY_CONFIG);
  };

  return (
    <div className="app-page">
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
                <Button variant="outline" onClick={() => setConfigDialogOpen(true)}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />
                  Nastaveni CRM
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

        <Tabs defaultValue="pipeline" className="space-y-6">
          <TabsList className="w-full justify-start sm:w-auto">
            <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
            <TabsTrigger value="subjects">Adresar</TabsTrigger>
            <TabsTrigger value="activities">Aktivity</TabsTrigger>
            <TabsTrigger value="relations">Vazby</TabsTrigger>
          </TabsList>

          <TabsContent value="pipeline" className="space-y-6">
            <Card className="overflow-hidden border-slate-200 shadow-sm">
              <CardHeader className="border-b bg-white px-5 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div>
                    <CardTitle className="text-xl font-semibold text-slate-950">Obchodni pipeline</CardTitle>
                    <CardDescription>Rizene faze od leadu po vyhranou nebo ztracenou prilezitost.</CardDescription>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Select value={stageFilter} onValueChange={setStageFilter}>
                      <SelectTrigger className="w-[180px] bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Jen otevrene</SelectItem>
                        <SelectItem value="all">Vsechny faze</SelectItem>
                        {crmStages.map((stage) => (
                          <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={priorityFilter} onValueChange={setPriorityFilter}>
                      <SelectTrigger className="w-[160px] bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Vsechny priority</SelectItem>
                        {crmPriorities.map((priority) => (
                          <SelectItem key={priority.value} value={priority.value}>{priority.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 bg-slate-50/50 p-4 lg:grid-cols-3 xl:grid-cols-6">
                {opportunitiesByStage.map((stage) => (
                  <div key={stage.value} className="min-h-[220px] rounded-lg border bg-white p-3 shadow-sm">
                    <div className="mb-3 flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-900">{stage.label}</h3>
                      <Badge variant="outline">{stage.opportunities.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {stage.opportunities.slice(0, 6).map((opportunity) => (
                        <button
                          key={opportunity.id}
                          type="button"
                          onClick={() => setSelectedOpportunityId(opportunity.id)}
                          className={cn(
                            'w-full rounded-md border bg-white p-3 text-left shadow-sm transition hover:border-slate-400 hover:shadow-md',
                            selectedOpportunity?.id === opportunity.id && 'border-slate-900 ring-2 ring-slate-200'
                          )}
                        >
                          <div className="line-clamp-2 text-sm font-semibold text-slate-950">{opportunity.title}</div>
                          <div className="mt-1 truncate text-xs text-muted-foreground">{opportunity.subject?.name || 'Bez subjektu'}</div>
                          <div className="mt-3 flex items-center justify-between gap-2">
                            <span className="text-xs font-medium">{formatCurrency(opportunity.value)}</span>
                            <Badge variant={getPriority(opportunity.priority, crmPriorities)?.tone || 'secondary'} className="text-[10px]">
                              {opportunity.probability || 0} %
                            </Badge>
                          </div>
                          {opportunity.expected_close_date && (
                            <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                              <CalendarClock className="h-3 w-3" />
                              {formatDate(opportunity.expected_close_date)}
                            </div>
                          )}
                          {opportunity.next_step && (
                            <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{opportunity.next_step}</div>
                          )}
                        </button>
                      ))}
                      {stage.opportunities.length === 0 && (
                        <div className="rounded-md border border-dashed bg-white/60 p-4 text-center text-xs text-muted-foreground">
                          {crmTablesReady ? 'Zatim prazdne' : 'Ceka na CRM migraci'}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <DealWorkspace
              opportunity={selectedOpportunity}
              documents={selectedOpportunityDocuments}
              stages={crmStages}
              priorities={crmPriorities}
              canEdit={canEditCrm}
              onEdit={openOpportunityDialog}
              onCreateDocument={handleCreateCommercialDocument}
              creatingDocument={creatingDocument}
            />
          </TabsContent>

          <TabsContent value="subjects">
            <Card className="min-w-0">
              <CardHeader className="border-b bg-slate-50/70">
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
                <CardHeader className="border-b bg-slate-50/70">
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
                <CardHeader className="border-b bg-slate-50/70">
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
                <CardHeader className="border-b bg-slate-50/70">
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
                <CardHeader className="border-b bg-slate-50/70">
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

        <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
          <DialogContent className="max-w-4xl">
            <DialogHeader>
              <DialogTitle>Nastaveni CRM stavů a priorit</DialogTitle>
            </DialogHeader>
            <div className="grid max-h-[70vh] gap-6 overflow-y-auto pr-1 lg:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.8fr)]">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Stavy obchodniho pripadu</h3>
                  <Button type="button" size="sm" variant="outline" onClick={addStageConfig}>Pridat stav</Button>
                </div>
                <div className="space-y-2">
                  {crmStages.map((stage, index) => (
                    <div key={stage.value} className="grid gap-2 rounded-lg border bg-slate-50 p-3 md:grid-cols-[minmax(120px,1fr)_90px_minmax(180px,1.2fr)_110px]">
                      <Input
                        value={stage.label}
                        onChange={(event) => updateStageConfig(index, 'label', event.target.value)}
                        placeholder="Nazev stavu"
                      />
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={stage.probability}
                        onChange={(event) => updateStageConfig(index, 'probability', event.target.value)}
                      />
                      <Select value={stage.color} onValueChange={(value) => updateStageConfig(index, 'color', value)}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="bg-slate-100 text-slate-700 border-slate-200">Neutral</SelectItem>
                          <SelectItem value="bg-blue-100 text-blue-700 border-blue-200">Modra</SelectItem>
                          <SelectItem value="bg-indigo-100 text-indigo-700 border-indigo-200">Indigo</SelectItem>
                          <SelectItem value="bg-amber-100 text-amber-800 border-amber-200">Oranzova</SelectItem>
                          <SelectItem value="bg-emerald-100 text-emerald-700 border-emerald-200">Zelena</SelectItem>
                          <SelectItem value="bg-rose-100 text-rose-700 border-rose-200">Cervena</SelectItem>
                        </SelectContent>
                      </Select>
                      <Select value={stage.is_closed ? 'closed' : 'open'} onValueChange={(value) => updateStageConfig(index, 'is_closed', value === 'closed')}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">Otevreno</SelectItem>
                          <SelectItem value="closed">Uzavreno</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Priority</h3>
                  <Button type="button" size="sm" variant="outline" onClick={addPriorityConfig}>Pridat</Button>
                </div>
                <div className="space-y-2">
                  {crmPriorities.map((priority, index) => (
                    <div key={priority.value} className="grid gap-2 rounded-lg border bg-slate-50 p-3 sm:grid-cols-[minmax(0,1fr)_130px] lg:grid-cols-1">
                      <Input
                        value={priority.label}
                        onChange={(event) => updatePriorityConfig(index, 'label', event.target.value)}
                        placeholder="Nazev priority"
                      />
                      <Select value={priority.tone} onValueChange={(value) => updatePriorityConfig(index, 'tone', value)}>
                        <SelectTrigger className="bg-white">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="secondary">Neutral</SelectItem>
                          <SelectItem value="outline">Obrys</SelectItem>
                          <SelectItem value="destructive">Vyrazna</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <DialogFooter className="gap-2 sm:justify-between">
              <Button type="button" variant="ghost" onClick={resetCrmConfig}>Obnovit vychozi</Button>
              <Button type="button" onClick={() => setConfigDialogOpen(false)}>Hotovo</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

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
                  <Label>Subjekt *</Label>
                  <Select value={opportunityForm.subject_id} onValueChange={(value) => handleOpportunityChange('subject_id', value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Vyberte subjekt" />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects.map((subject) => (
                        <SelectItem key={subject.id} value={subject.id}>{subject.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
      </div>
    </div>
  );
};

export default CRM;
