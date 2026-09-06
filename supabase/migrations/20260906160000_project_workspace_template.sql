-- Give every newly provisioned project a complete, predictable SharePoint workspace.
-- Existing project folders are extended in place the next time they are synchronized.

update public.document_storage_connections
set config = jsonb_set(
      coalesce(config, '{}'::jsonb),
      '{targets,project,structure}',
      jsonb_build_array(
        '00_Admin',
        '00_Admin/Projektovy list',
        '00_Admin/Zapisy a rozhodnuti',
        '01_Smlouvy',
        '01_Smlouvy/Objednavky a dodatky',
        '02_Podklady investora',
        '02_Podklady investora/Vstupni podklady',
        '02_Podklady investora/Geodeticke podklady',
        '03_Koordinace a KD',
        '03_Koordinace a KD/Zapisy z KD',
        '04_Fakturace',
        '04_Fakturace/Nakladove faktury',
        '05_Projektova dokumentace',
        '05_Projektova dokumentace/01_Pruvodni a souhrnne zpravy',
        '05_Projektova dokumentace/02_Situacni vykresy',
        '05_Projektova dokumentace/03_Dokumentace objektu',
        '05_Projektova dokumentace/04_Dokladova cast',
        '05_Projektova dokumentace/Pracovni verze',
        '05_Projektova dokumentace/Vydane verze',
        '06_Inzenyring a vyjadreni',
        '07_Revize a schvaleni',
        '08_Predani',
        '99_Archiv'
      ),
      true
    ),
    updated_at = now()
where provider = 'sharepoint';
