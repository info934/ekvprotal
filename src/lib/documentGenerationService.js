import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { jsPDF } from 'jspdf';

const documentTypeLabels = {
  offer: 'Nabidka',
  order: 'Objednavka',
  contract: 'Smlouva',
};

const formatCurrency = (value) => new Intl.NumberFormat('cs-CZ', {
  style: 'currency',
  currency: 'CZK',
  maximumFractionDigits: 2,
}).format(Number(value || 0));

const formatDate = (value) => {
  if (!value) return '-';
  return new Intl.DateTimeFormat('cs-CZ', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value));
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const stripHtml = (value) => String(value ?? '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<\/(p|div|section|header|footer|h[1-6]|tr|table|ul|ol|li)>/gi, '\n')
  .replace(/<br\s*\/?>/gi, '\n')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#039;/g, "'")
  .replace(/[ \t]+/g, ' ')
  .replace(/\n\s+/g, '\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim();

const sanitizeFileName = (value) => String(value || 'dokument')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-zA-Z0-9._-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 120) || 'dokument';

const downloadBlob = (blob, fileName) => {
  const url = window.URL.createObjectURL(blob);
  const a = window.document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = fileName;
  window.document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  window.document.body.removeChild(a);
};

export const buildDocumentGenerationPayload = ({ opportunity, document }) => {
  const items = [...(document?.items || [])]
    .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0))
    .map((item, index) => ({
      position: index + 1,
      code: item.code || '',
      name: item.name || '',
      quantity: Number(item.quantity || 0),
      unit: item.unit || 'ks',
      unitPrice: Number(item.unit_price || 0),
      discountPercent: Number(item.discount_percent || 0),
      vatRate: Number(item.vat_rate || 0),
      lineTotal: Number(item.line_total || 0),
    }));

  return {
    document: {
      id: document?.id,
      type: document?.type || 'offer',
      label: documentTypeLabels[document?.type] || 'Dokument',
      number: document?.number || '',
      title: document?.title || opportunity?.title || 'Dokument',
      status: document?.status || 'draft',
      issueDate: document?.issue_date || new Date().toISOString(),
      validUntil: document?.valid_until || null,
      subtotal: Number(document?.subtotal || 0),
      discountTotal: Number(document?.discount_total || 0),
      taxTotal: Number(document?.tax_total || 0),
      total: Number(document?.total || 0),
      notes: document?.notes || '',
    },
    opportunity: {
      id: opportunity?.id,
      title: opportunity?.title || '',
      value: Number(opportunity?.value || 0),
      subjectName: opportunity?.subject?.name || '',
      projectName: opportunity?.project?.name || '',
      projectCode: opportunity?.project?.code || '',
      description: opportunity?.description || '',
    },
    items,
    generatedAt: new Date().toISOString(),
  };
};

const renderItemsTableHtml = (items) => {
  const itemRows = items.length > 0 ? items.map((item) => `
    <tr>
      <td>${item.position}</td>
      <td>${escapeHtml(item.code || '-')}</td>
      <td>${escapeHtml(item.name)}</td>
      <td class="num">${item.quantity.toLocaleString('cs-CZ')} ${escapeHtml(item.unit)}</td>
      <td class="num">${formatCurrency(item.unitPrice)}</td>
      <td class="num">${item.discountPercent.toLocaleString('cs-CZ')} %</td>
      <td class="num">${formatCurrency(item.lineTotal)}</td>
    </tr>
  `).join('') : `
    <tr>
      <td colspan="7" class="empty">Dokument zatim nema polozky.</td>
    </tr>
  `;

  return `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Kod</th>
          <th>Nazev</th>
          <th class="num">Mnozstvi</th>
          <th class="num">Jedn. cena</th>
          <th class="num">Sleva</th>
          <th class="num">Celkem</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>
  `;
};

