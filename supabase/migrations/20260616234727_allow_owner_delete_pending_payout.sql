CREATE OR REPLACE FUNCTION public.delete_payout_request(
  p_payout_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current_member_id uuid;
  v_can_admin boolean;
  v_payout public.payouts%rowtype;
BEGIN
  v_current_member_id := public.get_member_id();
  v_can_admin := COALESCE(public.get_user_role() = 'admin', false)
    OR EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.role = public.get_user_role()
        AND rp.module = 'payouts'
        AND rp.can_admin = true
    );

  SELECT *
  INTO v_payout
  FROM public.payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payout request not found';
  END IF;

  IF NOT v_can_admin THEN
    IF v_payout.member_id IS DISTINCT FROM v_current_member_id THEN
      RAISE EXCEPTION 'Not allowed to delete this payout request';
    END IF;

    IF v_payout.status <> 'pending' THEN
      RAISE EXCEPTION 'Only pending payout requests can be deleted';
    END IF;
  END IF;

  DELETE FROM public.payout_items WHERE payout_id = p_payout_id;
  DELETE FROM public.payouts WHERE id = p_payout_id;

  BEGIN
    INSERT INTO public.audit_logs (user_id, user_email, action, details)
    VALUES (
      auth.uid(),
      auth.jwt() ->> 'email',
      'payout_deleted',
      jsonb_build_object(
        'payout_id', p_payout_id,
        'member_id', v_payout.member_id,
        'amount', v_payout.amount,
        'status', v_payout.status
      )
    );
  EXCEPTION WHEN undefined_table OR insufficient_privilege THEN
    NULL;
  END;

  RETURN to_jsonb(v_payout);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_payout_request(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_payout_request(uuid) TO authenticated;
