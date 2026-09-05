import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';
import { assertActiveAccount } from '../_shared/accountStatus.ts';

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const GRAPH_TIMEOUT_MS = 45_000;
const AI_TIMEOUT_MS = 150_000;
const PROMPT_VERSION = 'contract-finance-v3';
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

const getGraphToken = async () => {
  const tenantId = Deno.env.get('MS_GRAPH_TENANT_ID');
  const clientId = Deno.env.get('MS_GRAPH_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_GRAPH_CLIENT_SECRET');
  if (!tenantId || !clientId || !clientSecret) throw new Error('SharePoint credentials are not configured.');

  const response = await fetchWithTimeout(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  }, GRAPH_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Microsoft Graph authentication failed (${response.status}).`);
  return String((await response.json()).access_token);
};

const resolveDriveId = (config: Record<string, any>, entityType: string) => {
  const storageType = entityType === 'realization' ? 'realizace' : entityType;
  return config?.targets?.[storageType]?.driveId || config?.driveId || null;
};

const downloadSharePointFile = async (connection: Record<string, any>, entityType: string, fileId: string) => {
  const driveId = resolveDriveId(connection.config || {}, entityType);
  if (!driveId) throw new Error('SharePoint drive is not configured for this record type.');
  const token = await getGraphToken();
  const response = await fetchWithTimeout(
    `${GRAPH_ROOT}/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(fileId)}/content`,
    { headers: { Authorization: `Bearer ${token}` } },
    GRAPH_TIMEOUT_MS,
  );
  if (!response.ok) throw new Error(`Contract download from SharePoint failed (${response.status}).`);
  return new Uint8Array(await response.arrayBuffer());
};

const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = '';
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunk, bytes.length)));
  }
  return btoa(binary);
};

const sha256 = async (bytes: Uint8Array) => Array.from(
  new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
).map((value) => value.toString(16).padStart(2, '0')).join('');

const schema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'document_type', 'contract_number', 'contract_date', 'effective_date', 'completion_date',
    'currency', 'contract_value_excl_vat', 'vat_rate', 'contract_value_incl_vat',
    'payment_terms_days', 'advance_percent', 'retention_percent', 'customer_name',
    'supplier_name', 'milestones', 'warnings', 'confidence',
  ],
  properties: {
    document_type: { type: 'string', enum: ['contract', 'amendment', 'order', 'unknown'] },
    contract_number: { type: ['string', 'null'] },
    contract_date: { type: ['string', 'null'] },
    effective_date: { type: ['string', 'null'] },
    completion_date: { type: ['string', 'null'] },
    currency: { type: 'string' },
    contract_value_excl_vat: { type: ['number', 'null'] },
    vat_rate: { type: ['number', 'null'] },
    contract_value_incl_vat: { type: ['number', 'null'] },
    payment_terms_days: { type: ['integer', 'null'] },
    advance_percent: { type: ['number', 'null'] },
    retention_percent: { type: ['number', 'null'] },
    customer_name: { type: ['string', 'null'] },
    supplier_name: { type: ['string', 'null'] },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'sequence_number', 'name', 'condition_text', 'performance_date', 'planned_issue_date',
          'due_date', 'due_days', 'amount_excl_vat', 'vat_rate', 'percent_of_contract',
          'confidence', 'evidence',
        ],
        properties: {
          sequence_number: { type: 'integer' },
          name: { type: 'string' },
          condition_text: { type: ['string', 'null'] },
          performance_date: { type: ['string', 'null'] },
          planned_issue_date: { type: ['string', 'null'] },
          due_date: { type: ['string', 'null'] },
          due_days: { type: ['integer', 'null'] },
          amount_excl_vat: { type: ['number', 'null'] },
          vat_rate: { type: ['number', 'null'] },
          percent_of_contract: { type: ['number', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidence: { type: 'string' },
        },
      },
    },
    warnings: { type: 'array', items: { type: 'string' } },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
  },
};

const outputText = (payload: Record<string, any>) => {
  if (typeof payload.output_text === 'string') return payload.output_text;
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === 'output_text' && content.text) return content.text;
    }
  }
  for (const step of payload.steps || []) {
    if (step.type !== 'model_output') continue;
    for (const content of step.content || []) {
      if ((content.type === 'text' || content.type === 'output_text') && content.text) {
        return content.text;
      }
    }
  }
  throw new Error('AI response did not contain structured output.');
};

const extractionPrompt = [
  'Jsi přesný analytik českých smluv. Vyčti pouze údaje výslovně obsažené v dokumentu.',
  'Najdi cenu smlouvy, DPH, splatnost, zálohy, zádržné a všechny fakturační nebo platební etapy.',
  'Datum vrať jako YYYY-MM-DD. Co v dokumentu není, vrať jako null a nic neodhaduj.',
  'Ke každé etapě přidej krátký důkaz z příslušného ustanovení a confidence 0 až 1.',
  'Rozliš cenu bez DPH a s DPH. Upozorni na rozpory, neúplné podmínky a součty, které nedávají 100 %.',
].join('\n');

const analyzeWithGemini = async ({
  apiKey,
  model,
  bytes,
  mimeType,
}: {
  apiKey: string;
  model: string;
  bytes: Uint8Array;
  mimeType: string;
}) => {
  const response = await fetchWithTimeout('https://generativelanguage.googleapis.com/v1beta/interactions', {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      input: [
        { type: 'document', data: bytesToBase64(bytes), mime_type: mimeType },
        { type: 'text', text: extractionPrompt },
      ],
      response_format: {
        type: 'text',
        mime_type: 'application/json',
        schema,
      },
    }),
  }, AI_TIMEOUT_MS);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gemini contract analysis failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return JSON.parse(outputText(await response.json()));
};

const analyzeWithOpenAI = async ({
  apiKey,
  model,
  bytes,
  mimeType,
  fileName,
}: {
  apiKey: string;
  model: string;
  bytes: Uint8Array;
  mimeType: string;
  fileName: string;
}) => {
  const encodedFile = `data:${mimeType};base64,${bytesToBase64(bytes)}`;
  const fileInput = mimeType.startsWith('image/')
    ? { type: 'input_image', image_url: encodedFile, detail: 'high' }
    : { type: 'input_file', filename: fileName, file_data: encodedFile };
  const response = await fetchWithTimeout('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      store: false,
      max_output_tokens: 12000,
      input: [{
        role: 'user',
        content: [fileInput, { type: 'input_text', text: extractionPrompt }],
      }],
      text: { format: { type: 'json_schema', name: 'contract_finance_extraction', strict: true, schema } },
    }),
  }, AI_TIMEOUT_MS);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI contract analysis failed (${response.status}): ${detail.slice(0, 500)}`);
  }
  return JSON.parse(outputText(await response.json()));
};

