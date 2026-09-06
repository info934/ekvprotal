import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.30.0';
import { corsHeaders } from '../_shared/cors.ts';
import { fetchWithTimeout } from '../_shared/fetch.ts';
import { assertActiveAccount } from '../_shared/accountStatus.ts';
import { assertInvoiceFileDetached } from '../_shared/invoiceDeletionGuard.ts';
import { strToU8, zipSync } from 'npm:fflate@0.8.2';

type StorageAction = 'testConnection' | 'ensureFolder' | 'repairFolder' | 'getStatus' | 'initializeProjectWorkspace' | 'createUploadSession' | 'registerUploadedFile' | 'uploadFile' | 'downloadUrl' | 'listFiles' | 'deleteFile';
type EntityType = 'project' | 'realizace' | 'service' | 'product' | 'invoice';

type StorageTarget = {
  siteId?: string;
  driveId?: string;
  rootFolderId?: string;
  rootFolderPath?: string;
  structure?: string[];
  projectFolderName?: string;
  organizeProjectsByYear?: boolean;
  realizationFolderName?: string;
  organizeRealizationsByYear?: boolean;
  activeFolderName?: string;
  completedFolderName?: string;
  completedStatuses?: string[];
  costInvoiceFolderPath?: string;
  commercialContractFolderPath?: string;
  customerInvoiceFolderPath?: string;
};

type StorageConnection = {
  id: string;
  provider: string;
  status: string;
  config: Record<string, unknown> & {
    siteId?: string;
    driveId?: string;
    rootFolderId?: string;
    rootFolderPath?: string;
    projectStructure?: string[];
    realizationStructure?: string[];
    targets?: Partial<Record<EntityType, StorageTarget>>;
  };
};

const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const GRAPH_TOKEN_EXPIRY_BUFFER_MS = 60_000;
let graphTokenCache: { token: string; expiresAt: number } | null = null;
let graphTokenRequest: Promise<string> | null = null;
const ALLOWED_ENTITY_TYPES = new Set<EntityType>(['project', 'realizace', 'service', 'product', 'invoice']);
const MAX_INVOICE_FILE_SIZE = 10 * 1024 * 1024;
const ALLOWED_INVOICE_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];
const ALLOWED_INVOICE_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/octet-stream',
]);
const MAX_CONTRACT_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_CONTRACT_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.webp'];
const ALLOWED_CONTRACT_CONTENT_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/octet-stream',
]);
const COMMERCIAL_DOCUMENT_FOLDERS: Record<string, string> = {
  'obchodni-smlouva': 'Obchodni smlouvy',
  'odberatelska-faktura': 'Odberatelske faktury',
};
const ENTITY_PERMISSION_MODULES: Record<EntityType, string[]> = {
  project: ['projects', 'documents'],
  realizace: ['realizace', 'projects', 'documents'],
  service: ['service'],
  product: ['crm'],
  invoice: ['payouts', 'projects'],
};

