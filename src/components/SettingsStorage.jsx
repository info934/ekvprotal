import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, CheckCircle2, Cloud, ExternalLink, FileSignature, FolderTree, RefreshCw, Save, TestTube2 } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import {
  invalidateStorageConnectionCache,
  isStorageConfigMissingError,
  storageProviderLabels,
} from '@/lib/documentStorageService';
import { getGoogleDriveAuthorizationUrl, getGoogleDriveEsignStatus } from '@/lib/googleDriveEsignService';
import { invokeWithTimeout } from '@/lib/requestControl';

const TARGETS = [
  { key: 'project', label: 'Projekty', description: 'Projektová dokumentace a předání' },
  { key: 'realizace', label: 'Realizace', description: 'Realizační dokumentace, náklady a předání' },
  { key: 'service', label: 'Servis', description: 'Servisní případy uvnitř realizací a samostatný servis' },
  { key: 'invoice', label: 'Vedení', description: 'Obchodní smlouvy a odběratelské faktury' },
];

const DEFAULT_STRUCTURES = {
  project: ['00_Admin', '01_Smlouvy', '02_Dokumentace', '03_Predani', '04_Fakturace'],
  realizace: ['00_Admin', '01_Smlouvy_a_objednavky', '02_Technicka_dokumentace', '03_Harmonogram_a_KD', '04_Naklady/Faktury', '05_Fotodokumentace', '06_Revize_a_zkousky', '07_Predani', '08_Fakturace', 'Servis'],
  service: ['00_Admin', '01_Fotodokumentace', '02_Servisni_protokoly', '03_Predavaci_protokoly', '04_Komunikace', '05_Material_a_mereni'],
  invoice: [],
};

const emptyTarget = {
  siteId: '',
  driveId: '',
  rootFolderId: '',
  rootFolderPath: '',
  structure: [],
  projectFolderName: '',
  organizeProjectsByYear: false,
  realizationFolderName: '',
  organizeRealizationsByYear: false,
  activeFolderName: '',
  completedFolderName: '',
  completedStatuses: [],
  costInvoiceFolderPath: '',
  commercialContractFolderPath: '',
  customerInvoiceFolderPath: '',
};

const createDefaultTargets = () => Object.fromEntries(TARGETS.map(({ key }) => [
  key,
  {
    ...emptyTarget,
    structure: [...(DEFAULT_STRUCTURES[key] || [])],
    projectFolderName: key === 'project' ? 'Projekty' : '',
    organizeProjectsByYear: key === 'project',
    realizationFolderName: '',
    organizeRealizationsByYear: key === 'realizace',
    activeFolderName: ['project', 'realizace'].includes(key) ? 'Aktivni' : '',
    completedFolderName: ['project', 'realizace'].includes(key) ? 'Hotovo' : '',
    completedStatuses: key === 'project' ? ['closed'] : key === 'realizace' ? ['Dokončeno', 'Předáno'] : [],
    costInvoiceFolderPath: key === 'project'
      ? '04_Fakturace/Nakladove faktury'
      : key === 'realizace'
        ? '02_Naklady/Faktury'
        : '',
    commercialContractFolderPath: key === 'invoice' ? 'Obchodni smlouvy' : '',
    customerInvoiceFolderPath: key === 'invoice' ? 'Odberatelske faktury' : '',
  },
]));

const defaultForm = {
  provider: 'sharepoint',
  name: 'EKV SharePoint',
  status: 'active',
  tenantId: '',
  notes: '',
  targets: createDefaultTargets(),
};

const providerHelp = {
  supabase: 'Soubory zůstávají v Supabase Storage.',
  sharepoint: 'Přístupové údaje jsou bezpečně uložené pouze v Supabase Edge Function secrets.',
  google_drive: 'Google Drive zatím není aktivovaný.',
};

