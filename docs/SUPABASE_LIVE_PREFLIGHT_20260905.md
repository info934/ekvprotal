# Supabase EKV – ověření připojení a migrací 5. 9. 2026

Přihlášení přes Supabase CLI 2.109.1 a propojení pracovního adresáře proběhlo úspěšně. Ověřený cloudový projekt je `yurysbxxevtuvhrbmloc` (`info934's Project`, region `eu-central-1`), stav `ACTIVE_HEALTHY`, PostgreSQL `17.6.1.011`. Jde o projekt uvedený v produkční dokumentaci portálu.

## Co bylo provedeno

- Přihlášení a `link` projektu; místní údaje propojení jsou v ignorovaném `supabase/.temp/`.
- Spuštění celého `supabase/checks/00_preflight.sql` v transakci `READ ONLY`: úspěch.
- Samostatné přečtení historie migrací a katalogových údajů. CLI u vícepříkazového SQL vrací jen poslední výsledek, proto byly ruční výstupy preflightu načteny zvlášť.
- Ověření všech sedmi požadovaných vazeb triggerů; požadované tabulky, kontrolované sloupce, RPC a stav přejmenovávaných funkcí odpovídají předpokladům preflightu.
- Vlastníkem tří funkcí identity/oprávnění je `postgres`, má `BYPASSRLS`; funkce jsou `SECURITY DEFINER`. Současný `search_path=public` bude migrací aktivního účtu nahrazen explicitními kvalifikovanými odkazy.
- Ověření unikátních indexů pro `task_statuses(name)`, `planning_items(legacy_project_task_id)`, `planning_plans(project_id) WHERE project_id IS NOT NULL` a ledger `(attendance_id, attendance_submission_id, source_version)`.

Nebyly aplikovány nové migrace, měněna aplikační data ani migrační historie a nebyly nasazeny Edge funkce. Nebyly spuštěny zapisující SQL testy. Úspěch katalogové kontroly nedokazuje správnost provedení nových migrací ani jejich funkční chování.

## Skutečný stav historie

| Porovnání | Počet |
| --- | ---: |
| Lokální soubory | 127 |
| Verze evidované na Supabase | 67 |
| Společné verze | 60 |
| Verze pouze na Supabase | 7 |
| Starší verze pouze lokálně | 62 |
| Nové migrace 2.0 pouze lokálně | 5 |

Poslední evidovaná verze je `20260812150000_workflow_email_deliveries`. Žádná z pěti migrací `20260905100000` až `20260905140000` není evidovaná jako aplikovaná. Sedm verzí pouze na Supabase: `20260508122920`, `20260508122927`, `20260508122936`, `20260508123110`, `20260508195350`, `20260509063536`, `20260509075322`.

Tento nesoulad je známý historický stav: starší nasazení kombinovala ruční SQL a exportovanou baseline. Popisují jej [pravidla repozitáře](../supabase/README.md#historical-migration-drift) a [údržba migrací](SUPABASE_MIGRATION_MAINTENANCE.md). Neznamená to, že je potřeba 62 starších migrací znovu spustit. Plošný `db push`, automatické přeznačení historie ani reset databáze pro tento upgrade nepoužívat.

Další postup je v [návodu k migracím 2.0](SUPABASE_MIGRACE_2_0.md): ověřit pět přesných změn na izolované kopii, zajistit obnovitelnou zálohu a poté aplikovat a evidovat jednotlivé schválené verze podle pravidel repozitáře. Finanční a auditní historii zachovat.

Místní surové protokoly: `output/supabase-live-history-20260905.json`, `output/supabase-live-catalog-20260905.json`. Neobsahují přístupové tokeny ani aplikační záznamy; jde o verze a metadata schématu. Nebyly pořízeny zálohy provozních dat.
