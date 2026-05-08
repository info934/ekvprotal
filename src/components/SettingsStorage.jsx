import React, { useEffect, useMemo, useState } from 'react';
import { Cloud, FolderTree, RefreshCw, Save } from 'lucide-react';
import PageHeader from '@/components/ui/page-header';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { isStorageConfigMissingError, storageProviderLabels } from '@/lib/documentStorageService';

const defaultForm = {
  provider: 'supabase',
  name: 'Supabase Storage',
  status: 'active',
  rootFolderPath: '',
  tenantId: '',
  siteId: '',
  driveId: '',
  rootFolderId: '',
  notes: '',
};

const providerHelp = {
  supabase: 'Soucasne uloziste v Supabase Storage zustane aktivni bez dalsi konfigurace.',
  sharepoint: 'Pro produkcni provoz bude Edge Function potrebovat Microsoft Graph OAuth credentials a cilovy site/drive.',
  google_drive: 'Pro produkcni provoz bude Edge Function potrebovat Google OAuth credentials a cilovy Shared Drive nebo root folder.',
};

const toForm = (connection) => {
  const config = connection?.config || {};
  return {
    provider: connection?.provider || defaultForm.provider,
    name: connection?.name || storageProviderLabels[connection?.provider] || defaultForm.name,
    status: connection?.status || defaultForm.status,
    rootFolderPath: config.rootFolderPath || '',
    tenantId: config.tenantId || '',
    siteId: config.siteId || '',
    driveId: config.driveId || '',
    rootFolderId: config.rootFolderId || '',
    notes: config.notes || '',
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

  const selectedConnection = useMemo(
    () => connections.find((connection) => connection.id === selectedId),
    [connections, selectedId]
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
      if (isStorageConfigMissingError(error)) {
        setSchemaMissing(true);
      } else {
        toast({ title: 'Chyba pri nacitani uloziste', description: error.message, variant: 'destructive' });
      }
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

  useEffect(() => {
    if (selectedId === 'new') {
      setForm(defaultForm);
      return;
    }
    if (selectedConnection) setForm(toForm(selectedConnection));
  }, [selectedConnection, selectedId]);

  const updateForm = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveConnection = async () => {
    if (!hasPermission('settings', 'can_admin')) {
      toast({ title: 'Nedostatecna opravneni', variant: 'destructive' });
      return;
    }

    setSaving(true);
    const config = {
      rootFolderPath: form.rootFolderPath.trim(),
      tenantId: form.tenantId.trim(),
      siteId: form.siteId.trim(),
      driveId: form.driveId.trim(),
      rootFolderId: form.rootFolderId.trim(),
      notes: form.notes.trim(),
      projectStructure: ['00_Admin', '01_Smlouvy', '02_Dokumentace', '03_Predani', '04_Fakturace'],
      realizationStructure: ['00_Admin', '01_Objednavky', '02_Naklady', '03_Fotodokumentace', '04_Predani', '05_Fakturace'],
    };

    await supabase
      .from('document_storage_connections')
      .update({ is_default: false })
      .neq('id', '00000000-0000-0000-0000-000000000000');

    const payload = {
      provider: form.provider,
      name: form.name.trim() || storageProviderLabels[form.provider],
      status: form.status,
      is_default: true,
      config,
      updated_at: new Date().toISOString(),
    };

    const request = selectedId === 'new'
      ? supabase.from('document_storage_connections').insert(payload).select('*').single()
      : supabase.from('document_storage_connections').update(payload).eq('id', selectedId).select('*').single();

    const { data, error } = await request;

    if (error) {
      toast({ title: 'Chyba pri ukladani uloziste', description: error.message, variant: 'destructive' });
      setSaving(false);
      return;
    }

    toast({ title: 'Uloziste dokumentu ulozeno' });
    setSelectedId(data.id);
    await fetchConnections();
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Cloud}
        title="Uloziste dokumentu"
        description="Vychozi misto pro projektove dokumenty, realizace a budouci externi disky."
      />

      {schemaMissing && (
        <Alert>
          <FolderTree className="h-4 w-4" />
          <AlertTitle>Chybi databazova migrace</AlertTitle>
          <AlertDescription>
            Stranka je pripravena, ale v databazi jeste nejsou tabulky pro konfiguraci externiho uloziste.
            Po nasazeni migrace bude mozne vybrat Supabase, SharePoint nebo Google Drive.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Aktivni provider</CardTitle>
          <CardDescription>
            Tajne OAuth hodnoty se neukladaji ve frontendu. Patri do Supabase Edge Function secrets.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Konfigurace</Label>
              <Select value={selectedId} onValueChange={setSelectedId} disabled={loading || schemaMissing}>
                <SelectTrigger>
                  <SelectValue placeholder="Vyberte konfiguraci" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((connection) => (
                    <SelectItem key={connection.id} value={connection.id}>
                      {connection.name} {connection.is_default ? '(vychozi)' : ''}
                    </SelectItem>
                  ))}
                  <SelectItem value="new">Nova konfigurace</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Provider</Label>
              <Select value={form.provider} onValueChange={(value) => updateForm('provider', value)} disabled={loading || schemaMissing}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="supabase">Supabase Storage</SelectItem>
                  <SelectItem value="sharepoint">SharePoint</SelectItem>
                  <SelectItem value="google_drive">Google Drive</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{providerHelp[form.provider]}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="storageName">Nazev</Label>
              <Input id="storageName" value={form.name} onChange={(event) => updateForm('name', event.target.value)} disabled={loading || schemaMissing} />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(value) => updateForm('status', value)} disabled={loading || schemaMissing}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Aktivni</SelectItem>
                  <SelectItem value="draft">Rozpracovane</SelectItem>
                  <SelectItem value="disabled">Vypnute</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="rootFolderPath">Root cesta</Label>
              <Input id="rootFolderPath" placeholder="EKVPortal/Projekty" value={form.rootFolderPath} onChange={(event) => updateForm('rootFolderPath', event.target.value)} disabled={loading || schemaMissing} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rootFolderId">Root folder ID</Label>
              <Input id="rootFolderId" value={form.rootFolderId} onChange={(event) => updateForm('rootFolderId', event.target.value)} disabled={loading || schemaMissing} />
            </div>
          </div>

          {form.provider !== 'supabase' && (
            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="tenantId">Tenant ID</Label>
                <Input id="tenantId" value={form.tenantId} onChange={(event) => updateForm('tenantId', event.target.value)} disabled={loading || schemaMissing} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="siteId">Site ID</Label>
                <Input id="siteId" value={form.siteId} onChange={(event) => updateForm('siteId', event.target.value)} disabled={loading || schemaMissing} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="driveId">Drive ID</Label>
                <Input id="driveId" value={form.driveId} onChange={(event) => updateForm('driveId', event.target.value)} disabled={loading || schemaMissing} />
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="storageNotes">Poznamky k napojeni</Label>
            <Textarea id="storageNotes" rows={3} value={form.notes} onChange={(event) => updateForm('notes', event.target.value)} disabled={loading || schemaMissing} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={saveConnection} disabled={loading || saving || schemaMissing}>
              <Save className="mr-2 h-4 w-4" />
              {saving ? 'Ukladam...' : 'Ulozit jako vychozi'}
            </Button>
            <Button variant="outline" onClick={fetchConnections} disabled={loading || saving}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Obnovit
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default SettingsStorage;