const jsonResponse = (body: Record<string, unknown>, status = 200) => new Response(
  JSON.stringify(body),
  { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
);

const safeSegment = (value: unknown) => String(value || '')
  .trim()
  .replace(/[~"#%&*:<>?/\\{|}]+/g, '-')
  .replace(/[. ]+$/g, '')
  .slice(0, 120);

const normalizeEntityFolderCode = (value: unknown) => String(value || '')
  .normalize('NFC')
  .replace(/[~"#%&*:<>?/\\{|}]+/g, '-')
  .replace(/\s+/g, '-')
  .replace(/-+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48);

const normalizeEntityFolderName = (value: unknown) => String(value || '')
  .normalize('NFC')
  .replace(/[~"#%&*:<>?/\\{|}]+/g, '-')
  .replace(/\s+/g, ' ')
  .replace(/^\s*-+\s*/, '')
  .replace(/\s*-+\s*$/, '')
  .replace(/[. ]+$/g, '')
  .trim()
  .slice(0, 90);

const normalizePath = (...parts: Array<string | undefined>) => parts
  .flatMap((part) => String(part || '').split('/'))
  .filter((part) => part.trim().length > 0)
  .map(safeSegment)
  .filter(Boolean)
  .join('/');

const invoiceCategory = (body: Record<string, unknown>) => {
  const metadata = body.metadata && typeof body.metadata === 'object'
    ? body.metadata as Record<string, unknown>
    : {};
  return String(metadata.category || '');
};

const assertInvoiceFile = (fileName: unknown, contentType: unknown, fileSize: unknown, category = '') => {
  const normalizedName = String(fileName || '').trim().toLowerCase();
  const normalizedContentType = String(contentType || 'application/octet-stream').split(';')[0].trim().toLowerCase();
  const normalizedSize = Number(fileSize || 0);
  const isContract = category === 'obchodni-smlouva';
  const allowedExtensions = isContract ? ALLOWED_CONTRACT_EXTENSIONS : ALLOWED_INVOICE_EXTENSIONS;
  const allowedContentTypes = isContract ? ALLOWED_CONTRACT_CONTENT_TYPES : ALLOWED_INVOICE_CONTENT_TYPES;
  const maxSize = isContract ? MAX_CONTRACT_FILE_SIZE : MAX_INVOICE_FILE_SIZE;
  if (!allowedExtensions.some((extension) => normalizedName.endsWith(extension))) {
    const error = new Error(isContract
      ? 'Contract must be a PDF, DOC, DOCX, TXT, JPG, PNG or WEBP file.'
      : 'Invoice must be a PDF, JPG or PNG file.') as Error & { status?: number };
    error.status = 415;
    throw error;
  }
  if (!allowedContentTypes.has(normalizedContentType)) {
    const error = new Error(isContract ? 'Contract content type is not allowed.' : 'Invoice content type is not allowed.') as Error & { status?: number };
    error.status = 415;
    throw error;
  }
  if (!Number.isFinite(normalizedSize) || normalizedSize <= 0 || normalizedSize > maxSize) {
    const error = new Error(`${isContract ? 'Contract' : 'Invoice'} file must be between 1 byte and ${isContract ? 20 : 10} MB.`) as Error & { status?: number };
    error.status = 413;
    throw error;
  }
};

const graphError = async (response: Response) => {
  const payload = await response.json().catch(() => ({}));
  const message = payload?.error?.message || `Microsoft Graph returned ${response.status}.`;
  const error = new Error(message) as Error & { status?: number; code?: string };
  error.status = response.status;
  error.code = payload?.error?.code;
  return error;
};

const getGraphToken = async () => {
  if (graphTokenCache && graphTokenCache.expiresAt > Date.now() + GRAPH_TOKEN_EXPIRY_BUFFER_MS) {
    return graphTokenCache.token;
  }
  if (graphTokenRequest) return graphTokenRequest;

  const tenantId = Deno.env.get('MS_GRAPH_TENANT_ID');
  const clientId = Deno.env.get('MS_GRAPH_CLIENT_ID');
  const clientSecret = Deno.env.get('MS_GRAPH_CLIENT_SECRET');

  if (!tenantId || !clientId || !clientSecret) {
    throw new Error('SharePoint credentials are not configured in Supabase secrets.');
  }

  graphTokenRequest = (async () => {
    const response = await fetchWithTimeout(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    });

    if (!response.ok) throw await graphError(response);
    const data = await response.json();
    const token = String(data.access_token);
    graphTokenCache = {
      token,
      expiresAt: Date.now() + Math.max(Number(data.expires_in || 3600) * 1000, 60_000),
    };
    return token;
  })().finally(() => {
    graphTokenRequest = null;
  });

  return graphTokenRequest;
};

type StorageFolderMapping = {
  external_folder_id: string | null;
  external_web_url?: string | null;
  folder_path: string | null;
  attempt_count?: number | null;
  metadata?: Record<string, unknown> | null;
};

const graphFetch = async (token: string, path: string, init: RequestInit = {}) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchWithTimeout(`${GRAPH_ROOT}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...init.headers },
    });
    if (response.ok) return response.status === 204 ? null : response.json();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) throw await graphError(response);
    const retryAfter = Math.min(Number(response.headers.get('Retry-After') || 0) * 1000, 15_000);
    await new Promise((resolve) => setTimeout(resolve, retryAfter || (500 * (2 ** attempt))));
  }
  throw new Error('Microsoft Graph retry limit reached.');
};

const graphFetchAbsolute = async (token: string, url: string) => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetchWithTimeout(url, { headers: { Authorization: `Bearer ${token}` } });
    if (response.ok) return response.json();
    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === 3) throw await graphError(response);
    const retryAfter = Math.min(Number(response.headers.get('Retry-After') || 0) * 1000, 15_000);
    await new Promise((resolve) => setTimeout(resolve, retryAfter || (500 * (2 ** attempt))));
  }
  throw new Error('Microsoft Graph retry limit reached.');
};

const collectGraphPages = async (token: string, firstPath: string) => {
  const values: Array<Record<string, unknown>> = [];
  const visited = new Set<string>();
  let page = await graphFetch(token, firstPath);
  for (let pageNumber = 0; pageNumber < 25; pageNumber += 1) {
    values.push(...(page?.value || []));
    if (values.length >= 2_000) return values.slice(0, 2_000);
    const nextLink = page?.['@odata.nextLink'];
    if (!nextLink) break;
    if (visited.has(String(nextLink))) throw new Error('Microsoft Graph pagination returned a repeated page.');
    visited.add(String(nextLink));
    page = await graphFetchAbsolute(token, String(nextLink));
  }
  return values;
};

const resolveTarget = (connection: StorageConnection, entityType: EntityType): StorageTarget => {
  const config = connection.config || {};
  const configured = entityType === 'service'
    ? (config.targets?.service || config.targets?.realizace)
    : config.targets?.[entityType];
  const fallbackStructure = entityType === 'project'
    ? config.projectStructure
    : entityType === 'realizace'
      ? config.realizationStructure
      : [];

  const target = {
    siteId: configured?.siteId || config.siteId,
    driveId: configured?.driveId || config.driveId,
    rootFolderId: configured?.rootFolderId || config.rootFolderId,
    rootFolderPath: configured?.rootFolderPath ?? config.rootFolderPath,
    structure: configured?.structure || fallbackStructure || [],
    projectFolderName: configured?.projectFolderName,
    organizeProjectsByYear: configured?.organizeProjectsByYear,
    realizationFolderName: configured?.realizationFolderName,
    organizeRealizationsByYear: configured?.organizeRealizationsByYear,
    activeFolderName: configured?.activeFolderName,
    completedFolderName: configured?.completedFolderName,
    completedStatuses: configured?.completedStatuses,
    costInvoiceFolderPath: configured?.costInvoiceFolderPath,
    commercialContractFolderPath: configured?.commercialContractFolderPath,
    customerInvoiceFolderPath: configured?.customerInvoiceFolderPath,
  };

  if (!target.driveId) throw new Error(`SharePoint drive is not configured for ${entityType}.`);
  return target;
};

const getChildByName = async (token: string, driveId: string, parentId: string, name: string) => {
  const values = await collectGraphPages(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parentId)}/children?$select=id,name,webUrl,folder&$top=200`,
  );
  return values.find((item: { name?: unknown }) => String(item.name || '').localeCompare(name, undefined, { sensitivity: 'accent' }) === 0) || null;
};

const ensurePath = async (token: string, target: StorageTarget, folderPath: string) => {
  const driveId = String(target.driveId);
  const combinedPath = normalizePath(target.rootFolderPath, folderPath);
  const segments = combinedPath.split('/').filter(Boolean);
  let parent = target.rootFolderId
    ? await graphFetch(token, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(target.rootFolderId)}`)
    : await graphFetch(token, `/drives/${encodeURIComponent(driveId)}/root`);

  for (const segment of segments) {
    let item = await getChildByName(token, driveId, parent.id, segment);

    if (!item) {
      try {
        item = await graphFetch(token, `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(parent.id)}/children`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: segment,
            folder: {},
            '@microsoft.graph.conflictBehavior': 'fail',
          }),
        });
      } catch (error) {
        if ((error as { status?: number }).status !== 409) throw error;
        item = await getChildByName(token, driveId, parent.id, segment);
        if (!item) throw error;
      }
    }
    parent = item;
  }

  return { item: parent, folderPath: combinedPath };
};

const ensureStructure = async (token: string, target: StorageTarget, baseFolderId: string) => {
  const created: Array<{ id: string; name: string; path: string; webUrl?: string }> = [];
  const knownFolders = new Map<string, { id: string; name: string; webUrl?: string }>();

  for (const configuredPath of target.structure || []) {
    const segments = String(configuredPath).split('/').map(safeSegment).filter(Boolean);
    let parentId = baseFolderId;
    let currentPath = '';
    let item: { id: string; name: string; webUrl?: string } | null = null;

    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      item = knownFolders.get(currentPath) || await getChildByName(token, String(target.driveId), parentId, segment);

      if (!item) {
        try {
          item = await graphFetch(
            token,
            `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(parentId)}/children`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                name: segment,
                folder: {},
                '@microsoft.graph.conflictBehavior': 'fail',
              }),
            },
          );
        } catch (error) {
          if ((error as { status?: number }).status !== 409) throw error;
          item = await getChildByName(token, String(target.driveId), parentId, segment);
          if (!item) throw error;
        }
      }

      knownFolders.set(currentPath, item);
      parentId = item.id;
    }

    if (item) created.push({ id: item.id, name: item.name, path: currentPath, webUrl: item.webUrl });
  }
  return created;
};

const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const escapeXml = (value: unknown) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

const wordParagraph = (text: unknown, options: { bold?: boolean; size?: number; color?: string; spacingAfter?: number } = {}) => {
  const runProperties = [
    options.bold ? '<w:b/>' : '',
    options.size ? `<w:sz w:val="${options.size}"/><w:szCs w:val="${options.size}"/>` : '',
    options.color ? `<w:color w:val="${options.color}"/>` : '',
  ].join('');
  const paragraphProperties = options.spacingAfter
    ? `<w:pPr><w:spacing w:after="${options.spacingAfter}"/></w:pPr>`
    : '';
  return `<w:p>${paragraphProperties}<w:r><w:rPr>${runProperties}</w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
};

const wordTableRow = (label: string, value: unknown) => `<w:tr>
  <w:tc><w:tcPr><w:tcW w:w="2600" w:type="dxa"/><w:shd w:fill="EAF0FB"/></w:tcPr>${wordParagraph(label, { bold: true, color: '244B86' })}</w:tc>
  <w:tc><w:tcPr><w:tcW w:w="6500" w:type="dxa"/></w:tcPr>${wordParagraph(value || '—')}</w:tc>
</w:tr>`;

const formatWorkspaceDate = (value: unknown) => {
  if (!value) return '—';
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? String(value) : new Intl.DateTimeFormat('cs-CZ').format(parsed);
};

const createProjectWorkspaceDocx = (input: {
  project: Record<string, unknown>;
  investor?: Record<string, unknown> | null;
  client?: Record<string, unknown> | null;
  manager?: Record<string, unknown> | null;
  opportunity?: Record<string, unknown> | null;
}) => {
  const { project, investor, client, manager, opportunity } = input;
  const partyLine = (party?: Record<string, unknown> | null) => [party?.name, party?.ico ? `IČO ${party.ico}` : '', party?.dic ? `DIČ ${party.dic}` : ''].filter(Boolean).join(' · ') || '—';
  const contactLine = (party?: Record<string, unknown> | null) => [party?.contact_person, party?.email, party?.phone].filter(Boolean).join(' · ') || '—';
  const generatedAt = new Date().toISOString();
  const rows = [
    ['Kód projektu', project.code],
    ['Název projektu', project.name],
    ['Stav', project.status],
    ['Typ projektu', project.type],
    ['Investor', partyLine(investor)],
    ['Investor – kontakt', contactLine(investor)],
    ['Investor – adresa', investor?.address],
    ['Objednatel / klient', partyLine(client)],
    ['Klient – kontakt', contactLine(client)],
    ['Klient – adresa', client?.address],
    ['Vedoucí projektu', [manager?.name, manager?.email, manager?.phone].filter(Boolean).join(' · ')],
    ['Místo stavby', project.location],
    ['Interní reference klienta', project.client_internal_ref],
    ['Zahájení', formatWorkspaceDate(project.start_date)],
    ['Termín dokončení', formatWorkspaceDate(project.completion_date)],
    ['Zdrojová obchodní příležitost', [opportunity?.number, opportunity?.title].filter(Boolean).join(' · ')],
  ];
  const table = `<w:tbl><w:tblPr><w:tblW w:w="9100" w:type="dxa"/><w:tblBorders>
    <w:top w:val="single" w:sz="4" w:color="CBD5E1"/><w:left w:val="single" w:sz="4" w:color="CBD5E1"/>
    <w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/><w:right w:val="single" w:sz="4" w:color="CBD5E1"/>
    <w:insideH w:val="single" w:sz="4" w:color="E2E8F0"/><w:insideV w:val="single" w:sz="4" w:color="E2E8F0"/>
  </w:tblBorders></w:tblPr>${rows.map(([label, value]) => wordTableRow(String(label), value)).join('')}</w:tbl>`;
  const brief = String(project.brief || '').trim() || 'Rozsah a cíle projektu zatím nejsou doplněny.';
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  ${wordParagraph('EKV PROJECT', { bold: true, size: 22, color: '2563EB', spacingAfter: 100 })}
  ${wordParagraph('ZÁKLADNÍ ÚDAJE PROJEKTU', { bold: true, size: 36, color: '0F172A', spacingAfter: 260 })}
  ${table}
  ${wordParagraph('Zadání a rozsah', { bold: true, size: 26, color: '0F172A', spacingAfter: 100 })}
  ${wordParagraph(brief, { size: 21, spacingAfter: 220 })}
  ${wordParagraph('Kontrolní seznam vstupních podkladů', { bold: true, size: 26, color: '0F172A', spacingAfter: 100 })}
  ${wordParagraph('☐ Smlouva nebo objednávka  ☐ Zaměření / výkresy  ☐ Technické zadání investora')}
  ${wordParagraph('☐ Požadavky dotčených orgánů  ☐ Harmonogram  ☐ Kontaktní osoby')}
  ${wordParagraph(`Automaticky synchronizováno z EKV portálu: ${formatWorkspaceDate(generatedAt)}`, { size: 17, color: '64748B', spacingAfter: 100 })}
  <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1000" w:right="1000" w:bottom="1000" w:left="1000"/></w:sectPr>
</w:body></w:document>`;

  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'),
    'word/document.xml': strToU8(documentXml),
    'word/styles.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="21"/></w:rPr></w:style></w:styles>'),
    'word/_rels/document.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'),
    'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(`Projektový list ${project.code || ''}`)}</dc:title><dc:creator>EKV Project</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${generatedAt}</dcterms:modified></cp:coreProperties>`),
    'docProps/app.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>EKV Portal</Application></Properties>'),
  }, { level: 6 });
};

