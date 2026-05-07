# CRM preparation audit

## Current data sources

CRM should reuse existing operational data instead of creating a second address book:

- `subjects`: companies, customers, suppliers, investors, authorities and their base contact fields.
- `project_contacts`: external people linked to concrete projects.
- `projects`: projection pipeline and client/investor relationships.
- `realizations`: delivery/commercial history after project handover.
- `tasks`: follow-up actions can later be linked to CRM opportunities.

## Prepared application surface

- `/crm` route added as the first CRM workspace.
- Sidebar entry added under management modules.
- `crm` permission module added to frontend permission handling.
- Supabase migration prepared for default `crm` role permissions.
- The first CRM view is read-oriented and aggregates existing data only.

## Recommended next CRM steps

1. Add CRM pipeline entities:
   - `crm_opportunities`
   - `crm_activities`
   - `crm_notes`
   - optional `crm_sources`
2. Link opportunities to `subjects`, optional `projects`, and owner `members`.
3. Add timeline view for subject detail using projects, contacts, notes and activities.
4. Replace ad hoc project contacts with a reusable contact/person model only if duplicate contacts become a real problem.
5. Add RLS policies after the exact role model is agreed:
   - sales/admin full access
   - project managers scoped access
   - read-only management overview

## Risk notes

- Do not duplicate `subjects` into a new CRM company table.
- Do not move project contacts yet; existing project workflows depend on them.
- Initial CRM should be read-heavy until pipeline permissions and ownership are decided.
