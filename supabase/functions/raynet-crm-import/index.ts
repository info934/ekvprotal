import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';
import { authorizeFunctionRequest } from '../_shared/authorize.ts';

const RAYNET_BASES: Record<string, string> = {
  cz: 'https://app.raynet.cz/api/v2',
  sk: 'https://app.raynet.sk/api/v2',
};
const ACTIVITY_ENDPOINTS = [
  ['event', 'meeting'],
  ['task', 'task'],
  ['email', 'email'],
  ['phoneCall', 'call'],
  ['letter', 'note'],
] as const;

const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const clean = (value: unknown) => String(value ?? '').trim();
const pickValue = (value: any) => clean(value?.value || value?.code01 || value);
const stripHtml = (value: unknown) => clean(value).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
const normalizedLabel = (value: unknown) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const FVE_FIELD_ALIASES: Record<string, string> = {
  'typ pd': 'pd_type', 'projektant': 'designer', 'zodpovedna osoba': 'responsible_person',
  'zalohova fa nazev': 'advance_invoice_name', 'zalohova fa cena 50': 'advance_invoice_amount', 'zalohova fa stav': 'advance_invoice_status', 'zalohova fa url': 'advance_invoice_url',
  'id zakazaky': 'external_job_id', 'id sharepoint': 'sharepoint_folder', 'id odmena tab': 'reward_table_id',
  'parcelni cislo': 'parcel_number', 'obec katastr': 'cadastral_municipality', 'katastralni uzemi nazev': 'cadastral_area_name', 'katastralni uzemi cislo': 'cadastral_area_code',
  'cislo lv': 'title_deed_number', 'ulice': 'installation_street', 'c p': 'installation_house_number', 'psc': 'installation_postal_code', 'obec': 'installation_city', 'kraj': 'installation_region',
  'vykon kwp': 'system_power_kwp', 'akumulace kwh': 'battery_capacity_kwh', 'nabijecka kw': 'charger_power_kw', 'pocet stringu': 'string_count',
  'string 1 pocet panelu': 'string_1_panel_count', 'string 2 pocet panelu': 'string_2_panel_count', 'string 3 pocet panelu': 'string_3_panel_count', 'back up': 'backup_mode',
  'zadost o ppp podana': 'ppp_submitted', 'cislo zadost ppp': 'ppp_request_number', 'schvalena pd pro vyrobny': 'production_documentation_approved',
  'cislo odberneho mista': 'metering_point_number', 'ean spotreba': 'ean_consumption', 'ean vyroba': 'ean_production',
  'technicke podminky pripojeni cislo': 'connection_conditions_number', 'datum platnosti sop': 'connection_agreement_valid_until',
  'druh vyrobny': 'plant_type', 'zpusob pripojeni pocet fazi': 'connection_phase_count', 'hodnota jistice': 'breaker_rating_a', 'vypinaci char': 'breaker_curve', 'zpusob provozu': 'operation_mode',
  'cislo pozadavku': 'subsidy_request_number', 'akceptovana': 'subsidy_accepted', 'datum akceptace': 'subsidy_accepted_at', 'narok na dotaci': 'subsidy_amount',
  'typ strechy': 'roof_type', 'typ stresni krytiny': 'roof_covering', 'sklon strechy pv1': 'roof_pitch_1', 'sklon strechy pv2': 'roof_pitch_2',
  'hromosvod': 'lightning_protection', 'propojeni s hromosvodem': 'lightning_bonding', 'uzemneni po fasade': 'facade_grounding', 'tazeni vodice pen': 'pen_conductor_route',
  'typ konstrukce': 'mounting_type', 'vyska domu k okapu': 'eaves_height_m', 'cena za instalaci': 'installation_price',
  'autor certifikatu': 'certificate_authority', 'cislo certifikatu': 'certificate_number', 'datum vydani certifikatu': 'certificate_issued_at',
};

