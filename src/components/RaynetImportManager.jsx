import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Database, Eye, Loader2, RefreshCw, ShieldCheck, Users } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';

const inferStage = (phase) => {
  const name = String(phase?.code01 || phase?.value || '').toLowerCase();
  const probability = Number(phase?.probability || 0);
  if (/výhr|vyhr|won|realiz/.test(name) || probability === 100) return 'won';
  if (/prohr|ztrac|lost|storn/.test(name)) return 'lost';
  if (probability <= 15) return 'lead';
  if (probability <= 35) return 'qualified';
  if (probability <= 55) return 'proposal';
  return 'negotiation';
};

const isFveLabel = (value) => /\bfve\b|fotovolta|sol[aá]r/i.test(String(value || ''));
const getDictionaryLabel = (item) => String(item?.code01 || item?.value || item?.name || item?.id || 'Bez názvu');

const RaynetImportManager = () => {
  const { toast } = useToast();
  const [credentials, setCredentials] = useState({ instanceName: '', username: '', apiKey: '', region: 'cz' });
  const [connection, setConnection] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [members, setMembers] = useState([]);
  const [stages, setStages] = useState([]);
  const [userMappings, setUserMappings] = useState({});
  const [stageMappings, setStageMappings] = useState({});
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [batch, setBatch] = useState(null);
  const [busy, setBusy] = useState('');
  const [ready, setReady] = useState(true);

  const loadStoredState = useCallback(async () => {
    const [connectionRes, memberRes, stageRes, batchRes] = await Promise.all([
      supabase.from('crm_external_connections').select('id, instance_name, display_name, status, last_tested_at, last_inventory').eq('provider', 'raynet').order('updated_at', { ascending: false }).limit(1).maybeSingle(),
      supabase.from('members').select('id, name, email').eq('is_active', true).order('name'),
      supabase.from('crm_stage_definitions').select('value, label').eq('is_active', true).order('sort_order'),
      supabase.from('crm_import_batches').select('id, connection_id, status, source_counts, summary, created_at, applied_at, error_message').order('created_at', { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (connectionRes.error?.code === '42P01') {
      setReady(false);
      return;
    }
    if (connectionRes.error) throw connectionRes.error;
    const currentConnection = connectionRes.data;
    setConnection(currentConnection);
    setInventory(currentConnection?.last_inventory && Object.keys(currentConnection.last_inventory).length ? currentConnection.last_inventory : null);
    if (currentConnection?.instance_name) setCredentials((current) => ({ ...current, instanceName: currentConnection.instance_name }));
    setMembers(memberRes.data || []);
    setStages(stageRes.data || []);
    setBatch(batchRes.data || null);
    if (currentConnection?.id) {
      const [userMapRes, valueMapRes] = await Promise.all([
        supabase.from('crm_external_user_mappings').select('external_user_id, member_id').eq('connection_id', currentConnection.id).eq('is_active', true),
        supabase.from('crm_external_value_mappings').select('external_id, target_value').eq('connection_id', currentConnection.id).eq('entity_type', 'business_case').eq('field_name', 'stage'),
      ]);
      setUserMappings(Object.fromEntries((userMapRes.data || []).map((item) => [item.external_user_id, item.member_id || 'unassigned'])));
      setStageMappings(Object.fromEntries((valueMapRes.data || []).map((item) => [item.external_id, item.target_value])));
    }
  }, []);

  useEffect(() => {
    loadStoredState().catch((error) => toast({ title: 'Raynet integraci nelze načíst', description: error.message, variant: 'destructive' }));
  }, [loadStoredState, toast]);

  const completeInventory = useCallback((nextInventory, nextConnection) => {
    setInventory(nextInventory);
    setConnection(nextConnection);
    const emailMembers = new Map(members.filter((member) => member.email).map((member) => [member.email.toLowerCase(), member.id]));
    setUserMappings((current) => Object.fromEntries((nextInventory?.users || []).map((user) => [
      user.externalUserId,
      current[user.externalUserId] || emailMembers.get(String(user.email || '').toLowerCase()) || 'unassigned',
    ])));
    setStageMappings((current) => Object.fromEntries((nextInventory?.businessCasePhases || []).map((phase) => [
      String(phase.id), current[String(phase.id)] || inferStage(phase),
    ])));
    const fveCategories = (nextInventory?.businessCaseCategories || []).filter((item) => isFveLabel(getDictionaryLabel(item))).map((item) => String(item.id));
    const fveTypes = (nextInventory?.businessCaseTypes || []).filter((item) => isFveLabel(getDictionaryLabel(item))).map((item) => String(item.id));
    setSelectedCategories((current) => current.length ? current : fveCategories);
    setSelectedTypes((current) => current.length ? current : fveTypes);
  }, [members]);

  const invoke = async (action, extra = {}) => {
    setBusy(action);
    try {
      const { data, error } = await supabase.functions.invoke('raynet-crm-import', { body: { action, credentials, ...extra } });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Raynet požadavek selhal.');
      return data;
    } finally {
      setBusy('');
    }
  };

  const testConnection = async () => {
    try {
      const data = await invoke('test');
      setConnection(data.connection);
      toast({ title: 'Spojení s Raynetem funguje', description: `API vidí ${data.userCount} uživatelů.` });
    } catch (error) {
      toast({ title: 'Spojení s Raynetem selhalo', description: error.message, variant: 'destructive' });
    }
  };

  const loadInventory = async () => {
    try {
      const data = await invoke('inventory');
      completeInventory(data.inventory, data.connection);
      toast({ title: 'Struktura Raynetu načtena', description: 'Teď zkontrolujte mapování obchodníků a pipeline.' });
    } catch (error) {
      toast({ title: 'Strukturu Raynetu nelze načíst', description: error.message, variant: 'destructive' });
    }
  };

  const saveMappings = async () => {
    if (!connection?.id || !inventory) return false;
    setBusy('mapping');
    try {
      const userRows = (inventory.users || []).map((user) => ({
        connection_id: connection.id, external_user_id: user.externalUserId, external_email: user.email || null,
        external_name: user.name || null, member_id: userMappings[user.externalUserId] === 'unassigned' ? null : userMappings[user.externalUserId], is_active: true,
      }));
      const stageRows = (inventory.businessCasePhases || []).map((phase) => ({
        connection_id: connection.id, entity_type: 'business_case', field_name: 'stage', external_id: String(phase.id),
        external_value: getDictionaryLabel(phase), target_value: stageMappings[String(phase.id)] || inferStage(phase),
      }));
      const [usersRes, stagesRes] = await Promise.all([
        userRows.length ? supabase.from('crm_external_user_mappings').upsert(userRows, { onConflict: 'connection_id,external_user_id' }) : Promise.resolve({ error: null }),
        stageRows.length ? supabase.from('crm_external_value_mappings').upsert(stageRows, { onConflict: 'connection_id,entity_type,field_name,external_id' }) : Promise.resolve({ error: null }),
      ]);
      if (usersRes.error || stagesRes.error) throw usersRes.error || stagesRes.error;
      toast({ title: 'Mapování uloženo' });
      return true;
    } catch (error) {
      toast({ title: 'Mapování nelze uložit', description: error.message, variant: 'destructive' });
      return false;
    } finally {
      setBusy('');
    }
  };

  const preparePreview = async () => {
    try {
      const mappingsSaved = await saveMappings();
      if (!mappingsSaved) return;
      const data = await invoke('preview', { filters: { categoryIds: selectedCategories, typeIds: selectedTypes } });
      completeInventory(data.inventory, connection);
      setBatch(data.batch);
      toast({ title: 'Náhled importu je připraven', description: `${data.batch.summary.total} záznamů čeká na vaši kontrolu.` });
    } catch (error) {
      toast({ title: 'Náhled importu nelze připravit', description: error.message, variant: 'destructive' });
    }
  };

  const applyBatch = async () => {
    try {
      const data = await invoke('apply', { batchId: batch.id });
      setBatch((current) => ({ ...current, status: 'applied', summary: data.summary, applied_at: new Date().toISOString() }));
      toast({ title: 'Raynet data byla importována', description: `Vytvořeno ${data.summary.created}, aktualizováno ${data.summary.updated}.` });
    } catch (error) {
      toast({ title: 'Import se neprovedl', description: error.message, variant: 'destructive' });
    }
  };

  const categoryOptions = inventory?.businessCaseCategories || [];
  const typeOptions = inventory?.businessCaseTypes || [];
  const mappedUserCount = useMemo(() => Object.values(userMappings).filter((value) => value && value !== 'unassigned').length, [userMappings]);

  if (!ready) return (
    <Alert className="border-amber-200 bg-amber-50 text-amber-950">
      <Database className="h-4 w-4" />
      <AlertTitle>Raynet import čeká na databázovou migraci</AlertTitle>
      <AlertDescription>Po nasazení připravené migrace se zde zpřístupní bezpečný náhled a import.</AlertDescription>
    </Alert>
  );

  return (
    <div className="space-y-6">
      <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Jednosměrný a kontrolovaný import</AlertTitle>
        <AlertDescription>Raynet se pouze čte. API klíč zůstává v paměti této stránky, do databáze se neukládá. Před zápisem vždy vznikne kontrolní náhled.</AlertDescription>
      </Alert>

      <Card>
        <CardHeader className="border-b bg-slate-50/70">
          <CardTitle>Připojení k původnímu Raynet CRM</CardTitle>
          <CardDescription>API klíč vytvoří administrátor Raynetu u svého účtu. Pro import stačí oprávnění ke čtení.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 p-4 lg:grid-cols-4">
          <div className="space-y-2"><Label>Instance</Label><Input value={credentials.instanceName} onChange={(event) => setCredentials((current) => ({ ...current, instanceName: event.target.value }))} placeholder="nazev-firmy" autoComplete="off" /></div>
          <div className="space-y-2"><Label>Raynet uživatel</Label><Input type="email" value={credentials.username} onChange={(event) => setCredentials((current) => ({ ...current, username: event.target.value }))} placeholder="uzivatel@firma.cz" autoComplete="username" /></div>
          <div className="space-y-2"><Label>API klíč</Label><Input type="password" value={credentials.apiKey} onChange={(event) => setCredentials((current) => ({ ...current, apiKey: event.target.value }))} placeholder="••••••••••••" autoComplete="new-password" /></div>
          <div className="space-y-2"><Label>Region</Label><Select value={credentials.region} onValueChange={(region) => setCredentials((current) => ({ ...current, region }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="cz">Česko</SelectItem><SelectItem value="sk">Slovensko</SelectItem></SelectContent></Select></div>
          <div className="flex flex-wrap gap-2 lg:col-span-4">
            <Button type="button" variant="outline" onClick={testConnection} disabled={Boolean(busy) || !credentials.instanceName || !credentials.username || !credentials.apiKey}>{busy === 'test' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}Otestovat spojení</Button>
            <Button type="button" onClick={loadInventory} disabled={Boolean(busy) || !credentials.instanceName || !credentials.username || !credentials.apiKey}>{busy === 'inventory' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Načíst strukturu Raynetu</Button>
            {connection?.status === 'connected' && <Badge variant="secondary" className="h-9 px-3">Připojeno: {connection.instance_name}</Badge>}
          </div>
        </CardContent>
      </Card>

      {inventory && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card><CardContent className="flex items-center gap-3 p-4"><Users className="h-5 w-5 text-primary" /><div><div className="text-2xl font-bold">{inventory.users?.length || 0}</div><div className="text-sm text-muted-foreground">Raynet uživatelů · {mappedUserCount} namapováno</div></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><Database className="h-5 w-5 text-primary" /><div><div className="text-2xl font-bold">{inventory.businessCasePhases?.length || 0}</div><div className="text-sm text-muted-foreground">stavů obchodních případů</div></div></CardContent></Card>
            <Card><CardContent className="flex items-center gap-3 p-4"><Eye className="h-5 w-5 text-primary" /><div><div className="text-2xl font-bold">{Array.isArray(inventory.customFields) ? inventory.customFields.length : Object.keys(inventory.customFields || {}).length}</div><div className="text-sm text-muted-foreground">volitelných polí OP</div></div></CardContent></Card>
          </div>

          <Card>
            <CardHeader className="border-b bg-slate-50/70"><CardTitle>Mapování obchodníků</CardTitle><CardDescription>Aktivity, schůzky a obchodní případy se přiřadí správným lidem v EKV portálu.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 p-4 lg:grid-cols-2">
              {(inventory.users || []).map((user) => <div key={user.externalUserId} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,1fr)] sm:items-center"><div><div className="font-medium">{user.name}</div><div className="text-sm text-muted-foreground">{user.email}</div></div><Select value={userMappings[user.externalUserId] || 'unassigned'} onValueChange={(value) => setUserMappings((current) => ({ ...current, [user.externalUserId]: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Bez přiřazení</SelectItem>{members.map((member) => <SelectItem key={member.id} value={member.id}>{member.name} · {member.email}</SelectItem>)}</SelectContent></Select></div>)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-slate-50/70"><CardTitle>Mapování pipeline</CardTitle><CardDescription>Původní stav z Raynetu se převede na jednotnou pipeline EKV.</CardDescription></CardHeader>
            <CardContent className="grid gap-3 p-4 lg:grid-cols-2">
              {(inventory.businessCasePhases || []).map((phase) => <div key={phase.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-center"><div><div className="font-medium">{getDictionaryLabel(phase)}</div><div className="text-sm text-muted-foreground">Pravděpodobnost {Number(phase.probability || 0)} %</div></div><Select value={stageMappings[String(phase.id)] || inferStage(phase)} onValueChange={(value) => setStageMappings((current) => ({ ...current, [String(phase.id)]: value }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{stages.map((stage) => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}</SelectContent></Select></div>)}
              <div className="lg:col-span-2"><Button type="button" variant="outline" onClick={saveMappings} disabled={Boolean(busy)}>{busy === 'mapping' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Uložit mapování</Button></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b bg-slate-50/70"><CardTitle>Rozsah FVE importu</CardTitle><CardDescription>Prázdný výběr znamená všechny typy nebo kategorie. Automaticky jsou předvybrané položky s označením FVE či fotovoltaika.</CardDescription></CardHeader>
            <CardContent className="grid gap-5 p-4 lg:grid-cols-2">
              <div><div className="mb-2 text-sm font-semibold">Kategorie OP</div><div className="space-y-2">{categoryOptions.map((item) => { const id = String(item.id); return <label key={id} className="flex items-center gap-2 rounded-md border p-2"><Checkbox checked={selectedCategories.includes(id)} onCheckedChange={(checked) => setSelectedCategories((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id))} /><span className="text-sm">{getDictionaryLabel(item)}</span></label>; })}</div></div>
              <div><div className="mb-2 text-sm font-semibold">Typy OP</div><div className="space-y-2">{typeOptions.length ? typeOptions.map((item) => { const id = String(item.id); return <label key={id} className="flex items-center gap-2 rounded-md border p-2"><Checkbox checked={selectedTypes.includes(id)} onCheckedChange={(checked) => setSelectedTypes((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id))} /><span className="text-sm">{getDictionaryLabel(item)}</span></label>; }) : <div className="text-sm text-muted-foreground">Raynet nemá typy obchodních případů zapnuté.</div>}</div></div>
              <div className="lg:col-span-2"><Button type="button" onClick={preparePreview} disabled={Boolean(busy) || !credentials.apiKey}>{busy === 'preview' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Eye className="mr-2 h-4 w-4" />}Připravit náhled bez zápisu</Button></div>
            </CardContent>
          </Card>
        </>
      )}

      {batch && (
        <Card className={batch.status === 'applied' ? 'border-emerald-200' : 'border-blue-200'}>
          <CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><div><CardTitle>Poslední importní dávka</CardTitle><CardDescription>{new Date(batch.created_at).toLocaleString('cs-CZ')} · stav {batch.status}</CardDescription></div><Badge variant={batch.status === 'applied' ? 'default' : 'secondary'}>{batch.status === 'applied' ? 'Importováno' : 'Připraveno ke kontrole'}</Badge></div></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div className="rounded-lg bg-slate-50 p-3"><div className="text-2xl font-bold">{batch.summary?.total ?? Object.values(batch.source_counts || {}).reduce((sum, value) => sum + Number(value || 0), 0)}</div><div className="text-sm text-muted-foreground">záznamů celkem</div></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-2xl font-bold">{batch.summary?.actions?.create ?? batch.summary?.created ?? 0}</div><div className="text-sm text-muted-foreground">nových</div></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-2xl font-bold">{batch.summary?.actions?.update ?? batch.summary?.updated ?? 0}</div><div className="text-sm text-muted-foreground">aktualizací</div></div><div className="rounded-lg bg-slate-50 p-3"><div className="text-2xl font-bold">{batch.summary?.actions?.skip ?? batch.summary?.skipped ?? 0}</div><div className="text-sm text-muted-foreground">beze změny</div></div></div>
            {batch.status === 'ready' && <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="font-semibold text-blue-950">Náhled nic nezapsal do CRM</div><div className="text-sm text-blue-800">Tlačítko provede celou dávku v jedné transakci; při chybě se vše vrátí zpět.</div></div><Button type="button" onClick={applyBatch} disabled={Boolean(busy)}>{busy === 'apply' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Database className="mr-2 h-4 w-4" />}Importovat tuto dávku</Button></div>}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RaynetImportManager;
