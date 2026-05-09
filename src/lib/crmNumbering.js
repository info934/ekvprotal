export const DEFAULT_CRM_NUMBERING = {
  opportunity: { document_type: 'opportunity', label: 'Obchodni pripad', prefix: 'OP', next_number: 1, padding: 3 },
  offer: { document_type: 'offer', label: 'Nabidka', prefix: 'NAB', next_number: 1, padding: 3 },
  order: { document_type: 'order', label: 'Objednavka', prefix: 'OBJ', next_number: 1, padding: 3 },
};

export const normalizeCrmNumbering = (rows = []) => {
  const byType = rows.reduce((acc, row) => {
    if (row?.document_type) acc[row.document_type] = row;
    return acc;
  }, {});

  return Object.entries(DEFAULT_CRM_NUMBERING).reduce((acc, [type, defaults]) => {
    const row = byType[type] || defaults;
    acc[type] = {
      ...defaults,
      ...row,
      prefix: String(row.prefix || defaults.prefix).trim().toUpperCase() || defaults.prefix,
      next_number: Math.max(1, Number(row.next_number || defaults.next_number || 1)),
      padding: Math.max(2, Number(row.padding || defaults.padding || 3)),
    };
    return acc;
  }, {});
};

export const formatCrmNumber = (settings, type, sequence = null, date = new Date()) => {
  const config = settings?.[type] || DEFAULT_CRM_NUMBERING[type] || DEFAULT_CRM_NUMBERING.opportunity;
  const year = String(date.getFullYear()).slice(-2);
  const next = String(sequence ?? config.next_number ?? 1).padStart(Number(config.padding || 3), '0');
  return `${config.prefix}-${year}-${next}`;
};