const mapRaynetCustomFields = (raw: Record<string, unknown> | null | undefined, definitions: any[]) => {
  const mapped: Record<string, unknown> = {};
  const byName = new Map((definitions || []).map((field: any) => [field.name, field]));
  for (const [sourceKey, value] of Object.entries(raw || {})) {
    const definition = byName.get(sourceKey);
    const label = normalizedLabel(definition?.label || sourceKey.replace(/_[a-f0-9]{5,}$/i, ''));
    const group = normalizedLabel(definition?.groupName);
    let target = FVE_FIELD_ALIASES[label];
    if (!target && group === 'fve panely') target = ({ znacka: 'panel_brand', type: 'panel_type', pocet: 'panel_count', 'vykon panelu wp': 'panel_power_wp', 'rozmery panelu': 'panel_dimensions', 'zaruka mech': 'panel_mechanical_warranty_months', 'zaruka vyk': 'panel_performance_warranty_months' } as Record<string, string>)[label];
    if (!target && group === 'stridac') target = ({ znacka: 'inverter_brand', type: 'inverter_type', 'vykon stridace kw': 'inverter_power_kw', 'serial number': 'inverter_serial_number', zaruka: 'inverter_warranty_months', 'verze fw': 'inverter_firmware', nastaveni: 'inverter_grid_profile' } as Record<string, string>)[label];
    if (!target && group === 'baterie') target = ({ znacka: 'battery_brand', zaruka: 'battery_warranty_months', 'battery type': 'battery_type', 'serial number 1': 'battery_serial_1', 'serial number 2': 'battery_serial_2', 'serial number 3': 'battery_serial_3', 'bms type': 'bms_type', 'serial number bms': 'bms_serial_number' } as Record<string, string>)[label];
    if (!target && group === 'wallbox') target = ({ typ: 'wallbox_type', 'wb sn': 'wallbox_serial_number', vykon: 'wallbox_power_kw' } as Record<string, string>)[label];
    if (target) mapped[target] = value;
  }
  return { ...mapped, _raynet_custom: raw || {} };
};
const normalizeInstance = (value: unknown) => {
  const instance = clean(value).toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,99}$/.test(instance)) throw Object.assign(new Error('Neplatný název Raynet instance.'), { status: 400 });
  return instance;
};

const timezoneOffsetMinutes = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce<Record<string, string>>((result, part) => ({ ...result, [part.type]: part.value }), {});
  const represented = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return (represented - date.getTime()) / 60000;
};

const raynetDateToIso = (value: unknown, timeZone = 'Europe/Prague') => {
  const match = clean(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!match) return null;
  const guess = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0));
  let instant = new Date(guess);
  instant = new Date(guess - timezoneOffsetMinutes(instant, timeZone) * 60000);
  instant = new Date(guess - timezoneOffsetMinutes(instant, timeZone) * 60000);
  return instant.toISOString();
};

const addMinutes = (value: string | null, minutes: number) => value
  ? new Date(new Date(value).getTime() + minutes * 60000).toISOString()
  : null;

