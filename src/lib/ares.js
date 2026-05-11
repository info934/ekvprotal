import { fetchJsonWithTimeout } from '@/lib/http';

const ARES_BASE_URL = 'https://ares.gov.cz/ekonomicke-subjekty-v-be/rest/ekonomicke-subjekty';

export const normalizeIco = (value = '') => value.replace(/\D/g, '').slice(0, 8);
export const normalizeDic = (value = '') => value.replace(/\s/g, '').toUpperCase().slice(0, 14);

export const DPH_REGISTRY_URL = 'https://adisspr.mfcr.cz/adistc/adis/idpr_pub/dpr_info/dph/reg_dph.faces';

const formatAddress = (sidlo = {}) => {
  if (sidlo.textovaAdresa) return sidlo.textovaAdresa;

  const street = [sidlo.nazevUlice, sidlo.cisloDomovni, sidlo.cisloOrientacni && `/${sidlo.cisloOrientacni}`]
    .filter(Boolean)
    .join(' ');
  const city = [sidlo.psc, sidlo.nazevObce].filter(Boolean).join(' ');

  return [street, city].filter(Boolean).join(', ');
};

export const mapAresSubject = (data = {}) => {
  const nace = Array.isArray(data.czNace) ? data.czNace.filter(Boolean) : [];
  const sourceRegisters = Array.isArray(data.seznamRegistraci)
    ? data.seznamRegistraci.map((item) => item?.typRegistru || item).filter(Boolean)
    : [];
  const registryText = JSON.stringify([data.seznamRegistraci, data.registrace, data.dic]).toLowerCase();
  const vatStatus = registryText.includes('dph') || data.dic ? 'payer' : 'non_payer';

  return {
    name: data.obchodniJmeno || '',
    ico: data.ico || '',
    dic: data.dic || '',
    address: formatAddress(data.sidlo),
    legal_form: data.pravniForma ? `Kód ${data.pravniForma}` : '',
    region: data.sidlo?.nazevKraje || '',
    district: data.sidlo?.nazevOkresu || '',
    municipality: data.sidlo?.nazevObce || '',
    postal_code: data.sidlo?.psc || '',
    financial_office: data.financniUrad || '',
    nace,
    source_registers: sourceRegisters,
    vat_status: vatStatus,
    vat_payer: vatStatus === 'payer',
    company_summary: buildCompanySummary({
      name: data.obchodniJmeno || '',
      ico: data.ico || '',
      dic: data.dic || '',
      address: formatAddress(data.sidlo),
      legal_form: data.pravniForma ? `Kód ${data.pravniForma}` : '',
      region: data.sidlo?.nazevKraje || '',
      district: data.sidlo?.nazevOkresu || '',
      municipality: data.sidlo?.nazevObce || '',
      financial_office: data.financniUrad || '',
      nace,
      source_registers: sourceRegisters,
      vat_status: vatStatus,
    }),
    raw: data,
  };
};

export const getVatStatusLabel = (status) => ({
  payer: 'Plátce DPH',
  non_payer: 'Neplátce DPH',
  identified_person: 'Identifikovaná osoba',
  unknown: 'Neověřeno',
}[status] || 'Neověřeno');

export const buildCompanySummary = (data = {}) => {
  const parts = [];
  if (data.name) {
    parts.push(`${data.name} je subjekt vedený v registru ARES${data.ico ? ` pod IČO ${data.ico}` : ''}.`);
  }
  if (data.legal_form) parts.push(`Právní forma: ${data.legal_form}.`);
  if (data.address) parts.push(`Sídlo / adresa: ${data.address}.`);
  if (data.municipality || data.district || data.region) {
    parts.push(`Lokalita: ${[data.municipality, data.district, data.region].filter(Boolean).join(', ')}.`);
  }
  if (data.financial_office) parts.push(`Příslušný finanční úřad: ${data.financial_office}.`);
  if (data.vat_status) parts.push(`DPH status podle poslední kontroly: ${getVatStatusLabel(data.vat_status)}.`);
  if (Array.isArray(data.nace) && data.nace.length) {
    parts.push(`CZ-NACE: ${data.nace.slice(0, 5).join(', ')}${data.nace.length > 5 ? '…' : ''}.`);
  }
  if (Array.isArray(data.source_registers) && data.source_registers.length) {
    parts.push(`Zdrojové registry: ${data.source_registers.slice(0, 6).join(', ')}.`);
  }
  return parts.join(' ');
};

export const fetchAresSubjectByIco = async (ico, { timeoutMs = 8000 } = {}) => {
  const normalizedIco = normalizeIco(ico);

  if (normalizedIco.length !== 8) {
    throw new Error('IČO musí mít 8 číslic.');
  }

  const data = await fetchJsonWithTimeout(
    `${ARES_BASE_URL}/${normalizedIco}`,
    { headers: { accept: 'application/json' } },
    { timeoutMs }
  );

  return mapAresSubject(data);
};
