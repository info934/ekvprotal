export const DEFAULT_CRM_NUMBERING = {
  opportunity: { document_type: 'opportunity', label: 'Obchodní případ', prefix: 'OP', next_number: 1, padding: 3, year_format: 'YY' },
  offer: { document_type: 'offer', label: 'Nabídka', prefix: 'NAB', next_number: 1, padding: 3, year_format: 'YY' },
  order: { document_type: 'order', label: 'Objednávka', prefix: 'OBJ', next_number: 1, padding: 3, year_format: 'YY' },
};

const isMissingYearFormatColumn = (error) => {
  const message = `${error?.code || ''} ${error?.message || ''}`.toLowerCase();
  return error?.code === 'PGRST204' || message.includes('year_format');
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
      year_format: ['YY', 'YYYY', 'NONE'].includes(row.year_format) ? row.year_format : defaults.year_format,
    };
    return acc;
  }, {});
};

export const formatCrmYearToken = (yearFormat = 'YY', date = new Date()) => {
  if (yearFormat === 'NONE') return '';
  const year = String(date.getFullYear());
  return yearFormat === 'YYYY' ? year : year.slice(-2);
};

export const formatCrmNumber = (settings, type, sequence = null, date = new Date()) => {
  const config = settings?.[type] || DEFAULT_CRM_NUMBERING[type] || DEFAULT_CRM_NUMBERING.opportunity;
  const year = formatCrmYearToken(config.year_format, date);
  const next = String(sequence ?? config.next_number ?? 1).padStart(Number(config.padding || 3), '0');
  return [config.prefix, year, next].filter(Boolean).join('-');
};

export const selectCrmNumberingSettings = async (supabase) => {
  const query = supabase
    .from('crm_numbering_settings')
    .select('document_type, prefix, next_number, padding, year_format');

  const result = await query;
  if (!result.error || !isMissingYearFormatColumn(result.error)) return result;

  return supabase
    .from('crm_numbering_settings')
    .select('document_type, prefix, next_number, padding');
};

export const upsertCrmNumberingSettings = async (supabase, rows) => {
  const result = await supabase
    .from('crm_numbering_settings')
    .upsert(rows, { onConflict: 'document_type' });

  if (!result.error || !isMissingYearFormatColumn(result.error)) return result;

  const fallbackRows = rows.map(({ year_format, ...row }) => row);
  return supabase
    .from('crm_numbering_settings')
    .upsert(fallbackRows, { onConflict: 'document_type' });
};