const sha256 = async (value: unknown) => {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const raynetStatus = (status: unknown) => {
  const value = clean(status).toUpperCase();
  if (value.includes('WIN')) return { stage: 'won', status: 'closed' };
  if (value.includes('LOST') || value.includes('CANCEL')) return { stage: 'lost', status: 'closed' };
  return { stage: 'lead', status: 'open' };
};

const raynetActivityStatus = (activity: any) => {
  if (clean(activity?.status).toUpperCase() === 'CANCELLED') return 'cancelled';
  if (activity?.completed || clean(activity?.status).toUpperCase() === 'COMPLETED') return 'completed';
  return 'planned';
};

const detectBusinessType = (businessCase: any) => {
  const haystack = [businessCase?.businessCaseType, businessCase?.category, businessCase?.businessCaseClassification1,
    businessCase?.businessCaseClassification2, businessCase?.businessCaseClassification3, ...(businessCase?.tags || [])]
    .map(pickValue).join(' ').toLowerCase();
  return /\bfve\b|fotovolta|sol[aá]r/.test(haystack) ? 'fve' : 'general';
};

const companyPayload = (company: any) => {
  const address = company?.primaryAddress?.address || {};
  const contact = company?.primaryAddress?.contactInfo || {};
  return {
    name: clean(company?.name) || `Raynet klient ${company?.id}`,
    ico: clean(company?.regNumber) || null,
    dic: clean(company?.taxNumber) || null,
    person: Boolean(company?.person),
    address: [address.street, [address.zipCode, address.city].filter(Boolean).join(' '), address.country].map(clean).filter(Boolean).join(', ') || null,
    email: clean(contact.email) || null,
    phone: clean(contact.tel1) || null,
    note: stripHtml(company?.notice) || null,
  };
};

const ownerExternalId = (activity: any) => clean(
  activity?.owner?.id || activity?.participants?.find((participant: any) => participant?.owner)?.person?.id ||
  activity?.participants?.find((participant: any) => participant?.owner)?.person,
);

type RaynetCredentials = { username: string; apiKey: string; instanceName: string; region: string };

const getCredentials = (body: any): RaynetCredentials => {
  const credentials = body?.credentials || {};
  const username = clean(credentials.username || Deno.env.get('RAYNET_API_USERNAME'));
  const apiKey = clean(credentials.apiKey || Deno.env.get('RAYNET_API_KEY'));
  const instanceName = normalizeInstance(credentials.instanceName || Deno.env.get('RAYNET_INSTANCE_NAME'));
  const region = clean(credentials.region || Deno.env.get('RAYNET_REGION') || 'cz').toLowerCase();
  if (!username || !apiKey) throw Object.assign(new Error('Doplňte Raynet uživatele a API klíč.'), { status: 400 });
  if (!RAYNET_BASES[region]) throw Object.assign(new Error('Nepodporovaný region Raynetu.'), { status: 400 });
  return { username, apiKey, instanceName, region };
};

const createRaynetClient = (credentials: RaynetCredentials) => {
  const headers = {
    Accept: 'application/json',
    Authorization: `Basic ${btoa(`${credentials.username}:${credentials.apiKey}`)}`,
    'X-Instance-Name': credentials.instanceName,
  };
  return async (path: string, optional = false) => {
    const response = await fetchWithTimeout(`${RAYNET_BASES[credentials.region]}${path}`, { headers }, 20000);
    if (!response.ok) {
      if (optional && response.status === 404) return { data: [], totalCount: 0 };
      const payload = await response.json().catch(() => ({}));
      const message = response.status === 401 || response.status === 403
        ? 'Raynet odmítl přihlášení. Zkontrolujte uživatele, API klíč a název instance.'
        : clean(payload?.message || payload?.error) || `Raynet API vrátilo stav ${response.status}.`;
      throw Object.assign(new Error(message), { status: response.status });
    }
    const payload = await response.json();
    if (payload?.success === false || payload?.success === 'false') throw Object.assign(new Error(clean(payload?.message) || 'Raynet API požadavek selhal.'), { status: 502 });
    return payload;
  };
};

const fetchPageSet = async (raynet: ReturnType<typeof createRaynetClient>, path: string, maxRows: number) => {
  const rows: any[] = [];
  const pageSize = Math.min(100, Math.max(1, maxRows));
  for (let offset = 0; offset < maxRows; offset += pageSize) {
    const separator = path.includes('?') ? '&' : '?';
    const payload = await raynet(`${path}${separator}offset=${offset}&limit=${Math.min(pageSize, maxRows - offset)}&sortColumn=id&sortDirection=DESC`);
    const page = Array.isArray(payload?.data) ? payload.data : [];
    rows.push(...page);
    const totalCount = Number(payload?.totalCount);
    if (!page.length || (Number.isFinite(totalCount) && totalCount > 0 && rows.length >= totalCount)) break;
  }
  return rows.slice(0, maxRows);
};

const inChunks = <T>(items: T[], size = 80) => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, index) => items.slice(index * size, (index + 1) * size),
);