export const buildDocumentTemplatePlaceholders = (payload) => {
  const { document, opportunity, generatedAt } = payload;
  const totalWithTax = document.total + document.taxTotal;
  const clientName = opportunity.subjectName || 'Bez subjektu';
  const projectName = opportunity.projectName || opportunity.projectCode || '';
  const values = {
    document_number: document.number || '',
    document_title: document.title || '',
    document_type: document.label || '',
    document_date: formatDate(document.issueDate),
    document_valid_until: formatDate(document.validUntil),
    client_name: clientName,
    project_name: projectName,
    project_code: opportunity.projectCode || '',
    opportunity_title: opportunity.title || '',
    opportunity_value: formatCurrency(opportunity.value),
    subtotal: formatCurrency(document.subtotal),
    discount_total: formatCurrency(document.discountTotal),
    tax_total: formatCurrency(document.taxTotal),
    total_amount: formatCurrency(document.total),
    total_with_tax: formatCurrency(totalWithTax),
    notes: document.notes || '',
    generated_at: formatDate(generatedAt),
    items_table: renderItemsTableHtml(payload.items),

    supplier_name: clientName,
    order_number: document.number || '',
    order_date: formatDate(document.issueDate),
    delivery_date: formatDate(document.validUntil),
    realization_name: projectName || opportunity.title || '',
    admin_name: 'EKV Group',
  };

  return values;
};

export const fillDocumentTemplate = (templateContent, payload) => {
  const placeholders = buildDocumentTemplatePlaceholders(payload);
  return Object.entries(placeholders).reduce((content, [key, value]) => {
    const replacement = String(value ?? '');
    return content
      .replace(new RegExp(escapeRegExp(`{${key}}`), 'g'), replacement)
      .replace(new RegExp(escapeRegExp(`{{${key}}}`), 'g'), replacement);
  }, String(templateContent || ''));
};

