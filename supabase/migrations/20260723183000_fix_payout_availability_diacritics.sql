-- The original availability function was created while its Czech literals were
-- decoded as Windows-1250. Repair the already deployed function definition
-- without changing any payout calculation or stored financial value.
DO $fix_payout_availability_diacritics$
DECLARE
  v_definition text;
  v_fixed_definition text;
BEGIN
  SELECT pg_get_functiondef('public.get_payout_availability(uuid,uuid)'::regprocedure)
    INTO v_definition;

  IF position(U&'Nen\0102\00AD nastaven pod\0102\00ADl' IN v_definition) = 0 THEN
    RETURN;
  END IF;

  v_fixed_definition := convert_from(convert_to(v_definition, 'WIN1250'), 'UTF8');
  EXECUTE v_fixed_definition;
END;
$fix_payout_availability_diacritics$;