const mapConcurrent = async <T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) => {
  const result = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      result[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return result;
};

const uniqueById = (items: any[]) => [...new Map(items.map((item) => [clean(item?.id), item])).values()]
  .filter((item) => clean(item?.id));

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    if (req.method !== 'POST') return respond({ success: false, error: 'Method not allowed.' }, 405);
    const actor = await authorizeFunctionRequest(req, { module: 'crm', level: 'admin' });
    const body = await req.json();
    const action = clean(body?.action);
    if (!['test', 'inventory', 'preview', 'apply'].includes(action)) return respond({ success: false, error: 'Neplatná akce.' }, 400);

    const admin = createClient(Deno.env.get('SUPABASE_URL') || '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '');
    if (action === 'apply') {
      if (!body?.batchId) return respond({ success: false, error: 'Chybí dávka importu.' }, 400);
      const { data, error } = await admin.rpc('apply_raynet_crm_import', { p_batch_id: body.batchId, p_actor_member_id: actor.memberId });
      if (error) throw error;
      return respond({ success: true, summary: data });
    }

    const credentials = getCredentials(body);
    const raynet = createRaynetClient(credentials);
    const accountPayload = await raynet('/userAccount/?offset=0&limit=100');
    const users = (accountPayload?.data || []).map((account: any) => ({
      accountId: clean(account.id),
      externalUserId: clean(account?.person?.id || account.id),
      email: clean(account.username).toLowerCase(),
      name: clean(account?.person?.fullName || account.username),
      role: clean(account.userRole),
    }));

    const { data: connection, error: connectionError } = await admin.from('crm_external_connections').upsert({
      provider: 'raynet', instance_name: credentials.instanceName, display_name: `Raynet – ${credentials.instanceName}`,
      status: 'connected', last_tested_at: new Date().toISOString(), created_by: actor.memberId,
    }, { onConflict: 'provider,instance_name' }).select('id, instance_name, display_name, status, last_tested_at, last_inventory').single();
    if (connectionError) throw connectionError;
    if (action === 'test') return respond({ success: true, connection, userCount: Number(accountPayload?.totalCount || users.length) });

    const dictionaryPaths: Record<string, string> = {
      businessCaseCategories: '/businessCaseCategory/', businessCaseTypes: '/businessCaseType/', businessCasePhases: '/businessCasePhase/',
      classifications1: '/businessCaseClassification1/', classifications2: '/businessCaseClassification2/', classifications3: '/businessCaseClassification3/',
      activityCategories: '/activityCategory/', customFields: '/customField/config/',
    };
    const entries = await Promise.all(Object.entries(dictionaryPaths).map(async ([key, path]) => {
      const payload = await raynet(path, key === 'customFields');
      const data = key === 'customFields' ? payload?.data?.BusinessCase : payload?.data;
      return [key, Array.isArray(data) ? data : data || []];
    }));
    const inventory = { users, ...Object.fromEntries(entries), capturedAt: new Date().toISOString() };
    const { error: inventoryError } = await admin.from('crm_external_connections').update({ last_inventory: inventory }).eq('id', connection.id);
    if (inventoryError) throw inventoryError;
    if (action === 'inventory') return respond({ success: true, connection: { ...connection, last_inventory: inventory }, inventory });

    const requestedCategories = new Set((body?.filters?.categoryIds || []).map(String));
    const requestedTypes = new Set((body?.filters?.typeIds || []).map(String));
    const maxBusinessCases = Math.min(2000, Math.max(1, Number(body?.limits?.businessCases || 1000)));
    const maxActivitiesPerType = Math.min(5000, Math.max(1, Number(body?.limits?.activitiesPerType || 1000)));
    const businessCaseLists = requestedCategories.size
      ? await Promise.all([...requestedCategories].map((categoryId) => fetchPageSet(raynet, `/businessCase/?category=${encodeURIComponent(categoryId)}`, maxBusinessCases)))
      : [await fetchPageSet(
        raynet,
        requestedTypes.size ? `/businessCase/?businessCaseType[IN]=${encodeURIComponent([...requestedTypes].join(','))}` : '/businessCase/',
        maxBusinessCases,
      )];
    const businessCases = uniqueById(businessCaseLists.flat()).slice(0, maxBusinessCases);
    const selectedCaseSummaries = businessCases.filter((item: any) => (
      (!requestedCategories.size || requestedCategories.has(clean(item?.category?.id))) &&
      (!requestedTypes.size || requestedTypes.has(clean(item?.businessCaseType?.id)))
    ));
    const selectedCases = await mapConcurrent(selectedCaseSummaries, 8, async (item: any) => {
      const detail = await raynet(`/businessCase/${encodeURIComponent(clean(item.id))}/`);
      return { ...item, ...(detail?.data || {}) };
    });
    const companyIds = new Set(selectedCases.map((item: any) => clean(item?.company?.id)).filter(Boolean));
    const companyLists = await Promise.all(inChunks([...companyIds]).map((ids) => fetchPageSet(
      raynet,
      `/company/?id[IN]=${encodeURIComponent(ids.join(','))}`,
      Math.max(100, ids.length),
    )));
    const companyList = uniqueById(companyLists.flat());
    const companyById = new Map(companyList.map((item: any) => [clean(item.id), item]));
    const caseIdChunks = inChunks(selectedCases.map((item: any) => clean(item.id)).filter(Boolean));
    const activitiesByKind = await Promise.all(ACTIVITY_ENDPOINTS.map(async ([kind, mappedType]) => {
      const activityLists = await Promise.all(caseIdChunks.map((ids) => fetchPageSet(
        raynet,
        `/${kind}/?businessCase[IN]=${encodeURIComponent(ids.join(','))}`,
        maxActivitiesPerType,
      )));
      return { kind, mappedType, rows: uniqueById(activityLists.flat()).slice(0, maxActivitiesPerType) };
    }));

    const { data: userMappings } = await admin.from('crm_external_user_mappings').select('external_user_id, member_id').eq('connection_id', connection.id).eq('is_active', true);
    const { data: valueMappings } = await admin.from('crm_external_value_mappings').select('field_name, external_id, target_value').eq('connection_id', connection.id);
    const stageMappings = new Map((valueMappings || []).filter((mapping: any) => mapping.field_name === 'stage').map((mapping: any) => [mapping.external_id, mapping.target_value]));
    const userMappingSnapshot = Object.fromEntries((userMappings || []).map((mapping: any) => [mapping.external_user_id, mapping.member_id]));

    const staged: any[] = [];
    for (const externalId of companyIds) {
      const raw = companyById.get(externalId) || selectedCases.find((item: any) => clean(item?.company?.id) === externalId)?.company || { id: externalId };
      staged.push({ entity_type: 'company', external_id: externalId, raw_payload: raw, mapped_payload: companyPayload(raw), source_updated_at: raynetDateToIso(raw?.['rowInfo.updatedAt']) });
    }
    for (const item of selectedCases) {
      const fallback = raynetStatus(item?.status);
      const phaseId = clean(item?.businessCasePhase?.id);
      const stage = stageMappings.get(phaseId) || fallback.stage;
      staged.push({
        entity_type: 'business_case', external_id: clean(item.id), raw_payload: item,
        mapped_payload: {
          company_external_id: clean(item?.company?.id), owner_external_id: clean(item?.owner?.id), title: clean(item?.name), number: clean(item?.code) || null,
          stage, status: ['won', 'lost'].includes(stage) ? 'closed' : fallback.status, value: Number(item?.totalAmount || 0), probability: Number(item?.probability || 0),
          expected_close_date: clean(item?.scheduledEnd || item?.validTill) || null, description: stripHtml(item?.description) || null,
          category: pickValue(item?.category) || null, business_type: detectBusinessType(item), currency: pickValue(item?.currency) || 'CZK',
          classification_1: pickValue(item?.businessCaseClassification1) || null, classification_2: pickValue(item?.businessCaseClassification2) || null,
          classification_3: pickValue(item?.businessCaseClassification3) || null, tags: Array.isArray(item?.tags) ? item.tags : [],
          custom_fields: mapRaynetCustomFields(item?.customFields, inventory.customFields as any[]),
        }, source_updated_at: raynetDateToIso(item?.['rowInfo.updatedAt']),
      });
    }
    const selectedCaseIds = new Set(selectedCases.map((item: any) => clean(item.id)));
    for (const group of activitiesByKind) {
      for (const item of group.rows) {
        const businessCaseId = clean(item?.businessCase?.id || item?.businessCase);
        if (!businessCaseId || !selectedCaseIds.has(businessCaseId)) continue;
        const startsAt = raynetDateToIso(item?.scheduledFrom);
        staged.push({
          entity_type: 'activity', external_id: `${group.kind}:${clean(item.id)}`, raw_payload: { ...item, _raynetEntity: group.kind },
          mapped_payload: {
            business_case_external_id: businessCaseId, owner_external_id: ownerExternalId(item), type: group.mappedType,
            status: raynetActivityStatus(item), title: clean(item?.title) || `${group.kind} ${item.id}`,
            description: stripHtml(item?.description) || null, starts_at: startsAt, ends_at: raynetDateToIso(item?.scheduledTill) || addMinutes(startsAt, 30),
            completed_at: raynetDateToIso(item?.completed), location: clean(item?.meetingPlace) || null,
            meeting_minutes: group.kind === 'event' ? stripHtml(item?.description) || null : null,
          }, source_updated_at: raynetDateToIso(item?.['rowInfo.updatedAt']),
        });
      }
    }

    const { data: batch, error: batchError } = await admin.from('crm_import_batches').insert({
      connection_id: connection.id, status: 'preview', created_by: actor.memberId,
      source_counts: { companies: companyIds.size, businessCases: selectedCases.length, activities: staged.filter((row) => row.entity_type === 'activity').length },
      mapping_snapshot: { users: userMappingSnapshot, values: valueMappings || [], filters: body?.filters || {} },
    }).select('id, status, source_counts, created_at').single();
    if (batchError) throw batchError;

    const externalIds = staged.map((row) => row.external_id);
    const { data: existingLinks } = externalIds.length ? await admin.from('crm_external_links')
      .select('entity_type, external_id, source_hash').eq('connection_id', connection.id).in('external_id', externalIds) : { data: [] };
    const links = new Map((existingLinks || []).map((link: any) => [`${link.entity_type}:${link.external_id}`, link]));
    for (const row of staged) {
      row.source_hash = await sha256(row.raw_payload);
      const previous = links.get(`${row.entity_type}:${row.external_id}`);
      row.proposed_action = previous ? (previous.source_hash === row.source_hash ? 'skip' : 'update') : 'create';
      row.batch_id = batch.id;
    }
    for (let index = 0; index < staged.length; index += 200) {
      const { error } = await admin.from('crm_import_rows').insert(staged.slice(index, index + 200));
      if (error) throw error;
    }
    const actions = staged.reduce<Record<string, number>>((result, row) => ({ ...result, [row.proposed_action]: (result[row.proposed_action] || 0) + 1 }), {});
    const summary = { total: staged.length, entities: { companies: companyIds.size, businessCases: selectedCases.length, activities: staged.filter((row) => row.entity_type === 'activity').length }, actions };
    await admin.from('crm_import_batches').update({ status: 'ready', summary }).eq('id', batch.id);
    return respond({ success: true, batch: { ...batch, status: 'ready', summary }, inventory });
  } catch (error) {
    console.error('[raynet-crm-import]', { name: error?.name, status: error?.status, message: error?.message });
    const status = Number(error?.status || 500);
    return respond({ success: false, error: status >= 500 ? 'Import z Raynetu se nepodařilo připravit.' : error.message }, status);
  }
});