const ensureHtmlDocument = (content, title = 'Dokument') => {
  const html = String(content || '');
  if (/<!doctype html|<html[\s>]/i.test(html)) return html;

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    body { margin: 0; background: #f3f4f6; color: #111827; font-family: Arial, Helvetica, sans-serif; font-size: 13px; line-height: 1.45; }
    .page { width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff; padding: 18mm; box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12); }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #f9fafb; color: #6b7280; font-size: 11px; text-align: left; text-transform: uppercase; border-bottom: 1px solid #e5e7eb; padding: 9px; }
    td { border-bottom: 1px solid #eef2f7; padding: 9px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .empty { text-align: center; color: #6b7280; padding: 24px; }
    @media print { body { background: #fff; } .page { margin: 0; box-shadow: none; width: auto; min-height: auto; } }
  </style>
</head>
<body><main class="page">${html}</main></body>
</html>`;
};

export const renderCommercialDocumentHtml = (payload, template = null) => {
  const { document, opportunity, items, generatedAt } = payload;
  const totalWithTax = document.total + document.taxTotal;

  if (template?.content) {
    return ensureHtmlDocument(
      fillDocumentTemplate(template.content, payload),
      `${document.label} ${document.number || ''}`.trim()
    );
  }

  return `<!doctype html>
<html lang="cs">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(document.label)} ${escapeHtml(document.number)}</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f4f6;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 13px;
      line-height: 1.45;
    }
    .page {
      width: 210mm;
      min-height: 297mm;
      margin: 16px auto;
      background: #fff;
      padding: 18mm;
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12);
    }
    header {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      border-bottom: 2px solid #111827;
      padding-bottom: 18px;
      margin-bottom: 28px;
    }
    .brand {
      font-size: 24px;
      font-weight: 800;
      letter-spacing: 0;
    }
    .doc-title {
      text-align: right;
    }
    .doc-title h1 {
      margin: 0;
      font-size: 28px;
      line-height: 1.1;
    }
    .doc-title p, .muted {
      margin: 4px 0 0;
      color: #6b7280;
    }
    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 18px;
      margin-bottom: 28px;
    }
    .box {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 14px;
    }
    .box h2 {
      margin: 0 0 10px;
      font-size: 12px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 12px;
    }
    th {
      background: #f9fafb;
      color: #6b7280;
      font-size: 11px;
      text-align: left;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      border-bottom: 1px solid #e5e7eb;
      padding: 9px;
    }
    td {
      border-bottom: 1px solid #eef2f7;
      padding: 9px;
      vertical-align: top;
    }
    .num { text-align: right; white-space: nowrap; }
    .empty { text-align: center; color: #6b7280; padding: 24px; }
    .summary {
      width: 48%;
      margin-left: auto;
      margin-top: 20px;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      overflow: hidden;
    }
    .summary div {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border-bottom: 1px solid #eef2f7;
    }
    .summary div:last-child {
      border-bottom: 0;
      background: #111827;
      color: #fff;
      font-size: 15px;
      font-weight: 700;
    }
    .notes {
      margin-top: 28px;
      border-top: 1px solid #e5e7eb;
      padding-top: 18px;
      color: #374151;
      white-space: pre-wrap;
    }
    footer {
      margin-top: 42px;
      color: #6b7280;
      font-size: 11px;
      display: flex;
      justify-content: space-between;
      border-top: 1px solid #e5e7eb;
      padding-top: 12px;
    }
    @media print {
      body { background: #fff; }
      .page { margin: 0; box-shadow: none; width: auto; min-height: auto; }
    }
  </style>
</head>
<body>
  <main class="page">
    <header>
      <div>
        <div class="brand">EKV Group</div>
        <p class="muted">Dokument generovany z EKVPortal CRM</p>
      </div>
      <div class="doc-title">
        <h1>${escapeHtml(document.label)}</h1>
        <p>${escapeHtml(document.number || 'Bez cisla')}</p>
      </div>
    </header>

    <section class="grid">
      <div class="box">
        <h2>Klient</h2>
        <strong>${escapeHtml(opportunity.subjectName || 'Bez subjektu')}</strong>
        <p class="muted">${escapeHtml(opportunity.projectName || opportunity.projectCode || '')}</p>
      </div>
      <div class="box">
        <h2>Dokument</h2>
        <p><strong>Nazev:</strong> ${escapeHtml(document.title)}</p>
        <p><strong>Datum:</strong> ${formatDate(document.issueDate)}</p>
        <p><strong>Platnost:</strong> ${formatDate(document.validUntil)}</p>
      </div>
    </section>

    <h2>Polozky</h2>
    ${renderItemsTableHtml(items)}

    <section class="summary">
      <div><span>Mezisoucet</span><strong>${formatCurrency(document.subtotal)}</strong></div>
      <div><span>Sleva</span><strong>${formatCurrency(document.discountTotal)}</strong></div>
      <div><span>DPH</span><strong>${formatCurrency(document.taxTotal)}</strong></div>
      <div><span>Celkem s DPH</span><strong>${formatCurrency(totalWithTax)}</strong></div>
    </section>

    ${document.notes ? `<section class="notes"><strong>Poznamka</strong><br />${escapeHtml(document.notes)}</section>` : ''}

    <footer>
      <span>Vygenerovano: ${formatDate(generatedAt)}</span>
      <span>ID obchodniho pripadu: ${escapeHtml(opportunity.id || '-')}</span>
    </footer>
  </main>
</body>
</html>`;
};

export const generateDocumentFileName = (payload, extension = 'html') => {
  const parts = [
    payload.document.label,
    payload.document.number,
    payload.opportunity.subjectName,
  ].filter(Boolean);
  return `${sanitizeFileName(parts.join(' '))}.${extension}`;
};

export const downloadGeneratedDocumentHtml = ({ opportunity, document, template }) => {
  const payload = buildDocumentGenerationPayload({ opportunity, document });
  const html = renderCommercialDocumentHtml(payload, template);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  downloadBlob(blob, generateDocumentFileName(payload));
  return payload;
};

const makeText = (text, options = {}) => new TextRun({
  text: String(text ?? ''),
  font: 'Arial',
  size: options.size || 22,
  bold: options.bold || false,
  color: options.color || '111827',
});

const makeParagraph = (text, options = {}) => new Paragraph({
  heading: options.heading,
  alignment: options.alignment,
  spacing: options.spacing || { after: 120 },
  children: [makeText(text, options)],
});

const makeCell = (text, options = {}) => new TableCell({
  width: options.width ? { size: options.width, type: WidthType.PERCENTAGE } : undefined,
  shading: options.shading ? { fill: options.shading } : undefined,
  margins: { top: 120, bottom: 120, left: 120, right: 120 },
  children: [
    new Paragraph({
      alignment: options.align || AlignmentType.LEFT,
      children: [makeText(text, {
        bold: options.bold,
        size: options.size || 18,
        color: options.color || '111827',
      })],
    }),
  ],
});

const createTemplateDocxBlob = async (payload, template) => {
  const filledContent = stripHtml(fillDocumentTemplate(template.content, payload));
  const lines = filledContent.split('\n').map((line) => line.trim()).filter(Boolean);
  const doc = new Document({
    sections: [{
      properties: {
        page: { margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 } },
      },
      children: lines.length > 0
        ? lines.map((line, index) => makeParagraph(line, {
          bold: index === 0,
          size: index === 0 ? 30 : 22,
          spacing: { after: index === 0 ? 220 : 100 },
        }))
        : [makeParagraph(`${payload.document.label} ${payload.document.number}`.trim(), { bold: true, size: 30 })],
    }],
  });

  return Packer.toBlob(doc);
};

export const createCommercialDocumentDocxBlob = async (payload, template = null) => {
  if (template?.content) {
    return createTemplateDocxBlob(payload, template);
  }

  const { document, opportunity, items, generatedAt } = payload;
  const totalWithTax = document.total + document.taxTotal;

  const rows = [
    new TableRow({
      tableHeader: true,
      children: [
        makeCell('#', { bold: true, shading: 'F3F4F6', width: 6 }),
        makeCell('Kod', { bold: true, shading: 'F3F4F6', width: 12 }),
        makeCell('Nazev', { bold: true, shading: 'F3F4F6', width: 34 }),
        makeCell('Mnozstvi', { bold: true, shading: 'F3F4F6', width: 12, align: AlignmentType.RIGHT }),
        makeCell('Jedn. cena', { bold: true, shading: 'F3F4F6', width: 16, align: AlignmentType.RIGHT }),
        makeCell('Celkem', { bold: true, shading: 'F3F4F6', width: 20, align: AlignmentType.RIGHT }),
      ],
    }),
    ...(items.length > 0 ? items.map((item) => new TableRow({
      children: [
        makeCell(item.position, { width: 6 }),
        makeCell(item.code || '-', { width: 12 }),
        makeCell(item.name, { width: 34 }),
        makeCell(`${item.quantity.toLocaleString('cs-CZ')} ${item.unit}`, { width: 12, align: AlignmentType.RIGHT }),
        makeCell(formatCurrency(item.unitPrice), { width: 16, align: AlignmentType.RIGHT }),
        makeCell(formatCurrency(item.lineTotal), { width: 20, align: AlignmentType.RIGHT }),
      ],
    })) : [
      new TableRow({
        children: [makeCell('Dokument zatim nema polozky.', { width: 100 })],
      }),
    ]),
  ];

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 1000, right: 1000, bottom: 1000, left: 1000 },
        },
      },
      children: [
        new Paragraph({
          spacing: { after: 120 },
          children: [
            makeText('EKV Group', { bold: true, size: 34 }),
            makeText(`    ${document.label}`, { bold: true, size: 30 }),
          ],
        }),
        makeParagraph(document.number || 'Bez cisla', { color: '6B7280' }),
        makeParagraph(document.title, { heading: HeadingLevel.HEADING_1, size: 30, bold: true }),
        makeParagraph(`Klient: ${opportunity.subjectName || 'Bez subjektu'}`),
        makeParagraph(`Projekt: ${opportunity.projectName || opportunity.projectCode || '-'}`),
        makeParagraph(`Datum: ${formatDate(document.issueDate)}    Platnost: ${formatDate(document.validUntil)}`),
        makeParagraph('Polozky', { heading: HeadingLevel.HEADING_2, bold: true, size: 26, spacing: { before: 240, after: 120 } }),
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            left: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            right: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
            insideVertical: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' },
          },
          rows,
        }),
        makeParagraph(`Mezisoucet: ${formatCurrency(document.subtotal)}`, { alignment: AlignmentType.RIGHT, spacing: { before: 240, after: 60 } }),
        makeParagraph(`Sleva: ${formatCurrency(document.discountTotal)}`, { alignment: AlignmentType.RIGHT, spacing: { after: 60 } }),
        makeParagraph(`DPH: ${formatCurrency(document.taxTotal)}`, { alignment: AlignmentType.RIGHT, spacing: { after: 60 } }),
        makeParagraph(`Celkem s DPH: ${formatCurrency(totalWithTax)}`, { alignment: AlignmentType.RIGHT, bold: true, size: 26 }),
        ...(document.notes ? [
          makeParagraph('Poznamka', { heading: HeadingLevel.HEADING_2, bold: true, size: 24, spacing: { before: 240, after: 80 } }),
          makeParagraph(document.notes),
        ] : []),
        makeParagraph(`Vygenerovano: ${formatDate(generatedAt)}`, { color: '6B7280', size: 18, spacing: { before: 360 } }),
      ],
    }],
  });

  return Packer.toBlob(doc);
};

export const downloadGeneratedDocumentDocx = async ({ opportunity, document, template }) => {
  const payload = buildDocumentGenerationPayload({ opportunity, document });
  const blob = await createCommercialDocumentDocxBlob(payload, template);
  downloadBlob(blob, generateDocumentFileName(payload, 'docx'));
  return payload;
};

export const createCommercialDocumentPdf = (payload, template = null) => {
  const { document, opportunity, items, generatedAt } = payload;
  const totalWithTax = document.total + document.taxTotal;
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const margin = 14;
  let y = 16;

  const addText = (text, x, lineY, options = {}) => {
    pdf.setFont('helvetica', options.bold ? 'bold' : 'normal');
    pdf.setFontSize(options.size || 10);
    pdf.setTextColor(options.color || 17, options.color || 17, options.color || 17);
    pdf.text(String(text ?? ''), x, lineY, options);
  };

  if (template?.content) {
    const lines = stripHtml(fillDocumentTemplate(template.content, payload))
      .split('\n')
      .flatMap((line) => pdf.splitTextToSize(line.trim(), pageWidth - (margin * 2)))
      .filter(Boolean);

    addText(`${document.label} ${document.number || ''}`.trim(), margin, y, { bold: true, size: 16 });
    y += 10;
    lines.forEach((line) => {
      if (y > 280) {
        pdf.addPage();
        y = 16;
      }
      addText(line, margin, y, { size: 10 });
      y += 6;
    });
    return pdf;
  }

  addText('EKV Group', margin, y, { bold: true, size: 18 });
  addText(document.label, pageWidth - margin, y, { bold: true, size: 18, align: 'right' });
  y += 7;
  addText(document.number || 'Bez cisla', pageWidth - margin, y, { size: 10, align: 'right' });
  y += 12;
  pdf.setDrawColor(17, 24, 39);
  pdf.line(margin, y, pageWidth - margin, y);
  y += 12;

  addText(document.title, margin, y, { bold: true, size: 15 });
  y += 9;
  addText(`Klient: ${opportunity.subjectName || 'Bez subjektu'}`, margin, y);
  addText(`Datum: ${formatDate(document.issueDate)}`, pageWidth - margin, y, { align: 'right' });
  y += 6;
  addText(`Projekt: ${opportunity.projectName || opportunity.projectCode || '-'}`, margin, y);
  addText(`Platnost: ${formatDate(document.validUntil)}`, pageWidth - margin, y, { align: 'right' });
  y += 12;

  addText('Polozky', margin, y, { bold: true, size: 13 });
  y += 7;

  const columns = [
    { label: '#', x: margin, width: 8 },
    { label: 'Kod', x: margin + 10, width: 22 },
    { label: 'Nazev', x: margin + 34, width: 70 },
    { label: 'Mnozstvi', x: margin + 106, width: 22 },
    { label: 'Jedn. cena', x: margin + 130, width: 25 },
    { label: 'Celkem', x: margin + 158, width: 24 },
  ];

  pdf.setFillColor(249, 250, 251);
  pdf.rect(margin, y - 5, pageWidth - (margin * 2), 8, 'F');
  columns.forEach((column) => addText(column.label, column.x, y, { bold: true, size: 8 }));
  y += 7;

  if (items.length === 0) {
    addText('Dokument zatim nema polozky.', margin, y);
    y += 8;
  } else {
    items.forEach((item) => {
      if (y > 270) {
        pdf.addPage();
        y = 18;
      }
      addText(item.position, columns[0].x, y, { size: 8 });
      addText(item.code || '-', columns[1].x, y, { size: 8 });
      const nameLines = pdf.splitTextToSize(item.name, 68);
      addText(nameLines, columns[2].x, y, { size: 8 });
      addText(`${item.quantity.toLocaleString('cs-CZ')} ${item.unit}`, columns[3].x + columns[3].width, y, { size: 8, align: 'right' });
      addText(formatCurrency(item.unitPrice), columns[4].x + columns[4].width, y, { size: 8, align: 'right' });
      addText(formatCurrency(item.lineTotal), pageWidth - margin, y, { size: 8, align: 'right' });
      y += Math.max(7, nameLines.length * 4.5);
      pdf.setDrawColor(229, 231, 235);
      pdf.line(margin, y - 4, pageWidth - margin, y - 4);
    });
  }

  y += 8;
  addText(`Mezisoucet: ${formatCurrency(document.subtotal)}`, pageWidth - margin, y, { align: 'right' });
  y += 6;
  addText(`Sleva: ${formatCurrency(document.discountTotal)}`, pageWidth - margin, y, { align: 'right' });
  y += 6;
  addText(`DPH: ${formatCurrency(document.taxTotal)}`, pageWidth - margin, y, { align: 'right' });
  y += 8;
  addText(`Celkem s DPH: ${formatCurrency(totalWithTax)}`, pageWidth - margin, y, { align: 'right', bold: true, size: 13 });

  if (document.notes) {
    y += 14;
    addText('Poznamka', margin, y, { bold: true, size: 12 });
    y += 6;
    addText(pdf.splitTextToSize(document.notes, pageWidth - (margin * 2)), margin, y);
  }

  addText(`Vygenerovano: ${formatDate(generatedAt)}`, margin, 287, { size: 8 });
  return pdf;
};

export const downloadGeneratedDocumentPdf = ({ opportunity, document, template }) => {
  const payload = buildDocumentGenerationPayload({ opportunity, document });
  const pdf = createCommercialDocumentPdf(payload, template);
  pdf.save(generateDocumentFileName(payload, 'pdf'));
  return payload;
};

export const documentGenerationTargets = [
  { type: 'offer', label: 'Nabidky', output: ['html', 'docx', 'pdf'] },
  { type: 'order', label: 'Objednavky', output: ['html', 'docx', 'pdf'] },
  { type: 'contract', label: 'Smlouvy', output: ['html', 'pdf', 'docx'] },
];
