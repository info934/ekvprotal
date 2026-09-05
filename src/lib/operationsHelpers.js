/** Keep a new attendance entry in the month the person is viewing. */
export function attendanceEntryDate(month, today = new Date()) {
  return month.getFullYear() === today.getFullYear() && month.getMonth() === today.getMonth()
    ? new Date(today.getFullYear(), today.getMonth(), today.getDate())
    : new Date(month.getFullYear(), month.getMonth(), 1);
}

export const ACTIVE_PAYOUT_STATUSES = ['pending', 'approved', 'invoice_uploaded'];

export function payoutViewForStatus(status, currentView) {
  return status !== 'all' && !ACTIVE_PAYOUT_STATUSES.includes(status) ? 'all' : currentView;
}

export function clampPage(page, count, pageSize) {
  return Math.max(1, Math.min(page, Math.max(1, Math.ceil(count / pageSize))));
}

/** Parse Excel serials, Date cells and explicit Czech/ISO dates; never silently drop invalid dates. */
export function parseEngineeringDate(value, { date1904 = false } = {}) {
  if (value == null || String(value).trim() === '') return null;
  let year, month, day;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    year = value.getFullYear(); month = value.getMonth() + 1; day = value.getDate();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const serial = Math.floor(value);
    if (serial < 0 || serial > 2958465 || (!date1904 && serial === 60)) throw new Error('Neplatné datum Excelu.');
    // Excel's 1900 calendar contains a fictitious leap day at serial 60.
    const offset = date1904 ? serial : serial > 60 ? serial - 1 : serial;
    const date = new Date(Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 31) + offset * 86400000);
    year = date.getUTCFullYear(); month = date.getUTCMonth() + 1; day = date.getUTCDate();
  } else {
    const input = String(value).trim();
    const iso = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    const local = input.match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})$/);
    if (iso) [, year, month, day] = iso.map(Number);
    else if (local) [, day, month, year] = local.map(Number);
    else throw new Error(`Neplatné datum „${input}“. Použijte d.m.rrrr nebo rrrr-mm-dd.`);
  }
  const checked = new Date(Date.UTC(year, month - 1, day));
  if (year < 1900 || year > 9999 || checked.getUTCFullYear() !== year || checked.getUTCMonth() !== month - 1 || checked.getUTCDate() !== day) {
    throw new Error(`Neplatné datum „${String(value)}“.`);
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function planningAvailabilityKey(item) {
  return JSON.stringify([item?.id || '', item?.member_id || '', item?.item_type || '', item?.start_at || '', item?.item_type === 'milestone' ? item?.start_at || '' : item?.end_at || '']);
}

export function planningDeletionItems(items, id) {
  const selected = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (selected.has(item.parent_id) && !selected.has(item.id)) { selected.add(item.id); changed = true; }
    }
  }
  return items.filter(item => selected.has(item.id));
}

export function toSafeCsv(rows) {
  return '\uFEFF' + rows.map(row => row.map(value => {
    let text = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(';')).join('\r\n');
}
