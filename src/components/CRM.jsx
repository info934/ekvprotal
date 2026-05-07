import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { BarChart3, Building2, Briefcase, Contact, ExternalLink, Mail, Phone, Plus, RefreshCw, Search, Target, Users } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

const opportunityStages = [
  { value: 'lead', label: 'Lead' },
  { value: 'qualified', label: 'Kvalifikovano' },
  { value: 'proposal', label: 'Nabidka' },
  { value: 'negotiation', label: 'Jednani' },
  { value: 'won', label: 'Vyhrano' },
  { value: 'lost', label: 'Ztraceno' },
];

const initialOpportunityForm = {
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

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 0,
}).format(Number(value || 0));

const MetricCard = ({ icon: Icon, title, value, description }) => (
  <Card className="overflow-hidden">
    <CardContent className="flex items-center gap-4 p-4">
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary ring-1 ring-primary/10">
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

const CRM = () => {
  const { toast } = useToast();
  const { hasPermission, memberId } = useAuth();
  const [subjects, setSubjects] = useState([]);
  const [projects, setProjects] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [opportunities, setOpportunities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingOpportunity, setSavingOpportunity] = useState(false);
  const [opportunityDialogOpen, setOpportunityDialogOpen] = useState(false);
  const [opportunityForm, setOpportunityForm] = useState(initialOpportunityForm);
  const [query, setQuery] = useState('');

  const canEditCrm = hasPermission('crm', 'can_edit');

  const fetchCrmData = useCallback(async () => {
    setLoading(true);

    const [subjectsRes, projectsRes, contactsRes, opportunitiesRes] = await Promise.all([
      supabase
        .from('subjects')
        .select('id, name, ico, email, phone, contact_person, created_at, subject_types(name)')
        .order('name', { ascending: true }),
      supabase
        .from('projects')
        .select('id, name, code, status, created_at, client:client_id(id, name), investor:investor_id(id, name)')
        .order('created_at', { ascending: false })
        .limit(12),
      supabase
        .from('project_contacts')
        .select('id, name, role, email, phone, project_id, projects(id, name, code)')
        .order('name', { ascending: true })
        .limit(40),
      supabase
        .from('crm_opportunities')
        .select('id, title, stage, status, priority, value, probability, expected_close_date, next_step, subject:subject_id(id, name), project:project_id(id, name, code), owner:owner_member_id(id, name)')
        .order('updated_at', { ascending: false }),
    ]);

    if (subjectsRes.error || projectsRes.error || contactsRes.error || opportunitiesRes.error) {
      toast({
        title: 'CRM data se nepodarilo nacist',
        description: subjectsRes.error?.message || projectsRes.error?.message || contactsRes.error?.message || opportunitiesRes.error?.message,
        variant: 'destructive',
      });
    } else {
      setSubjects(subjectsRes.data || []);
      setProjects(projectsRes.data || []);
      setContacts(contactsRes.data || []);
      setOpportunities(opportunitiesRes.data || []);
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
    const openOpportunities = opportunities.filter((opportunity) => opportunity.status === 'open' && !['won', 'lost'].includes(opportunity.stage));
    const pipelineValue = openOpportunities.reduce((sum, opportunity) => sum + Number(opportunity.value || 0), 0);

    return {
      subjects: subjects.length,
      customers: countsByType.customer || 0,
      investors: countsByType.investor || 0,
      suppliers: countsByType.supplier || 0,
      contacts: contacts.length,
      activeRelations,
      opportunities: openOpportunities.length,
      pipelineValue,
      countsByType,
    };
  }, [subjects, projects, contacts, opportunities]);

  const filteredSubjects = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return subjects.slice(0, 12);

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
      .slice(0, 20);
  }, [subjects, query]);

  const opportunitiesByStage = useMemo(() => {
    return opportunityStages.map((stage) => ({
      ...stage,
      opportunities: opportunities.filter((opportunity) => opportunity.stage === stage.value),
    }));
  }, [opportunities]);

  const handleOpportunityChange = (field, value) => {
    setOpportunityForm((current) => ({ ...current, [field]: value }));
  };

  const openOpportunityDialog = () => {
    setOpportunityForm(initialOpportunityForm);
    setOpportunityDialogOpen(true);
  };

  const handleSaveOpportunity = async (event) => {
    event.preventDefault();

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
      status: ['won', 'lost'].includes(opportunityForm.stage) ? 'closed' : 'open',
    };

    const { error } = await supabase.from('crm_opportunities').insert(payload);

    setSavingOpportunity(false);

    if (error) {
      toast({
        title: 'Prilezitost se nepodarilo ulozit',
        description: error.message,
        variant: 'destructive',
      });
      return;
    }

    toast({ title: 'CRM prilezitost ulozena' });
    setOpportunityDialogOpen(false);
    fetchCrmData();
  };

  return (
    <div className="app-page">
      <div className="space-y-6">
        <PageHeader
          icon={Briefcase}
          title="CRM"
          description="Zakladni obchodni pohled nad subjekty, kontakty a vazbami na projekty. Modul zatim pouziva existujici data bez duplicitni databaze."
          actions={
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={fetchCrmData} disabled={loading}>
                <RefreshCw className={cn('mr-2 h-4 w-4', loading && 'animate-spin')} />
                Obnovit
              </Button>
              {canEditCrm && (
                <Button onClick={openOpportunityDialog}>
                  <Plus className="mr-2 h-4 w-4" />
                  Nova prilezitost
                </Button>
              )}
              <Button asChild>
                <Link to="/subjects">
                  <Building2 className="mr-2 h-4 w-4" />
                  Adresar subjektu
                </Link>
              </Button>
            </div>
          }
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard icon={Building2} title="Subjekty celkem" value={metrics.subjects} description="Zakaznici, dodavatele, investori a urady" />
          <MetricCard icon={Users} title="Zakaznici" value={metrics.customers} description="Subjekty typu customer" />
          <MetricCard icon={Target} title="Otevrene prilezitosti" value={metrics.opportunities} description={formatCurrency(metrics.pipelineValue)} />
          <MetricCard icon={Contact} title="Projektove kontakty" value={metrics.contacts} description={`${metrics.activeRelations} aktivnich vazeb`} />
        </div>

        <Card>
          <CardHeader className="border-b bg-slate-50/70">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>Obchodni pipeline</CardTitle>
                <CardDescription>Prvni CRM vrstva pro sledovani poptavek, nabidek a dalsich kroku.</CardDescription>
              </div>
              <Badge variant="secondary">{formatCurrency(metrics.pipelineValue)}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 lg:grid-cols-3 xl:grid-cols-6">
            {opportunitiesByStage.map((stage) => (
              <div key={stage.value} className="min-h-[180px] rounded-lg border bg-slate-50/70 p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{stage.label}</h3>
                  <Badge variant="outline">{stage.opportunities.length}</Badge>
                </div>
                <div className="space-y-2">
                  {stage.opportunities.slice(0, 5).map((opportunity) => (
                    <div key={opportunity.id} className="rounded-md border bg-white p-3 shadow-sm">
                      <div className="line-clamp-2 text-sm font-semibold text-slate-950">{opportunity.title}</div>
                      <div className="mt-1 truncate text-xs text-muted-foreground">{opportunity.subject?.name || 'Bez subjektu'}</div>
                      <div className="mt-3 flex items-center justify-between gap-2">
                        <span className="text-xs font-medium">{formatCurrency(opportunity.value)}</span>
                        <Badge variant={opportunity.priority === 'high' ? 'destructive' : 'secondary'} className="text-[10px]">
                          {opportunity.probability || 0} %
                        </Badge>
                      </div>
                      {opportunity.next_step && (
                        <div className="mt-2 line-clamp-2 text-xs text-muted-foreground">{opportunity.next_step}</div>
                      )}
                    </div>
                  ))}
                  {stage.opportunities.length === 0 && (
                    <div className="rounded-md border border-dashed bg-white/60 p-4 text-center text-xs text-muted-foreground">
                      Zatim prazdne
                    </div>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
          <Card className="min-w-0">
            <CardHeader className="border-b bg-slate-50/70">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <CardTitle>Adresar CRM</CardTitle>
                  <CardDescription>Rychly pohled na subjekty pouzitelne pro obchodni pipeline.</CardDescription>
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

          <div className="space-y-6">
            <Card>
              <CardHeader className="border-b bg-slate-50/70">
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5 text-primary" />
                  Typy subjektu
                </CardTitle>
                <CardDescription>Zaklad segmentace pro budouci pipeline.</CardDescription>
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

            <Card>
              <CardHeader className="border-b bg-slate-50/70">
                <CardTitle>Posledni obchodni vazby</CardTitle>
                <CardDescription>Projekty s klientem nebo investorem.</CardDescription>
              </CardHeader>
              <CardContent className="divide-y p-0">
                {projects.length === 0 ? (
                  <div className="p-6 text-sm text-muted-foreground">Zadne projekty k zobrazeni.</div>
                ) : (
                  projects.slice(0, 7).map((project) => (
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
          </div>
        </div>

        <Card>
          <CardHeader className="border-b bg-slate-50/70">
            <CardTitle>Projektove kontakty</CardTitle>
            <CardDescription>Do budoucna vhodny zaklad pro osoby, aktivity, komunikaci a obchodni historii.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
            {contacts.slice(0, 9).map((contact) => (
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
          </CardContent>
        </Card>

        <Dialog open={opportunityDialogOpen} onOpenChange={setOpportunityDialogOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Nova CRM prilezitost</DialogTitle>
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
                      {opportunityStages.map((stage) => (
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
                      <SelectItem value="low">Nizka</SelectItem>
                      <SelectItem value="medium">Stredni</SelectItem>
                      <SelectItem value="high">Vysoka</SelectItem>
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
                <Button type="submit" disabled={savingOpportunity}>
                  {savingOpportunity ? 'Ukladam...' : 'Ulozit prilezitost'}
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
