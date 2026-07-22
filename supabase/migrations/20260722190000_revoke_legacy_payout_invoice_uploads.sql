-- Legacy invoice RPCs accept a caller-provided path without proving that the
-- file exists. Revoke the implicit PUBLIC grant as well as direct API roles.
revoke all on function public.upload_hourly_payout_invoice(uuid, text)
  from public, anon, authenticated;
revoke all on function public.upload_payout_invoice(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.upload_hourly_payout_invoice_v2(uuid, text, text, uuid, text, jsonb)
  to authenticated, service_role;
grant execute on function public.upload_payout_invoice_v2(uuid, text, text, text, uuid, text, jsonb)
  to authenticated, service_role;
