export const EMPLOYMENT_STATUSES = Object.freeze({ active: 'Aktivní zaměstnanec', inactive: 'Neaktivní zaměstnanec' });
export const EMPLOYEE_ASSET_TYPES = Object.freeze({ vehicle: 'Vozidlo', key: 'Klíče / přístup', device: 'Technika', license: 'Licence', other: 'Ostatní majetek' });
export const EMPLOYEE_ASSET_STATUSES = Object.freeze({ issued: 'Předáno zaměstnanci', returned: 'Vráceno' });
export const EMPLOYEE_RECORD_KINDS = Object.freeze({ contract: 'Smlouva', verification: 'Ověření / oprávnění', training: 'Školení' });
export const EMPLOYEE_RECORD_STATUSES = Object.freeze({ pending: 'Čeká na ověření', verified: 'Ověřeno', expired: 'Platnost skončila' });
export const EMPLOYEE_REQUEST_TYPES = Object.freeze({ training: 'Školení', license: 'Nákup licence', equipment: 'Vybavení' });
export const EMPLOYEE_REQUEST_STATUSES = Object.freeze({ pending: 'Čeká na schválení', approved: 'Schváleno', rejected: 'Zamítnuto', fulfilled: 'Vyřízeno', cancelled: 'Zrušeno žadatelem' });

const hasOption = (options, value) => Object.prototype.hasOwnProperty.call(options, value);
const textLength = value => String(value ?? '').trim().length;
export const isValidEmployeeDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
};
export const isSafeEmployeeReferenceUrl = value => {
  if (!value) return true;
  if (typeof value !== 'string' || value.length > 2000 || !/^https:\/\//i.test(value) || /[\s<>"'\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch { return false; }
};

export function validateEmployeeAsset(asset = {}) {
  if (!hasOption(EMPLOYEE_ASSET_TYPES, asset.asset_type)) return 'Vyberte typ majetku.';
  if (!textLength(asset.label) || textLength(asset.label) > 200) return 'Název majetku musí mít 1 až 200 znaků.';
  if (textLength(asset.identifier) > 200) return 'Identifikátor může mít nejvýše 200 znaků.';
  if (!isValidEmployeeDate(asset.assigned_on)) return 'Vyplňte platné datum předání.';
  if (asset.due_on && (!isValidEmployeeDate(asset.due_on) || asset.due_on < asset.assigned_on)) return 'Plánované vrácení nesmí být před předáním.';
  if (textLength(asset.note) > 4000) return 'Poznámka může mít nejvýše 4 000 znaků.';
  return null;
}

export function validateEmployeeRecord(record = {}) {
  if (!textLength(record.title) || textLength(record.title) > 200) return 'Název záznamu musí mít 1 až 200 znaků.';
  if (!hasOption(EMPLOYEE_RECORD_KINDS, record.kind)) return 'Vyberte druh záznamu.';
  if (!hasOption(EMPLOYEE_RECORD_STATUSES, record.status)) return 'Vyberte stav ověření.';
  if (record.valid_from && !isValidEmployeeDate(record.valid_from)) return 'Datum počátku platnosti není platné.';
  if (record.valid_until && !isValidEmployeeDate(record.valid_until)) return 'Datum konce platnosti není platné.';
  if (record.valid_from && record.valid_until && record.valid_until < record.valid_from) return 'Konec platnosti nesmí být před jejím začátkem.';
  if (!isSafeEmployeeReferenceUrl(record.reference_url)) return 'Odkaz musí být bezpečná HTTPS adresa bez přihlašovacích údajů.';
  if (textLength(record.note) > 4000) return 'Poznámka může mít nejvýše 4 000 znaků.';
  return null;
}

export function validateEmployeeRequest(request = {}) {
  if (!hasOption(EMPLOYEE_REQUEST_TYPES, request.request_type)) return 'Vyberte typ žádosti.';
  if (!textLength(request.title) || textLength(request.title) > 200) return 'Předmět žádosti musí mít 1 až 200 znaků.';
  if (!textLength(request.description) || textLength(request.description) > 4000) return 'Popis žádosti musí mít 1 až 4 000 znaků.';
  if (request.estimated_cost !== '' && request.estimated_cost != null
    && (!Number.isFinite(Number(request.estimated_cost)) || Number(request.estimated_cost) < 0 || Number(request.estimated_cost) > 9999999999.99)) return 'Předpokládaná cena musí být nezáporné konečné číslo.';
  if (request.requested_for && !isValidEmployeeDate(request.requested_for)) return 'Požadované datum není platné.';
  return null;
}

export function employeeRequestTransitions(status, { isAdmin = false, isOwner = false } = {}) {
  if (status === 'pending') return [...(isAdmin ? ['approved', 'rejected'] : []), ...(isOwner ? ['cancelled'] : [])];
  if (status === 'approved' && isAdmin) return ['fulfilled'];
  return [];
}