const validDate = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
const allowedVat = (value: unknown) => value == null ? null : [0, 12, 21].includes(Number(value)) ? Number(value) : null;
const nonNegativeNumber = (value: unknown) => {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const validateExtraction = (raw: Record<string, any>) => {
  const warnings = Array.isArray(raw.warnings) ? raw.warnings.map(String) : [];
  raw.contract_date = validDate(raw.contract_date);
  raw.effective_date = validDate(raw.effective_date);
  raw.completion_date = validDate(raw.completion_date);
  raw.vat_rate = allowedVat(raw.vat_rate);
  raw.currency = String(raw.currency || 'CZK').toUpperCase();
  raw.contract_value_excl_vat = nonNegativeNumber(raw.contract_value_excl_vat);
  raw.contract_value_incl_vat = nonNegativeNumber(raw.contract_value_incl_vat);
  raw.payment_terms_days = nonNegativeNumber(raw.payment_terms_days);
  raw.advance_percent = nonNegativeNumber(raw.advance_percent);
  raw.retention_percent = nonNegativeNumber(raw.retention_percent);

  if (raw.currency !== 'CZK') warnings.push(`Smlouva používá měnu ${raw.currency}; automatické doplnění hodnoty zakázky vyžaduje ruční kontrolu kurzu.`);
  if (raw.contract_value_excl_vat != null && raw.contract_value_incl_vat != null && raw.vat_rate != null) {
    const expected = Number(raw.contract_value_excl_vat) * (1 + Number(raw.vat_rate) / 100);
    if (Math.abs(expected - Number(raw.contract_value_incl_vat)) > 2) warnings.push('Součet bez DPH, sazba DPH a částka s DPH si neodpovídají.');
  }

  let milestoneTotal = 0;
  let percentTotal = 0;
  raw.milestones = (raw.milestones || []).map((item: Record<string, any>, index: number) => {
    item.sequence_number = Number(item.sequence_number || index + 1);
    item.performance_date = validDate(item.performance_date);
    item.planned_issue_date = validDate(item.planned_issue_date);
    item.due_date = validDate(item.due_date);
    item.vat_rate = allowedVat(item.vat_rate) ?? raw.vat_rate;
    item.amount_excl_vat = nonNegativeNumber(item.amount_excl_vat);
    item.percent_of_contract = nonNegativeNumber(item.percent_of_contract);
    item.due_days = nonNegativeNumber(item.due_days);
    if (item.due_date && item.planned_issue_date && item.due_date < item.planned_issue_date) {
      warnings.push(`Etapa ${item.sequence_number}: datum splatnosti je dříve než plánované vystavení.`);
      item.due_date = null;
    }
    if (item.amount_excl_vat == null && item.percent_of_contract != null && raw.contract_value_excl_vat != null) {
      item.amount_excl_vat = Math.round(Number(raw.contract_value_excl_vat) * Number(item.percent_of_contract)) / 100;
    }
    milestoneTotal += Number(item.amount_excl_vat || 0);
    percentTotal += Number(item.percent_of_contract || 0);
    return item;
  });
  if (raw.contract_value_excl_vat != null && milestoneTotal > 0 && Math.abs(milestoneTotal - Number(raw.contract_value_excl_vat)) > 2) {
    warnings.push('Součet platebních etap neodpovídá ceně smlouvy bez DPH.');
  }
  if (percentTotal > 100.5) warnings.push('Součet procent platebních etap přesahuje 100 %.');
  raw.warnings = [...new Set(warnings)];
  return raw;
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  let jobId: string | null = null;
  let admin: ReturnType<typeof createClient> | null = null;

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration.');
    const provider = String(Deno.env.get('CONTRACT_AI_PROVIDER') || (geminiKey ? 'gemini' : 'openai')).toLowerCase();
    if (!['gemini', 'openai'].includes(provider)) throw new Error('CONTRACT_AI_PROVIDER must be gemini or openai.');
    if (provider === 'gemini' && !geminiKey) throw new Error('GEMINI_API_KEY is not configured in Supabase secrets.');
    if (provider === 'openai' && !openAiKey) throw new Error('OPENAI_API_KEY is not configured in Supabase secrets.');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ success: false, error: 'Missing authorization.' }, 401);
    admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return json({ success: false, error: 'Invalid session.' }, 401);
    await assertActiveAccount(admin, user.id);

    const { data: member } = await admin.from('members').select('user_role').eq('auth_user_id', user.id).maybeSingle();
    if (String(member?.user_role || '').toLowerCase() !== 'admin') return json({ success: false, error: 'Admin access required.' }, 403);

    const body = await req.json();
    const entityType = String(body.entityType || '');
    const storageEntityType = String(body.storageEntityType || entityType);
    const entityId = String(body.entityId || '');
    const fileId = String(body.fileId || '');
    const fileName = String(body.fileName || 'contract.pdf');
    const mimeType = String(body.mimeType || 'application/pdf');
    if (!['project', 'realization'].includes(entityType) || !entityId || !body.connectionId || !fileId) {
      return json({ success: false, error: 'Invalid contract source or target.' }, 400);
    }
    if (!['project', 'realization', 'realizace', 'invoice'].includes(storageEntityType)) {
      return json({ success: false, error: 'Invalid contract storage target.' }, 400);
    }
    if (!ALLOWED_TYPES.has(mimeType)) return json({ success: false, error: 'Unsupported contract file type.' }, 400);

    const { data: connection, error: connectionError } = await admin
      .from('document_storage_connections').select('*').eq('id', body.connectionId).single();
    if (connectionError || !connection) throw new Error('Storage connection was not found.');
    if (connection.provider !== 'sharepoint' || connection.status !== 'active') {
      return json({ success: false, error: 'An active SharePoint connection is required.' }, 400);
    }

    const targetTable = entityType === 'project' ? 'projects' : 'realizations';
    const { data: target } = await admin.from(targetTable).select('id').eq('id', entityId).maybeSingle();
    if (!target) return json({ success: false, error: 'Target project or realization was not found.' }, 404);

    if (storageEntityType === 'invoice') {
      const ownerType = entityType === 'realization' ? 'realizace' : entityType;
      const { data: registeredFile } = await admin
        .from('document_storage_files')
        .select('id')
        .eq('connection_id', body.connectionId)
        .eq('entity_type', 'invoice')
        .eq('external_file_id', fileId)
        .eq('owner_type', ownerType)
        .eq('owner_id', entityId)
        .maybeSingle();
      if (!registeredFile) {
        return json({ success: false, error: 'The central contract file is not registered for this project or realization.' }, 403);
      }
    }

    const bytes = await downloadSharePointFile(connection, storageEntityType, fileId);
    if (bytes.byteLength === 0) throw new Error('Contract file is empty.');
    if (bytes.byteLength > MAX_FILE_SIZE) throw new Error('Contract file exceeds the 20 MB analysis limit.');
    const hash = await sha256(bytes);
    const targetColumn = entityType === 'project' ? 'project_id' : 'realization_id';
    const { data: duplicate } = await admin
      .from('contract_extraction_jobs')
      .select('id,status')
      .eq(targetColumn, entityId)
      .eq('source_sha256', hash)
      .in('status', ['review', 'approved'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (duplicate) {
      return json({ success: true, duplicate: true, extractionId: duplicate.id, status: duplicate.status });
    }

    const jobPayload: Record<string, unknown> = {
      entity_type: entityType,
      project_id: entityType === 'project' ? entityId : null,
      realization_id: entityType === 'realization' ? entityId : null,
      source_connection_id: body.connectionId,
      source_file_id: fileId,
      source_file_name: fileName,
      source_web_url: body.webUrl || null,
      source_mime_type: mimeType,
      source_sha256: hash,
      prompt_version: PROMPT_VERSION,
      created_by: user.id,
    };
    const { data: job, error: jobError } = await admin.from('contract_extraction_jobs').insert(jobPayload).select('id').single();
    if (jobError) throw jobError;
    jobId = job.id;

    const model = provider === 'gemini'
      ? Deno.env.get('GEMINI_CONTRACT_EXTRACTION_MODEL') || 'gemini-3.5-flash'
      : Deno.env.get('OPENAI_CONTRACT_EXTRACTION_MODEL') || Deno.env.get('CONTRACT_EXTRACTION_MODEL') || 'gpt-5-mini';
    const rawExtraction = provider === 'gemini'
      ? await analyzeWithGemini({ apiKey: geminiKey!, model, bytes, mimeType })
      : await analyzeWithOpenAI({ apiKey: openAiKey!, model, bytes, mimeType, fileName });
    const extracted = validateExtraction(rawExtraction);
    const milestoneRows = extracted.milestones.map((item: Record<string, any>) => ({
      extraction_id: jobId,
      sequence_number: item.sequence_number,
      name: item.name,
      condition_text: item.condition_text,
      performance_date: item.performance_date,
      planned_issue_date: item.planned_issue_date,
      due_date: item.due_date,
      due_days: item.due_days,
      amount_excl_vat: item.amount_excl_vat,
      vat_rate: item.vat_rate,
      percent_of_contract: item.percent_of_contract,
      evidence: item.evidence,
      confidence: item.confidence,
      accepted: item.confidence >= 0.8 && Boolean(item.evidence) && (item.amount_excl_vat != null || item.percent_of_contract != null),
    }));
    if (milestoneRows.length) {
      const { error } = await admin.from('contract_extraction_milestones').insert(milestoneRows);
      if (error) throw error;
    }

    const { error: updateError } = await admin.from('contract_extraction_jobs').update({
      status: 'review', model, source_sha256: hash, confidence: extracted.confidence,
      extracted_data: extracted, warnings: extracted.warnings, updated_at: new Date().toISOString(),
    }).eq('id', jobId);
    if (updateError) throw updateError;
    await admin.from('audit_logs').insert({
      user_id: user.id,
      user_email: user.email || null,
      action: 'contract_extraction_created',
      details: { extraction_id: jobId, entity_type: entityType, entity_id: entityId, provider, model, prompt_version: PROMPT_VERSION },
    });
    return json({ success: true, extractionId: jobId, extraction: extracted });
  } catch (error) {
    if (admin && jobId) {
      await admin.from('contract_extraction_jobs').update({
        status: 'failed', error_message: error instanceof Error ? error.message : String(error), updated_at: new Date().toISOString(),
      }).eq('id', jobId);
    }
    return json({ success: false, error: error instanceof Error ? error.message : String(error) }, (error as { status?: number }).status || 500);
  }
});
