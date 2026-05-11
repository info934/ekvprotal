import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Briefcase,
  Building2,
  CheckCircle,
  ClipboardList,
  Copy,
  ExternalLink,
  FileText,
  Loader2,
  Mail,
  MapPin,
  Phone,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Tag,
  User2,
  XCircle,
} from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { DPH_REGISTRY_URL, fetchAresSubjectByIco, getVatStatusLabel, normalizeDic, normalizeIco } from '@/lib/ares';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import PageHeader from '@/components/ui/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const emptyForm = {
  name: '',
  subject_kind: 'company',
  birth_date: '',
  ico: '',
  dic: '',
  vat_status: 'unknown',
  vat_payer: null,
  vat_checked_at: null,
  company_summary: '',
  registry_checked_at: null,
  registry_source: '',
  registry_snapshot: null,
  address: '',
  legal_form: '',
  contact_person: '',
  email: '',
  phone: '',
  note: '',
  type_id: '',
  region: '',
};

const subjectKindConfig = {
  person: { label: 'Fyzická osoba', icon: User2, className: 'bg-sky-50 text-sky-700 border-sky-200' },
  entrepreneur: { label: 'Podnikatel / OSVČ', icon: Briefcase, className: 'bg-amber-50 text-amber-700 border-amber-200' },
  company: { label: 'Firma', icon: Building2, className: 'bg-slate-50 text-slate-700 border-slate-200' },
};

const orderStatusConfig = {
  pending: { label: 'Čeká na potvrzení', icon: RefreshCw, className: 'bg-yellow-50 text-yellow-700 border-yellow-200' },
  confirmed: { label: 'Potvrzeno', icon: CheckCircle, className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  rejected: { label: 'Odmítnuto', icon: XCircle, className: 'bg-red-50 text-red-700 border-red-200' },
  expired: { label: 'Vypršelo', icon: AlertTriangle, className: 'bg-slate-50 text-slate-700 border-slate-200' },
};

const formatCurrency = (value) => `${Number(value || 0).toLocaleString('cs-CZ')} Kč`;

const formatDate = (value) => {
  if (!value) return '-';
  try {
    return format(parseISO(value), 'd.M.yyyy');
  } catch {
    return '-';
  }
};

const getSubjectKind = (subject) => subject?.subject_kind || (subject?.ico ? 'company' : 'person');

const getTypeLabel = (subject, subjectTypes) => {
  if (subject?.subject_types?.name) return subject.subject_types.name;
  return subjectTypes.find((type) => type.id === subject?.type_id)?.name || 'Bez typu';
};

const Field = ({ label, children, className }) => (
  <div className={cn('space-y-2', className)}>
    <Label className="text-xs font-semibold uppercase tracking-[0.02em] text-slate-500">{label}</Label>
    {children}
  </div>
);

const InfoTile = ({ icon: Icon, label, value, tone = 'default' }) => {
  const tones = {
    default: 'bg-white text-slate-700 border-slate-200',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
  };

  return (
    <Card className={cn('overflow-hidden shadow-sm', tones[tone])}>
      <CardContent className="flex min-w-0 items-center gap-3 p-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-white/70 ring-1 ring-black/5">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.02em] opacity-75">{label}</p>
          <p className="mt-1 truncate text-lg font-semibold text-slate-950">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
};

const StatusBadge = ({ status }) => {
  const config = orderStatusConfig[status] || { label: status || '-', icon: AlertTriangle, className: 'bg-slate-50 text-slate-700 border-slate-200' };
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn('inline-flex items-center gap-1 whitespace-nowrap', config.className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
};

const SubjectKindBadge = ({ kind }) => {
  const config = subjectKindConfig[kind] || subjectKindConfig.company;
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn('inline-flex items-center gap-1 whitespace-nowrap', config.className)}>
      <Icon className="h-3 w-3" />
      {config.label}
    </Badge>
  );
};

const VatStatusBadge = ({ status }) => {
  const styles = {
    payer: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    non_payer: 'bg-slate-50 text-slate-700 border-slate-200',
    identified_person: 'bg-amber-50 text-amber-700 border-amber-200',
    unknown: 'bg-blue-50 text-blue-700 border-blue-200',
  };

  return (
    <Badge variant="outline" className={cn('whitespace-nowrap', styles[status] || styles.unknown)}>
      {getVatStatusLabel(status)}
    </Badge>
  );
};

