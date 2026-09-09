import { MEETING_POINT_TYPES } from './meetingNotes.js';
import { EKV_COMPANY, ekvProjectLogoDataUri } from './documentBrand.js';

export const escapeMeetingHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[char]));

const splitLongText = (value, limit = 2200) => {
  const text = String(value || '');
  if (text.length <= limit) return [text];
  const chunks = []; let remaining = text;
  while (remaining.length > limit) {
    let cut = Math.max(remaining.lastIndexOf('\n', limit), remaining.lastIndexOf('. ', limit));
    if (cut < limit * .55) cut = limit;
    const extra = remaining[cut] === '.' ? 1 : 0;
    chunks.push(remaining.slice(0, cut + extra).trim());
    remaining = remaining.slice(cut + extra).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
};

const paginatePoints = (points = []) => {
  const expanded = points.flatMap((point, originalIndex) => splitLongText(point.text).map((text, partIndex) => ({ ...point, text, originalIndex, partIndex })));
  if (!expanded.length) return [[]];
  const pages = []; let page = []; let weight = 0;
  for (const point of expanded) {
    const pointWeight = 1 + Math.ceil(String(point.text).length / 750);
    const limit = pages.length === 0 ? 5 : 7;
    if (page.length && weight + pointWeight > limit) { pages.push(page); page = []; weight = 0; }
    page.push(point); weight += pointWeight;
  }
  if (page.length) pages.push(page);
  return pages;
};

export function meetingPrintHtml(note, { entityTitle = '', entityType = 'project', entityCode = '' } = {}) {
  const e = escapeMeetingHtml;
  const raw = String(note.meeting_date || '');
  const date = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw.split('-').reverse().join('. ') : raw;
  const pages = paginatePoints(note.points || []);
  const entityLabel = entityType === 'realization' ? 'Realizace' : 'Projekce';
  const footer = number => `<footer><div><strong>${e(EKV_COMPANY.name)}</strong> · ${e(EKV_COMPANY.address)} · IČO ${e(EKV_COMPANY.ico)} · DIČ ${e(EKV_COMPANY.dic)}</div><div>${e(EKV_COMPANY.email)} · ${e(EKV_COMPANY.web)}</div><span>Strana ${number}/${pages.length}</span></footer>`;
  const body = pages.map((points, pageIndex) => `<main class="page"><div class="topline"></div>
    <div class="page-header"><img class="brand-logo" src="${ekvProjectLogoDataUri}" alt="EKV Project"><div class="doc-mark"><span>ZÁPIS Z KONTROLNÍHO DNE</span><strong>${e(entityCode || entityTitle)}</strong></div></div>
    ${pageIndex === 0 ? `<section class="hero"><div><p class="eyebrow">${e(entityLabel)} · ${e(entityTitle)}</p><h1>${e(note.title)}</h1><p class="lead">Rozhodnutí, úkoly a informace zaznamenané při jednání.</p></div><aside><div><span>Datum jednání</span><strong>${e(date || 'Neuvedeno')}</strong></div><div><span>Verze zápisu</span><strong>${e(note.version)}</strong></div><div><span>Stav dokumentu</span><strong>Uložená verze</strong></div></aside></section><section class="participants"><h2>Účastníci</h2><p>${e(note.participants || 'Neuvedeni')}</p></section>` : `<div class="continuation"><span>${e(note.title)}</span><strong>Body jednání · pokračování</strong></div>`}
    <section class="meeting"><div class="section-title"><h2>Body jednání</h2><span>${(note.points || []).length} bodů</span></div><ol>${points.map(point => `<li class="point"><div class="point-number">${point.originalIndex + 1}</div><div><div class="point-label">${e(MEETING_POINT_TYPES[point.kind] || 'Bod')}${point.partIndex ? ' · pokračování' : ''}</div><p>${e(point.text)}</p>${point.planning_item_id ? `<div class="reference">Navázaný úkol: ${e(point.planning_item_id)}</div>` : ''}</div></li>`).join('') || '<li class="empty">Bez bodů.</li>'}</ol></section>
    ${pageIndex === pages.length - 1 ? `<div class="notice">Obsah odpovídá uložené verzi zápisu. Aktuální stav navázaných úkolů najdete v portálu.</div><div class="signatures"><div><span>Za EKV Project</span><i>Jméno, datum a podpis</i></div><div><span>Za objednatele / investora</span><i>Jméno, datum a podpis</i></div></div>` : ''}${footer(pageIndex + 1)}</main>`).join('');
  return `<!doctype html><html lang="cs"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(note.title)} – verze ${e(note.version)}</title><style>
  @page{size:A4;margin:0}*{box-sizing:border-box}:root{--ink:#101828;--muted:#667085;--line:#d7e0ec;--soft:#f5f8fc;--blue:#2459c7;--navy:#153b82;--green:#2f8f5b}body{margin:0;background:#e9edf4;color:var(--ink);font:10.5px/1.45 "Aptos","Segoe UI",Arial,sans-serif}.page{position:relative;width:210mm;height:297mm;margin:14px auto;background:#fff;padding:9mm 11mm 20mm;overflow:hidden;page-break-after:always;box-shadow:0 20px 55px rgba(15,23,42,.15)}.page:last-child{page-break-after:auto}.topline{height:6px;border-radius:999px;background:linear-gradient(90deg,var(--navy),var(--blue),var(--green));margin-bottom:8mm}.page-header{display:flex;align-items:center;justify-content:space-between;gap:12mm;padding-bottom:5mm;border-bottom:1px solid var(--line)}.brand-logo{display:block;width:48mm;height:auto}.doc-mark{text-align:right}.doc-mark span{display:block;color:var(--blue);font-size:8px;font-weight:800;letter-spacing:.12em}.doc-mark strong{display:block;margin-top:2px;font-size:11px}.hero{display:grid;grid-template-columns:minmax(0,1fr) 61mm;gap:9mm;margin-top:8mm}.eyebrow{margin:0 0 3mm;color:var(--blue);font-weight:800;text-transform:uppercase;letter-spacing:.09em}h1{margin:0;font-size:24px;line-height:1.08;letter-spacing:-.03em;overflow-wrap:anywhere}.lead{color:var(--muted);font-size:11px}.hero aside{border:1px solid var(--line);border-radius:10px;overflow:hidden}.hero aside div{display:grid;grid-template-columns:27mm 1fr;gap:4px;padding:7px 8px;border-bottom:1px solid var(--line)}.hero aside div:last-child{border:0}.hero aside span{color:var(--muted);font-size:8.5px}.hero aside strong{text-align:right}.participants{margin-top:6mm;padding:4mm;border:1px solid var(--line);border-radius:10px;background:var(--soft)}h2{margin:0;font-size:13px}.participants p{margin:2mm 0 0;white-space:pre-wrap}.continuation{display:flex;justify-content:space-between;margin:6mm 0 4mm;color:var(--muted)}.continuation strong{color:var(--ink)}.meeting{margin-top:6mm}.section-title{display:flex;align-items:end;justify-content:space-between;border-bottom:2px solid var(--navy);padding-bottom:2mm}.section-title span{color:var(--muted)}ol{list-style:none;margin:0;padding:0}.point{display:grid;grid-template-columns:10mm 1fr;gap:3mm;padding:4mm 0;border-bottom:1px solid var(--line);break-inside:avoid}.point-number{display:grid;place-items:center;width:8mm;height:8mm;border-radius:50%;background:var(--navy);color:#fff;font-weight:800}.point-label{color:var(--blue);font-size:8.5px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.point p{margin:1.5mm 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.reference{margin-top:2mm;color:var(--muted);font-size:8.5px}.empty{padding:10mm;text-align:center;color:var(--muted)}.notice{margin-top:5mm;padding:3mm;border-left:3px solid var(--green);background:#f0fdf4;color:#355646}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:7mm;margin-top:6mm}.signatures div{min-height:23mm;border:1px dashed #98a5b8;border-radius:9px;padding:3mm;display:flex;flex-direction:column;justify-content:space-between}.signatures span{font-weight:700}.signatures i{border-top:1px solid var(--muted);padding-top:2mm;color:var(--muted);font-style:normal;font-size:8.5px}footer{position:absolute;left:11mm;right:11mm;bottom:7mm;display:grid;grid-template-columns:1fr auto auto;gap:5mm;padding-top:2mm;border-top:1px solid var(--line);color:var(--muted);font-size:7.5px}footer div:nth-child(2){display:none}@media print{body{background:#fff}.page{margin:0;box-shadow:none;height:295mm}.topline{border-radius:0}}@media(max-width:800px){.page{margin:0;transform-origin:top left;box-shadow:none}}
  </style></head><body>${body}</body></html>`;
}