const toForm = (connection) => {
  const config = connection?.config || {};
  return {
    provider: connection?.provider || defaultForm.provider,
    name: connection?.name || storageProviderLabels[connection?.provider] || defaultForm.name,
    status: connection?.status || defaultForm.status,
    tenantId: config.tenantId || '',
    notes: config.notes || '',
    targets: Object.fromEntries(TARGETS.map(({ key }) => [
      key,
      {
        ...emptyTarget,
        ...(config.targets?.[key] || {}),
        projectFolderName: key === 'project'
          ? (Object.prototype.hasOwnProperty.call(config.targets?.[key] || {}, 'projectFolderName')
            ? config.targets[key].projectFolderName
            : 'Projekty')
          : '',
        organizeProjectsByYear: key === 'project'
          ? config.targets?.[key]?.organizeProjectsByYear !== false
          : false,
        realizationFolderName: key === 'realizace' ? (config.targets?.[key]?.realizationFolderName || '') : '',
        organizeRealizationsByYear: key === 'realizace' ? config.targets?.[key]?.organizeRealizationsByYear !== false : false,
        activeFolderName: ['project', 'realizace'].includes(key)
          ? (config.targets?.[key]?.activeFolderName || 'Aktivni')
          : '',
        completedFolderName: ['project', 'realizace'].includes(key)
          ? (config.targets?.[key]?.completedFolderName || 'Hotovo')
          : '',
        completedStatuses: ['project', 'realizace'].includes(key) && Array.isArray(config.targets?.[key]?.completedStatuses) && config.targets[key].completedStatuses.length
          ? config.targets[key].completedStatuses
          : (key === 'project' ? ['closed'] : key === 'realizace' ? ['Dokončeno', 'Předáno'] : []),
        costInvoiceFolderPath: key === 'project'
          ? (config.targets?.[key]?.costInvoiceFolderPath || '04_Fakturace/Nakladove faktury')
          : key === 'realizace'
            ? (config.targets?.[key]?.costInvoiceFolderPath || '02_Naklady/Faktury')
            : '',
        commercialContractFolderPath: key === 'invoice'
          ? (config.targets?.[key]?.commercialContractFolderPath || 'Obchodni smlouvy')
          : '',
        customerInvoiceFolderPath: key === 'invoice'
          ? (config.targets?.[key]?.customerInvoiceFolderPath || 'Odberatelske faktury')
          : '',
        structure: Array.isArray(config.targets?.[key]?.structure)
          ? config.targets[key].structure
          : [...(DEFAULT_STRUCTURES[key] || [])],
      },
    ])),
  };
};

