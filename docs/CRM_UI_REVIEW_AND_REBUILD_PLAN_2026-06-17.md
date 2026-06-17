# CRM UI review and rebuild plan

Datum: 2026-06-17

## Aktualni stav

- Hlavni CRM modul je soustredeny v `src/components/CRM.jsx` a ma pres 3000 radku.
- V jednom souboru jsou datove nacitani, metriky, dashboard, board, tabulka, detail obchodni prilezitosti, dialogy i inline update logika.
- Aktualni UI micha vice pracovnich rezimu najednou. Uzivatel musi prochazet mnoho panelu, nez je jasne, co je nejdulezitejsi udelat dal.
- Existujici routy zustavaji spravne:
  - `/crm`
  - `/crm/opportunities`
  - `/crm/opportunities/:opportunityId`
  - `/crm/offers`
  - `/crm/orders`
  - `/crm/:opportunityId`

## Rozhodnuty smer

CRM rebuild bude dashboard-first, ne kanban-first.

Prvni obrazovka `/crm` ma odpovedet na tri otazky:

- Jak vypada pipeline a forecast?
- Kde jsou rizika a zpozdene follow-upy?
- Ktere prilezitosti potrebuji akci dnes?

Navrh prvni faze:

- Horni KPI strip: otevrene prilezitosti, pipeline, vazena pipeline, ocekavany zisk.
- Analyticky pas: rozpad podle fazi, koncentrace rizika, nejblizsi follow-upy.
- Worklist prilezitosti: kompaktni tabulka/seznam s filtrem, prioritou, hodnotou, vlastnikem a dalsim krokem.
- Preview panel: po vyberu prilezitosti ukazat hlavni informace a rychle akce bez nutnosti opustit dashboard.

## Implementacni plan

- Zachovat existujici datovy model a Supabase tabulky. Prvni UI balicek nema menit schema.
- Rozdelit `CRM.jsx` postupne do mensich casti:
  - `useCrmData` pro nacitani, refresh, metriky a mutace.
  - `CrmDashboardPage` pro hlavni `/crm`.
  - `CrmPipelineSummary` pro pipeline/forecast sekci.
  - `CrmRiskPanel` pro rizika a follow-upy.
  - `CrmOpportunityWorklist` pro pracovni seznam prilezitosti.
  - `CrmOpportunityPreview` pro pravy/detailni panel.
- V prvni fazi zachovat existujici `DealWorkspace` funkcne, ale sjednotit ho vizualne s novym dashboardem.
- Neprepisovat najednou nabidky a objednavky; `/crm/offers` a `/crm/orders` zustanou samostatne a napoji se vizualne v dalsim baliku.

## Design pravidla

- Pracovni SaaS UI, ne marketingova landing page.
- Pouzit existujici shadcn komponenty a lucide ikony.
- Radius panelu max. 8 px, zadne karty v kartach.
- Paleta: bila plocha, slate text, modre primarni akce, emerald/amber/rose pro stavove a rizikove informace.
- Horni cast musi byt skenovatelna bez scrollovani na desktopu.
- Na mobilu ma byt poradi: KPI, rizika/follow-upy, worklist, detail az po vyberu.

## Acceptance criteria

- `/crm` ma jasnou jednu primarni akci a viditelny seznam prilezitosti k reseni.
- Uzivatel vidi pipeline, rizika a follow-upy bez prepinani tabu.
- Vyber prilezitosti v worklistu aktualizuje preview panel bez ztraty filtru.
- Existujici workflow vytvoreni, upravy, zmeny faze a duvodu prohrane prilezitosti zustava funkcni.
- `CRM.jsx` po prvni refactor fazi prestane byt jedinym vlastnikem celeho CRM UI.

## Overeni

- `npm run lint`
- `npm run build`
- Browser smoke:
  - `/crm`
  - `/crm/opportunities`
  - `/crm/opportunities/:opportunityId`
  - `/crm/offers`
  - `/crm/orders`
- Playwright kontrola desktop a mobilniho viewportu:
  - bez prekryvu textu
  - filtry a vyber radku funguji
  - preview panel se aktualizuje
  - prazdne stavy jsou citelne
