DO $$
DECLARE
  connection_id uuid;
BEGIN
  SELECT id
  INTO connection_id
  FROM public.document_storage_connections
  WHERE provider = 'sharepoint'
  ORDER BY is_default DESC, created_at ASC
  LIMIT 1;

  UPDATE public.document_storage_connections
  SET is_default = false,
      updated_at = now()
  WHERE is_default = true;

  IF connection_id IS NULL THEN
    INSERT INTO public.document_storage_connections (
      provider,
      name,
      status,
      is_default,
      config
    ) VALUES (
      'sharepoint',
      'EKV SharePoint',
      'active',
      true,
      '{}'::jsonb
    )
    RETURNING id INTO connection_id;
  END IF;

  UPDATE public.document_storage_connections
  SET name = 'EKV SharePoint',
      status = 'active',
      is_default = true,
      config = jsonb_build_object(
        'tenantId', '1218304c-4324-41d0-90dd-577fcfaff3c0',
        'targets', jsonb_build_object(
          'project', jsonb_build_object(
            'siteId', 'ekvproject.sharepoint.com,93dd2f8e-2df6-41b2-850e-d32b92d7722d,b888f298-9d89-4208-a9fb-8839906e4506',
            'driveId', 'b!ji_dk_YtskGFDtMrktdyLZjyiLiJnQhCqfuIOZBuRQZeVxJ2ecswQaEAvq3Yhwvu',
            'rootFolderPath', 'EKVPortal',
            'structure', jsonb_build_array('00_Admin', '01_Smlouvy', '02_Dokumentace', '03_Predani', '04_Fakturace')
          ),
          'realizace', jsonb_build_object(
            'siteId', 'ekvproject.sharepoint.com,d05d5c3e-336e-49df-86ca-bba3005d26eb,842ae6f5-0902-4f3f-b649-e182133934ed',
            'driveId', 'b!Plxd0G4z30mGyrujAF0m6_XmKoQCCT9PtknhghM5NO2_O2HioRCPTa_LyEkL3-LK',
            'rootFolderPath', 'EKVPortal',
            'structure', jsonb_build_array('00_Admin', '01_Objednavky', '02_Naklady', '03_Fotodokumentace', '04_Predani', '05_Fakturace')
          ),
          'invoice', jsonb_build_object(
            'siteId', 'ekvproject.sharepoint.com,5da450c3-f306-4487-8b50-d3ebb123f6eb,1f691990-7ba1-42fa-81db-09dcf5689b90',
            'driveId', 'b!w1CkXQbzh0SLUNPrsSP265AZaR-he_pCgdsJ3PVom5ARqPaGZ85gQK4kQMDCOOW0',
            'rootFolderPath', 'Faktury',
            'structure', '[]'::jsonb
          ),
          'product', jsonb_build_object(
            'siteId', 'ekvproject.sharepoint.com,93dd2f8e-2df6-41b2-850e-d32b92d7722d,b888f298-9d89-4208-a9fb-8839906e4506',
            'driveId', 'b!ji_dk_YtskGFDtMrktdyLZjyiLiJnQhCqfuIOZBuRQZeVxJ2ecswQaEAvq3Yhwvu',
            'rootFolderPath', 'EKVPortal',
            'structure', '[]'::jsonb
          )
        ),
        'notes', 'Projekty, realizace a faktury jsou smerovany do samostatnych SharePoint webu.'
      ),
      updated_at = now()
  WHERE id = connection_id;
END $$;