const SettingsStorage = () => {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const [connections, setConnections] = useState([]);
  const [selectedId, setSelectedId] = useState('new');
  const [form, setForm] = useState(defaultForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schemaMissing, setSchemaMissing] = useState(false);
  const [testingTarget, setTestingTarget] = useState(null);
  const [testResults, setTestResults] = useState({});
  const [googleDrive, setGoogleDrive] = useState({ loading: true, connected: false, connection: null });
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === selectedId),
    [connections, selectedId],
  );

  const fetchConnections = async () => {
    if (!hasPermission('settings', 'can_admin')) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await supabase
      .from('document_storage_connections')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (error) {
      if (isStorageConfigMissingError(error)) setSchemaMissing(true);
      else toast({ title: 'Chyba při načítání úložiště', description: error.message, variant: 'destructive' });
      setLoading(false);
      return;
    }

    setSchemaMissing(false);
    setConnections(data || []);
    const active = data?.find((connection) => connection.is_default) || data?.[0];
    if (active) {
      setSelectedId(active.id);
      setForm(toForm(active));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  const refreshGoogleDrive = async () => {
    if (!hasPermission('settings', 'can_admin')) return;
    setGoogleDrive((current) => ({ ...current, loading: true }));
    try {
      const status = await getGoogleDriveEsignStatus();
      setGoogleDrive({ ...status, loading: false });
    } catch (error) {
      setGoogleDrive({ loading: false, connected: false, connection: null, error: error.message });
    }
  };

  useEffect(() => {
    refreshGoogleDrive();
    const result = new URLSearchParams(window.location.search).get('googleDrive');
    if (result === 'connected') toast({ title: 'Google Drive byl propojen', description: 'Podpisový PoC je připravený k použití.' });
    if (result && result !== 'connected') toast({ title: 'Google Drive se nepodařilo propojit', description: result, variant: 'destructive' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPermission]);

  const connectGoogleDrive = async () => {
    setConnectingGoogle(true);
    try {
      const result = await getGoogleDriveAuthorizationUrl();
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      toast({ title: 'Propojení nelze zahájit', description: error.message, variant: 'destructive' });
      setConnectingGoogle(false);
    }
  };

  useEffect(() => {
    if (selectedId === 'new') setForm(defaultForm);
    else if (selectedConnection) setForm(toForm(selectedConnection));
    setTestResults({});
  }, [selectedConnection, selectedId]);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));
  const updateTarget = (targetKey, field, value) => setForm((current) => ({
    ...current,
    targets: {
      ...current.targets,
      [targetKey]: { ...current.targets[targetKey], [field]: value },
    },
  }));

  const updateTargetStructure = (targetKey, value) => {
    const structure = value
      .split('\n')
      .map((folder) => folder.trim().replace(/^\/+|\/+$/g, ''))
      .filter((folder, index, folders) => folder && folders.indexOf(folder) === index);
    updateTarget(targetKey, 'structure', structure);
  };

  const saveConnection = async () => {
    if (!hasPermission('settings', 'can_admin')) return;
    setSaving(true);

    const targets = Object.fromEntries(TARGETS.map(({ key }) => [key, {
      ...form.targets[key],
      siteId: form.targets[key].siteId.trim(),
      driveId: form.targets[key].driveId.trim(),
      rootFolderId: form.targets[key].rootFolderId.trim(),
      rootFolderPath: form.targets[key].rootFolderPath.trim(),
      structure: form.targets[key].structure || [],
      projectFolderName: key === 'project'
        ? String(form.targets[key].projectFolderName ?? '').trim().replace(/^\/+|\/+$/g, '')
        : '',
      organizeProjectsByYear: key === 'project' ? form.targets[key].organizeProjectsByYear !== false : false,
      realizationFolderName: key === 'realizace'
        ? String(form.targets[key].realizationFolderName ?? '').trim().replace(/^\/+|\/+$/g, '')
        : '',
      organizeRealizationsByYear: key === 'realizace' ? form.targets[key].organizeRealizationsByYear !== false : false,
      activeFolderName: ['project', 'realizace'].includes(key)
        ? String(form.targets[key].activeFolderName || 'Aktivni').trim().replace(/^\/+|\/+$/g, '')
        : '',
      completedFolderName: ['project', 'realizace'].includes(key)
        ? String(form.targets[key].completedFolderName || 'Hotovo').trim().replace(/^\/+|\/+$/g, '')
        : '',
      completedStatuses: ['project', 'realizace'].includes(key)
        ? (form.targets[key].completedStatuses?.length ? form.targets[key].completedStatuses : key === 'project' ? ['closed'] : ['Dokončeno', 'Předáno'])
        : [],
      costInvoiceFolderPath: key === 'project'
        ? String(form.targets[key].costInvoiceFolderPath || '04_Fakturace/Nakladove faktury').trim().replace(/^\/+|\/+$/g, '')
        : key === 'realizace'
          ? String(form.targets[key].costInvoiceFolderPath || '02_Naklady/Faktury').trim().replace(/^\/+|\/+$/g, '')
          : '',
      commercialContractFolderPath: key === 'invoice'
        ? String(form.targets[key].commercialContractFolderPath || 'Obchodni smlouvy').trim().replace(/^\/+|\/+$/g, '')
        : '',
      customerInvoiceFolderPath: key === 'invoice'
        ? String(form.targets[key].customerInvoiceFolderPath || 'Odberatelske faktury').trim().replace(/^\/+|\/+$/g, '')
        : '',
    }]));
    targets.product = { ...targets.project, rootFolderPath: 'EKVPortal' };

    const payload = {
      provider: form.provider,
      name: form.name.trim() || storageProviderLabels[form.provider],
      status: form.status,
      config: {
        tenantId: form.tenantId.trim(),
        targets,
        notes: form.notes.trim(),
      },
    };

    const { data, error } = await supabase.rpc('save_default_document_storage_connection', {
      p_connection_id: selectedId === 'new' ? null : selectedId,
      p_payload: payload,
    });

    if (error) {
      toast({ title: 'Chyba při ukládání úložiště', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    toast({ title: 'Nastavení SharePointu bylo uloženo' });
    invalidateStorageConnectionCache();
    setSelectedId(data.id);
    await fetchConnections();
    setSaving(false);
  };

  const testConnection = async (entityType) => {
    if (selectedId === 'new') {
      toast({ title: 'Nejprve konfiguraci uložte', variant: 'warning' });
      return;
    }
    setTestingTarget(entityType);
    try {
      const { data, error } = await invokeWithTimeout(supabase, 'document-storage', {
        body: { action: 'testConnection', provider: form.provider, connectionId: selectedId, entityType },
      });
      const success = !error && data?.success;
      setTestResults((current) => ({ ...current, [entityType]: success ? 'success' : 'error' }));
      toast({
        title: success ? 'Spojení funguje' : 'Spojení se nezdařilo',
        description: success ? `${data.drive?.name || 'SharePoint'} je dostupný.` : (data?.error || error?.message),
        variant: success ? 'default' : 'destructive',
      });
    } catch (error) {
      setTestResults((current) => ({ ...current, [entityType]: 'error' }));
      toast({ title: 'Spojení se nezdařilo', description: error.message, variant: 'destructive' });
    } finally {
      setTestingTarget(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Cloud}
        title="Úložiště dokumentů"
        description="Oddělené SharePoint struktury pro projekty, realizace a účetní faktury."
      />

      {schemaMissing && (
        <Alert>
          <FolderTree className="h-4 w-4" />
          <AlertTitle>Chybí databázová migrace</AlertTitle>
          <AlertDescription>Databáze zatím neobsahuje tabulky pro externí úložiště.</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <CardTitle>Aktivní připojení</CardTitle>
              <CardDescription>Tajný klíč se nikdy nezobrazuje ani neukládá do této stránky.</CardDescription>
            </div>
            <Badge variant={form.status === 'active' ? 'success' : 'secondary'}>{form.status === 'active' ? 'Aktivní' : form.status}</Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 lg:col-span-2">
              <Label>Konfigurace</Label>
              <Select value={selectedId} onValueChange={setSelectedId} disabled={loading || schemaMissing}>
                <SelectTrigger><SelectValue placeholder="Vyberte konfiguraci" /></SelectTrigger>
                <SelectContent>
                  {connections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.name} {connection.is_default ? '(výchozí)' : ''}
                    </SelectItem>
                  ))}
                  <SelectItem value="new">Nová konfigurace</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={form.provider} onValueChange={(value) => updateForm('provider', value)} disabled={loading || schemaMissing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="sharepoint">SharePoint</SelectItem>
                  <SelectItem value="supabase">Supabase Storage</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => updateForm('status', value)} disabled={loading || schemaMissing}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktivní</SelectItem>
                  <SelectItem value="draft">Rozpracované</SelectItem>
                  <SelectItem value="disabled">Vypnuté</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="storageName">Název připojení</Label>
              <Input id="storageName" value={form.name} onChange={(event) => updateForm('name', event.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="tenantId">Tenant ID</Label>
              <Input id="tenantId" value={form.tenantId} onChange={(event) => updateForm('tenantId', event.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{providerHelp[form.provider]}</p>

          {form.provider === 'sharepoint' && (
            <div className="grid gap-4 xl:grid-cols-3">
              {TARGETS.map((target) => {
                const result = testResults[target.key];
                return (
                  <div key={target.key} className="rounded-lg border bg-slate-50/60 p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div>
                        <h3 className="font-semibold text-slate-900">{target.label}</h3>
                        <p className="text-xs text-muted-foreground">{target.description}</p>
                      </div>
                      {result === 'success' && <CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                      {result === 'error' && <AlertCircle className="h-5 w-5 text-red-600" />}
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor={`${target.key}-site`}>Site ID</Label>
                        <Input id={`${target.key}-site`} value={form.targets[target.key].siteId} onChange={(event) => updateTarget(target.key, 'siteId', event.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${target.key}-drive`}>Drive ID</Label>
                        <Input id={`${target.key}-drive`} value={form.targets[target.key].driveId} onChange={(event) => updateTarget(target.key, 'driveId', event.target.value)} />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`${target.key}-root`}>Kořenová cesta</Label>
                        <Input id={`${target.key}-root`} value={form.targets[target.key].rootFolderPath} onChange={(event) => updateTarget(target.key, 'rootFolderPath', event.target.value)} placeholder="EKVPortal" />
                      </div>
                      {target.key === 'project' && (
                        <div className="space-y-4 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                          <div>
                            <Label>Třídění projektových složek</Label>
                            <p className="mt-1 text-xs text-muted-foreground">
                              Nové i synchronizované projekty se zařadí podle roku a stavu. Přesun zachová obsah i odkazy na soubory.
                            </p>
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${target.key}-container`}>Hlavní složka projektů</Label>
                            <Input
                              id={`${target.key}-container`}
                              value={form.targets[target.key].projectFolderName || ''}
                              onChange={(event) => updateTarget(target.key, 'projectFolderName', event.target.value)}
                              placeholder="Projekty"
                            />
                            <p className="text-xs text-muted-foreground">Ponechte prázdné, pokud je připojená knihovna určená jen pro projekty.</p>
                          </div>
                          <label className="flex min-h-11 items-center justify-between gap-3 rounded-md border bg-white px-3 text-sm font-medium">
                            Třídit projekty do složek podle roku
                            <Switch
                              checked={form.targets[target.key].organizeProjectsByYear !== false}
                              onCheckedChange={(checked) => updateTarget(target.key, 'organizeProjectsByYear', checked)}
                            />
                          </label>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-1.5">
                              <Label htmlFor={`${target.key}-active-folder`}>Rozpracované projekty</Label>
                              <Input
                                id={`${target.key}-active-folder`}
                                value={form.targets[target.key].activeFolderName || ''}
                                onChange={(event) => updateTarget(target.key, 'activeFolderName', event.target.value)}
                                placeholder="Aktivni"
                              />
                            </div>
                            <div className="space-y-1.5">
                              <Label htmlFor={`${target.key}-completed-folder`}>Dokončené projekty</Label>
                              <Input
                                id={`${target.key}-completed-folder`}
                                value={form.targets[target.key].completedFolderName || ''}
                                onChange={(event) => updateTarget(target.key, 'completedFolderName', event.target.value)}
                                placeholder="Hotovo"
                              />
                            </div>
                          </div>
                          <div className="space-y-1.5">
                            <Label>Stav pro přesun do Hotovo</Label>
                            <Select
                              value={form.targets[target.key].completedStatuses?.[0] || 'closed'}
                              onValueChange={(value) => updateTarget(target.key, 'completedStatuses', [value])}
                            >
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="ready_for_delivery">Připraveno k dodání</SelectItem>
                                <SelectItem value="delivered">Dodáno</SelectItem>
                                <SelectItem value="closed">Uzavřeno</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="rounded-md bg-white px-3 py-2 font-mono text-[11px] leading-5 text-slate-600">
                            {[form.targets[target.key].rootFolderPath, form.targets[target.key].projectFolderName, form.targets[target.key].organizeProjectsByYear === false ? '' : new Date().getFullYear(), form.targets[target.key].activeFolderName || 'Aktivni', 'OP-26-001 - Název projektu'].filter((segment) => String(segment || '').trim()).join(' / ')}
                          </div>
                        </div>
                      )}
                      {target.key !== 'invoice' && (
                        <div className="space-y-1.5">
                          <Label htmlFor={`${target.key}-structure`}>Struktura nových složek</Label>
                          <Textarea
                            id={`${target.key}-structure`}
                            rows={7}
                            value={(form.targets[target.key].structure || []).join('\n')}
                            onChange={(event) => updateTargetStructure(target.key, event.target.value)}
                            placeholder={'00_Admin\n01_Smlouvy\n02_Dokumentace/01_Vstupy'}
                            className="font-mono text-xs"
                          />
                          <p className="text-xs text-muted-foreground">
                            Jedna složka na řádek. Lomítkem vytvoříte podsložku. Změna se použije při přípravě nových projektů a realizací; existující složky se nemažou.
                          </p>
                        </div>
                      )}
                      {target.key !== 'invoice' && (
                        <div className="space-y-1.5">
                          <Label htmlFor={`${target.key}-cost-invoices`}>Složka nákladových faktur</Label>
                          <Input
                            id={`${target.key}-cost-invoices`}
                            value={form.targets[target.key].costInvoiceFolderPath || ''}
                            onChange={(event) => updateTarget(target.key, 'costInvoiceFolderPath', event.target.value)}
                            placeholder={target.key === 'project' ? '04_Fakturace/Nakladove faktury' : '02_Naklady/Faktury'}
                          />
                          <p className="text-xs text-muted-foreground">
                            Originály nákladových faktur se ukládají přímo do složky konkrétního projektu nebo realizace.
                          </p>
                        </div>
                      )}
                      {target.key === 'invoice' && (
                        <div className="space-y-4">
                          <div className="space-y-1.5">
                            <Label htmlFor={`${target.key}-commercial-contracts`}>Složka obchodních smluv</Label>
                            <Input
                              id={`${target.key}-commercial-contracts`}
                              value={form.targets[target.key].commercialContractFolderPath || ''}
                              onChange={(event) => updateTarget(target.key, 'commercialContractFolderPath', event.target.value)}
                              placeholder="Obchodni smlouvy"
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label htmlFor={`${target.key}-customer-invoices`}>Složka odběratelských faktur</Label>
                            <Input
                              id={`${target.key}-customer-invoices`}
                              value={form.targets[target.key].customerInvoiceFolderPath || ''}
                              onChange={(event) => updateTarget(target.key, 'customerInvoiceFolderPath', event.target.value)}
                              placeholder="Odberatelske faktury"
                            />
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Centrální úložiště Vedení je určené pouze pro obchodní smlouvy a odběratelské faktury spojené se zakázkou.
                          </p>
                        </div>
                      )}
                      <Button type="button" variant="outline" size="sm" className="w-full" onClick={() => testConnection(target.key)} disabled={testingTarget === target.key || selectedId === 'new'}>
                        <TestTube2 className="mr-2 h-4 w-4" />
                        {testingTarget === target.key ? 'Ověřuji...' : 'Otestovat přístup'}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="storageNotes">Poznámky</Label>
            <Textarea id="storageNotes" rows={2} value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveConnection} disabled={loading || saving || schemaMissing}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Ukládám...' : 'Uložit jako výchozí'}
            </Button>
            <Button variant="outline" onClick={fetchConnections} disabled={loading || saving}>
              <RefreshCw className="mr-2 h-4 w-4" /> Obnovit
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="rounded-lg border border-blue-100 bg-blue-50 p-2 text-blue-700"><FileSignature className="h-5 w-5" /></div>
              <div>
                <CardTitle>Google Drive eSignature PoC</CardTitle>
                <CardDescription>
                  Portál připraví neměnné PDF v Google Drive. Umístění podpisových polí a odeslání proběhne ručně v Google Drive.
                </CardDescription>
              </div>
            </div>
            <Badge variant={googleDrive.connected ? 'success' : 'secondary'}>
              {googleDrive.loading ? 'Ověřuji...' : googleDrive.connected ? (googleDrive.shared ? 'Firemní účet' : 'Propojeno') : 'Nepřipojeno'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Kontrolovaný pilotní režim</AlertTitle>
            <AlertDescription>
              Soubory mají prefix TEST-. SharePoint zůstává hlavním úložištěm a připojený Google účet mohou pro podpisové žádosti používat všichni administrátoři.
            </AlertDescription>
          </Alert>
          <div className="grid gap-3 rounded-lg border bg-slate-50/70 p-4 sm:grid-cols-3">
            <div><div className="text-xs font-medium uppercase text-slate-500">Google účet</div><div className="mt-1 text-sm font-semibold text-slate-900">{googleDrive.connection?.google_email || 'Není propojen'}</div></div>
            <div><div className="text-xs font-medium uppercase text-slate-500">Cílová složka</div><div className="mt-1 text-sm font-semibold text-slate-900">EKVPortal-eSignature-POC / K podpisu</div></div>
            <div><div className="text-xs font-medium uppercase text-slate-500">Rozsah</div><div className="mt-1 text-sm font-semibold text-slate-900">Pouze soubory vytvořené portálem</div></div>
          </div>
          {googleDrive.error && <p className="text-sm text-red-600">{googleDrive.error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={connectGoogleDrive} disabled={connectingGoogle || googleDrive.loading}>
              <ExternalLink className="mr-2 h-4 w-4" />{googleDrive.connected ? 'Znovu propojit účet' : 'Propojit Google účet'}
            </Button>
            <Button variant="outline" onClick={refreshGoogleDrive} disabled={googleDrive.loading}>
              <RefreshCw className={`mr-2 h-4 w-4 ${googleDrive.loading ? 'animate-spin' : ''}`} />Obnovit stav
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsStorage;
