# EKVPortal design review

Date: 2026-05-12
Scope: login, dashboard, CRM, projects, realizace, payouts, attendance, desktop and mobile viewport.

## Verdict

Needs work, but the direction is sound.

The portal already reads as a serious operational business tool: dense, structured, calm, and data-first. The strongest parts are the login screen, dashboard KPI hierarchy, and the recent payout UI polish. The main design debt is not visual decoration; it is interaction clarity, responsiveness under dense data, accessibility labels, and a few runtime/schema issues that reduce trust.

## Fix pass

Status after implementation pass on 2026-05-12:

- CRM no longer selects `crm_numbering_settings.year_format` in the normal dashboard/document path, so live databases without that migration do not emit schema errors during everyday CRM use.
- CRM stage rows now use stable render keys and normalized labels, including Czech diacritics.
- Mobile sidebar and reviewed icon-only controls now have accessible labels.
- Dashboard engineering statuses use display labels instead of raw internal values.
- Czech pluralization was normalized for CRM offer/order counts covered by this pass.
- CRM header actions now keep the primary/secondary actions visible and move lower-frequency actions into a menu.
- Mobile dashboard DOM order now puts "Co řešit teď" ahead of pipeline/quick overview inside the operational section.

Remaining design debt: broader hardcoded color cleanup, deeper navigation information architecture, and a separate dark-mode/keyboard-only pass.

## Pillar assessment

| Pillar | Status | Notes |
| --- | --- | --- |
| Frictionless insight to action | Needs attention | Core modules are reachable quickly, but several screens expose too many equal-weight actions and icon-only controls. |
| Quality craft | Needs attention | Good shared card/table language, but there are inconsistent hardcoded colors, mixed Czech/internal status labels, and mobile gaps. |
| Trustworthy building | Needs attention | CRM emits console errors and a Supabase schema error for `crm_numbering_settings.year_format`; this undermines confidence in generated documents/settings. |

## What works well

- The login screen sets context clearly and feels more finished than the average internal tool.
- The dashboard gives a useful cross-company operational view with direct links into CRM, projects, realizace, finance, and tasks.
- Main module headers are consistent: title, short description, then primary actions.
- Payouts now have clearer workflow framing: request, approval, invoice, paid.
- The palette is appropriately restrained for an operational portal; it does not feel like a marketing landing page.
- Mobile dashboard cards stack cleanly and remain readable.

## Blocking issues

1. CRM has live console and schema errors.

   Evidence: `crm_numbering_settings.year_format` is selected by the frontend, but the online Supabase table does not currently expose that column. The browser console reports `column crm_numbering_settings.year_format does not exist`.

   Impact: users may see broken or inconsistent CRM numbering/template behavior, especially around offers/orders. This is a trust issue, not just a backend detail.

   Recommendation: apply the existing migration `supabase/migrations/20260511130000_add_crm_numbering_year_format.sql` to the active Supabase project, then re-test CRM settings and document generation.

2. CRM renders repeated React key warnings in `CrmDashboardInsights`.

   Evidence: browser console reports repeated duplicate key warnings around `src/components/CRM.jsx`, where stage rows are keyed by `stage.value`.

   Impact: React can duplicate, omit, or preserve the wrong card state during updates. For a pipeline/dashboard view this can show misleading stage rows.

   Recommendation: ensure CRM stage values are unique before rendering, or key with a stable composite such as `${stage.value}-${stage.label}` after normalizing duplicate DB values.

## Major issues

1. Mobile navigation trigger is icon-only without an accessible label.

   Evidence: `src/components/Sidebar.jsx` mobile `SheetTrigger` renders a button with only a menu icon. The snapshot shows an unlabeled button.

   Recommendation: add `aria-label="Otevřít menu"` to the mobile trigger and equivalent labels to other icon-only controls.

2. Too many icon-only controls have no visible meaning.

   Seen in projects, realizace, attendance, and toolbar toggles. Some have accessible names, but visually the user has to infer the action from a small icon.

   Recommendation: keep icon-only controls for familiar actions, but add tooltips and `aria-label`s consistently. For view toggles, use segmented controls with visible active state and labels where space allows.

3. The left navigation is functional but overloaded.

   The sidebar exposes top modules, nested CRM/Finance items, favorite stars, collapse controls, logout, version, and sometimes quick actions. It is powerful, but visually dense.

   Recommendation: separate persistent primary modules from utility actions more strongly. Consider grouping admin/settings/document utilities lower or behind a secondary "Správa" group.

4. Kanban-style project and realizace boards become horizontally dense.

   Desktop boards are useful for status scanning, but many narrow columns with long Czech project names create high cognitive load.

   Recommendation: keep board mode, but add a stronger table/list default for operational work, and use board mode mainly for status review. Add count/value summaries at the top of each column and stronger truncation/tooltips.

5. Mixed status language leaks internal values.

   Dashboard engineering shows labels like `waiting_for_approval` and `new`.

   Recommendation: all user-facing statuses should go through dictionary formatting, e.g. `Čeká na schválení`, `Nové`.

6. Hardcoded colors and inline styles weaken design system consistency.

   Evidence: `tailwind.config.js` defines tokens, but components still include raw hex values and inline styles in several places, including chart colors, document templates, project card border colors, and email/export HTML.

   Recommendation: keep raw colors only inside generated HTML/email templates where necessary. UI components should use semantic Tailwind tokens or shared status helpers.

## Minor issues

1. Dashboard is long on mobile.

   It is readable, but the first screen only shows the header and a few KPIs. The "Co řešit teď" section is buried.

   Recommendation: on mobile, put "Vyžaduje pozornost" and "Co řešit teď" above lower financial deep-dive sections.

2. Some Czech copy needs polish.

   Examples: `2 nabídek`, `0 objednávek`, labels without diacritics such as `Kvalifikovano`, `Nabidka`, `Jednani`, `Vyhrano`.

   Recommendation: centralize count formatting and CRM stage display labels.

3. Header action hierarchy is sometimes flat.

   CRM has `Obnovit`, `Nastavení CRM`, `Nová příležitost`, `Adresář subjektů` in one row. The primary action is visible, but the row still asks users to compare four buttons.

   Recommendation: keep one primary button, one secondary button, and move low-frequency actions into a menu.

4. Dark mode exists but was not visually verified in this pass.

   Recommendation: run a separate light/dark contrast pass before calling the design system complete.

## Recommended next design iteration

1. Fix CRM trust issues first: schema mismatch and duplicate keys.
2. Add accessible labels/tooltips to all icon-only buttons in sidebar, toolbars, table actions, and view toggles.
3. Normalize display labels for statuses and Czech pluralization.
4. Simplify action rows: one primary action per screen, secondary actions grouped.
5. Improve mobile dashboard priority order.
6. Convert remaining UI hardcoded colors to semantic tokens or shared status helpers.
7. Do a focused dark-mode and keyboard-only pass.

## Verification performed

- Started local Vite app on `http://localhost:3000` for review and `http://localhost:3001` for the fix pass.
- Logged in with a test account.
- Reviewed desktop screens: login, dashboard, CRM, projects, realizace, payouts, attendance.
- Reviewed mobile dashboard at `390x844`.
- Captured screenshots in `.playwright-cli/`.
- Checked design token usage in `src/index.css` and `tailwind.config.js`.
- Checked console output for runtime UI trust issues.
- Ran `npm run lint`.
- Ran `npm run build`.
