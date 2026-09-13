import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const root = process.cwd();
const outputDir = path.join(root, 'output', 'pdf', 'lookbook-2026-09');
await mkdir(outputDir, { recursive: true });

const server = await createServer({ root, appType: 'custom', server: { middlewareMode: true }, logLevel: 'error' });
try {
  const documents = await server.ssrLoadModule('/src/lib/documentGenerationService.js');
  const meetings = await server.ssrLoadModule('/src/lib/meetingPrint.js');
  const subject = {
    name: 'DEMO Investor s.r.o.', ico: '01234567', dic: 'CZ01234567',
    address: 'Ukázková 125, 301 00 Plzeň', contact_person: 'Jan Novák',
    email: 'demo.investor@example.cz', phone: '+420 777 000 000',
  };
  const opportunity = {
    id: '00000000-0000-4000-8000-000000000946', number: 'OP-2026-DEMO',
    title: 'FVE 99,9 kWp s bateriovým úložištěm', value: 3_267_000,
    description: 'Dodávka, montáž, připojení a uvedení fotovoltaické elektrárny s BESS do provozu.',
    subject, project: { id: '00000000-0000-4000-8000-000000000301', code: '260900-DEMO', name: 'DEMO FVE Plzeň' },
  };
  const items = [
    { sort_order: 10, section_name: 'Projekt a příprava', code: 'PD-FVE', name: 'Projektová dokumentace', description: 'Dokumentace pro provedení stavby, jednopólová schémata a dokladová část.', quantity: 1, unit: 'soubor', unit_price: 145000, unit_cost: 88000, vat_rate: 21, discount_percent: 0 },
    { sort_order: 20, section_name: 'Fotovoltaická elektrárna', code: 'FVE-999', name: 'Technologie FVE 99,9 kWp', description: 'Panely, nosná konstrukce, DC a AC část, ochrany, monitoring a montáž.', quantity: 1, unit: 'soubor', unit_price: 1_985_000, unit_cost: 1_510_000, vat_rate: 21, discount_percent: 3 },
    { sort_order: 30, section_name: 'Bateriové úložiště', code: 'BESS-120', name: 'BESS 120 kWh', description: 'Bateriové moduly, BMS, výkonová elektronika, EMS a uvedení do provozu.', quantity: 1, unit: 'soubor', unit_price: 1_240_000, unit_cost: 910_000, vat_rate: 21, discount_percent: 0 },
    { sort_order: 40, section_name: 'Dokončení', code: 'REV-DOC', name: 'Výchozí revize a dokumentace skutečného provedení', description: 'Revizní zpráva, zkoušky, návody, školení obsluhy a předání.', quantity: 1, unit: 'soubor', unit_price: 72000, unit_cost: 39000, vat_rate: 21, discount_percent: 0 },
  ];
  const commercial = [
    ['01-testovaci-nabidka-ekv.html', 'offer', 'NAB-2026-DEMO-001', 'Cenová nabídka – FVE 99,9 kWp s BESS'],
    ['02-testovaci-objednavka-ekv.html', 'order', 'OBJ-2026-DEMO-001', 'Objednávka realizace FVE a BESS'],
    ['03-testovaci-smlouva-ekv.html', 'contract', 'SOD-2026-DEMO-001', 'Smlouva o dílo – FVE a bateriové úložiště'],
  ];
  for (const [fileName, type, number, title] of commercial) {
    const document = {
      id: `00000000-0000-4000-8000-000000000${type === 'offer' ? '501' : type === 'order' ? '502' : '503'}`,
      type, number, title, status: 'draft', issue_date: '2026-09-13', valid_until: '2026-10-13', subject, items,
      notes: 'TESTOVACÍ VZOR PRO KONTROLU VZHLEDU. Termín realizace: 12 týdnů od splnění podmínek zahájení. Platební podmínky a přesný rozsah budou potvrzeny ve finálním dokumentu.',
    };
    const payload = documents.buildDocumentGenerationPayload({ opportunity, document });
    await writeFile(path.join(outputDir, fileName), documents.renderCommercialDocumentHtml(payload), 'utf8');
  }

  const protocolBase = {
    id: '00000000-0000-4000-8000-000000000601', project: opportunity.project,
    realization: { id: '00000000-0000-4000-8000-000000000401', name: 'Realizace FVE 99,9 kWp s BESS', status: 'handover' },
    opportunity, subject, document_date: '2026-09-13', status: 'draft', version: 1,
    items: [
      { sort_order: 10, code: 'FVE', name: 'Fotovoltaická elektrárna 99,9 kWp', description: 'Kompletní DC/AC technologie a monitoring.', quantity: 1, unit: 'soubor', condition: 'Funkční, odzkoušeno' },
      { sort_order: 20, code: 'BESS', name: 'Bateriové úložiště 120 kWh', description: 'BMS, EMS a vzdálený dohled.', quantity: 1, unit: 'soubor', condition: 'Funkční, odzkoušeno' },
      { sort_order: 30, code: 'DOC', name: 'Dokladová a provozní dokumentace', description: 'Revize, návody, protokoly a dokumentace skutečného provedení.', quantity: 1, unit: 'soubor', condition: 'Předáno elektronicky' },
    ],
    defects: [{ sort_order: 10, title: 'Doplnění finálního popisu rozvaděče', description: 'Kosmetická úprava štítku bez vlivu na bezpečný provoz.', severity: 'nízká', status: 'otevřeno', responsible: 'EKV Project s.r.o.', due_date: '2026-09-20' }],
    notes: 'TESTOVACÍ VZOR PRO KONTROLU VZHLEDU. Dokument neprokazuje skutečné předání díla.',
  };
  const protocols = [
    ['04-testovaci-predavaci-protokol-celkovy-ekv.html', 'handover_full', 'PRE-2026-DEMO-001', 'Celkové předání díla', 'Dílo je předáváno jako celek v rozsahu smlouvy o dílo.'],
    ['05-testovaci-predavaci-protokol-castecny-ekv.html', 'handover_partial', 'PRE-C-2026-DEMO-001', 'Částečné předání díla', 'Předává se technologická část FVE a BESS; dokončení administrativních kroků pokračuje.'],
    ['06-testovaci-servisni-protokol-ekv.html', 'service_protocol', 'SRV-2026-DEMO-001', 'Servisní protokol FVE + BESS', 'Diagnostika komunikace BMS, kontrola konektorů, aktualizace firmware a funkční zkouška.'],
  ];
  for (const [fileName, document_type, number, title, scope] of protocols) {
    const protocol = { ...protocolBase, document_type, number, title, handover_scope: scope, service_description: document_type === 'service_protocol' ? scope : '' };
    const payload = documents.buildHandoverProtocolPayload({ protocol });
    await writeFile(path.join(outputDir, fileName), documents.renderHandoverProtocolHtml(payload), 'utf8');
  }

  const meeting = {
    id: '00000000-0000-4000-8000-000000000701', title: 'Kontrolní den č. 6 – koordinace montáže',
    meeting_date: '2026-09-13', version: 1,
    participants: 'Jan Novák – investor\nIng. Petra Svobodová – EKV Project\nMartin Dvořák – generální dodavatel',
    points: [
      { kind: 'decision', text: 'Potvrzeno umístění hlavního AC rozvaděče podle revize výkresu R03.' },
      { kind: 'task', text: 'EKV Project doplní aktualizovaný harmonogram montáže a rozešle jej účastníkům do 15. 9. 2026.' },
      { kind: 'information', text: 'Dodávka bateriových modulů je potvrzena na 21. 9. 2026. Manipulační koridor zůstane volný.' },
      { kind: 'risk', text: 'Před instalací je nutné uzavřít požární prostupy. Odpovědnost: generální dodavatel, termín 18. 9. 2026.' },
      { kind: 'task', text: 'Investor potvrdí kontaktní osobu pro školení obsluhy a termín předání dokumentace.' },
    ],
  };
  await writeFile(path.join(outputDir, '07-testovaci-zapis-kd-ekv.html'), meetings.meetingPrintHtml(meeting, {
    entityTitle: opportunity.project.name, entityType: 'project', entityCode: opportunity.project.code,
  }), 'utf8');
  process.stdout.write(outputDir);
} finally {
  await server.close();
}
