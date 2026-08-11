-- Expose an unambiguous reward cost contract while preserving the historical
-- assigned_costs field, which contains all deductions for compatibility.

alter function public.project_financial_summary_admin_internal(uuid)
  rename to project_financial_summary_admin_internal_legacy_20260811_reward_fields;

revoke all on function public.project_financial_summary_admin_internal_legacy_20260811_reward_fields(uuid)
  from public, anon, authenticated;
grant execute on function public.project_financial_summary_admin_internal_legacy_20260811_reward_fields(uuid)
  to service_role;

create function public.project_financial_summary_admin_internal(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_summary jsonb;
  v_member_rewards jsonb := '[]'::jsonb;
begin
  v_summary := public.project_financial_summary_admin_internal_legacy_20260811_reward_fields(p_project_id);

  select coalesce(jsonb_agg(
    reward || jsonb_build_object(
      'direct_assigned_costs', greatest(
        0,
        coalesce((reward->>'assigned_costs')::numeric, 0)
          - coalesce((reward->>'sponsored_labor_costs')::numeric, 0)
      ),
      'total_deductions', coalesce((reward->>'assigned_costs')::numeric, 0)
    ) order by reward_order
  ), '[]'::jsonb)
  into v_member_rewards
  from jsonb_array_elements(coalesce(v_summary->'member_rewards', '[]'::jsonb))
    with ordinality reward_rows(reward, reward_order);

  return jsonb_set(v_summary, '{member_rewards}', v_member_rewards, true);
end;
$$;

revoke all on function public.project_financial_summary_admin_internal(uuid)
  from public, anon, authenticated;
grant execute on function public.project_financial_summary_admin_internal(uuid)
  to service_role;

comment on function public.project_financial_summary_admin_internal(uuid) is
  'Canonical project financial model v3 with explicit direct_assigned_costs, sponsored_labor_costs, and total_deductions reward fields.';
