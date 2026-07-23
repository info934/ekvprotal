-- Repair a legacy mojibake label in the payout availability read model.
-- The function body is otherwise retained exactly as deployed.
DO $fix_payout_availability_status_label$
DECLARE
  v_definition text;
  v_legacy_label text := 'DostupnA' || chr(65533) || ' k LlA?dosti';
  v_fixed_label text := 'Dostupn' || chr(233) || ' k ' || chr(382) || chr(225) || 'dosti';
BEGIN
  SELECT pg_get_functiondef('public.get_payout_availability(uuid,uuid)'::regprocedure)
    INTO v_definition;

  IF position(v_legacy_label IN v_definition) > 0 THEN
    v_definition := replace(
      v_definition,
      v_legacy_label,
      v_fixed_label
    );
    EXECUTE v_definition;
  END IF;
END;
$fix_payout_availability_status_label$;