const getEntityFolderMapping = async (
  admin: ReturnType<typeof createClient>,
  connectionId: string,
  entityType: EntityType,
  entityId: string,
) => {
  const { data, error } = await admin
    .from('document_storage_folders')
    .select('external_folder_id, external_web_url, folder_path, desired_folder_path, status, attempt_count, last_error, last_attempt_at, next_retry_at, last_verified_at, metadata')
    .eq('connection_id', connectionId)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .maybeSingle();

  if (error) throw error;
  return data as StorageFolderMapping | null;
};

const assertFolderPathBelongsToEntity = (
  folderPath: string,
  mapping: StorageFolderMapping | null,
  target: StorageTarget,
) => {
  if (!mapping?.folder_path) return;
  const normalizedRequested = normalizePath(target.rootFolderPath, folderPath);
  const normalizedRoot = normalizePath(mapping.folder_path);
  if (normalizedRequested !== normalizedRoot && !normalizedRequested.startsWith(`${normalizedRoot}/`)) {
    const error = new Error('Requested folder is outside the mapped entity folder.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
};

const isItemAtOrBelowFolder = async (
  token: string,
  driveId: string,
  itemId: string,
  allowedFolderId: string,
) => {
  let currentId = itemId;
  for (let depth = 0; depth < 40 && currentId; depth += 1) {
    if (currentId === allowedFolderId) return true;
    const item = await graphFetch(
      token,
      `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(currentId)}?$select=id,parentReference`,
    );
    const parentId = item?.parentReference?.id;
    if (!parentId || parentId === currentId) return false;
    currentId = parentId;
  }
  return false;
};

const assertItemBelongsToEntityFolder = async (
  token: string,
  target: StorageTarget,
  itemId: string,
  mapping: StorageFolderMapping | null,
) => {
  const allowedFolderId = mapping?.external_folder_id;
  if (!allowedFolderId) {
    const error = new Error('Entity folder mapping was not found.') as Error & { status?: number };
    error.status = 404;
    throw error;
  }

  const allowed = await isItemAtOrBelowFolder(token, String(target.driveId), itemId, allowedFolderId);
  if (!allowed) {
    const error = new Error('Requested SharePoint item is outside the mapped entity folder.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
};

const projectWorkspaceIsEnabled = async (
  admin: ReturnType<typeof createClient>,
  projectId: string,
) => {
  const { data, error } = await admin
    .from('project_workspace_preferences')
    .select('create_folder')
    .eq('project_id', projectId)
    .maybeSingle();
  if (error) throw error;
  return data?.create_folder !== false;
};

const getServerEntityFolderPath = async (
  admin: ReturnType<typeof createClient>,
  entityType: EntityType,
  entityId: string,
  target?: StorageTarget,
) => {
  if (entityType === 'invoice') return '';
  if (entityType === 'service') {
    const { data: serviceCase, error: serviceError } = await admin
      .from('service_cases')
      .select('id, number, title, realizace_id, reported_at, created_at')
      .eq('id', entityId)
      .maybeSingle();
    if (serviceError) throw serviceError;
    if (!serviceCase) {
      const notFound = new Error('Service case was not found.') as Error & { status?: number };
      notFound.status = 404;
      throw notFound;
    }
    const serviceLabel = [
      normalizeEntityFolderCode(serviceCase.number),
      normalizeEntityFolderName(serviceCase.title),
    ].filter(Boolean).join(' - ') || serviceCase.id;
    if (serviceCase.realizace_id) {
      const realizationPath = await getServerEntityFolderPath(admin, 'realizace', String(serviceCase.realizace_id), target);
      return normalizePath(realizationPath, 'Servis', serviceLabel);
    }
    const serviceYear = [serviceCase.reported_at, serviceCase.created_at]
      .map((value) => value ? new Date(String(value)).getUTCFullYear() : NaN)
      .find((value) => Number.isInteger(value) && value >= 2000 && value <= 2100);
    return normalizePath('Servis', 'Samostatne', String(serviceYear || new Date().getUTCFullYear()), serviceLabel);
  }
  const table = entityType === 'project'
    ? 'projects'
    : entityType === 'realizace'
      ? 'realizations'
      : 'commercial_item_catalog';
  const select = entityType === 'project'
    ? 'id, code, name, status, start_date, created_at'
    : entityType === 'realizace'
      ? 'id, name, status, start_date, created_at'
      : 'id, code, name';
  const { data, error } = await admin.from(table).select(select).eq('id', entityId).maybeSingle();
  if (error) throw error;
  if (!data) {
    const notFound = new Error('Storage entity was not found.') as Error & { status?: number };
    notFound.status = 404;
    throw notFound;
  }
  const code = entityType === 'realizace'
    ? `R-${String(data.id).slice(0, 8)}`
    : normalizeEntityFolderCode(data.code);
  const { data: preference, error: preferenceError } = entityType === 'project'
    ? await admin
      .from('project_workspace_preferences')
      .select('folder_name')
      .eq('project_id', entityId)
      .maybeSingle()
    : { data: null, error: null };
  if (preferenceError) throw preferenceError;
  const name = normalizeEntityFolderName(preference?.folder_name || data.name);
  const label = [code, name].filter(Boolean).join(' - ');
  if (entityType === 'realizace') {
    const realizationTarget = target || {};
    const datedYear = [data.start_date, data.created_at]
      .map((value) => value ? new Date(String(value)).getUTCFullYear() : NaN)
      .find((value) => Number.isInteger(value) && value >= 2000 && value <= 2100);
    const completedStatuses = Array.isArray(realizationTarget.completedStatuses) && realizationTarget.completedStatuses.length
      ? realizationTarget.completedStatuses.map(String)
      : ['Dokončeno', 'Předáno'];
    const statusFolder = completedStatuses.includes(String(data.status || ''))
      ? (realizationTarget.completedFolderName || 'Hotovo')
      : (realizationTarget.activeFolderName || 'Aktivni');
    const realizationFolderName = Object.prototype.hasOwnProperty.call(realizationTarget, 'realizationFolderName')
      ? String(realizationTarget.realizationFolderName || '')
      : '';
    return normalizePath(
      realizationFolderName,
      realizationTarget.organizeRealizationsByYear === false ? '' : String(datedYear || new Date().getUTCFullYear()),
      statusFolder,
      label || data.id,
    );
  }
  if (entityType !== 'project') {
    return normalizePath('products', label || data.id);
  }

  const projectTarget = target || {};
  const codeYear = String(data.code || '').match(/(?:^|[^0-9])(20[0-9]{2})(?:[^0-9]|$)/)?.[1]
    || String(data.code || '').match(/(?:^|[-_/ ])([0-9]{2})(?=[-_/ ])/i)?.[1];
  const datedYear = [data.start_date, data.created_at]
    .map((value) => value ? new Date(String(value)).getUTCFullYear() : NaN)
    .find((value) => Number.isInteger(value) && value >= 2000 && value <= 2100);
  const year = codeYear
    ? (codeYear.length === 2 ? `20${codeYear}` : codeYear)
    : String(datedYear || new Date().getUTCFullYear());
  const completedStatuses = Array.isArray(projectTarget.completedStatuses) && projectTarget.completedStatuses.length
    ? projectTarget.completedStatuses.map(String)
    : ['closed'];
  const statusFolder = completedStatuses.includes(String(data.status || ''))
    ? (projectTarget.completedFolderName || 'Hotovo')
    : (projectTarget.activeFolderName || 'Aktivni');
  const projectFolderName = Object.prototype.hasOwnProperty.call(projectTarget, 'projectFolderName')
    ? String(projectTarget.projectFolderName || '')
    : 'Projekty';
  return normalizePath(
    projectFolderName,
    projectTarget.organizeProjectsByYear === false ? '' : year,
    statusFolder,
    label || data.id,
  );
};

const reconcileMappedFolderLocation = async (
  token: string,
  target: StorageTarget,
  mapping: StorageFolderMapping,
  desiredPath: string,
) => {
  const driveId = String(target.driveId);
  const currentItem = await graphFetch(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(String(mapping.external_folder_id))}?$select=id,name,webUrl,parentReference`,
  );
  const desiredSegments = normalizePath(desiredPath).split('/').filter(Boolean);
  const desiredName = desiredSegments.pop();
  if (!desiredName) throw new Error('Project folder name is empty.');
  const desiredParent = await ensurePath(token, target, desiredSegments.join('/'));
  const alreadyPlaced = String(currentItem?.parentReference?.id || '') === String(desiredParent.item.id)
    && String(currentItem?.name || '') === desiredName;
  if (alreadyPlaced) {
    return { item: currentItem, folderPath: normalizePath(target.rootFolderPath, desiredPath), moved: false };
  }

  const collision = await getChildByName(token, driveId, String(desiredParent.item.id), desiredName);
  if (collision && String(collision.id) !== String(currentItem.id)) {
    throw new Error(`Cílová složka „${desiredName}“ už existuje. Přesun nebyl proveden, aby nedošlo ke sloučení cizích dokumentů.`);
  }

  const movedItem = await graphFetch(
    token,
    `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(String(currentItem.id))}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: desiredName,
        parentReference: { id: desiredParent.item.id },
      }),
    },
  );
  return { item: movedItem, folderPath: normalizePath(target.rootFolderPath, desiredPath), moved: true };
};

