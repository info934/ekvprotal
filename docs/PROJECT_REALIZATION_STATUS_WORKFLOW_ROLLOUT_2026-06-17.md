# Project and realization status workflow rollout

Datum: 2026-06-17

## Obsah baliku

- Nova migrace `20260617173000_project_realization_status_workflow.sql`.
- Backend RPC:
  - `update_project_status(uuid, text, text)`
  - `update_realization_status(uuid, text, text)`
- Frontend zmeny:
  - `Projects.jsx` vola `update_project_status`.
  - `ProjectDetail.jsx` vola `update_project_status`.
  - `ProjectForm.jsx` pri editaci uklada status pres `update_project_status`.
  - `Realizace.jsx` vola `update_realization_status`.
  - `RealizaceDetail.jsx` vola `update_realization_status`.
  - `RealizaceForm.jsx` pri editaci uklada status pres `update_realization_status`.

## Chovani

- Projekty lze prepnout pouze na stavy:
  - `nabidka`
  - `active`
  - `ready_for_delivery`
  - `delivered`
  - `closed`
- Realizace lze prepnout pouze na stavy:
  - `Připravuje se`
  - `Probíhá`
  - `Pozastaveno`
  - `Dokončeno`
  - `Předáno`
  - `waiting_for_approval`
- Projektove zmeny vyzaduji `can_edit_module('projects')`.
- Realizacni zmeny vyzaduji `can_edit_module('realizace')`.
- Audit se zapisuje pres existujici `log_workflow_audit`.
- Projektova historie zustava kompatibilni s akci `update_project_status` a klicem `details.project_id`.

## Rollout poznamky

Tato zmena obsahuje databazovou migraci. Na produkci aplikovat pres review konkretniho SQL souboru:

```bash
supabase db query --linked --file supabase/migrations/20260617173000_project_realization_status_workflow.sql
```

Po aplikaci overit:

```sql
select routine_name, privilege_type, grantee
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in ('update_project_status', 'update_realization_status')
order by routine_name, grantee;
```

## Smoke test

- Zmenit stav projektu v seznamu projektu.
- Zmenit stav projektu v detailu projektu.
- Zmenit stav projektu pres editacni formular.
- Zmenit stav realizace v seznamu realizaci.
- Zmenit stav realizace v detailu realizace.
- Zmenit stav realizace pres editacni formular.
- Otevrit historii projektu a overit novy audit zaznam.
- Overit, ze uzivatel bez edit opravneni dostane chybovou hlasku z RPC.