const RelatedProjectsTable = ({ projects, emptyText }) => (
  projects.length ? (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Projekt</TableHead>
          <TableHead>Stav</TableHead>
          <TableHead>Termín</TableHead>
          <TableHead className="text-right">Cena</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {projects.map((project) => (
          <TableRow key={project.id} className="cursor-pointer">
            <TableCell className="min-w-[260px]">
              <Link to={`/projects/${project.id}`} className="font-semibold text-slate-950 hover:text-primary">
                {project.name || 'Bez názvu'}
              </Link>
              {project.code && <div className="text-xs text-muted-foreground">{project.code}</div>}
            </TableCell>
            <TableCell>{project.status || '-'}</TableCell>
            <TableCell>{formatDate(project.completion_date)}</TableCell>
            <TableCell className="text-right font-semibold">{formatCurrency(project.price)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  ) : (
    <div className="rounded-lg border border-dashed bg-slate-50 p-8 text-center text-sm text-muted-foreground">{emptyText}</div>
  )
);

const SubjectDetail = () => {
  const { subjectId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { hasPermission } = useAuth();

  const [subject, setSubject] = useState(null);
  const [formData, setFormData] = useState(emptyForm);
  const [subjectTypes, setSubjectTypes] = useState([]);
  const [projectsAsSubcontractor, setProjectsAsSubcontractor] = useState([]);
  const [projectsAsInvestor, setProjectsAsInvestor] = useState([]);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingAres, setFetchingAres] = useState(false);
  const [aresInfo, setAresInfo] = useState(null);

  const canEdit = hasPermission('subjects', 'can_edit');
  const subjectKind = formData.subject_kind || getSubjectKind(subject);
  const isPerson = subjectKind === 'person';

  const applySubjectToForm = useCallback((data) => {
    const nextKind = getSubjectKind(data);
    setFormData({
      ...emptyForm,
      ...data,
      subject_kind: nextKind,
      birth_date: data.birth_date || '',
      ico: data.ico || '',
      dic: data.dic || '',
      vat_status: data.vat_status || 'unknown',
      vat_payer: data.vat_payer ?? null,
      vat_checked_at: data.vat_checked_at || null,
      company_summary: data.company_summary || '',
      registry_checked_at: data.registry_checked_at || null,
      registry_source: data.registry_source || '',
      registry_snapshot: data.registry_snapshot || null,
      type_id: data.type_id || '',
      note: data.note || '',
    });
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [subjectRes, typesRes, subcontractorRes, ordersRes] = await Promise.all([
        supabase.from('subjects').select('*, subject_types(name)').eq('id', subjectId).single(),
        supabase.from('subject_types').select('*').order('name'),
        supabase.from('project_subcontractors').select('*, projects(*)').eq('subject_id', subjectId),
        supabase.from('subcontractor_orders').select('*, projects(name)').eq('subject_id', subjectId).order('created_at', { ascending: false }),
      ]);

      if (subjectRes.error || !subjectRes.data) throw subjectRes.error || new Error('Subjekt nebyl nalezen.');

      setSubject(subjectRes.data);
      applySubjectToForm(subjectRes.data);
      setSubjectTypes(typesRes.data || []);
      setProjectsAsSubcontractor(subcontractorRes.data || []);
      setOrders(ordersRes.data || []);

      if (hasPermission('projects', 'can_read')) {
        const { data, error } = await supabase
          .from('projects')
          .select('*')
          .or(`investor_id.eq.${subjectId},client_id.eq.${subjectId}`)
          .order('created_at', { ascending: false });
        if (error) throw error;
        setProjectsAsInvestor(data || []);
      }
    } catch (error) {
      toast({ title: 'Chyba při načítání subjektu', description: error.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [applySubjectToForm, hasPermission, subjectId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const metrics = useMemo(() => {
    const investorValue = projectsAsInvestor.reduce((sum, project) => sum + Number(project.price || 0), 0);
    const subcontractorValue = projectsAsSubcontractor.reduce((sum, row) => sum + Number(row.price || 0), 0);
    return {
      investorProjects: projectsAsInvestor.length,
      subcontractorProjects: projectsAsSubcontractor.length,
      orders: orders.length,
      value: investorValue + subcontractorValue,
    };
  }, [orders.length, projectsAsInvestor, projectsAsSubcontractor]);

  const handleChange = (field, value) => {
    setFormData((current) => ({ ...current, [field]: value }));
  };

  const handleFetchAres = async () => {
    if (isPerson) return;
    if (normalizeIco(formData.ico).length !== 8) {
      toast({ title: 'Zadejte platné IČO s 8 číslicemi.', variant: 'destructive' });
      return;
    }

    setFetchingAres(true);
    try {
      const data = await fetchAresSubjectByIco(formData.ico);
      setAresInfo(data);
      setFormData((current) => ({
        ...current,
        subject_kind: current.subject_kind === 'person' ? 'entrepreneur' : current.subject_kind,
        name: data.name || current.name,
        ico: data.ico || current.ico,
        dic: data.dic || current.dic,
        vat_status: data.vat_status || current.vat_status || 'unknown',
        vat_payer: data.vat_payer,
        vat_checked_at: new Date().toISOString(),
        company_summary: data.company_summary || current.company_summary,
        registry_checked_at: new Date().toISOString(),
        registry_source: 'ARES',
        registry_snapshot: data.raw || null,
        address: data.address || current.address,
        legal_form: data.legal_form || current.legal_form,
        region: data.region || current.region,
      }));
      toast({ title: 'ARES data načtena', description: 'Zkontrolujte doplněné údaje a uložte změny.' });
    } catch (error) {
      toast({ title: 'ARES se nepodařilo načíst', description: error.message, variant: 'destructive' });
    } finally {
      setFetchingAres(false);
    }
  };

  const handleSave = async () => {
    if (!canEdit) return;
    if (!formData.name.trim()) {
      toast({ title: 'Doplňte název nebo jméno subjektu.', variant: 'destructive' });
      return;
    }
    if (!isPerson && normalizeIco(formData.ico).length !== 8) {
      toast({ title: 'U firmy nebo podnikatele je potřeba platné IČO.', variant: 'destructive' });
      return;
    }

    const payload = {
      name: formData.name.trim(),
      subject_kind: formData.subject_kind,
      birth_date: isPerson ? (formData.birth_date || null) : null,
      ico: isPerson ? null : normalizeIco(formData.ico),
      dic: isPerson ? null : (normalizeDic(formData.dic) || null),
      vat_status: isPerson ? 'unknown' : (formData.vat_status || 'unknown'),
      vat_payer: isPerson ? null : formData.vat_status === 'payer',
      vat_checked_at: isPerson ? null : formData.vat_checked_at,
      company_summary: isPerson ? null : (formData.company_summary?.trim() || null),
      registry_checked_at: isPerson ? null : formData.registry_checked_at,
      registry_source: isPerson ? null : (formData.registry_source || null),
      registry_snapshot: isPerson ? null : formData.registry_snapshot,
      address: formData.address?.trim() || null,
      legal_form: isPerson ? null : (formData.legal_form?.trim() || null),
      contact_person: formData.contact_person?.trim() || null,
      email: formData.email?.trim() || null,
      phone: formData.phone?.trim() || null,
      note: formData.note?.trim() || null,
      type_id: formData.type_id || null,
      region: formData.region?.trim() || null,
    };

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from('subjects')
        .update(payload)
        .eq('id', subjectId)
        .select('*, subject_types(name)')
        .single();
      if (error) throw error;

      setSubject(data);
      applySubjectToForm(data);
      toast({ title: 'Subjekt uložen' });
    } catch (error) {
      toast({ title: 'Subjekt se nepodařilo uložit', description: error.message, variant: 'destructive' });
    } finally {
      setSaving(false);
    }
  };

  const copyOrderLink = (token) => {
    const orderUrl = `${window.location.origin}/sub-order/${token}`;
    navigator.clipboard.writeText(orderUrl);
    toast({ title: 'Odkaz na objednávku zkopírován' });
  };

  if (loading) {
    return (
      <div className="app-page">
        <Card>
          <CardContent className="flex min-h-[360px] items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            Načítání subjektu...
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!subject) {
    return (
      <div className="app-page">
        <Card>
          <CardContent className="p-10 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-red-500" />
            <h1 className="text-2xl font-semibold">Subjekt nenalezen</h1>
            <p className="mt-2 text-muted-foreground">Požadovaný subjekt nebyl nalezen nebo byl smazán.</p>
            <Button className="mt-6" onClick={() => navigate('/subjects')}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Zpět na subjekty
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const KindIcon = (subjectKindConfig[subjectKind] || subjectKindConfig.company).icon;

  return (
    <div className="app-page">
      <div className="space-y-6">
        <PageHeader
          icon={KindIcon}
          title={subject.name || 'Subjekt'}
          description="Detail subjektu, kontaktní údaje, ARES informace a vazby na projekty a objednávky."
          meta={
            <div className="flex flex-wrap items-center gap-2">
              <SubjectKindBadge kind={subjectKind} />
              <Badge variant="outline" className="gap-1">
                <Tag className="h-3 w-3" />
                {getTypeLabel(subject, subjectTypes)}
              </Badge>
              {!isPerson && subject.ico && <Badge variant="secondary">IČO {subject.ico}</Badge>}
              {!isPerson && <VatStatusBadge status={formData.vat_status || subject.vat_status || 'unknown'} />}
            </div>
          }
          actions={
            <>
              <Button variant="outline" onClick={() => navigate('/subjects')}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                Zpět
              </Button>
              <Button variant="outline" onClick={fetchData}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Obnovit
              </Button>
              {canEdit && (
                <>
                  <Button variant="outline" onClick={() => applySubjectToForm(subject)}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Vrátit změny
                  </Button>
                  <Button onClick={handleSave} disabled={saving}>
                    {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                    Uložit
                  </Button>
                </>
              )}
            </>
          }
        />

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <InfoTile icon={Briefcase} label="Projekty jako klient" value={metrics.investorProjects} tone="blue" />
          <InfoTile icon={FileText} label="Subdodávky" value={metrics.subcontractorProjects} tone="amber" />
          <InfoTile icon={ClipboardList} label="Objednávky" value={metrics.orders} tone="green" />
          <InfoTile icon={Building2} label="Objem vazeb" value={formatCurrency(metrics.value)} />
        </div>

        <Tabs defaultValue="basic" className="space-y-4">
          <TabsList className="flex h-auto w-full flex-wrap justify-start rounded-lg border bg-slate-50 p-1">
            <TabsTrigger value="basic">Základní údaje</TabsTrigger>
            <TabsTrigger value="details">Další údaje</TabsTrigger>
            <TabsTrigger value="relations">Vazby</TabsTrigger>
            <TabsTrigger value="orders">Objednávky</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-4">
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
              <Card>
                <CardHeader>
                  <CardTitle>Základní údaje</CardTitle>
                  <CardDescription>Primární identita subjektu. U firmy a podnikatele lze doplnit údaje z ARES.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <Field label="Druh subjektu">
                    <Select value={formData.subject_kind} onValueChange={(value) => handleChange('subject_kind', value)} disabled={!canEdit}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(subjectKindConfig).map(([value, config]) => (
                          <SelectItem key={value} value={value}>{config.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  <Field label="Typ v adresáři">
                    <Select value={formData.type_id || 'none'} onValueChange={(value) => handleChange('type_id', value === 'none' ? '' : value)} disabled={!canEdit}>
                      <SelectTrigger><SelectValue placeholder="Bez typu" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Bez typu</SelectItem>
                        {subjectTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>

                  {!isPerson && (
                    <Field label="IČO">
                      <div className="flex gap-2">
                        <Input value={formData.ico || ''} onChange={(event) => handleChange('ico', normalizeIco(event.target.value))} disabled={!canEdit} maxLength={8} />
                        <Button type="button" variant="outline" onClick={handleFetchAres} disabled={!canEdit || fetchingAres}>
                          {fetchingAres ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                          ARES
                        </Button>
                      </div>
                    </Field>
                  )}

                  <Field label={isPerson ? 'Jméno a příjmení' : 'Název subjektu'} className={!isPerson ? '' : 'md:col-span-2'}>
                    <Input value={formData.name || ''} onChange={(event) => handleChange('name', event.target.value)} disabled={!canEdit} />
                  </Field>

                  {isPerson ? (
                    <Field label="Datum narození">
                      <Input type="date" value={formData.birth_date || ''} onChange={(event) => handleChange('birth_date', event.target.value)} disabled={!canEdit} />
                    </Field>
                  ) : (
                    <>
                      <Field label="DIČ">
                        <Input value={formData.dic || ''} onChange={(event) => handleChange('dic', normalizeDic(event.target.value))} disabled={!canEdit} />
                      </Field>
                      <Field label="Právní forma">
                        <Input value={formData.legal_form || ''} onChange={(event) => handleChange('legal_form', event.target.value)} disabled={!canEdit} />
                      </Field>
                      <Field label="DPH status">
                        <Select value={formData.vat_status || 'unknown'} onValueChange={(value) => {
                          handleChange('vat_status', value);
                          handleChange('vat_payer', value === 'payer');
                          handleChange('vat_checked_at', new Date().toISOString());
                        }} disabled={!canEdit}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unknown">{getVatStatusLabel('unknown')}</SelectItem>
                            <SelectItem value="payer">{getVatStatusLabel('payer')}</SelectItem>
                            <SelectItem value="non_payer">{getVatStatusLabel('non_payer')}</SelectItem>
                            <SelectItem value="identified_person">{getVatStatusLabel('identified_person')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                      <Field label="Registr DPH">
                        <Button type="button" variant="outline" className="w-full justify-start" onClick={() => window.open(DPH_REGISTRY_URL, '_blank', 'noopener,noreferrer')}>
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Otevřít kontrolu
                        </Button>
                      </Field>
                    </>
                  )}

                  <Field label="Kontaktní osoba">
                    <Input value={formData.contact_person || ''} onChange={(event) => handleChange('contact_person', event.target.value)} disabled={!canEdit} />
                  </Field>
                  <Field label="E-mail">
                    <Input type="email" value={formData.email || ''} onChange={(event) => handleChange('email', event.target.value)} disabled={!canEdit} />
                  </Field>
                  <Field label="Telefon">
                    <Input type="tel" value={formData.phone || ''} onChange={(event) => handleChange('phone', event.target.value)} disabled={!canEdit} />
                  </Field>
                  <Field label="Kraj">
                    <Input value={formData.region || ''} onChange={(event) => handleChange('region', event.target.value)} disabled={!canEdit} />
                  </Field>
                  <Field label="Adresa" className="md:col-span-2">
                    <Input value={formData.address || ''} onChange={(event) => handleChange('address', event.target.value)} disabled={!canEdit} />
                  </Field>
                  {!isPerson && (
                    <Field label="Summary o firmě" className="md:col-span-2">
                      <Textarea
                        value={formData.company_summary || ''}
                        onChange={(event) => handleChange('company_summary', event.target.value)}
                        disabled={!canEdit}
                        rows={5}
                        placeholder="Stručné veřejné shrnutí firmy, oboru, registrů a DPH statusu."
                      />
                    </Field>
                  )}
                </CardContent>
              </Card>

              <div className="space-y-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Rychlé kontakty</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{formData.email || 'E-mail není vyplněn'}</span>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <Phone className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{formData.phone || 'Telefon není vyplněn'}</span>
                    </div>
                    <div className="flex min-w-0 items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="break-words">{formData.address || 'Adresa není vyplněna'}</span>
                    </div>
                  </CardContent>
                </Card>

                {!isPerson && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">ARES doplnění</CardTitle>
                      <CardDescription>Veřejné údaje se načítají ručně podle IČO.</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      {aresInfo ? (
                        <>
                          <div>
                            <p className="text-xs font-semibold uppercase text-muted-foreground">DPH</p>
                            <div className="mt-1 flex flex-wrap items-center gap-2">
                              <VatStatusBadge status={aresInfo.vat_status || 'unknown'} />
                              {formData.vat_checked_at && <span className="text-xs text-muted-foreground">ověřeno {formatDate(formData.vat_checked_at)}</span>}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-muted-foreground">Obec / okres</p>
                            <p className="font-medium">{[aresInfo.municipality, aresInfo.district].filter(Boolean).join(' / ') || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-muted-foreground">Finanční úřad</p>
                            <p className="font-medium">{aresInfo.financial_office || '-'}</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase text-muted-foreground">CZ-NACE</p>
                            <p className="break-words font-medium">{aresInfo.nace?.length ? aresInfo.nace.join(', ') : '-'}</p>
                          </div>
                        </>
                      ) : (
                        <div className="rounded-lg border border-dashed bg-slate-50 p-4 text-muted-foreground">
                          Zadejte IČO a stiskněte ARES. Načtené údaje se zobrazí tady a vybraná pole se doplní do formuláře.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="details" className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <Card>
              <CardHeader>
                <CardTitle>Interní poznámka</CardTitle>
                <CardDescription>Poznámka k subjektu pro obchod, projekci nebo realizace.</CardDescription>
              </CardHeader>
              <CardContent>
                <Textarea value={formData.note || ''} onChange={(event) => handleChange('note', event.target.value)} disabled={!canEdit} rows={10} placeholder="Doplňte důležité informace, domluvy nebo rizika..." />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Identifikace</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-3 border-b pb-2">
                  <span className="text-muted-foreground">Druh</span>
                  <SubjectKindBadge kind={subjectKind} />
                </div>
                <div className="flex items-center justify-between gap-3 border-b pb-2">
                  <span className="text-muted-foreground">Typ</span>
                  <span className="font-medium">{getTypeLabel(subject, subjectTypes)}</span>
                </div>
                {!isPerson && (
                  <>
                    <div className="flex items-center justify-between gap-3 border-b pb-2">
                      <span className="text-muted-foreground">IČO</span>
                      <span className="font-medium">{formData.ico || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-b pb-2">
                      <span className="text-muted-foreground">DIČ</span>
                      <span className="font-medium">{formData.dic || '-'}</span>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-b pb-2">
                      <span className="text-muted-foreground">DPH</span>
                      <VatStatusBadge status={formData.vat_status || 'unknown'} />
                    </div>
                    <div className="flex items-center justify-between gap-3 border-b pb-2">
                      <span className="text-muted-foreground">Registry</span>
                      <span className="text-right font-medium">{formData.registry_source || '-'}</span>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="relations" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Projekty jako klient / investor</CardTitle>
                <CardDescription>Projekty, kde je subjekt vedený jako investor nebo klient.</CardDescription>
              </CardHeader>
              <CardContent>
                <RelatedProjectsTable projects={projectsAsInvestor} emptyText="Subjekt zatím není navázaný na žádný projekt jako klient nebo investor." />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Subdodavatelské vazby</CardTitle>
                <CardDescription>Projekty, kde je subjekt vedený jako subdodavatel.</CardDescription>
              </CardHeader>
              <CardContent>
                {projectsAsSubcontractor.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Projekt</TableHead>
                        <TableHead>Rozsah</TableHead>
                        <TableHead className="text-right">Cena</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {projectsAsSubcontractor.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell className="min-w-[260px]">
                            <Link to={`/projects/${row.projects?.id}`} className="font-semibold text-slate-950 hover:text-primary">
                              {row.projects?.name || 'Neznámý projekt'}
                            </Link>
                          </TableCell>
                          <TableCell className="min-w-[260px]">{row.scope_of_work || '-'}</TableCell>
                          <TableCell className="text-right font-semibold">{formatCurrency(row.price)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-lg border border-dashed bg-slate-50 p-8 text-center text-sm text-muted-foreground">Subjekt zatím není použitý jako subdodavatel.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="orders">
            <Card>
              <CardHeader>
                <CardTitle>Objednávky</CardTitle>
                <CardDescription>Subdodavatelské objednávky navázané na tento subjekt.</CardDescription>
              </CardHeader>
              <CardContent>
                {orders.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Projekt</TableHead>
                        <TableHead>Vytvořeno</TableHead>
                        <TableHead>Stav</TableHead>
                        <TableHead className="text-right">Akce</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orders.map((order) => (
                        <TableRow key={order.id}>
                          <TableCell className="min-w-[260px]">
                            <Link to={`/projects/${order.project_id}`} className="font-semibold text-slate-950 hover:text-primary">
                              {order.projects?.name || 'Neznámý projekt'}
                            </Link>
                          </TableCell>
                          <TableCell>{formatDate(order.created_at)}</TableCell>
                          <TableCell><StatusBadge status={order.status} /></TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              {order.unique_token && (
                                <>
                                  <Button variant="ghost" size="icon" onClick={() => copyOrderLink(order.unique_token)} title="Kopírovat odkaz">
                                    <Copy className="h-4 w-4" />
                                  </Button>
                                  <Button variant="ghost" size="icon" onClick={() => window.open(`/sub-order/${order.unique_token}`, '_blank')} title="Otevřít objednávku">
                                    <ExternalLink className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <div className="rounded-lg border border-dashed bg-slate-50 p-8 text-center text-sm text-muted-foreground">Pro tento subjekt zatím nejsou objednávky.</div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
};

export default SubjectDetail;