const ensureStatusFolders = async (
  token: string,
  target: StorageTarget,
  desiredEntityPath: string,
) => {
  const pathSegments = normalizePath(desiredEntityPath).split('/').filter(Boolean);
  pathSegments.pop(); // entity folder name
  pathSegments.pop(); // current status folder
  const basePath = pathSegments.join('/');
  const active = await ensurePath(token, target, normalizePath(basePath, target.activeFolderName || 'Aktivni'));
  const completed = await ensurePath(token, target, normalizePath(basePath, target.completedFolderName || 'Hotovo'));
  return {
    active: active.folderPath,
    completed: completed.folderPath,
  };
};

const assertInvoiceAccessLink = (entityId: string, accessEntityType: string, accessEntityId: string) => {
  if (['payout', 'hourly_payout'].includes(accessEntityType) && entityId !== accessEntityId) {
    const error = new Error('Invoice owner does not match the authorized payout.') as Error & { status?: number };
    error.status = 403;
    throw error;
  }
};

const resolveInvoiceFolderPath = (target: StorageTarget, body: Record<string, unknown>) => {
  const category = invoiceCategory(body);
  if (category === 'obchodni-smlouva') {
    return normalizePath(target.commercialContractFolderPath || COMMERCIAL_DOCUMENT_FOLDERS[category]);
  }
  if (category === 'odberatelska-faktura') {
    return normalizePath(target.customerInvoiceFolderPath || COMMERCIAL_DOCUMENT_FOLDERS[category]);
  }
  return String(body.folderPath || '');
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  let folderOperation: null | {
    admin: ReturnType<typeof createClient>;
    connectionId: string;
    entityType: string;
    entityId: string;
    desiredPath: string;
  } = null;
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) throw new Error('Missing Supabase service configuration.');

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return jsonResponse({ success: false, error: 'Missing authorization.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) return jsonResponse({ success: false, error: 'Invalid session.' }, 401);
    await assertActiveAccount(admin, user.id);

    const body = await req.json();
    const action = body.action as StorageAction;
    const provider = String(body.provider || 'sharepoint');
    const entityType = String(body.entityType || 'project') as EntityType;
    if (!action || !body.connectionId) return jsonResponse({ success: false, error: 'Missing action or connection.' }, 400);
    if (provider !== 'sharepoint') return jsonResponse({ success: false, error: 'Only SharePoint is implemented by this function.' }, 400);
    if (!ALLOWED_ENTITY_TYPES.has(entityType)) return jsonResponse({ success: false, error: 'Unsupported entity type.' }, 400);
    const entityId = body.entityId ? String(body.entityId) : '';
    if (action !== 'testConnection' && !entityId) {
      return jsonResponse({ success: false, error: 'Entity ID is required for this storage action.' }, 400);
    }

    const { data: member } = await admin
      .from('members')
      .select('id, user_role')
      .eq('auth_user_id', user.id)
      .maybeSingle();
    const role = String(member?.user_role || '');
    const isAdmin = role === 'admin';
    const accessEntityType = String(body.accessEntityType || entityType);
    const accessEntityId = String(body.accessEntityId || entityId);
    const isPayoutInvoice = entityType === 'invoice'
      && ['payout', 'hourly_payout'].includes(accessEntityType);

    // A worker can upload/download their own payout invoice even if their role
    // intentionally has no broad payout-administration permission. This keeps
    // the authority limited to the exact payout bound to their member record.
    let ownsPayout = false;
    let ownsApprovedPayout = false;
    if (isPayoutInvoice && member?.id && accessEntityId) {
      const table = accessEntityType === 'hourly_payout' ? 'hourly_payout_requests' : 'payouts';
      const { data: ownedPayout } = await admin
        .from(table)
        .select('id, status')
        .eq('id', accessEntityId)
        .eq('member_id', member.id)
        .maybeSingle();
      ownsPayout = Boolean(ownedPayout);
      ownsApprovedPayout = ownedPayout?.status === 'approved';
    }

    const isPayoutInvoiceWrite = ['uploadFile', 'createUploadSession', 'registerUploadedFile'].includes(action);
    const requiredModules = action === 'testConnection' ? ['settings'] : ENTITY_PERMISSION_MODULES[entityType];
    const { data: permissionRows } = await admin
      .from('role_permissions')
      .select('module, can_read, can_edit, can_admin')
      .eq('role', role)
      .in('module', requiredModules);
    const hasPermission = isAdmin || (isPayoutInvoiceWrite && ownsApprovedPayout) || (permissionRows || []).some((permission) => {
      if (action === 'testConnection') return permission.can_admin;
      if (action === 'downloadUrl' || action === 'listFiles' || action === 'getStatus') return permission.can_read || permission.can_edit || permission.can_admin;
      return permission.can_edit || permission.can_admin;
    });
    if (!hasPermission) return jsonResponse({ success: false, error: 'You do not have permission for this storage action.' }, 403);

    if (action !== 'testConnection') {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
      if (!anonKey) throw new Error('Missing Supabase anonymous key.');
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      if (entityType !== 'invoice' && (accessEntityType !== entityType || accessEntityId !== entityId)) {
        return jsonResponse({ success: false, error: 'Storage access scope does not match the target entity.' }, 403);
      }
      if (entityType === 'invoice') assertInvoiceAccessLink(entityId, accessEntityType, accessEntityId);
      let canAccess = false;
      if (accessEntityType === 'project') {
        const { data } = await userClient.rpc('can_access_project', { p_project_id: accessEntityId });
        canAccess = data === true;
        if (canAccess && entityType === 'invoice') {
          const { data: canViewFinance } = await userClient.rpc('can_view_project_financials');
          canAccess = canViewFinance === true;
        }
      } else if (accessEntityType === 'realizace' || accessEntityType === 'realization') {
        const { data } = await userClient.rpc('can_access_realization', { p_realization_id: accessEntityId });
        canAccess = data === true;
        if (canAccess && entityType === 'invoice') {
          const { data: canViewFinance } = await userClient.rpc('can_view_realization_financials');
          canAccess = canViewFinance === true;
        }
      } else if (accessEntityType === 'service') {
        const { data } = await userClient.from('service_cases').select('id').eq('id', accessEntityId).maybeSingle();
        canAccess = Boolean(data);
      } else if (accessEntityType === 'product') {
        const { data } = await userClient.from('commercial_item_catalog').select('id').eq('id', accessEntityId).maybeSingle();
        canAccess = Boolean(data);
      } else if (accessEntityType === 'payout') {
        const { data } = await userClient.from('payouts').select('id').eq('id', accessEntityId).maybeSingle();
        canAccess = ownsPayout || Boolean(data);
      } else if (accessEntityType === 'hourly_payout') {
        const { data } = await userClient.from('hourly_payout_requests').select('id').eq('id', accessEntityId).maybeSingle();
        canAccess = ownsPayout || Boolean(data);
      }
      if (!canAccess) return jsonResponse({ success: false, error: 'You cannot access this entity.' }, 403);
    }

    const { data: connection, error: connectionError } = await admin
      .from('document_storage_connections')
      .select('id, provider, status, config')
      .eq('id', body.connectionId)
      .single();
    if (connectionError || !connection) return jsonResponse({ success: false, error: 'Storage connection was not found.' }, 404);
    if (connection.status !== 'active' && action !== 'testConnection') return jsonResponse({ success: false, error: 'Storage connection is not active.' }, 409);

    const target = resolveTarget(connection as StorageConnection, entityType);
    const requiresEntityScope = action !== 'testConnection' && action !== 'ensureFolder' && entityType !== 'invoice';
    if (requiresEntityScope && !entityId) {
      return jsonResponse({ success: false, error: 'Entity ID is required for this storage action.' }, 400);
    }
    const entityFolderMapping = requiresEntityScope
      ? await getEntityFolderMapping(admin, String(connection.id), entityType, entityId)
      : null;

    if (action === 'getStatus') {
      const mapping = await getEntityFolderMapping(admin, String(connection.id), entityType, entityId);
      return jsonResponse({ success: true, status: mapping || null });
    }

    const graphToken = await getGraphToken();
    if (action === 'testConnection') {
      const drive = await graphFetch(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}`);
      return jsonResponse({
        success: true,
        provider,
        entityType,
        drive: { id: drive.id, name: drive.name, webUrl: drive.webUrl },
      });
    }

    if (action === 'ensureFolder' || action === 'repairFolder') {
      if (entityType === 'project' && !await projectWorkspaceIsEnabled(admin, entityId)) {
        return jsonResponse({
          success: false,
          error: 'Vytváření složky je u tohoto projektu vypnuté.',
          code: 'PROJECT_WORKSPACE_DISABLED',
        }, 409);
      }
      const existingMapping = await getEntityFolderMapping(admin, String(connection.id), entityType, entityId);
      const requestedPath = await getServerEntityFolderPath(admin, entityType, entityId, target);
      folderOperation = {
        admin,
        connectionId: String(connection.id),
        entityType,
        entityId,
        desiredPath: requestedPath,
      };
      const attemptedAt = new Date().toISOString();
      const { error: processingError } = await admin.from('document_storage_folders').upsert({
        connection_id: connection.id,
        entity_type: entityType,
        entity_id: entityId,
        folder_path: existingMapping?.folder_path || requestedPath,
        desired_folder_path: requestedPath,
        external_folder_id: existingMapping?.external_folder_id || null,
        external_web_url: existingMapping?.external_web_url || null,
        status: 'processing',
        attempt_count: Number(existingMapping?.attempt_count || 0) + 1,
        last_attempt_at: attemptedAt,
        last_error: null,
        next_retry_at: null,
        metadata: existingMapping?.metadata || {},
        updated_at: attemptedAt,
      }, { onConflict: 'connection_id,entity_type,entity_id' });
      if (processingError) throw processingError;
      const statusFolders = entityType === 'project' || entityType === 'realizace'
        ? await ensureStatusFolders(graphToken, target, requestedPath)
        : null;
      let result: { item: Record<string, unknown>; folderPath: string; moved?: boolean };
      if (existingMapping?.external_folder_id) {
        result = entityType === 'project' || entityType === 'realizace' || entityType === 'service'
          ? await reconcileMappedFolderLocation(graphToken, target, existingMapping, requestedPath)
          : {
            item: await graphFetch(
              graphToken,
              `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(existingMapping.external_folder_id)}`,
            ),
            folderPath: String(existingMapping.folder_path || ''),
            moved: false,
          };
      } else {
        const ensured = await ensurePath(graphToken, target, requestedPath);
        result = { ...ensured, moved: false };
      }

      const structure = await ensureStructure(graphToken, target, String(result.item.id));
      const synchronizedAt = new Date().toISOString();
      const mappingPayload = {
        connection_id: connection.id,
        entity_type: entityType,
        entity_id: entityId,
        folder_path: result.folderPath,
        external_folder_id: result.item.id,
        external_web_url: result.item.webUrl,
        status: 'created',
        desired_folder_path: result.folderPath,
        last_error: null,
        next_retry_at: null,
        last_verified_at: synchronizedAt,
        metadata: {
          ...(existingMapping?.metadata || {}),
          driveId: target.driveId,
          siteId: target.siteId,
          structure,
          structureVersion: 3,
          organization: { folderPath: result.folderPath, moved: Boolean(result.moved), synchronizedAt },
          statusFolders,
          reusedMapping: Boolean(existingMapping?.external_folder_id),
        },
        updated_at: synchronizedAt,
      };
      const { error: mappingError } = await admin
        .from('document_storage_folders')
        .upsert(mappingPayload, { onConflict: 'connection_id,entity_type,entity_id' });
      if (mappingError) throw mappingError;
      folderOperation = null;
      const sharedLinkTable = entityType === 'project'
        ? 'projects'
        : entityType === 'realizace'
          ? 'realizations'
          : entityType === 'service'
            ? 'service_cases'
            : null;
      if (sharedLinkTable) {
        const { error: linkError } = await admin
          .from(sharedLinkTable)
          .update({ shared_drive_link: result.item.webUrl || null })
          .eq('id', entityId);
        if (linkError) throw linkError;
      }
      return jsonResponse({
        success: true,
        provider,
        status: 'created',
        folderId: String(result.item.id),
        externalFolderId: String(result.item.id),
        folderPath: result.folderPath,
        webUrl: result.item.webUrl,
        moved: Boolean(result.moved),
        metadata: mappingPayload.metadata,
      });
    }

    if (action === 'initializeProjectWorkspace') {
      if (entityType !== 'project') {
        return jsonResponse({ success: false, error: 'Project workspace can only be initialized for a project.' }, 400);
      }

      if (!await projectWorkspaceIsEnabled(admin, entityId)) {
        return jsonResponse({
          success: true,
          provider,
          status: 'disabled',
          skipped: true,
          message: 'Automatické vytváření složky je u projektu vypnuté.',
        });
      }

      const { data: project, error: projectError } = await admin
        .from('projects')
        .select('id, code, name, status, type, start_date, completion_date, created_at, location, client_internal_ref, brief, investor_id, client_id, created_by_member_id, crm_opportunity_id')
        .eq('id', entityId)
        .maybeSingle();
      if (projectError) throw projectError;
      if (!project) return jsonResponse({ success: false, error: 'Project was not found.' }, 404);

      const { data: currentMapping, error: currentMappingError } = await admin
        .from('document_storage_folders')
        .select('*')
        .eq('connection_id', connection.id)
        .eq('entity_type', 'project')
        .eq('entity_id', entityId)
        .maybeSingle();
      if (currentMappingError) throw currentMappingError;

      let rootItem: Record<string, unknown>;
      let folderPath: string;
      let moved = false;
      const requestedPath = await getServerEntityFolderPath(admin, 'project', entityId, target);
      const statusFolders = await ensureStatusFolders(graphToken, target, requestedPath);
      if (currentMapping?.external_folder_id) {
        const reconciled = await reconcileMappedFolderLocation(graphToken, target, currentMapping, requestedPath);
        rootItem = reconciled.item;
        folderPath = reconciled.folderPath;
        moved = reconciled.moved;
      } else {
        const ensured = await ensurePath(graphToken, target, requestedPath);
        rootItem = ensured.item;
        folderPath = ensured.folderPath;
      }

      const structure = await ensureStructure(graphToken, target, String(rootItem.id));
      const projectSheetFolder = structure.find((folder) => folder.path === '00_Admin/Projektovy list')
        || structure.find((folder) => folder.path === '00_Admin')
        || { id: String(rootItem.id), path: '' };

      const partyIds = [...new Set([project.investor_id, project.client_id].filter(Boolean))];
      const partiesPromise = partyIds.length
        ? admin.from('subjects').select('id, name, ico, dic, address, contact_person, email, phone').in('id', partyIds)
        : Promise.resolve({ data: [], error: null });
      const managerPromise = project.created_by_member_id
        ? admin.from('members').select('id, name, email, phone').eq('id', project.created_by_member_id).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const opportunityPromise = project.crm_opportunity_id
        ? admin.from('crm_opportunities').select('id, number, title').eq('id', project.crm_opportunity_id).maybeSingle()
        : Promise.resolve({ data: null, error: null });
      const [partiesResult, managerResult, opportunityResult] = await Promise.all([
        partiesPromise,
        managerPromise,
        opportunityPromise,
      ]);
      if (partiesResult.error) throw partiesResult.error;
      if (managerResult.error) throw managerResult.error;
      if (opportunityResult.error) throw opportunityResult.error;

      const parties = partiesResult.data || [];
      const projectSheet = createProjectWorkspaceDocx({
        project,
        investor: parties.find((party) => party.id === project.investor_id) || null,
        client: parties.find((party) => party.id === project.client_id) || null,
        manager: managerResult.data || null,
        opportunity: opportunityResult.data || null,
      });
      const projectSheetFileName = '00_Zakladni_udaje_projektu.docx';
      const uploaded = await graphFetch(
        graphToken,
        `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(projectSheetFolder.id))}:/${encodeURIComponent(projectSheetFileName)}:/content?@microsoft.graph.conflictBehavior=replace`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
          body: projectSheet,
        },
      );

      const initializedAt = new Date().toISOString();
      const workspaceMetadata = {
        ...(currentMapping?.metadata || {}),
        driveId: target.driveId,
        siteId: target.siteId,
        structure,
        structureVersion: 3,
        projectWorkspace: {
          status: 'ready',
          templateVersion: 1,
          initializedAt,
          projectSheetFileId: uploaded.id,
          projectSheetWebUrl: uploaded.webUrl,
        },
        organization: { folderPath, moved, synchronizedAt: initializedAt, statusFolders },
      };
      const mappingPayload = {
        connection_id: connection.id,
        entity_type: 'project',
        entity_id: entityId,
        folder_path: folderPath,
        external_folder_id: rootItem.id,
        external_web_url: rootItem.webUrl,
        status: 'created',
        metadata: workspaceMetadata,
        updated_at: initializedAt,
      };
      const { error: mappingError } = await admin
        .from('document_storage_folders')
        .upsert(mappingPayload, { onConflict: 'connection_id,entity_type,entity_id' });
      if (mappingError) throw mappingError;

      const { error: registryError } = await admin.from('document_storage_files').upsert({
        connection_id: connection.id,
        entity_type: 'project',
        entity_id: entityId,
        owner_type: 'project_workspace',
        owner_id: entityId,
        external_file_id: uploaded.id,
        external_parent_id: projectSheetFolder.id,
        file_name: projectSheetFileName,
        external_web_url: uploaded.webUrl,
        metadata: { documentKind: 'project_sheet', templateVersion: 1, synchronizedAt: initializedAt },
        uploaded_by: user.id,
      }, { onConflict: 'connection_id,external_file_id' });
      if (registryError) throw registryError;

      const { error: projectLinkError } = await admin
        .from('projects')
        .update({ shared_drive_link: rootItem.webUrl })
        .eq('id', entityId);
      if (projectLinkError) throw projectLinkError;

      return jsonResponse({
        success: true,
        provider,
        status: 'ready',
        folderId: rootItem.id,
        externalFolderId: rootItem.id,
        folderPath,
        webUrl: rootItem.webUrl,
        moved,
        projectSheet: { fileId: uploaded.id, fileName: projectSheetFileName, webUrl: uploaded.webUrl },
        metadata: workspaceMetadata,
      });
    }

    if (action === 'createUploadSession') {
      const fileName = safeSegment(body.fileName);
      if (entityType === 'invoice') assertInvoiceFile(fileName, body.contentType, body.fileSize, invoiceCategory(body));
      let folderId = body.folderId ? String(body.folderId) : '';
      let folderPath = entityType === 'invoice'
        ? resolveInvoiceFolderPath(target, body)
        : String(body.folderPath || '');
      if (!folderId) {
        assertFolderPathBelongsToEntity(folderPath, entityFolderMapping, target);
        const result = await ensurePath(graphToken, target, folderPath);
        folderId = result.item.id;
        folderPath = result.folderPath;
      }
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, folderId, entityFolderMapping);
      }
      const session = await graphFetch(
        graphToken,
        `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/createUploadSession`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name: fileName } }),
        },
      );
      return jsonResponse({ success: true, uploadUrl: session.uploadUrl, folderId, folderPath, fileName });
    }

    if (action === 'registerUploadedFile') {
      const fileId = String(body.fileId || '');
      const folderId = String(body.folderId || '');
      if (!fileId || !folderId) return jsonResponse({ success: false, error: 'Uploaded file and folder IDs are required.' }, 400);
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, fileId, entityFolderMapping);
      }
      if (entityType === 'invoice') {
        const requiredFolderPath = resolveInvoiceFolderPath(target, body);
        if (requiredFolderPath) {
          const requiredFolder = await ensurePath(graphToken, target, requiredFolderPath);
          if (requiredFolder.item.id !== folderId) {
            return jsonResponse({ success: false, error: 'Invoice was uploaded outside its configured accounting folder.' }, 403);
          }
        }
      }
      const uploaded = await graphFetch(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(fileId)}`);
      if (entityType === 'invoice') {
        try {
          assertInvoiceFile(uploaded.name, uploaded.file?.mimeType, uploaded.size, invoiceCategory(body));
        } catch (validationError) {
          await graphFetch(
            graphToken,
            `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(fileId)}`,
            { method: 'DELETE' },
          ).catch(() => null);
          throw validationError;
        }
      }
      if (String(uploaded?.parentReference?.id || '') !== folderId) {
        return jsonResponse({ success: false, error: 'Uploaded file does not belong to the requested folder.' }, 403);
      }
      const ownerType = entityType === 'invoice' ? String(body.accessEntityType || 'invoice') : entityType;
      const ownerId = entityType === 'invoice' ? String(body.accessEntityId || entityId) : entityId;
      const { error: registryError } = await admin.from('document_storage_files').upsert({
        connection_id: connection.id,
        entity_type: entityType,
        entity_id: entityId,
        owner_type: ownerType,
        owner_id: ownerId,
        external_file_id: uploaded.id,
        external_parent_id: folderId,
        file_name: uploaded.name || safeSegment(body.fileName),
        external_web_url: uploaded.webUrl,
        metadata: body.metadata || {},
        uploaded_by: user.id,
      }, { onConflict: 'connection_id,external_file_id' });
      if (registryError) {
        await graphFetch(
          graphToken,
          `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(uploaded.id))}`,
          { method: 'DELETE' },
        ).catch(() => null);
        throw registryError;
      }
      return jsonResponse({
        success: true,
        provider,
        fileId: uploaded.id,
        parentId: folderId,
        filePath: normalizePath(String(body.folderPath || ''), uploaded.name || safeSegment(body.fileName)),
        webUrl: uploaded.webUrl,
        metadata: { driveId: target.driveId, siteId: target.siteId, size: uploaded.size, eTag: uploaded.eTag, mimeType: uploaded.file?.mimeType },
      });
    }

    if (action === 'uploadFile') {
      const fileName = safeSegment(body.fileName);
      const fileBase64 = String(body.fileBase64 || '');
      if (!fileBase64) return jsonResponse({ success: false, error: 'File content is required.' }, 400);
      if (entityType === 'invoice') assertInvoiceFile(fileName, body.contentType, body.fileSize, invoiceCategory(body));

      let folderId = body.folderId ? String(body.folderId) : '';
      let folderPath = entityType === 'invoice'
        ? resolveInvoiceFolderPath(target, body)
        : String(body.folderPath || '');
      if (!folderId) {
        assertFolderPathBelongsToEntity(folderPath, entityFolderMapping, target);
        const result = await ensurePath(graphToken, target, folderPath);
        folderId = result.item.id;
        folderPath = result.folderPath;
      }
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, folderId, entityFolderMapping);
      }

      const uploaded = await graphFetch(
        graphToken,
        `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(folderId)}:/${encodeURIComponent(fileName)}:/content?@microsoft.graph.conflictBehavior=rename`,
        {
          method: 'PUT',
          headers: { 'Content-Type': String(body.contentType || 'application/octet-stream') },
          body: base64ToBytes(fileBase64),
        },
      );

      if (entityType === 'invoice') {
        try {
          assertInvoiceFile(uploaded.name, uploaded.file?.mimeType, uploaded.size, invoiceCategory(body));
        } catch (validationError) {
          await graphFetch(
            graphToken,
            `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(uploaded.id))}`,
            { method: 'DELETE' },
          ).catch(() => null);
          throw validationError;
        }
      }

      const ownerType = entityType === 'invoice' ? String(body.accessEntityType || 'invoice') : entityType;
      const ownerId = entityType === 'invoice' ? String(body.accessEntityId || entityId) : entityId;
      const { error: registryError } = await admin.from('document_storage_files').insert({
        connection_id: connection.id,
        entity_type: entityType,
        entity_id: entityId,
        owner_type: ownerType,
        owner_id: ownerId,
        external_file_id: uploaded.id,
        external_parent_id: folderId,
        file_name: fileName,
        external_web_url: uploaded.webUrl,
        metadata: body.metadata || {},
        uploaded_by: user.id,
      });
      if (registryError) {
        await graphFetch(
          graphToken,
          `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(uploaded.id))}`,
          { method: 'DELETE' },
        ).catch(() => null);
        throw registryError;
      }

      return jsonResponse({
        success: true,
        provider,
        fileId: uploaded.id,
        parentId: folderId,
        filePath: normalizePath(folderPath, fileName),
        webUrl: uploaded.webUrl,
        metadata: {
          driveId: target.driveId,
          siteId: target.siteId,
          size: uploaded.size,
          eTag: uploaded.eTag,
          mimeType: uploaded.file?.mimeType,
        },
      });
    }

    if (action === 'downloadUrl') {
      if (!body.fileId) return jsonResponse({ success: false, error: 'File ID is required.' }, 400);
      const { data: registeredFile } = await admin
        .from('document_storage_files')
        .select('external_file_id')
        .eq('connection_id', connection.id)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .eq('external_file_id', String(body.fileId))
        .maybeSingle();
      if (!registeredFile) return jsonResponse({ success: false, error: 'File is not registered for this entity.' }, 403);
      const item = await graphFetch(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(body.fileId))}`);
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, String(body.fileId), entityFolderMapping);
      }
      return jsonResponse({ success: true, webUrl: item.webUrl, downloadUrl: item['@microsoft.graph.downloadUrl'] || null });
    }

    if (action === 'listFiles') {
      if (entityType === 'invoice') {
        return jsonResponse({ success: false, error: 'Listing the shared invoice folder is not allowed.' }, 403);
      }
      if (!body.folderId) return jsonResponse({ success: false, error: 'Folder ID is required.' }, 400);
      if (entityFolderMapping) {
        await assertItemBelongsToEntityFolder(graphToken, target, String(body.folderId), entityFolderMapping);
      }
      const items = await collectGraphPages(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(String(body.folderId))}/children?$select=id,name,size,webUrl,lastModifiedDateTime,file,folder&$top=200`);
      return jsonResponse({ success: true, items });
    }

    if (action === 'deleteFile') {
      if (!body.fileId) return jsonResponse({ success: false, error: 'File ID is required.' }, 400);
      const fileId = String(body.fileId);
      const { data: registeredFile, error: registryReadError } = await admin
        .from('document_storage_files')
        .select('id, external_file_id, external_web_url')
        .eq('connection_id', connection.id)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .eq('external_file_id', fileId)
        .maybeSingle();
      if (registryReadError) throw Object.assign(new Error('Could not verify registered file ownership.'), { status: 503 });
      if (!registeredFile) return jsonResponse({ success: false, error: 'File is not registered for this entity.' }, 403);
      if (entityFolderMapping) await assertItemBelongsToEntityFolder(graphToken, target, fileId, entityFolderMapping);
      if (entityType === 'invoice') {
        await assertInvoiceFileDetached(admin, {
          connectionId: String(connection.id), fileId, fileUrl: registeredFile.external_web_url,
        });
      }
      try {
        await graphFetch(graphToken, `/drives/${encodeURIComponent(String(target.driveId))}/items/${encodeURIComponent(fileId)}`, { method: 'DELETE' });
      } catch (deleteError) {
        if ((deleteError as { status?: number }).status !== 404) throw deleteError;
      }
      const { error: registryDeleteError } = await admin.from('document_storage_files').delete().eq('id', registeredFile.id);
      if (registryDeleteError) throw registryDeleteError;
      return jsonResponse({ success: true, deleted: true, fileId });
    }

    return jsonResponse({ success: false, error: 'Unsupported action.' }, 400);
  } catch (error) {
    if (folderOperation) {
      const retryAt = new Date(Date.now() + 5 * 60_000).toISOString();
      await folderOperation.admin.from('document_storage_folders').update({
        status: 'error',
        desired_folder_path: folderOperation.desiredPath,
        last_error: String(error?.message || error).slice(0, 2000),
        next_retry_at: retryAt,
        updated_at: new Date().toISOString(),
      }).eq('connection_id', folderOperation.connectionId)
        .eq('entity_type', folderOperation.entityType)
        .eq('entity_id', folderOperation.entityId);
    }
    console.error('[document-storage]', error);
    return jsonResponse({
      success: false,
      error: error instanceof Error ? error.message : 'Unexpected document storage error.',
    }, (error as { status?: number }).status || 500);
  }
});
