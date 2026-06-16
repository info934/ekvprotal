


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."overhead_allocation_status" AS ENUM (
    'DRAFT',
    'PENDING_APPROVAL',
    'APPROVED'
);


ALTER TYPE "public"."overhead_allocation_status" OWNER TO "postgres";


CREATE TYPE "public"."overhead_cost_type" AS ENUM (
    'PRAVIDELNY',
    'PROMENLIVY'
);


ALTER TYPE "public"."overhead_cost_type" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_company_financials"() RETURNS TABLE("realized_profit" numeric, "potential_profit" numeric, "total_overhead" numeric, "total_project_value" numeric, "unallocated_budget" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
WITH project_finances AS (
    SELECT
        p.id,
        p.status,
        p.price,
        p.price * (p.budget_percentage / 100.0) as total_budget,
        p.price * (p.budget_percentage / 100.0) * (p.overhead_percentage / 100.0) as overhead_amount,
        COALESCE((SELECT SUM(ps.price) FROM project_subcontractors ps WHERE ps.project_id = p.id), 0) as subcontractor_costs,
        COALESCE((SELECT SUM(
            CASE
                WHEN pm.reward_type = 'fixed' THEN pm.reward_amount
                WHEN pm.reward_type = 'percentage' THEN 
                    GREATEST(0, 
                        (p.price * (p.budget_percentage / 100.0)) 
                        - (p.price * (p.budget_percentage / 100.0) * (p.overhead_percentage / 100.0)) 
                        - COALESCE((SELECT SUM(ps_inner.price) FROM project_subcontractors ps_inner WHERE ps_inner.project_id = p.id), 0)
                    ) * (pm.reward_percentage / 100.0)
                ELSE 0
            END
        ) FROM project_members pm WHERE pm.project_id = p.id), 0) as member_rewards
    FROM projects p
)
SELECT
    SUM(CASE WHEN pf.status IN ('delivered', 'closed') THEN pf.price - pf.total_budget ELSE 0 END) as realized_profit,
    SUM(CASE WHEN pf.status NOT IN ('delivered', 'closed') THEN pf.price - pf.total_budget ELSE 0 END) as potential_profit,
    SUM(pf.overhead_amount) as total_overhead,
    SUM(pf.price) as total_project_value,
    SUM(pf.total_budget - pf.overhead_amount - pf.subcontractor_costs - pf.member_rewards) as unallocated_budget
FROM project_finances pf;
$$;


ALTER FUNCTION "public"."get_company_financials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_member_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT id FROM public.members WHERE auth_user_id = (select auth.uid()) LIMIT 1;
$$;


ALTER FUNCTION "public"."get_member_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_overhead_summary"() RETURNS TABLE("total_allocated_overhead" numeric, "total_accounted_overhead" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
SELECT
    (SELECT COALESCE(SUM(p.price * (p.budget_percentage / 100.0) * (p.overhead_percentage / 100.0)), 0)
     FROM projects p
     WHERE p.price IS NOT NULL AND p.budget_percentage IS NOT NULL AND p.overhead_percentage IS NOT NULL
    ) as total_allocated_overhead,
    
    (SELECT COALESCE(SUM(poc.amount), 0)
     FROM project_overhead_costs poc
    ) as total_accounted_overhead;
$$;


ALTER FUNCTION "public"."get_overhead_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_permissions"("p_role" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    permissions_json JSON;
BEGIN
    SELECT json_object_agg(module, json_build_object('can_read', can_read, 'can_edit', can_edit, 'can_admin', can_admin))
    INTO permissions_json
    FROM role_permissions
    WHERE role = p_role;
    
    RETURN permissions_json;
END;
$$;


ALTER FUNCTION "public"."get_permissions"("p_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_projects_with_balance"("p_member_id" "uuid") RETURNS TABLE("project_id" "uuid", "project_name" "text", "project_code" "text", "total_reward" numeric, "paid_amount" numeric, "available_balance" numeric, "project_status" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
WITH member_projects AS (
    SELECT 
        pm.project_id,
        pm.reward_type,
        pm.reward_amount,
        pm.reward_percentage
    FROM project_members pm
    WHERE pm.member_id = p_member_id
),
project_details AS (
    SELECT
        p.id as project_id,
        p.name as project_name,
        p.code as project_code,
        p.price,
        p.budget_percentage,
        p.overhead_percentage,
        p.status as project_status,
        COALESCE((SELECT SUM(ps.price) FROM project_subcontractors ps WHERE ps.project_id = p.id), 0) as total_subcontractor_price
    FROM projects p
    WHERE p.id IN (SELECT project_id FROM member_projects)
),
project_rewards AS (
    SELECT
        pd.project_id,
        pd.project_name,
        pd.project_code,
        pd.project_status,
        CASE
            WHEN mp.reward_type = 'fixed' THEN mp.reward_amount
            WHEN mp.reward_type = 'percentage' THEN
                GREATEST(0, 
                    (pd.price * (pd.budget_percentage / 100.0))
                    - (pd.price * (pd.budget_percentage / 100.0) * (pd.overhead_percentage / 100.0))
                    - pd.total_subcontractor_price
                ) * (mp.reward_percentage / 100.0)
            ELSE 0
        END AS total_reward
    FROM project_details pd
    JOIN member_projects mp ON pd.project_id = mp.project_id
),
paid_amounts AS (
    SELECT
        pi.project_id,
        SUM(pi.amount) as paid_amount
    FROM payout_items pi
    JOIN payouts p ON pi.payout_id = p.id
    WHERE p.member_id = p_member_id AND p.status IN ('paid', 'approved', 'pending')
    GROUP BY pi.project_id
)
SELECT
    pr.project_id,
    pr.project_name,
    pr.project_code,
    COALESCE(pr.total_reward, 0) as total_reward,
    COALESCE(pa.paid_amount, 0) as paid_amount,
    COALESCE(pr.total_reward, 0) - COALESCE(pa.paid_amount, 0) as available_balance,
    pr.project_status
FROM project_rewards pr
LEFT JOIN paid_amounts pa ON pr.project_id = pa.project_id
WHERE (COALESCE(pr.total_reward, 0) - COALESCE(pa.paid_amount, 0)) > 0.01;
$$;


ALTER FUNCTION "public"."get_projects_with_balance"("p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_realizace_financials"() RETURNS TABLE("total_revenue" numeric, "total_costs" numeric, "total_profit" numeric, "total_overhead" numeric, "realization_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
    -- This function will be the basis for future Forecast module aggregation.
    -- The Forecast module will call this and get_company_financials (for Projekce)
    -- to create a company-wide financial overview.
    SELECT
        SUM(rf.actual_revenue) as total_revenue,
        SUM(rf.actual_costs) as total_costs,
        SUM(rf.actual_profit) as total_profit,
        (SELECT SUM(ro.overhead_amount) FROM public.realizace_overhead ro) as total_overhead,
        (SELECT COUNT(DISTINCT r.id) FROM public.realizations r WHERE r.status NOT IN ('Dokončeno', 'Předáno')) as realization_count
    FROM public.realizace_financials rf;
$$;


ALTER FUNCTION "public"."get_realizace_financials"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_realizace_overhead_summary"() RETURNS TABLE("total_overhead" numeric)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
    -- This function can be used by a future Forecast module to analyze
    -- overhead distribution across different business units (Projekce vs. Realizace).
    SELECT
        COALESCE(SUM(ro.overhead_amount), 0) as total_overhead
    FROM public.realizace_overhead ro;
$$;


ALTER FUNCTION "public"."get_realizace_overhead_summary"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_realizations_with_balance"("p_member_id" "uuid") RETURNS TABLE("realization_id" "uuid", "realization_name" "text", "total_reward" numeric, "paid_amount" numeric, "available_balance" numeric, "realization_status" "text")
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
WITH member_shares AS (
    SELECT 
        rps.realizace_id,
        rps.share_type,
        rps.share_value
    FROM realization_profit_shares rps
    WHERE rps.member_id = p_member_id
),
realization_stats AS (
    SELECT
        r.id,
        r.name,
        r.status,
        COALESCE(r.contract_amount, 0) as contract_amount,
        COALESCE(r.actual_costs, 0) as actual_costs,
        (COALESCE(r.contract_amount, 0) - COALESCE(r.actual_costs, 0)) as estimated_profit
    FROM realizations r
    WHERE r.id IN (SELECT realizace_id FROM member_shares)
),
calculated_rewards AS (
    SELECT
        rs.id as realization_id,
        rs.name,
        rs.status,
        CASE
            WHEN ms.share_type = 'fixed' THEN ms.share_value
            WHEN ms.share_type = 'percentage' THEN 
                GREATEST(0, rs.estimated_profit * (ms.share_value / 100.0))
            ELSE 0
        END as total_reward
    FROM realization_stats rs
    JOIN member_shares ms ON rs.id = ms.realizace_id
),
paid_amounts AS (
    SELECT
        pi.realizace_id,
        SUM(pi.amount) as paid_amount
    FROM payout_items pi
    JOIN payouts p ON pi.payout_id = p.id
    WHERE p.member_id = p_member_id 
      AND p.status IN ('paid', 'approved', 'pending')
    GROUP BY pi.realizace_id
)
SELECT
    cr.realization_id,
    cr.name as realization_name,
    ROUND(cr.total_reward, 2) as total_reward,
    COALESCE(pa.paid_amount, 0) as paid_amount,
    ROUND(GREATEST(0, cr.total_reward - COALESCE(pa.paid_amount, 0)), 2) as available_balance,
    cr.status as realization_status
FROM calculated_rewards cr
LEFT JOIN paid_amounts pa ON cr.realization_id = pa.realizace_id
WHERE (cr.total_reward - COALESCE(pa.paid_amount, 0)) > 0;
$$;


ALTER FUNCTION "public"."get_realizations_with_balance"("p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_activities"("p_member_id" "uuid") RETURNS TABLE("id" "uuid", "subject" "text", "status" "text", "project_id" "uuid", "projects" json)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    ea.id,
    ea.subject,
    ea.status,
    ea.project_id,
    json_build_object('name', p.name) as projects
  FROM engineering_activities ea
  INNER JOIN projects p ON ea.project_id = p.id
  WHERE ea.status <> 'done'
  AND EXISTS (
    SELECT 1 
    FROM project_members pm 
    WHERE pm.project_id = ea.project_id 
    AND pm.member_id = p_member_id
  )
  ORDER BY ea.end_date ASC NULLS LAST
  LIMIT 5;
$$;


ALTER FUNCTION "public"."get_user_activities"("p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_financials"("p_member_id" "uuid") RETURNS TABLE("total_reward" numeric, "available_to_payout" numeric, "total_paid" numeric)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
WITH member_rewards AS (
  SELECT 
    member_id,
    SUM(reward_amount) as total_reward,
    SUM(CASE WHEN project_status IN ('delivered', 'closed') THEN reward_amount ELSE 0 END) as total_earned_from_completed
  FROM mv_user_project_rewards
  WHERE member_id = p_member_id
  GROUP BY member_id
),
payout_sums AS (
  SELECT
    member_id,
    SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS total_paid
  FROM payouts
  WHERE member_id = p_member_id
  GROUP BY member_id
)
SELECT
  COALESCE(mr.total_reward, 0) as total_reward,
  COALESCE(mr.total_earned_from_completed, 0) - COALESCE(ps.total_paid, 0) as available_to_payout,
  COALESCE(ps.total_paid, 0) as total_paid
FROM members m
LEFT JOIN member_rewards mr ON m.id = mr.member_id
LEFT JOIN payout_sums ps ON m.id = ps.member_id
WHERE m.id = p_member_id;
$$;


ALTER FUNCTION "public"."get_user_financials"("p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  RETURN (SELECT id FROM auth.users WHERE email = p_email);
END;
$$;


ALTER FUNCTION "public"."get_user_id_by_email"("p_email" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "code" "text" NOT NULL,
    "status" "text" NOT NULL,
    "price" numeric,
    "budget_percentage" numeric,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "overhead_percentage" numeric DEFAULT 0,
    "type" "text" DEFAULT 'Ostatní'::"text" NOT NULL,
    "created_by_member_id" "uuid",
    "completion_date" "date",
    "brief" "text",
    "template_id" "uuid",
    "start_date" "date",
    "shared_drive_link" "text",
    "stage_id" "uuid",
    "location" "text",
    "client_internal_ref" "text",
    "is_priority" boolean DEFAULT false,
    "location_coordinates" "text",
    "brief_editable" "text",
    "investor_id" "uuid",
    "client_id" "uuid",
    "crm_opportunity_id" "uuid",
    CONSTRAINT "check_project_budget_pct" CHECK ((("budget_percentage" >= (0)::numeric) AND ("budget_percentage" <= (100)::numeric))),
    CONSTRAINT "check_project_overhead_pct" CHECK ((("overhead_percentage" >= (0)::numeric) AND ("overhead_percentage" <= (100)::numeric))),
    CONSTRAINT "check_project_price_positive" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."projects" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_projects"("p_member_id" "uuid") RETURNS SETOF "public"."projects"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT p.* 
  FROM projects p
  WHERE EXISTS (
    SELECT 1 
    FROM project_members pm 
    WHERE pm.project_id = p.id 
    AND pm.member_id = p_member_id
  );
$$;


ALTER FUNCTION "public"."get_user_projects"("p_member_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_user_role"() RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    v_user_role TEXT;
BEGIN
    SELECT user_role INTO v_user_role
    FROM public.members
    WHERE auth_user_id = (select auth.uid())
    LIMIT 1;

    RETURN COALESCE(v_user_role, 'user');
END;
$$;


ALTER FUNCTION "public"."get_user_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  user_full_name TEXT;
BEGIN
  user_full_name := COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email);
  INSERT INTO public.members (auth_user_id, email, name, user_role, attendance_enabled, hourly_rate)
  VALUES (
    NEW.id,
    NEW.email,
    user_full_name,
    'user',
    true,
    0
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_admin_payout_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_member_name TEXT;
BEGIN
  -- We only notify admins on specific status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT name INTO v_member_name FROM public.members WHERE id = NEW.member_id;
    
    -- In a real setup, we would call pg_net.http_post here pointing to the Edge Function.
    -- Since we cannot guarantee secrets in pg_net for this sandbox, we log it.
    -- The actual email sending will be handled by the application layer for reliability.
    RAISE NOTICE 'Payout status changed to % for member %', NEW.status, v_member_name;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_admin_payout_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_member_hourly_payout_change"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    RAISE NOTICE 'Hourly payout status changed to % for member_id %', NEW.status, NEW.member_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_member_hourly_payout_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."refresh_user_rewards"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_project_rewards;
END;
$$;


ALTER FUNCTION "public"."refresh_user_rewards"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."setup_project_rls"("table_name" "text") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', table_name);
  EXECUTE format('
    CREATE POLICY "Enable read for project members or admins" ON public.%I FOR SELECT USING (
      get_user_role() = ''admin'' OR 
      EXISTS (SELECT 1 FROM project_members WHERE project_id = %I.project_id AND member_id = get_member_id())
    );', table_name, table_name);
  EXECUTE format('
    CREATE POLICY "Enable insert for project members or admins" ON public.%I FOR INSERT WITH CHECK (
      get_user_role() = ''admin'' OR 
      EXISTS (SELECT 1 FROM project_members WHERE project_id = %I.project_id AND member_id = get_member_id())
    );', table_name, table_name);
  EXECUTE format('
    CREATE POLICY "Enable update for project members or admins" ON public.%I FOR UPDATE USING (
      get_user_role() = ''admin'' OR 
      EXISTS (SELECT 1 FROM project_members WHERE project_id = %I.project_id AND member_id = get_member_id())
    );', table_name, table_name);
  EXECUTE format('
    CREATE POLICY "Enable delete for admins" ON public.%I FOR DELETE USING (
      get_user_role() = ''admin''
    );', table_name);
END;
$$;


ALTER FUNCTION "public"."setup_project_rls"("table_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_realizace_order_stock_movements"("p_order_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  order_record public.realizace_orders%ROWTYPE;
  link jsonb;
  item jsonb;
  item_index integer;
  catalog_id uuid;
  item_quantity numeric;
  item_unit_cost numeric;
BEGIN
  SELECT *
  INTO order_record
  FROM public.realizace_orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Realizace order % not found', p_order_id;
  END IF;

  DELETE FROM public.product_stock_movements
  WHERE source_type = 'realizace_order'
    AND source_id = p_order_id;

  IF COALESCE(order_record.commercial_status, 'order') NOT IN ('order', 'offer_accepted') THEN
    RETURN;
  END IF;

  IF order_record.item_links IS NULL OR jsonb_typeof(order_record.item_links) <> 'array' THEN
    RETURN;
  END IF;

  FOR link IN SELECT * FROM jsonb_array_elements(order_record.item_links)
  LOOP
    item_index := NULLIF(link->>'index', '')::integer;
    catalog_id := NULLIF(link->>'catalog_item_id', '')::uuid;
    item := order_record.items -> item_index;

    IF catalog_id IS NULL OR item IS NULL THEN
      CONTINUE;
    END IF;

    item_quantity := ABS(COALESCE(NULLIF(item->>'quantity', '')::numeric, 0));
    item_unit_cost := COALESCE(NULLIF(item->>'unit_price', '')::numeric, 0);

    IF item_quantity <= 0 THEN
      CONTINUE;
    END IF;

    INSERT INTO public.product_stock_movements (
      catalog_item_id,
      movement_type,
      quantity,
      unit_cost,
      source_type,
      source_id,
      request_id,
      note
    )
    VALUES (
      catalog_id,
      'issue',
      -item_quantity,
      item_unit_cost,
      'realizace_order',
      p_order_id,
      CONCAT('realizace-order-item-', item_index::text, '-', catalog_id::text),
      CONCAT('Realizace objednavka ', COALESCE(order_record.order_number, p_order_id::text))
    );
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."sync_realizace_order_stock_movements"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_realizace_team_members_to_array"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    IF (TG_OP = 'DELETE') THEN
        UPDATE realizations
        SET team_members = ARRAY(
            SELECT member_id FROM realizace_team_members WHERE realizace_id = OLD.realizace_id
        )
        WHERE id = OLD.realizace_id;
        RETURN OLD;
    ELSE
        UPDATE realizations
        SET team_members = ARRAY(
            SELECT member_id FROM realizace_team_members WHERE realizace_id = NEW.realizace_id
        )
        WHERE id = NEW.realizace_id;
        RETURN NEW;
    END IF;
END;
$$;


ALTER FUNCTION "public"."sync_realizace_team_members_to_array"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trigger_refresh_user_rewards"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  PERFORM refresh_user_rewards();
  RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."trigger_refresh_user_rewards"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_commercial_item_catalog_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_commercial_item_catalog_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_crm_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_crm_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_hourly_payout_requests_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_hourly_payout_requests_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_monthly_allocations_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_monthly_allocations_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_overhead_costs_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_overhead_costs_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_payout_total_amount"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    total_amount NUMERIC;
BEGIN
    IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
        SELECT SUM(amount) INTO total_amount
        FROM public.payout_items
        WHERE payout_id = NEW.payout_id;

        UPDATE public.payouts
        SET amount = total_amount
        WHERE id = NEW.payout_id;

        RETURN NEW;
    ELSIF (TG_OP = 'DELETE') THEN
        SELECT SUM(amount) INTO total_amount
        FROM public.payout_items
        WHERE payout_id = OLD.payout_id;

        UPDATE public.payouts
        SET amount = COALESCE(total_amount, 0)
        WHERE id = OLD.payout_id;

        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$;


ALTER FUNCTION "public"."update_payout_total_amount"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_product_field_definitions_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_product_field_definitions_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_project_templates_custom_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_project_templates_custom_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_realizace_orders_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_realizace_orders_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_realizations_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_realizations_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_subjects_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_subjects_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."app_settings" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL
);


ALTER TABLE "public"."app_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "date" "date" NOT NULL,
    "hours" numeric(4,2) NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "realizace_id" "uuid",
    CONSTRAINT "attendance_hours_check" CHECK (("hours" > (0)::numeric)),
    CONSTRAINT "check_attendance_hours" CHECK ((("hours" > (0)::numeric) AND ("hours" <= (24)::numeric)))
);


ALTER TABLE "public"."attendance" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attendance_submissions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "month_date" "date" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "total_hours" numeric NOT NULL,
    "submitted_at" timestamp with time zone,
    "approved_at" timestamp with time zone,
    "approver_id" "uuid",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."attendance_submissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "user_id" "uuid",
    "user_email" "text",
    "action" "text" NOT NULL,
    "details" "jsonb"
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."commercial_item_catalog" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "category" "text",
    "unit" "text" DEFAULT 'ks'::"text" NOT NULL,
    "default_unit_price" numeric(14,2) DEFAULT 0 NOT NULL,
    "default_vat_rate" numeric(5,2) DEFAULT 21 NOT NULL,
    "source" "text" DEFAULT 'manual'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sku" "text",
    "product_type" "text" DEFAULT 'service'::"text" NOT NULL,
    "purchase_price" numeric(14,2) DEFAULT 0 NOT NULL,
    "currency" "text" DEFAULT 'CZK'::"text" NOT NULL,
    "stock_min_qty" numeric(14,3),
    "warehouse_location" "text",
    "allow_backorder" boolean DEFAULT false NOT NULL,
    "valid_from" "date",
    "valid_until" "date",
    "datasheet_storage_provider" "text" DEFAULT 'sharepoint'::"text" NOT NULL,
    "datasheet_storage_connection_id" "uuid",
    "datasheet_external_file_id" "text",
    "datasheet_external_web_url" "text",
    "datasheet_file_name" "text",
    "datasheet_preview_image_url" "text",
    "datasheet_storage_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "image_url" "text",
    "archived_at" timestamp with time zone,
    "updated_by" "uuid",
    CONSTRAINT "commercial_item_catalog_product_type_check" CHECK (("product_type" = ANY (ARRAY['service'::"text", 'manufactured'::"text"]))),
    CONSTRAINT "commercial_item_catalog_source_check" CHECK (("source" = ANY (ARRAY['manual'::"text", 'offer'::"text", 'order'::"text", 'import'::"text"])))
);


ALTER TABLE "public"."commercial_item_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opportunity_id" "uuid",
    "subject_id" "uuid",
    "project_id" "uuid",
    "assigned_member_id" "uuid",
    "type" "text" DEFAULT 'note'::"text" NOT NULL,
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "title" "text" NOT NULL,
    "description" "text",
    "due_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crm_activities_check" CHECK ((("opportunity_id" IS NOT NULL) OR ("subject_id" IS NOT NULL)))
);


ALTER TABLE "public"."crm_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_commercial_document_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "document_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid",
    "code" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "quantity" numeric(14,3) DEFAULT 1 NOT NULL,
    "unit" "text" DEFAULT 'ks'::"text" NOT NULL,
    "unit_price" numeric(14,2) DEFAULT 0 NOT NULL,
    "discount_percent" numeric(6,2) DEFAULT 0 NOT NULL,
    "vat_rate" numeric(5,2) DEFAULT 21 NOT NULL,
    "line_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_sku" "text",
    "product_type" "text",
    "stock_available_snapshot" numeric(14,3),
    "catalog_price_snapshot" numeric(14,2)
);


ALTER TABLE "public"."crm_commercial_document_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_commercial_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opportunity_id" "uuid" NOT NULL,
    "subject_id" "uuid",
    "type" "text" DEFAULT 'offer'::"text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "number" "text",
    "title" "text" NOT NULL,
    "issue_date" "date" DEFAULT CURRENT_DATE NOT NULL,
    "valid_until" "date",
    "currency" "text" DEFAULT 'CZK'::"text" NOT NULL,
    "subtotal" numeric(14,2) DEFAULT 0 NOT NULL,
    "discount_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "tax_total" numeric(14,2) DEFAULT 0 NOT NULL,
    "total" numeric(14,2) DEFAULT 0 NOT NULL,
    "notes" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sync_items" boolean DEFAULT true NOT NULL,
    CONSTRAINT "crm_commercial_documents_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'sent'::"text", 'accepted'::"text", 'rejected'::"text", 'cancelled'::"text", 'closed'::"text"]))),
    CONSTRAINT "crm_commercial_documents_type_check" CHECK (("type" = ANY (ARRAY['offer'::"text", 'order'::"text"])))
);


ALTER TABLE "public"."crm_commercial_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opportunity_id" "uuid",
    "subject_id" "uuid",
    "author_member_id" "uuid",
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crm_notes_check" CHECK ((("opportunity_id" IS NOT NULL) OR ("subject_id" IS NOT NULL)))
);


ALTER TABLE "public"."crm_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_numbering_settings" (
    "document_type" "text" NOT NULL,
    "prefix" "text" NOT NULL,
    "next_number" integer DEFAULT 1 NOT NULL,
    "padding" integer DEFAULT 3 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."crm_numbering_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_opportunities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "owner_member_id" "uuid",
    "title" "text" NOT NULL,
    "stage" "text" DEFAULT 'lead'::"text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "priority" "text" DEFAULT 'medium'::"text" NOT NULL,
    "source" "text",
    "value" numeric(14,2) DEFAULT 0 NOT NULL,
    "probability" integer DEFAULT 0 NOT NULL,
    "expected_close_date" "date",
    "next_step" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "number" "text",
    "realization_id" "uuid",
    "lost_reason" "text",
    "lost_at" timestamp with time zone,
    CONSTRAINT "crm_opportunities_probability_check" CHECK ((("probability" >= 0) AND ("probability" <= 100)))
);


ALTER TABLE "public"."crm_opportunities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_opportunity_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "opportunity_id" "uuid" NOT NULL,
    "catalog_item_id" "uuid",
    "code" "text",
    "name" "text" NOT NULL,
    "description" "text",
    "quantity" numeric DEFAULT 1 NOT NULL,
    "unit" "text" DEFAULT 'ks'::"text" NOT NULL,
    "unit_price" numeric DEFAULT 0 NOT NULL,
    "discount_percent" numeric DEFAULT 0 NOT NULL,
    "vat_rate" numeric DEFAULT 21 NOT NULL,
    "line_total" numeric DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "product_sku" "text",
    "product_type" "text",
    "stock_available_snapshot" numeric(14,3),
    "catalog_price_snapshot" numeric(14,2)
);


ALTER TABLE "public"."crm_opportunity_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_priority_definitions" (
    "value" "text" NOT NULL,
    "label" "text" NOT NULL,
    "tone" "text" DEFAULT 'secondary'::"text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."crm_priority_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."crm_stage_definitions" (
    "value" "text" NOT NULL,
    "label" "text" NOT NULL,
    "color" "text" DEFAULT 'bg-slate-100 text-slate-700 border-slate-200'::"text" NOT NULL,
    "probability" integer DEFAULT 0 NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_closed" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "crm_stage_definitions_probability_check" CHECK ((("probability" >= 0) AND ("probability" <= 100)))
);


ALTER TABLE "public"."crm_stage_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."doc_structures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'missing'::"text",
    "document_id" "uuid",
    "file_name" "text",
    "file_path" "text"
);


ALTER TABLE "public"."doc_structures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_storage_connections" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" NOT NULL,
    "name" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "last_checked_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_storage_connections_provider_check" CHECK (("provider" = ANY (ARRAY['supabase'::"text", 'sharepoint'::"text", 'google_drive'::"text"]))),
    CONSTRAINT "document_storage_connections_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'active'::"text", 'disabled'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."document_storage_connections" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_storage_folders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "connection_id" "uuid" NOT NULL,
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "folder_path" "text" NOT NULL,
    "external_folder_id" "text",
    "external_web_url" "text",
    "status" "text" DEFAULT 'planned'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "document_storage_folders_entity_type_check" CHECK (("entity_type" = ANY (ARRAY['project'::"text", 'realizace'::"text", 'product'::"text"]))),
    CONSTRAINT "document_storage_folders_status_check" CHECK (("status" = ANY (ARRAY['planned'::"text", 'created'::"text", 'error'::"text"])))
);


ALTER TABLE "public"."document_storage_folders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."document_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."document_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "name" "text" NOT NULL,
    "type" "text",
    "discipline" "text",
    "status" "text",
    "version" "text",
    "file_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "structure_item_id" "uuid",
    "assignment_file" boolean DEFAULT false,
    "file_path" "text",
    "storage_provider" "text" DEFAULT 'supabase'::"text" NOT NULL,
    "storage_connection_id" "uuid",
    "external_file_id" "text",
    "external_parent_id" "text",
    "external_web_url" "text",
    "storage_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."engineering_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "subject" "text" NOT NULL,
    "description" "text",
    "start_date" "date",
    "end_date" "date",
    "status" "text" DEFAULT 'new'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "category" "text",
    "dny_na_vyjadreni" integer,
    "file_name" "text",
    "file_url" "text",
    "no_document" boolean DEFAULT false,
    "is_urgent" boolean DEFAULT false,
    "form_data" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."engineering_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."engineering_subjects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."engineering_subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hourly_payout_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "hours" numeric NOT NULL,
    "hourly_rate" numeric NOT NULL,
    "total_amount" numeric NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "rejection_reason" "text",
    "approved_at" timestamp with time zone,
    "rejected_at" timestamp with time zone,
    "invoice_url" "text",
    "invoice_uploaded_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "payout_month" integer,
    "payout_year" integer,
    "total_hours" numeric,
    "breakdown" "jsonb",
    "approved_without_invoice" boolean DEFAULT false,
    "admin_note" "text"
);


ALTER TABLE "public"."hourly_payout_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hourly_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "hours" numeric NOT NULL,
    "hourly_rate" numeric NOT NULL,
    "total_amount" numeric NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invoice_url" "text",
    "invoice_name" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "approver_id" "uuid",
    "payout_month" integer,
    "payout_year" integer
);


ALTER TABLE "public"."hourly_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."legal_forms" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."legal_forms" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_certifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "issuer" "text",
    "certificate_number" "text",
    "issue_date" "date",
    "expiry_date" "date",
    "file_path" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."member_certifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."member_roles" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."member_roles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "role_id" "uuid",
    "email" "text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "auth_user_id" "uuid",
    "attendance_enabled" boolean DEFAULT true,
    "hourly_rate" numeric(10,2),
    "user_role" "text" DEFAULT 'user'::"text",
    "internal_note" "text",
    "languages" "text"[],
    "company" "text",
    "job_title" "text",
    "department" "text",
    "bio" "text",
    "avatar_url" "text",
    "language" "text" DEFAULT 'cs'::"text",
    "notification_preferences" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "member_id" "uuid",
    "reward_percentage" numeric,
    "reward_amount" numeric,
    "reward_type" "text" DEFAULT 'percentage'::"text",
    "is_hourly" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."project_members" OWNER TO "postgres";


COMMENT ON COLUMN "public"."project_members"."is_hourly" IS 'If true, member can log hours for this project in attendance.';



CREATE TABLE IF NOT EXISTS "public"."project_subcontractors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "scope_of_work" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "price" numeric,
    "subject_id" "uuid"
);


ALTER TABLE "public"."project_subcontractors" OWNER TO "postgres";


CREATE MATERIALIZED VIEW "public"."mv_user_project_rewards" AS
 SELECT "pm"."member_id",
    "pm"."project_id",
    "p"."status" AS "project_status",
        CASE
            WHEN ("pm"."reward_type" = 'fixed'::"text") THEN "pm"."reward_amount"
            ELSE (((("p"."price" * ("p"."budget_percentage" / 100.0)) - (("p"."price" * ("p"."budget_percentage" / 100.0)) * ("p"."overhead_percentage" / 100.0))) - COALESCE(( SELECT "sum"("project_subcontractors"."price") AS "sum"
               FROM "public"."project_subcontractors"
              WHERE ("project_subcontractors"."project_id" = "p"."id")), (0)::numeric)) * ("pm"."reward_percentage" / 100.0))
        END AS "reward_amount"
   FROM ("public"."project_members" "pm"
     JOIN "public"."projects" "p" ON (("pm"."project_id" = "p"."id")))
  WITH NO DATA;


ALTER MATERIALIZED VIEW "public"."mv_user_project_rewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "related_payout_id" "uuid",
    "related_payout_type" "text",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_statuses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."order_statuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."order_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."overhead_allocation_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "overhead_monthly_allocation_id" "uuid" NOT NULL,
    "overhead_cost_id" "uuid" NOT NULL,
    "project_id" "uuid" NOT NULL,
    "amount_allocated" numeric NOT NULL,
    "percentage_share" numeric
);


ALTER TABLE "public"."overhead_allocation_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."overhead_audit_logs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "monthly_allocation_id" "uuid",
    "user_id" "uuid",
    "user_email" "text",
    "action" "text" NOT NULL,
    "details" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."overhead_audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."overhead_costs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "type" "public"."overhead_cost_type" NOT NULL,
    "category" "text",
    "amount" numeric NOT NULL,
    "valid_from" "date",
    "valid_to" "date",
    "date_incurred" "date",
    "default_allocation_key" "jsonb",
    "attachments" "jsonb",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "check_dates_for_type" CHECK (((("type" = 'PRAVIDELNY'::"public"."overhead_cost_type") AND ("valid_from" IS NOT NULL) AND ("valid_to" IS NOT NULL)) OR (("type" = 'PROMENLIVY'::"public"."overhead_cost_type") AND ("date_incurred" IS NOT NULL))))
);


ALTER TABLE "public"."overhead_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."overhead_monthly_allocations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "month" "text" NOT NULL,
    "status" "public"."overhead_allocation_status" DEFAULT 'DRAFT'::"public"."overhead_allocation_status" NOT NULL,
    "notes" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."overhead_monthly_allocations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payout_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payout_id" "uuid" NOT NULL,
    "project_id" "uuid",
    "amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "realizace_id" "uuid",
    "realization_id" "uuid",
    CONSTRAINT "payout_items_project_or_realization" CHECK (((("project_id" IS NOT NULL) AND ("realization_id" IS NULL)) OR (("project_id" IS NULL) AND ("realization_id" IS NOT NULL)))),
    CONSTRAINT "payout_items_project_or_realization_chk" CHECK ((("project_id" IS NOT NULL) OR ("realization_id" IS NOT NULL) OR ("realizace_id" IS NOT NULL)))
);


ALTER TABLE "public"."payout_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid",
    "amount" numeric NOT NULL,
    "status" "text" NOT NULL,
    "request_date" "date" NOT NULL,
    "reason" "text",
    "invoice_url" "text",
    "invoice_name" "text",
    "variable_symbol" "text",
    "approved_without_invoice" boolean DEFAULT false,
    "admin_note" "text",
    "approved_at" timestamp with time zone,
    "approved_by" "uuid",
    "invoice_uploaded_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    CONSTRAINT "check_payout_amount_positive" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."payouts" OWNER TO "postgres";


COMMENT ON COLUMN "public"."payouts"."approved_at" IS 'Timestamp when payout was approved by admin';



COMMENT ON COLUMN "public"."payouts"."approved_by" IS 'Member ID of admin who approved the payout request';



COMMENT ON COLUMN "public"."payouts"."invoice_uploaded_at" IS 'Timestamp when member uploaded the invoice file';



COMMENT ON COLUMN "public"."payouts"."paid_at" IS 'Timestamp when payment was confirmed by admin';



CREATE TABLE IF NOT EXISTS "public"."priority_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."priority_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_field_definitions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "field_key" "text" NOT NULL,
    "label" "text" NOT NULL,
    "field_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "field_group" "text" DEFAULT 'Technicke parametry'::"text" NOT NULL,
    "unit" "text",
    "options" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "ai_hint" "text",
    "is_required" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 100 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_field_definitions_type_check" CHECK (("field_type" = ANY (ARRAY['text'::"text", 'number'::"text", 'boolean'::"text", 'date'::"text", 'select'::"text", 'textarea'::"text"])))
);


ALTER TABLE "public"."product_field_definitions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."product_stock_movements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "catalog_item_id" "uuid" NOT NULL,
    "movement_type" "text" NOT NULL,
    "quantity" numeric(14,3) NOT NULL,
    "unit_cost" numeric(14,2),
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_id" "uuid",
    "request_id" "text",
    "note" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "product_stock_movements_quantity_check" CHECK (("quantity" <> (0)::numeric)),
    CONSTRAINT "product_stock_movements_type_check" CHECK (("movement_type" = ANY (ARRAY['receipt'::"text", 'issue'::"text", 'reservation'::"text", 'release'::"text", 'adjustment'::"text"])))
);


ALTER TABLE "public"."product_stock_movements" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."product_stock_status" WITH ("security_invoker"='true') AS
 SELECT "catalog"."id" AS "catalog_item_id",
    (COALESCE("sum"(
        CASE
            WHEN ("movement"."movement_type" = ANY (ARRAY['receipt'::"text", 'issue'::"text", 'adjustment'::"text"])) THEN "movement"."quantity"
            ELSE (0)::numeric
        END), (0)::numeric))::numeric(14,3) AS "stock_qty",
    (COALESCE("sum"(
        CASE
            WHEN ("movement"."movement_type" = 'reservation'::"text") THEN "movement"."quantity"
            WHEN ("movement"."movement_type" = 'release'::"text") THEN (- "abs"("movement"."quantity"))
            ELSE (0)::numeric
        END), (0)::numeric))::numeric(14,3) AS "reserved_qty",
    ((COALESCE("sum"(
        CASE
            WHEN ("movement"."movement_type" = ANY (ARRAY['receipt'::"text", 'issue'::"text", 'adjustment'::"text"])) THEN "movement"."quantity"
            ELSE (0)::numeric
        END), (0)::numeric) - COALESCE("sum"(
        CASE
            WHEN ("movement"."movement_type" = 'reservation'::"text") THEN "movement"."quantity"
            WHEN ("movement"."movement_type" = 'release'::"text") THEN (- "abs"("movement"."quantity"))
            ELSE (0)::numeric
        END), (0)::numeric)))::numeric(14,3) AS "available_qty"
   FROM ("public"."commercial_item_catalog" "catalog"
     LEFT JOIN "public"."product_stock_movements" "movement" ON (("movement"."catalog_item_id" = "catalog"."id")))
  GROUP BY "catalog"."id";


ALTER VIEW "public"."product_stock_status" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "author_name" "text",
    "text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."project_comments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "name" "text" NOT NULL,
    "role" "text",
    "email" "text",
    "phone" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_costs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "amount" numeric NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_attendance_cost" boolean DEFAULT false,
    "attendance_submission_id" "uuid"
);


ALTER TABLE "public"."project_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "url" "text" NOT NULL,
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "unique_token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "completion_date" "date"
);


ALTER TABLE "public"."project_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_overhead_costs" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "overhead_allocation_item_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "month" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_overhead_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_stages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."project_stages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_tags" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."project_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid",
    "name" "text" NOT NULL,
    "start_date" "date" NOT NULL,
    "end_date" "date" NOT NULL,
    "member_id" "uuid",
    "status" "text" DEFAULT 'Nové'::"text" NOT NULL,
    "description" "text"
);


ALTER TABLE "public"."project_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_templates" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."project_templates" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_templates_custom" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "tasks_data" "jsonb" DEFAULT '[]'::"jsonb",
    "phases_data" "jsonb" DEFAULT '[]'::"jsonb",
    "milestones_data" "jsonb" DEFAULT '[]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."project_templates_custom" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_to_tags" (
    "project_id" "uuid" NOT NULL,
    "tag_id" "uuid" NOT NULL
);


ALTER TABLE "public"."project_to_tags" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."project_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."project_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."projection_statuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."projection_statuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realizace_costs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "realizace_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "amount" numeric(14,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "created_by" "uuid",
    "supplier_id" "uuid",
    "variable_symbol" "text",
    "note" "text",
    "invoice_url" "text",
    "invoice_name" "text",
    "invoice_storage_provider" "text" DEFAULT 'supabase'::"text" NOT NULL,
    "invoice_storage_connection_id" "uuid",
    "invoice_external_file_id" "text",
    "invoice_external_web_url" "text",
    "invoice_storage_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    CONSTRAINT "realizace_costs_amount_check" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."realizace_costs" OWNER TO "postgres";


COMMENT ON TABLE "public"."realizace_costs" IS 'Manual cost ledger for Realizace module';



CREATE TABLE IF NOT EXISTS "public"."realizace_extra_costs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "realizace_id" "uuid" NOT NULL,
    "description" "text" NOT NULL,
    "cost_amount" numeric(14,2) NOT NULL,
    "sale_amount" numeric(14,2) NOT NULL,
    "markup_percent" numeric(9,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category" "text" DEFAULT 'other'::"text"
);


ALTER TABLE "public"."realizace_extra_costs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realizace_financials" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "realizace_id" "uuid" NOT NULL,
    "actual_revenue" numeric DEFAULT 0 NOT NULL,
    "actual_costs" numeric DEFAULT 0 NOT NULL,
    "actual_profit" numeric GENERATED ALWAYS AS (("actual_revenue" - "actual_costs")) STORED,
    "actual_margin" numeric GENERATED ALWAYS AS (
CASE
    WHEN ("actual_revenue" = (0)::numeric) THEN (0)::numeric
    ELSE (("actual_revenue" - "actual_costs") / "actual_revenue")
END) STORED,
    "period" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."realizace_financials" OWNER TO "postgres";


COMMENT ON TABLE "public"."realizace_financials" IS 'Stores periodic financial snapshots for implementation/execution (Realizace) projects.';



COMMENT ON COLUMN "public"."realizace_financials"."actual_revenue" IS 'Actual revenue recorded for the period.';



COMMENT ON COLUMN "public"."realizace_financials"."actual_costs" IS 'Actual costs recorded for the period.';



COMMENT ON COLUMN "public"."realizace_financials"."actual_profit" IS 'Calculated profit for the period (revenue - costs).';



COMMENT ON COLUMN "public"."realizace_financials"."actual_margin" IS 'Calculated profit margin for the period.';



COMMENT ON COLUMN "public"."realizace_financials"."period" IS 'The month/period this financial snapshot represents (e.g., YYYY-MM-01).';



CREATE TABLE IF NOT EXISTS "public"."realizace_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "realizace_id" "uuid" NOT NULL,
    "supplier_id" "uuid" NOT NULL,
    "order_number" "text" NOT NULL,
    "status" "text" DEFAULT 'nová'::"text" NOT NULL,
    "items" "jsonb",
    "total_amount" numeric NOT NULL,
    "delivery_date" "date",
    "notes" "text",
    "sent_to_emails" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "item_links" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "offer_reference" "text",
    "commercial_status" "text" DEFAULT 'order'::"text" NOT NULL,
    CONSTRAINT "realizace_orders_commercial_status_check" CHECK (("commercial_status" = ANY (ARRAY['offer'::"text", 'order'::"text", 'offer_accepted'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."realizace_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realizace_overhead" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "realizace_id" "uuid" NOT NULL,
    "overhead_amount" numeric NOT NULL,
    "overhead_type" "text",
    "period" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."realizace_overhead" OWNER TO "postgres";


COMMENT ON TABLE "public"."realizace_overhead" IS 'Stores overhead costs allocated to Realizace projects.';



CREATE TABLE IF NOT EXISTS "public"."realizace_team_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "realizace_id" "uuid",
    "member_id" "uuid",
    "responsibility" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."realizace_team_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realization_profit_shares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "realizace_id" "uuid" NOT NULL,
    "member_id" "uuid" NOT NULL,
    "share_type" "text" NOT NULL,
    "share_value" numeric NOT NULL,
    "note" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "realization_profit_shares_share_type_check" CHECK (("share_type" = ANY (ARRAY['percent'::"text", 'fixed'::"text"]))),
    CONSTRAINT "realization_profit_shares_share_value_check" CHECK (("share_value" >= (0)::numeric))
);


ALTER TABLE "public"."realization_profit_shares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realization_statuses" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."realization_statuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realization_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."realization_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."realizations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "location_address" "text",
    "location_gps" "text",
    "type" "text",
    "status" "text" DEFAULT 'pripravuje_se'::"text" NOT NULL,
    "start_date" "date",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "investor_id" "uuid",
    "lead_person_id" "uuid",
    "team_members" "uuid"[],
    "budget" numeric,
    "actual_costs" numeric,
    "updated_at" timestamp with time zone,
    "planned_end_date" "date",
    "actual_end_date" "date",
    "contract_amount" numeric,
    "expected_total_cost" numeric,
    "linked_project_id" "uuid",
    "profit_margin_percent" numeric,
    "profit_share_percent" numeric,
    "overhead_percent" numeric DEFAULT 0,
    "crm_opportunity_id" "uuid"
);


ALTER TABLE "public"."realizations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."realizations"."profit_margin_percent" IS 'Percentage of profit margin relative to contract amount';



COMMENT ON COLUMN "public"."realizations"."profit_share_percent" IS 'Percentage of profit share distribution';



CREATE TABLE IF NOT EXISTS "public"."reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "data" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "created_by" "uuid"
);


ALTER TABLE "public"."reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."risk_levels" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "color" "text",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."risk_levels" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."role_permissions" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "role" "text" NOT NULL,
    "module" "text" NOT NULL,
    "can_read" boolean DEFAULT false NOT NULL,
    "can_edit" boolean DEFAULT false NOT NULL,
    "can_admin" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."role_permissions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salary_payouts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "member_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "invoice_url" "text",
    "invoice_name" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "approved_at" timestamp with time zone,
    "paid_at" timestamp with time zone,
    "approver_id" "uuid"
);


ALTER TABLE "public"."salary_payouts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcontractor_orders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "subject_id" "uuid" NOT NULL,
    "unique_token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subcontractor_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcontractor_orders_deprecated" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "project_id" "uuid" NOT NULL,
    "subcontractor_id" "uuid" NOT NULL,
    "unique_token" "text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subcontractor_orders_deprecated" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcontractor_statuses_deprecated" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subcontractor_statuses_deprecated" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subcontractors_deprecated" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "company_name" "text" NOT NULL,
    "ico" "text",
    "phone" "text",
    "email" "text",
    "rating" numeric(2,1) DEFAULT 5.0,
    "created_at" timestamp with time zone DEFAULT "timezone"('utc'::"text", "now"()) NOT NULL,
    "field_of_work" "text"
);


ALTER TABLE "public"."subcontractors_deprecated" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subject_types" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."subject_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subjects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "ico" "text",
    "dic" "text",
    "address" "text",
    "legal_form" "text",
    "commercial_register" "text",
    "contact_person" "text",
    "email" "text",
    "phone" "text",
    "note" "text",
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "type_id" "uuid",
    "region" "text",
    "subject_kind" "text" DEFAULT 'company'::"text" NOT NULL,
    "birth_date" "date",
    "vat_payer" boolean,
    "vat_status" "text" DEFAULT 'unknown'::"text" NOT NULL,
    "vat_checked_at" timestamp with time zone,
    "company_summary" "text",
    "registry_checked_at" timestamp with time zone,
    "registry_source" "text",
    "registry_snapshot" "jsonb",
    CONSTRAINT "subjects_subject_kind_check" CHECK (("subject_kind" = ANY (ARRAY['person'::"text", 'entrepreneur'::"text", 'company'::"text"]))),
    CONSTRAINT "subjects_vat_status_check" CHECK (("vat_status" = ANY (ARRAY['unknown'::"text", 'payer'::"text", 'non_payer'::"text", 'identified_person'::"text"])))
);


ALTER TABLE "public"."subjects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."task_statuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."task_statuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_engineering_activities" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "subject" "text" NOT NULL,
    "description" "text",
    "start_day_offset" integer DEFAULT 0 NOT NULL,
    "end_day_offset" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."template_engineering_activities" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."template_tasks" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "template_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "start_day_offset" integer DEFAULT 0 NOT NULL,
    "duration_days" integer DEFAULT 1 NOT NULL
);


ALTER TABLE "public"."template_tasks" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."units" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "abbreviation" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."units" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_roles" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "role_name" "text" NOT NULL
);


ALTER TABLE "public"."user_roles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_project_budget_summary" WITH ("security_invoker"='true') AS
 SELECT "id" AS "project_id",
    "price" AS "project_price",
    "budget_percentage",
    (("price" * "budget_percentage") / 100.0) AS "total_budget",
    "overhead_percentage"
   FROM "public"."projects" "p";


ALTER VIEW "public"."v_project_budget_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."v_project_costs_summary" WITH ("security_invoker"='true') AS
 SELECT "project_id",
    "sum"("amount") AS "total_costs",
    "sum"(
        CASE
            WHEN ("is_attendance_cost" = true) THEN "amount"
            ELSE (0)::numeric
        END) AS "attendance_costs"
   FROM "public"."project_costs"
  GROUP BY "project_id";


ALTER VIEW "public"."v_project_costs_summary" OWNER TO "postgres";


ALTER TABLE ONLY "public"."app_settings"
    ADD CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_member_id_month_date_key" UNIQUE ("member_id", "month_date");



ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."commercial_item_catalog"
    ADD CONSTRAINT "commercial_item_catalog_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_commercial_document_items"
    ADD CONSTRAINT "crm_commercial_document_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_commercial_documents"
    ADD CONSTRAINT "crm_commercial_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_notes"
    ADD CONSTRAINT "crm_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_numbering_settings"
    ADD CONSTRAINT "crm_numbering_settings_pkey" PRIMARY KEY ("document_type");



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_opportunity_items"
    ADD CONSTRAINT "crm_opportunity_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."crm_priority_definitions"
    ADD CONSTRAINT "crm_priority_definitions_pkey" PRIMARY KEY ("value");



ALTER TABLE ONLY "public"."crm_stage_definitions"
    ADD CONSTRAINT "crm_stage_definitions_pkey" PRIMARY KEY ("value");



ALTER TABLE ONLY "public"."doc_structures"
    ADD CONSTRAINT "doc_structures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."doc_structures"
    ADD CONSTRAINT "doc_structures_project_id_name_key" UNIQUE ("project_id", "name");



ALTER TABLE ONLY "public"."document_storage_connections"
    ADD CONSTRAINT "document_storage_connections_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_storage_folders"
    ADD CONSTRAINT "document_storage_folders_connection_id_entity_type_entity_i_key" UNIQUE ("connection_id", "entity_type", "entity_id");



ALTER TABLE ONLY "public"."document_storage_folders"
    ADD CONSTRAINT "document_storage_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."document_types"
    ADD CONSTRAINT "document_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."engineering_subjects"
    ADD CONSTRAINT "engineering_subjects_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."engineering_subjects"
    ADD CONSTRAINT "engineering_subjects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hourly_payout_requests"
    ADD CONSTRAINT "hourly_payout_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hourly_payouts"
    ADD CONSTRAINT "hourly_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."legal_forms"
    ADD CONSTRAINT "legal_forms_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."legal_forms"
    ADD CONSTRAINT "legal_forms_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_certifications"
    ADD CONSTRAINT "member_certifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."member_roles"
    ADD CONSTRAINT "member_roles_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."member_roles"
    ADD CONSTRAINT "member_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_auth_user_id_key" UNIQUE ("auth_user_id");



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_statuses"
    ADD CONSTRAINT "order_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_templates"
    ADD CONSTRAINT "order_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overhead_allocation_items"
    ADD CONSTRAINT "overhead_allocation_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overhead_audit_logs"
    ADD CONSTRAINT "overhead_audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overhead_costs"
    ADD CONSTRAINT "overhead_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overhead_monthly_allocations"
    ADD CONSTRAINT "overhead_monthly_allocations_month_key" UNIQUE ("month");



ALTER TABLE ONLY "public"."overhead_monthly_allocations"
    ADD CONSTRAINT "overhead_monthly_allocations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payout_items"
    ADD CONSTRAINT "payout_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_variable_symbol_key" UNIQUE ("variable_symbol");



ALTER TABLE ONLY "public"."priority_levels"
    ADD CONSTRAINT "priority_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_field_definitions"
    ADD CONSTRAINT "product_field_definitions_key_unique" UNIQUE ("field_key");



ALTER TABLE ONLY "public"."product_field_definitions"
    ADD CONSTRAINT "product_field_definitions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."product_stock_movements"
    ADD CONSTRAINT "product_stock_movements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_comments"
    ADD CONSTRAINT "project_comments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_contacts"
    ADD CONSTRAINT "project_contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_costs"
    ADD CONSTRAINT "project_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_links"
    ADD CONSTRAINT "project_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_member_id_key" UNIQUE ("project_id", "member_id");



ALTER TABLE ONLY "public"."project_orders"
    ADD CONSTRAINT "project_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_orders"
    ADD CONSTRAINT "project_orders_unique_token_key" UNIQUE ("unique_token");



ALTER TABLE ONLY "public"."project_overhead_costs"
    ADD CONSTRAINT "project_overhead_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_stages"
    ADD CONSTRAINT "project_stages_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."project_stages"
    ADD CONSTRAINT "project_stages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_subcontractors"
    ADD CONSTRAINT "project_subcontractors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_tags"
    ADD CONSTRAINT "project_tags_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."project_tags"
    ADD CONSTRAINT "project_tags_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_templates_custom"
    ADD CONSTRAINT "project_templates_custom_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."project_templates"
    ADD CONSTRAINT "project_templates_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."project_to_tags"
    ADD CONSTRAINT "project_to_tags_pkey" PRIMARY KEY ("project_id", "tag_id");



ALTER TABLE ONLY "public"."project_types"
    ADD CONSTRAINT "project_types_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."project_types"
    ADD CONSTRAINT "project_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projection_statuses"
    ADD CONSTRAINT "projection_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realizace_costs"
    ADD CONSTRAINT "realizace_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realizace_extra_costs"
    ADD CONSTRAINT "realizace_extra_costs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realizace_financials"
    ADD CONSTRAINT "realizace_financials_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realizace_orders"
    ADD CONSTRAINT "realizace_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realizace_overhead"
    ADD CONSTRAINT "realizace_overhead_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realizace_team_members"
    ADD CONSTRAINT "realizace_team_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realizace_team_members"
    ADD CONSTRAINT "realizace_team_members_realizace_id_member_id_key" UNIQUE ("realizace_id", "member_id");



ALTER TABLE ONLY "public"."realization_profit_shares"
    ADD CONSTRAINT "realization_profit_shares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realization_statuses"
    ADD CONSTRAINT "realization_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realization_types"
    ADD CONSTRAINT "realization_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."realizations"
    ADD CONSTRAINT "realizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."risk_levels"
    ADD CONSTRAINT "risk_levels_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_unique" UNIQUE ("role", "module");



ALTER TABLE ONLY "public"."salary_payouts"
    ADD CONSTRAINT "salary_payouts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."engineering_activities"
    ADD CONSTRAINT "statements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subcontractor_orders_deprecated"
    ADD CONSTRAINT "subcontractor_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subcontractor_orders"
    ADD CONSTRAINT "subcontractor_orders_pkey1" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subcontractor_orders_deprecated"
    ADD CONSTRAINT "subcontractor_orders_unique_token_key" UNIQUE ("unique_token");



ALTER TABLE ONLY "public"."subcontractor_orders"
    ADD CONSTRAINT "subcontractor_orders_unique_token_key1" UNIQUE ("unique_token");



ALTER TABLE ONLY "public"."subcontractor_statuses_deprecated"
    ADD CONSTRAINT "subcontractor_statuses_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."subcontractor_statuses_deprecated"
    ADD CONSTRAINT "subcontractor_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subcontractors_deprecated"
    ADD CONSTRAINT "subcontractors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subject_types"
    ADD CONSTRAINT "subject_types_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."subject_types"
    ADD CONSTRAINT "subject_types_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_ico_key" UNIQUE ("ico");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."task_statuses"
    ADD CONSTRAINT "task_statuses_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."task_statuses"
    ADD CONSTRAINT "task_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_engineering_activities"
    ADD CONSTRAINT "template_engineering_activities_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."template_tasks"
    ADD CONSTRAINT "template_tasks_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."overhead_allocation_items"
    ADD CONSTRAINT "unique_allocation_item" UNIQUE ("overhead_monthly_allocation_id", "overhead_cost_id", "project_id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "unique_project_code" UNIQUE ("code");



ALTER TABLE ONLY "public"."units"
    ADD CONSTRAINT "units_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_roles"
    ADD CONSTRAINT "user_roles_role_name_key" UNIQUE ("role_name");



CREATE INDEX "crm_commercial_documents_type_number_idx" ON "public"."crm_commercial_documents" USING "btree" ("type", "number");



CREATE INDEX "crm_opportunities_number_idx" ON "public"."crm_opportunities" USING "btree" ("number");



CREATE INDEX "crm_opportunity_items_opportunity_idx" ON "public"."crm_opportunity_items" USING "btree" ("opportunity_id", "sort_order");



CREATE INDEX "idx_attendance_member_id" ON "public"."attendance" USING "btree" ("member_id");



CREATE INDEX "idx_attendance_project_id" ON "public"."attendance" USING "btree" ("project_id");



CREATE INDEX "idx_attendance_realizace_id" ON "public"."attendance" USING "btree" ("realizace_id");



CREATE INDEX "idx_audit_logs_user_id" ON "public"."audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_commercial_item_catalog_active" ON "public"."commercial_item_catalog" USING "btree" ("is_active");



CREATE INDEX "idx_commercial_item_catalog_category" ON "public"."commercial_item_catalog" USING "btree" ("category");



CREATE UNIQUE INDEX "idx_commercial_item_catalog_code_unique" ON "public"."commercial_item_catalog" USING "btree" ("lower"("code")) WHERE (("code" IS NOT NULL) AND ("code" <> ''::"text"));



CREATE INDEX "idx_commercial_item_catalog_datasheet_connection" ON "public"."commercial_item_catalog" USING "btree" ("datasheet_storage_connection_id");



CREATE INDEX "idx_commercial_item_catalog_datasheet_file" ON "public"."commercial_item_catalog" USING "btree" ("datasheet_external_file_id") WHERE ("datasheet_external_file_id" IS NOT NULL);



CREATE INDEX "idx_commercial_item_catalog_product_type" ON "public"."commercial_item_catalog" USING "btree" ("product_type");



CREATE UNIQUE INDEX "idx_commercial_item_catalog_sku_unique" ON "public"."commercial_item_catalog" USING "btree" ("lower"("sku")) WHERE (("sku" IS NOT NULL) AND ("sku" <> ''::"text"));



CREATE INDEX "idx_commercial_item_catalog_validity" ON "public"."commercial_item_catalog" USING "btree" ("valid_from", "valid_until");



CREATE INDEX "idx_crm_activities_assigned_member_id" ON "public"."crm_activities" USING "btree" ("assigned_member_id");



CREATE INDEX "idx_crm_activities_due_at" ON "public"."crm_activities" USING "btree" ("due_at");



CREATE INDEX "idx_crm_activities_opportunity_id" ON "public"."crm_activities" USING "btree" ("opportunity_id");



CREATE INDEX "idx_crm_activities_project_id" ON "public"."crm_activities" USING "btree" ("project_id");



CREATE INDEX "idx_crm_activities_subject_id" ON "public"."crm_activities" USING "btree" ("subject_id");



CREATE INDEX "idx_crm_commercial_document_items_catalog_item" ON "public"."crm_commercial_document_items" USING "btree" ("catalog_item_id");



CREATE INDEX "idx_crm_commercial_document_items_document_id" ON "public"."crm_commercial_document_items" USING "btree" ("document_id");



CREATE INDEX "idx_crm_commercial_documents_opportunity_id" ON "public"."crm_commercial_documents" USING "btree" ("opportunity_id");



CREATE INDEX "idx_crm_commercial_documents_subject_id" ON "public"."crm_commercial_documents" USING "btree" ("subject_id");



CREATE INDEX "idx_crm_commercial_documents_type_status" ON "public"."crm_commercial_documents" USING "btree" ("type", "status");



CREATE INDEX "idx_crm_notes_author_member_id" ON "public"."crm_notes" USING "btree" ("author_member_id");



CREATE INDEX "idx_crm_notes_opportunity_id" ON "public"."crm_notes" USING "btree" ("opportunity_id");



CREATE INDEX "idx_crm_notes_subject_id" ON "public"."crm_notes" USING "btree" ("subject_id");



CREATE INDEX "idx_crm_opportunities_lost_at" ON "public"."crm_opportunities" USING "btree" ("lost_at") WHERE ("lost_at" IS NOT NULL);



CREATE INDEX "idx_crm_opportunities_owner_member_id" ON "public"."crm_opportunities" USING "btree" ("owner_member_id");



CREATE INDEX "idx_crm_opportunities_project_id" ON "public"."crm_opportunities" USING "btree" ("project_id");



CREATE INDEX "idx_crm_opportunities_realization_id" ON "public"."crm_opportunities" USING "btree" ("realization_id");



CREATE INDEX "idx_crm_opportunities_stage" ON "public"."crm_opportunities" USING "btree" ("stage");



CREATE INDEX "idx_crm_opportunities_status" ON "public"."crm_opportunities" USING "btree" ("status");



CREATE INDEX "idx_crm_opportunities_subject_id" ON "public"."crm_opportunities" USING "btree" ("subject_id");



CREATE INDEX "idx_crm_opportunity_items_catalog_item" ON "public"."crm_opportunity_items" USING "btree" ("catalog_item_id");



CREATE INDEX "idx_doc_structures_document_id" ON "public"."doc_structures" USING "btree" ("document_id");



CREATE UNIQUE INDEX "idx_document_storage_connections_default" ON "public"."document_storage_connections" USING "btree" ("is_default") WHERE "is_default";



CREATE INDEX "idx_document_storage_connections_provider" ON "public"."document_storage_connections" USING "btree" ("provider");



CREATE INDEX "idx_document_storage_folders_connection" ON "public"."document_storage_folders" USING "btree" ("connection_id");



CREATE INDEX "idx_document_storage_folders_entity" ON "public"."document_storage_folders" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_documents_external_file_id" ON "public"."documents" USING "btree" ("external_file_id") WHERE ("external_file_id" IS NOT NULL);



CREATE INDEX "idx_documents_project_id" ON "public"."documents" USING "btree" ("project_id");



CREATE INDEX "idx_documents_storage_connection_id" ON "public"."documents" USING "btree" ("storage_connection_id");



CREATE INDEX "idx_documents_structure_item_id" ON "public"."documents" USING "btree" ("structure_item_id");



CREATE INDEX "idx_engineering_activities_project_id" ON "public"."engineering_activities" USING "btree" ("project_id");



CREATE INDEX "idx_engineering_activities_status" ON "public"."engineering_activities" USING "btree" ("status");



CREATE INDEX "idx_hourly_payout_requests_member_id" ON "public"."hourly_payout_requests" USING "btree" ("member_id");



CREATE INDEX "idx_hourly_payout_requests_project_id" ON "public"."hourly_payout_requests" USING "btree" ("project_id");



CREATE INDEX "idx_hourly_payouts_approver_id" ON "public"."hourly_payouts" USING "btree" ("approver_id");



CREATE INDEX "idx_hourly_payouts_member_id" ON "public"."hourly_payouts" USING "btree" ("member_id");



CREATE INDEX "idx_member_certifications_member_id" ON "public"."member_certifications" USING "btree" ("member_id");



CREATE INDEX "idx_members_auth_user_id" ON "public"."members" USING "btree" ("auth_user_id");



CREATE INDEX "idx_members_role_id" ON "public"."members" USING "btree" ("role_id");



CREATE INDEX "idx_members_user_role" ON "public"."members" USING "btree" ("user_role");



CREATE UNIQUE INDEX "idx_mv_user_project_rewards" ON "public"."mv_user_project_rewards" USING "btree" ("member_id", "project_id");



CREATE INDEX "idx_notifications_user_id" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_order_templates_is_active" ON "public"."order_templates" USING "btree" ("is_active");



CREATE INDEX "idx_overhead_allocation_items_overhead_cost_id" ON "public"."overhead_allocation_items" USING "btree" ("overhead_cost_id");



CREATE INDEX "idx_overhead_allocation_items_project_id" ON "public"."overhead_allocation_items" USING "btree" ("project_id");



CREATE INDEX "idx_overhead_audit_logs_monthly_allocation_id" ON "public"."overhead_audit_logs" USING "btree" ("monthly_allocation_id");



CREATE INDEX "idx_overhead_audit_logs_user_id" ON "public"."overhead_audit_logs" USING "btree" ("user_id");



CREATE INDEX "idx_overhead_costs_created_by" ON "public"."overhead_costs" USING "btree" ("created_by");



CREATE INDEX "idx_overhead_monthly_allocations_created_by" ON "public"."overhead_monthly_allocations" USING "btree" ("created_by");



CREATE INDEX "idx_overhead_monthly_allocations_updated_by" ON "public"."overhead_monthly_allocations" USING "btree" ("updated_by");



CREATE INDEX "idx_payout_items_payout_id" ON "public"."payout_items" USING "btree" ("payout_id");



CREATE INDEX "idx_payout_items_project_id" ON "public"."payout_items" USING "btree" ("project_id");



CREATE INDEX "idx_payout_items_realizace_id" ON "public"."payout_items" USING "btree" ("realizace_id");



CREATE INDEX "idx_payout_items_realization_id" ON "public"."payout_items" USING "btree" ("realization_id");



CREATE INDEX "idx_payouts_approved_by" ON "public"."payouts" USING "btree" ("approved_by");



CREATE INDEX "idx_payouts_member_id" ON "public"."payouts" USING "btree" ("member_id");



CREATE INDEX "idx_payouts_request_date" ON "public"."payouts" USING "btree" ("request_date" DESC);



CREATE INDEX "idx_payouts_status" ON "public"."payouts" USING "btree" ("status");



CREATE INDEX "idx_product_field_definitions_active_sort" ON "public"."product_field_definitions" USING "btree" ("is_active", "sort_order", "label");



CREATE INDEX "idx_product_stock_movements_catalog_item" ON "public"."product_stock_movements" USING "btree" ("catalog_item_id", "created_at" DESC);



CREATE UNIQUE INDEX "idx_product_stock_movements_request_unique" ON "public"."product_stock_movements" USING "btree" ("source_type", COALESCE("source_id", '00000000-0000-0000-0000-000000000000'::"uuid"), "request_id") WHERE ("request_id" IS NOT NULL);



CREATE INDEX "idx_project_comments_project_id" ON "public"."project_comments" USING "btree" ("project_id");



CREATE INDEX "idx_project_contacts_project_id" ON "public"."project_contacts" USING "btree" ("project_id");



CREATE INDEX "idx_project_costs_project_id" ON "public"."project_costs" USING "btree" ("project_id");



CREATE INDEX "idx_project_links_project_id" ON "public"."project_links" USING "btree" ("project_id");



CREATE INDEX "idx_project_members_composite" ON "public"."project_members" USING "btree" ("project_id", "member_id");



CREATE INDEX "idx_project_members_member_id" ON "public"."project_members" USING "btree" ("member_id");



CREATE INDEX "idx_project_members_project_id" ON "public"."project_members" USING "btree" ("project_id");



CREATE INDEX "idx_project_orders_member_id" ON "public"."project_orders" USING "btree" ("member_id");



CREATE INDEX "idx_project_orders_project_id" ON "public"."project_orders" USING "btree" ("project_id");



CREATE INDEX "idx_project_overhead_costs_overhead_allocation_item_id" ON "public"."project_overhead_costs" USING "btree" ("overhead_allocation_item_id");



CREATE INDEX "idx_project_overhead_costs_project_id" ON "public"."project_overhead_costs" USING "btree" ("project_id");



CREATE INDEX "idx_project_subcontractors_project_id" ON "public"."project_subcontractors" USING "btree" ("project_id");



CREATE INDEX "idx_project_subcontractors_subject_id" ON "public"."project_subcontractors" USING "btree" ("subject_id");



CREATE INDEX "idx_project_tasks_member_id" ON "public"."project_tasks" USING "btree" ("member_id");



CREATE INDEX "idx_project_tasks_project_id" ON "public"."project_tasks" USING "btree" ("project_id");



CREATE INDEX "idx_project_templates_custom_user_id" ON "public"."project_templates_custom" USING "btree" ("user_id");



CREATE INDEX "idx_project_to_tags_tag_id" ON "public"."project_to_tags" USING "btree" ("tag_id");



CREATE INDEX "idx_projects_client_id" ON "public"."projects" USING "btree" ("client_id");



CREATE INDEX "idx_projects_created_by_member_id" ON "public"."projects" USING "btree" ("created_by_member_id");



CREATE INDEX "idx_projects_crm_opportunity_id" ON "public"."projects" USING "btree" ("crm_opportunity_id");



CREATE INDEX "idx_projects_investor_id" ON "public"."projects" USING "btree" ("investor_id");



CREATE INDEX "idx_projects_stage_id" ON "public"."projects" USING "btree" ("stage_id");



CREATE INDEX "idx_projects_status" ON "public"."projects" USING "btree" ("status");



CREATE INDEX "idx_projects_template_id" ON "public"."projects" USING "btree" ("template_id");



CREATE INDEX "idx_realizace_costs_created_by" ON "public"."realizace_costs" USING "btree" ("created_by");



CREATE INDEX "idx_realizace_costs_invoice_storage_connection_id" ON "public"."realizace_costs" USING "btree" ("invoice_storage_connection_id");



CREATE INDEX "idx_realizace_costs_supplier_id" ON "public"."realizace_costs" USING "btree" ("supplier_id");



CREATE INDEX "idx_realizace_financials_realizace_id" ON "public"."realizace_financials" USING "btree" ("realizace_id");



CREATE INDEX "idx_realizace_orders_commercial_status" ON "public"."realizace_orders" USING "btree" ("commercial_status");



CREATE INDEX "idx_realizace_orders_realizace_id" ON "public"."realizace_orders" USING "btree" ("realizace_id");



CREATE INDEX "idx_realizace_orders_supplier_id" ON "public"."realizace_orders" USING "btree" ("supplier_id");



CREATE INDEX "idx_realizace_overhead_realizace_id" ON "public"."realizace_overhead" USING "btree" ("realizace_id");



CREATE INDEX "idx_realizace_team_members_member_id" ON "public"."realizace_team_members" USING "btree" ("member_id");



CREATE INDEX "idx_realization_profit_shares_member_id" ON "public"."realization_profit_shares" USING "btree" ("member_id");



CREATE INDEX "idx_realization_profit_shares_realizace_id" ON "public"."realization_profit_shares" USING "btree" ("realizace_id");



CREATE INDEX "idx_realizations_crm_opportunity_id" ON "public"."realizations" USING "btree" ("crm_opportunity_id");



CREATE INDEX "idx_realizations_investor_id" ON "public"."realizations" USING "btree" ("investor_id");



CREATE INDEX "idx_realizations_lead_person_id" ON "public"."realizations" USING "btree" ("lead_person_id");



CREATE INDEX "idx_realizations_linked_project_id" ON "public"."realizations" USING "btree" ("linked_project_id");



CREATE INDEX "idx_reports_created_by" ON "public"."reports" USING "btree" ("created_by");



CREATE INDEX "idx_salary_payouts_approver_id" ON "public"."salary_payouts" USING "btree" ("approver_id");



CREATE INDEX "idx_salary_payouts_member_id" ON "public"."salary_payouts" USING "btree" ("member_id");



CREATE INDEX "idx_subcontractor_orders_deprecated_project_id" ON "public"."subcontractor_orders_deprecated" USING "btree" ("project_id");



CREATE INDEX "idx_subcontractor_orders_deprecated_subcontractor_id" ON "public"."subcontractor_orders_deprecated" USING "btree" ("subcontractor_id");



CREATE INDEX "idx_subcontractor_orders_project_id" ON "public"."subcontractor_orders" USING "btree" ("project_id");



CREATE INDEX "idx_subcontractor_orders_subject_id" ON "public"."subcontractor_orders" USING "btree" ("subject_id");



CREATE INDEX "idx_subjects_type_id" ON "public"."subjects" USING "btree" ("type_id");



CREATE INDEX "idx_template_engineering_activities_template_id" ON "public"."template_engineering_activities" USING "btree" ("template_id");



CREATE INDEX "idx_template_tasks_template_id" ON "public"."template_tasks" USING "btree" ("template_id");



CREATE INDEX "realizace_costs_realizace_id_idx" ON "public"."realizace_costs" USING "btree" ("realizace_id");



CREATE INDEX "realizace_extra_costs_realizace_id_created_at_idx" ON "public"."realizace_extra_costs" USING "btree" ("realizace_id", "created_at" DESC);



CREATE INDEX "subjects_subject_kind_idx" ON "public"."subjects" USING "btree" ("subject_kind");



CREATE INDEX "subjects_vat_status_idx" ON "public"."subjects" USING "btree" ("vat_status");



CREATE OR REPLACE TRIGGER "on_monthly_allocations_update" BEFORE UPDATE ON "public"."overhead_monthly_allocations" FOR EACH ROW EXECUTE FUNCTION "public"."update_monthly_allocations_updated_at"();



CREATE OR REPLACE TRIGGER "on_overhead_costs_update" BEFORE UPDATE ON "public"."overhead_costs" FOR EACH ROW EXECUTE FUNCTION "public"."update_overhead_costs_updated_at"();



CREATE OR REPLACE TRIGGER "on_payout_items_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."payout_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_payout_total_amount"();



CREATE OR REPLACE TRIGGER "on_realizace_orders_update" BEFORE UPDATE ON "public"."realizace_orders" FOR EACH ROW EXECUTE FUNCTION "public"."update_realizace_orders_updated_at"();



CREATE OR REPLACE TRIGGER "on_realizations_update" BEFORE UPDATE ON "public"."realizations" FOR EACH ROW EXECUTE FUNCTION "public"."update_realizations_updated_at"();



CREATE OR REPLACE TRIGGER "on_subjects_update" BEFORE UPDATE ON "public"."subjects" FOR EACH ROW EXECUTE FUNCTION "public"."update_subjects_updated_at"();



CREATE OR REPLACE TRIGGER "refresh_rewards_on_member_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."project_members" FOR EACH STATEMENT EXECUTE FUNCTION "public"."trigger_refresh_user_rewards"();



CREATE OR REPLACE TRIGGER "refresh_rewards_on_project_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."projects" FOR EACH STATEMENT EXECUTE FUNCTION "public"."trigger_refresh_user_rewards"();



CREATE OR REPLACE TRIGGER "refresh_rewards_on_subcontractor_change" AFTER INSERT OR DELETE OR UPDATE ON "public"."project_subcontractors" FOR EACH STATEMENT EXECUTE FUNCTION "public"."trigger_refresh_user_rewards"();



CREATE OR REPLACE TRIGGER "tr_notify_admin_payout_change" AFTER UPDATE OF "status" ON "public"."payouts" FOR EACH ROW EXECUTE FUNCTION "public"."notify_admin_payout_change"();



CREATE OR REPLACE TRIGGER "tr_notify_member_hourly_payout_change" AFTER UPDATE OF "status" ON "public"."hourly_payout_requests" FOR EACH ROW EXECUTE FUNCTION "public"."notify_member_hourly_payout_change"();



CREATE OR REPLACE TRIGGER "trigger_sync_realizace_team" AFTER INSERT OR DELETE OR UPDATE ON "public"."realizace_team_members" FOR EACH ROW EXECUTE FUNCTION "public"."sync_realizace_team_members_to_array"();



CREATE OR REPLACE TRIGGER "update_commercial_item_catalog_updated_at" BEFORE UPDATE ON "public"."commercial_item_catalog" FOR EACH ROW EXECUTE FUNCTION "public"."update_commercial_item_catalog_updated_at"();



CREATE OR REPLACE TRIGGER "update_crm_activities_updated_at" BEFORE UPDATE ON "public"."crm_activities" FOR EACH ROW EXECUTE FUNCTION "public"."update_crm_updated_at"();



CREATE OR REPLACE TRIGGER "update_crm_commercial_document_items_updated_at" BEFORE UPDATE ON "public"."crm_commercial_document_items" FOR EACH ROW EXECUTE FUNCTION "public"."update_crm_updated_at"();



CREATE OR REPLACE TRIGGER "update_crm_commercial_documents_updated_at" BEFORE UPDATE ON "public"."crm_commercial_documents" FOR EACH ROW EXECUTE FUNCTION "public"."update_crm_updated_at"();



CREATE OR REPLACE TRIGGER "update_crm_notes_updated_at" BEFORE UPDATE ON "public"."crm_notes" FOR EACH ROW EXECUTE FUNCTION "public"."update_crm_updated_at"();



CREATE OR REPLACE TRIGGER "update_crm_opportunities_updated_at" BEFORE UPDATE ON "public"."crm_opportunities" FOR EACH ROW EXECUTE FUNCTION "public"."update_crm_updated_at"();



CREATE OR REPLACE TRIGGER "update_crm_priority_definitions_updated_at" BEFORE UPDATE ON "public"."crm_priority_definitions" FOR EACH ROW EXECUTE FUNCTION "public"."update_crm_updated_at"();



CREATE OR REPLACE TRIGGER "update_crm_stage_definitions_updated_at" BEFORE UPDATE ON "public"."crm_stage_definitions" FOR EACH ROW EXECUTE FUNCTION "public"."update_crm_updated_at"();



CREATE OR REPLACE TRIGGER "update_hourly_payout_requests_updated_at" BEFORE UPDATE ON "public"."hourly_payout_requests" FOR EACH ROW EXECUTE FUNCTION "public"."update_hourly_payout_requests_updated_at"();



CREATE OR REPLACE TRIGGER "update_product_field_definitions_updated_at" BEFORE UPDATE ON "public"."product_field_definitions" FOR EACH ROW EXECUTE FUNCTION "public"."update_product_field_definitions_updated_at"();



CREATE OR REPLACE TRIGGER "update_project_templates_custom_updated_at" BEFORE UPDATE ON "public"."project_templates_custom" FOR EACH ROW EXECUTE FUNCTION "public"."update_project_templates_custom_updated_at"();



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attendance"
    ADD CONSTRAINT "attendance_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id");



ALTER TABLE ONLY "public"."attendance_submissions"
    ADD CONSTRAINT "attendance_submissions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."commercial_item_catalog"
    ADD CONSTRAINT "commercial_item_catalog_datasheet_storage_connection_id_fkey" FOREIGN KEY ("datasheet_storage_connection_id") REFERENCES "public"."document_storage_connections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_assigned_member_id_fkey" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_activities"
    ADD CONSTRAINT "crm_activities_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_commercial_document_items"
    ADD CONSTRAINT "crm_commercial_document_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."commercial_item_catalog"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_commercial_document_items"
    ADD CONSTRAINT "crm_commercial_document_items_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."crm_commercial_documents"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_commercial_documents"
    ADD CONSTRAINT "crm_commercial_documents_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_commercial_documents"
    ADD CONSTRAINT "crm_commercial_documents_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_notes"
    ADD CONSTRAINT "crm_notes_author_member_id_fkey" FOREIGN KEY ("author_member_id") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_notes"
    ADD CONSTRAINT "crm_notes_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_notes"
    ADD CONSTRAINT "crm_notes_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_owner_member_id_fkey" FOREIGN KEY ("owner_member_id") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_realization_id_fkey" FOREIGN KEY ("realization_id") REFERENCES "public"."realizations"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_opportunities"
    ADD CONSTRAINT "crm_opportunities_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."crm_opportunity_items"
    ADD CONSTRAINT "crm_opportunity_items_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."commercial_item_catalog"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."crm_opportunity_items"
    ADD CONSTRAINT "crm_opportunity_items_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."doc_structures"
    ADD CONSTRAINT "doc_structures_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."doc_structures"
    ADD CONSTRAINT "doc_structures_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."document_storage_folders"
    ADD CONSTRAINT "document_storage_folders_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "public"."document_storage_connections"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_storage_connection_id_fkey" FOREIGN KEY ("storage_connection_id") REFERENCES "public"."document_storage_connections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."documents"
    ADD CONSTRAINT "documents_structure_item_id_fkey" FOREIGN KEY ("structure_item_id") REFERENCES "public"."doc_structures"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "fk_member" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."project_subcontractors"
    ADD CONSTRAINT "fk_subject" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hourly_payout_requests"
    ADD CONSTRAINT "hourly_payout_requests_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."hourly_payout_requests"
    ADD CONSTRAINT "hourly_payout_requests_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."hourly_payouts"
    ADD CONSTRAINT "hourly_payouts_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."hourly_payouts"
    ADD CONSTRAINT "hourly_payouts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."member_certifications"
    ADD CONSTRAINT "member_certifications_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "public"."member_roles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."members"
    ADD CONSTRAINT "members_user_role_fkey" FOREIGN KEY ("user_role") REFERENCES "public"."user_roles"("role_name") ON UPDATE CASCADE ON DELETE SET DEFAULT;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overhead_allocation_items"
    ADD CONSTRAINT "overhead_allocation_items_overhead_cost_id_fkey" FOREIGN KEY ("overhead_cost_id") REFERENCES "public"."overhead_costs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overhead_allocation_items"
    ADD CONSTRAINT "overhead_allocation_items_overhead_monthly_allocation_id_fkey" FOREIGN KEY ("overhead_monthly_allocation_id") REFERENCES "public"."overhead_monthly_allocations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overhead_allocation_items"
    ADD CONSTRAINT "overhead_allocation_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overhead_audit_logs"
    ADD CONSTRAINT "overhead_audit_logs_monthly_allocation_id_fkey" FOREIGN KEY ("monthly_allocation_id") REFERENCES "public"."overhead_monthly_allocations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."overhead_audit_logs"
    ADD CONSTRAINT "overhead_audit_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."overhead_costs"
    ADD CONSTRAINT "overhead_costs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."overhead_monthly_allocations"
    ADD CONSTRAINT "overhead_monthly_allocations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."overhead_monthly_allocations"
    ADD CONSTRAINT "overhead_monthly_allocations_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."payout_items"
    ADD CONSTRAINT "payout_items_payout_id_fkey" FOREIGN KEY ("payout_id") REFERENCES "public"."payouts"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payout_items"
    ADD CONSTRAINT "payout_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payout_items"
    ADD CONSTRAINT "payout_items_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id");



ALTER TABLE ONLY "public"."payout_items"
    ADD CONSTRAINT "payout_items_realization_id_fkey" FOREIGN KEY ("realization_id") REFERENCES "public"."realizations"("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."payouts"
    ADD CONSTRAINT "payouts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."product_stock_movements"
    ADD CONSTRAINT "product_stock_movements_catalog_item_id_fkey" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."commercial_item_catalog"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_comments"
    ADD CONSTRAINT "project_comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_contacts"
    ADD CONSTRAINT "project_contacts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_costs"
    ADD CONSTRAINT "project_costs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_links"
    ADD CONSTRAINT "project_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_members"
    ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_orders"
    ADD CONSTRAINT "project_orders_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_orders"
    ADD CONSTRAINT "project_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_overhead_costs"
    ADD CONSTRAINT "project_overhead_costs_overhead_allocation_item_id_fkey" FOREIGN KEY ("overhead_allocation_item_id") REFERENCES "public"."overhead_allocation_items"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_overhead_costs"
    ADD CONSTRAINT "project_overhead_costs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_subcontractors"
    ADD CONSTRAINT "project_subcontractors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_tasks"
    ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_templates_custom"
    ADD CONSTRAINT "project_templates_custom_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."project_to_tags"
    ADD CONSTRAINT "project_to_tags_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."project_to_tags"
    ADD CONSTRAINT "project_to_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "public"."project_tags"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."subjects"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_created_by_member_id_fkey" FOREIGN KEY ("created_by_member_id") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_crm_opportunity_id_fkey" FOREIGN KEY ("crm_opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "public"."subjects"("id");



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_stage_id_fkey" FOREIGN KEY ("stage_id") REFERENCES "public"."project_stages"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."realizace_costs"
    ADD CONSTRAINT "realizace_costs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."realizace_costs"
    ADD CONSTRAINT "realizace_costs_invoice_storage_connection_id_fkey" FOREIGN KEY ("invoice_storage_connection_id") REFERENCES "public"."document_storage_connections"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."realizace_costs"
    ADD CONSTRAINT "realizace_costs_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realizace_costs"
    ADD CONSTRAINT "realizace_costs_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."subjects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."realizace_extra_costs"
    ADD CONSTRAINT "realizace_extra_costs_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realizace_financials"
    ADD CONSTRAINT "realizace_financials_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realizace_orders"
    ADD CONSTRAINT "realizace_orders_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realizace_orders"
    ADD CONSTRAINT "realizace_orders_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "public"."subjects"("id");



ALTER TABLE ONLY "public"."realizace_overhead"
    ADD CONSTRAINT "realizace_overhead_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realizace_team_members"
    ADD CONSTRAINT "realizace_team_members_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realizace_team_members"
    ADD CONSTRAINT "realizace_team_members_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realization_profit_shares"
    ADD CONSTRAINT "realization_profit_shares_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realization_profit_shares"
    ADD CONSTRAINT "realization_profit_shares_realizace_id_fkey" FOREIGN KEY ("realizace_id") REFERENCES "public"."realizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."realizations"
    ADD CONSTRAINT "realizations_crm_opportunity_id_fkey" FOREIGN KEY ("crm_opportunity_id") REFERENCES "public"."crm_opportunities"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."realizations"
    ADD CONSTRAINT "realizations_investor_id_fkey" FOREIGN KEY ("investor_id") REFERENCES "public"."subjects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."realizations"
    ADD CONSTRAINT "realizations_lead_person_id_fkey" FOREIGN KEY ("lead_person_id") REFERENCES "public"."members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."realizations"
    ADD CONSTRAINT "realizations_linked_project_id_fkey" FOREIGN KEY ("linked_project_id") REFERENCES "public"."projects"("id");



ALTER TABLE ONLY "public"."reports"
    ADD CONSTRAINT "reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."role_permissions"
    ADD CONSTRAINT "role_permissions_role_fkey" FOREIGN KEY ("role") REFERENCES "public"."user_roles"("role_name") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salary_payouts"
    ADD CONSTRAINT "salary_payouts_approver_id_fkey" FOREIGN KEY ("approver_id") REFERENCES "public"."members"("id");



ALTER TABLE ONLY "public"."salary_payouts"
    ADD CONSTRAINT "salary_payouts_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."engineering_activities"
    ADD CONSTRAINT "statements_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcontractor_orders_deprecated"
    ADD CONSTRAINT "subcontractor_orders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcontractor_orders"
    ADD CONSTRAINT "subcontractor_orders_project_id_fkey1" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcontractor_orders_deprecated"
    ADD CONSTRAINT "subcontractor_orders_subcontractor_id_fkey" FOREIGN KEY ("subcontractor_id") REFERENCES "public"."subcontractors_deprecated"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subcontractor_orders"
    ADD CONSTRAINT "subcontractor_orders_subject_id_fkey" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subjects"
    ADD CONSTRAINT "subjects_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "public"."subject_types"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."template_engineering_activities"
    ADD CONSTRAINT "template_engineering_activities_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."template_tasks"
    ADD CONSTRAINT "template_tasks_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "public"."project_templates"("id") ON DELETE CASCADE;



CREATE POLICY "Admin full access" ON "public"."member_roles" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admin full access" ON "public"."project_types" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Admins can manage reports" ON "public"."reports" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'reports'::"text") AND ("role_permissions"."can_admin" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'reports'::"text") AND ("role_permissions"."can_admin" = true))))));



CREATE POLICY "Allow all authenticated to read realizace costs" ON "public"."realizace_costs" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Allow authenticated to manage realizace costs" ON "public"."realizace_costs" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text")) WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Allow project members to read doc_structures" ON "public"."doc_structures" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Allow project members to read documents" ON "public"."documents" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_read"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'documents'::"text"))) AND ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Allow project members with edit permission to delete" ON "public"."documents" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'documents'::"text"))) AND ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Allow read for project members" ON "public"."project_subcontractors" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "App settings update for admins" ON "public"."app_settings" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Authenticated users can read storage connections" ON "public"."document_storage_connections" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "CRM activities edit access" ON "public"."crm_activities" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("assigned_member_id" = "public"."get_member_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_edit" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("assigned_member_id" = "public"."get_member_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_edit" = true))))));



CREATE POLICY "CRM activities read access" ON "public"."crm_activities" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "CRM commercial document items edit access" ON "public"."crm_commercial_document_items" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "CRM commercial document items read access" ON "public"."crm_commercial_document_items" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "CRM commercial documents edit access" ON "public"."crm_commercial_documents" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "CRM commercial documents read access" ON "public"."crm_commercial_documents" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "CRM edit access" ON "public"."crm_opportunities" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("owner_member_id" = "public"."get_member_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_edit" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("owner_member_id" = "public"."get_member_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_edit" = true))))));



CREATE POLICY "CRM notes edit access" ON "public"."crm_notes" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("author_member_id" = "public"."get_member_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_edit" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("author_member_id" = "public"."get_member_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_edit" = true))))));



CREATE POLICY "CRM notes read access" ON "public"."crm_notes" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "CRM numbering settings admin access" ON "public"."crm_numbering_settings" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_admin" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_admin" = true))))));



CREATE POLICY "CRM numbering settings read access" ON "public"."crm_numbering_settings" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "CRM opportunity items edit access" ON "public"."crm_opportunity_items" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "CRM opportunity items read access" ON "public"."crm_opportunity_items" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "CRM priority definitions admin access" ON "public"."crm_priority_definitions" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_admin" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_admin" = true))))));



CREATE POLICY "CRM priority definitions read access" ON "public"."crm_priority_definitions" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "CRM read access" ON "public"."crm_opportunities" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "CRM stage definitions admin access" ON "public"."crm_stage_definitions" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_admin" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_admin" = true))))));



CREATE POLICY "CRM stage definitions read access" ON "public"."crm_stage_definitions" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'crm'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "Commercial item catalog edit access" ON "public"."commercial_item_catalog" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['realizace'::"text", 'projects'::"text", 'settings'::"text", 'crm'::"text"])) AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['realizace'::"text", 'projects'::"text", 'settings'::"text", 'crm'::"text"])) AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Commercial item catalog read access" ON "public"."commercial_item_catalog" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['realizace'::"text", 'projects'::"text", 'settings'::"text", 'crm'::"text"])) AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "Document editors can manage storage folders" ON "public"."document_storage_folders" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['documents'::"text", 'projects'::"text", 'realizace'::"text"])) AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['documents'::"text", 'projects'::"text", 'realizace'::"text"])) AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Document readers can read storage folders" ON "public"."document_storage_folders" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['documents'::"text", 'projects'::"text", 'realizace'::"text"])) AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "Enable all for admins" ON "public"."document_types" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."order_statuses" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."priority_levels" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."project_overhead_costs" TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."projection_statuses" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."realization_statuses" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."realization_types" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."risk_levels" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."units" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins" ON "public"."user_roles" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins on doc_structures" ON "public"."doc_structures" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins on legal_forms" ON "public"."legal_forms" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins on overhead_allocation_items" ON "public"."overhead_allocation_items" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins on overhead_costs" ON "public"."overhead_costs" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins on overhead_monthly_allocations" ON "public"."overhead_monthly_allocations" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins on subcontractor_statuses_deprecated" ON "public"."subcontractor_statuses_deprecated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for admins on subcontractors_deprecated" ON "public"."subcontractors_deprecated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable all for authenticated users on order_templates" ON "public"."order_templates" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable all for authenticated users on realizace_orders" ON "public"."realizace_orders" USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable all for own submissions or admins" ON "public"."attendance_submissions" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"())));



CREATE POLICY "Enable all for users with edit permission" ON "public"."realizace_team_members" USING (((EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'realizace'::"text") AND ("role_permissions"."can_edit" = true)))) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable delete for admins" ON "public"."documents" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."engineering_activities" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."engineering_subjects" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."payout_items" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."payouts" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."project_comments" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."project_costs" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."project_links" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."project_subcontractors" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins" ON "public"."project_tasks" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for admins on realizations" ON "public"."realizations" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable delete for own pending or rejected requests" ON "public"."hourly_payout_requests" FOR DELETE TO "authenticated" USING ((("member_id" = "public"."get_member_id"()) AND ("status" = ANY (ARRAY['pending'::"text", 'rejected'::"text"]))));



CREATE POLICY "Enable delete for own records or admins" ON "public"."attendance" FOR DELETE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable full access for admins" ON "public"."project_orders" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable full access for admins" ON "public"."subcontractor_orders" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable full access for admins" ON "public"."subcontractor_orders_deprecated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable full access for admins" ON "public"."template_engineering_activities" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable full access for admins" ON "public"."template_tasks" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable insert for admins on overhead_audit_logs" ON "public"."overhead_audit_logs" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable insert for authenticated" ON "public"."notifications" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."audit_logs" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable insert for authenticated users" ON "public"."engineering_subjects" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable insert for authenticated users on realizations" ON "public"."realizations" FOR INSERT WITH CHECK ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable insert for own" ON "public"."hourly_payouts" FOR INSERT WITH CHECK ((("member_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable insert for own" ON "public"."salary_payouts" FOR INSERT WITH CHECK ((("member_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable insert for own payout requests" ON "public"."payout_items" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("payout_id" IN ( SELECT "payouts"."id"
   FROM "public"."payouts"
  WHERE ("payouts"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable insert for own payout requests" ON "public"."payouts" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'payouts'::"text"))) AND ("member_id" = "public"."get_member_id"()))));



CREATE POLICY "Enable insert for own records" ON "public"."attendance" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'attendance'::"text"))) AND ("member_id" = "public"."get_member_id"()))));



CREATE POLICY "Enable insert for own records" ON "public"."hourly_payout_requests" FOR INSERT WITH CHECK ((("member_id" = "public"."get_member_id"()) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable insert for project members or admins" ON "public"."documents" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'documents'::"text"))) AND (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "documents"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"())))))));



CREATE POLICY "Enable insert for project members or admins" ON "public"."engineering_activities" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'engineering'::"text"))) AND ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable insert for project members or admins" ON "public"."project_comments" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_comments"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable insert for project members or admins" ON "public"."project_costs" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_costs"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable insert for project members or admins" ON "public"."project_links" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_links"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable insert for project members or admins" ON "public"."project_subcontractors" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_subcontractors"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable insert for project members or admins" ON "public"."project_tasks" FOR INSERT WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'tasks'::"text"))) AND ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable read access for all users" ON "public"."member_roles" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."project_orders" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."project_types" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."realization_types" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."template_engineering_activities" FOR SELECT USING (true);



CREATE POLICY "Enable read access for all users" ON "public"."template_tasks" FOR SELECT USING (true);



CREATE POLICY "Enable read access for assigned members" ON "public"."projects" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("id" IN ( SELECT "pm"."project_id"
   FROM "public"."project_members" "pm"
  WHERE ("pm"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read access for users" ON "public"."members" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("id" = "public"."get_member_id"()) OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."member_id" = "public"."get_member_id"()) AND ("members"."id" IN ( SELECT "pm_inner"."member_id"
           FROM "public"."project_members" "pm_inner"
          WHERE ("pm_inner"."project_id" = "pm"."project_id")))))) OR (EXISTS ( SELECT 1
   FROM "public"."projects" "p"
  WHERE (("p"."created_by_member_id" = "members"."id") AND ("p"."id" IN ( SELECT "pm"."project_id"
           FROM "public"."project_members" "pm"
          WHERE ("pm"."member_id" = "public"."get_member_id"()))))))));



CREATE POLICY "Enable read for admins on overhead_audit_logs" ON "public"."overhead_audit_logs" FOR SELECT USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable read for admins only" ON "public"."audit_logs" FOR SELECT USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."app_settings" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."document_types" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."engineering_subjects" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."member_certifications" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."order_statuses" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."priority_levels" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."project_stages" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."project_tags" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."project_templates" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."projection_statuses" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."realizace_team_members" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."realization_statuses" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."reports" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ( SELECT "role_permissions"."can_read"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'reports'::"text")))));



CREATE POLICY "Enable read for authenticated users" ON "public"."risk_levels" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."role_permissions" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."subject_types" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."subjects" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ( SELECT "role_permissions"."can_read"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'subjects'::"text")))));



CREATE POLICY "Enable read for authenticated users" ON "public"."task_statuses" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."units" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users" ON "public"."user_roles" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users on legal_forms" ON "public"."legal_forms" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users on realizace_financials" ON "public"."realizace_financials" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users on realizace_overhead" ON "public"."realizace_overhead" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for authenticated users on realizations" ON "public"."realizations" FOR SELECT USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable read for own notifications" ON "public"."notifications" FOR SELECT USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Enable read for own or admins" ON "public"."hourly_payouts" FOR SELECT USING ((("member_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable read for own or admins" ON "public"."salary_payouts" FOR SELECT USING ((("member_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable read for own payouts or admins" ON "public"."payout_items" FOR SELECT USING ((("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'super_manager'::"text"])) OR ("payout_id" IN ( SELECT "payouts"."id"
   FROM "public"."payouts"
  WHERE ("payouts"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for own payouts, admins or super_managers" ON "public"."payouts" FOR SELECT USING ((("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'super_manager'::"text"])) OR (( SELECT "role_permissions"."can_read"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'payouts'::"text"))) AND ("member_id" = "public"."get_member_id"()))));



CREATE POLICY "Enable read for own records or admins" ON "public"."hourly_payout_requests" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"())));



CREATE POLICY "Enable read for own records, admins or super_managers" ON "public"."attendance" FOR SELECT USING ((("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'super_manager'::"text"])) OR (( SELECT "role_permissions"."can_read"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'attendance'::"text"))) AND ("member_id" = "public"."get_member_id"()))));



CREATE POLICY "Enable read for project members" ON "public"."project_contacts" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "pm"."project_id"
   FROM "public"."project_members" "pm"
  WHERE ("pm"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for project members or admins" ON "public"."engineering_activities" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "pm"."project_id"
   FROM "public"."project_members" "pm"
  WHERE ("pm"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for project members or admins" ON "public"."project_comments" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for project members or admins" ON "public"."project_costs" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "pm"."project_id"
   FROM "public"."project_members" "pm"
  WHERE ("pm"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for project members or admins" ON "public"."project_links" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for project members or admins" ON "public"."project_overhead_costs" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "pm"."project_id"
   FROM "public"."project_members" "pm"
  WHERE ("pm"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for project members or admins" ON "public"."project_tasks" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"()) OR ("project_id" IN ( SELECT "pm"."project_id"
   FROM "public"."project_members" "pm"
  WHERE ("pm"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for project members or admins" ON "public"."project_to_tags" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable read for project members or admins" ON "public"."subcontractor_orders" FOR SELECT USING ((("public"."get_user_role"() = 'admin'::"text") OR ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"())))));



CREATE POLICY "Enable update for admins" ON "public"."engineering_subjects" FOR UPDATE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable update for admins" ON "public"."payout_items" FOR UPDATE USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Enable update for authenticated users on realizations" ON "public"."realizations" FOR UPDATE USING ((( SELECT "auth"."role"() AS "role") = 'authenticated'::"text"));



CREATE POLICY "Enable update for own notifications" ON "public"."notifications" FOR UPDATE USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "Enable update for own or admins" ON "public"."hourly_payouts" FOR UPDATE USING ((("member_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable update for own or admins" ON "public"."salary_payouts" FOR UPDATE USING ((("member_id" = ( SELECT "members"."id"
   FROM "public"."members"
  WHERE ("members"."auth_user_id" = ( SELECT "auth"."uid"() AS "uid")))) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable update for own record" ON "public"."members" FOR UPDATE USING (("id" = "public"."get_member_id"())) WITH CHECK (("id" = "public"."get_member_id"()));



CREATE POLICY "Enable update for own records" ON "public"."hourly_payout_requests" FOR UPDATE USING ((("member_id" = "public"."get_member_id"()) OR ("public"."get_user_role"() = 'admin'::"text")));



CREATE POLICY "Enable update for own records, admins or super_managers" ON "public"."attendance" FOR UPDATE USING ((("public"."get_user_role"() = ANY (ARRAY['admin'::"text", 'super_manager'::"text"])) OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'attendance'::"text"))) AND ("member_id" = "public"."get_member_id"()))));



CREATE POLICY "Enable update for project members or admins" ON "public"."documents" FOR UPDATE USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "documents"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable update for project members or admins" ON "public"."engineering_activities" FOR UPDATE USING ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'engineering'::"text"))) AND ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"())))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'engineering'::"text"))) AND ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable update for project members or admins" ON "public"."project_comments" FOR UPDATE USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_comments"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable update for project members or admins" ON "public"."project_costs" FOR UPDATE USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_costs"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable update for project members or admins" ON "public"."project_links" FOR UPDATE USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_links"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable update for project members or admins" ON "public"."project_subcontractors" FOR UPDATE USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members"
  WHERE (("project_members"."project_id" = "project_subcontractors"."project_id") AND ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Enable update for project members or admins" ON "public"."project_tasks" FOR UPDATE USING ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'tasks'::"text"))) AND ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"())))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (( SELECT "role_permissions"."can_edit"
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'tasks'::"text"))) AND ("project_id" IN ( SELECT "project_members"."project_id"
   FROM "public"."project_members"
  WHERE ("project_members"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Member certifications delete for admins or own records" ON "public"."member_certifications" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"())));



CREATE POLICY "Member certifications insert for admins or own records" ON "public"."member_certifications" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"())));



CREATE POLICY "Member certifications update for admins or own records" ON "public"."member_certifications" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"()))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"())));



CREATE POLICY "Members delete for admins" ON "public"."members" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Members insert for admins" ON "public"."members" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Members update for admins" ON "public"."members" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Payouts update for admins or own invoice upload" ON "public"."payouts" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"()))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("member_id" = "public"."get_member_id"())));



CREATE POLICY "Product field definitions admin access" ON "public"."product_field_definitions" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'settings'::"text") AND ("role_permissions"."can_admin" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'settings'::"text") AND ("role_permissions"."can_admin" = true))))));



CREATE POLICY "Product field definitions read access" ON "public"."product_field_definitions" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['crm'::"text", 'realizace'::"text", 'projects'::"text", 'settings'::"text"])) AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "Product stock movements edit access" ON "public"."product_stock_movements" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['realizace'::"text", 'settings'::"text"])) AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['realizace'::"text", 'settings'::"text"])) AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Product stock movements read access" ON "public"."product_stock_movements" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['crm'::"text", 'realizace'::"text", 'projects'::"text", 'settings'::"text"])) AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "Project contacts delete for project members" ON "public"."project_contacts" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_contacts"."project_id") AND ("pm"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Project contacts insert for project members" ON "public"."project_contacts" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_contacts"."project_id") AND ("pm"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Project contacts update for project members" ON "public"."project_contacts" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_contacts"."project_id") AND ("pm"."member_id" = "public"."get_member_id"())))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_contacts"."project_id") AND ("pm"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Project custom templates delete for admins or owners" ON "public"."project_templates_custom" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "Project custom templates insert for admins or owners" ON "public"."project_templates_custom" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "Project custom templates update for admins or owners" ON "public"."project_templates_custom" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR ("user_id" = "auth"."uid"()))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "Project members delete access" ON "public"."project_members" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Project members insert access" ON "public"."project_members" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Project members read access" ON "public"."project_members" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "Project members update access" ON "public"."project_members" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Project stages delete for admins" ON "public"."project_stages" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project stages insert for admins" ON "public"."project_stages" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project stages update for admins" ON "public"."project_stages" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project tags delete for admins" ON "public"."project_tags" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project tags insert for admins" ON "public"."project_tags" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project tags update for admins" ON "public"."project_tags" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project templates delete for admins" ON "public"."project_templates" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project templates insert for admins" ON "public"."project_templates" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project templates update for admins" ON "public"."project_templates" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Project to tags delete for admins or project members" ON "public"."project_to_tags" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_to_tags"."project_id") AND ("pm"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Project to tags insert for admins or project members" ON "public"."project_to_tags" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_to_tags"."project_id") AND ("pm"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Project to tags update for admins or project members" ON "public"."project_to_tags" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_to_tags"."project_id") AND ("pm"."member_id" = "public"."get_member_id"())))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."project_members" "pm"
  WHERE (("pm"."project_id" = "project_to_tags"."project_id") AND ("pm"."member_id" = "public"."get_member_id"()))))));



CREATE POLICY "Projects delete for admins" ON "public"."projects" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Projects insert for admins" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Projects update for admins" ON "public"."projects" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Realizace extra costs delete access" ON "public"."realizace_extra_costs" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Realizace extra costs insert access" ON "public"."realizace_extra_costs" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Realizace extra costs read access" ON "public"."realizace_extra_costs" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "Realizace extra costs update access" ON "public"."realizace_extra_costs" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Realizace financials delete for admins" ON "public"."realizace_financials" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Realizace financials insert for admins or editors" ON "public"."realizace_financials" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions" "rp"
  WHERE (("rp"."role" = "public"."get_user_role"()) AND ("rp"."module" = 'realizace'::"text") AND ("rp"."can_edit" = true))))));



CREATE POLICY "Realizace financials update for admins or editors" ON "public"."realizace_financials" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions" "rp"
  WHERE (("rp"."role" = "public"."get_user_role"()) AND ("rp"."module" = 'realizace'::"text") AND ("rp"."can_edit" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions" "rp"
  WHERE (("rp"."role" = "public"."get_user_role"()) AND ("rp"."module" = 'realizace'::"text") AND ("rp"."can_edit" = true))))));



CREATE POLICY "Realizace overhead delete for admins" ON "public"."realizace_overhead" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Realizace overhead insert for admins or editors" ON "public"."realizace_overhead" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions" "rp"
  WHERE (("rp"."role" = "public"."get_user_role"()) AND ("rp"."module" = 'realizace'::"text") AND ("rp"."can_edit" = true))))));



CREATE POLICY "Realizace overhead update for admins or editors" ON "public"."realizace_overhead" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions" "rp"
  WHERE (("rp"."role" = "public"."get_user_role"()) AND ("rp"."module" = 'realizace'::"text") AND ("rp"."can_edit" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions" "rp"
  WHERE (("rp"."role" = "public"."get_user_role"()) AND ("rp"."module" = 'realizace'::"text") AND ("rp"."can_edit" = true))))));



CREATE POLICY "Realization profit shares delete access" ON "public"."realization_profit_shares" FOR DELETE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Realization profit shares insert access" ON "public"."realization_profit_shares" FOR INSERT TO "authenticated" WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Realization profit shares read access" ON "public"."realization_profit_shares" FOR SELECT TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = ANY (ARRAY['projects'::"text", 'payouts'::"text"])) AND ("role_permissions"."can_read" = true))))));



CREATE POLICY "Realization profit shares update access" ON "public"."realization_profit_shares" FOR UPDATE TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true))))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'projects'::"text") AND (("role_permissions"."can_edit" = true) OR ("role_permissions"."can_admin" = true)))))));



CREATE POLICY "Role permissions delete for admins" ON "public"."role_permissions" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Role permissions insert for admins" ON "public"."role_permissions" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Role permissions update for admins" ON "public"."role_permissions" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Settings admins can manage storage connections" ON "public"."document_storage_connections" TO "authenticated" USING ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'settings'::"text") AND ("role_permissions"."can_admin" = true)))))) WITH CHECK ((("public"."get_user_role"() = 'admin'::"text") OR (EXISTS ( SELECT 1
   FROM "public"."role_permissions"
  WHERE (("role_permissions"."role" = "public"."get_user_role"()) AND ("role_permissions"."module" = 'settings'::"text") AND ("role_permissions"."can_admin" = true))))));



CREATE POLICY "Subject types delete for admins" ON "public"."subject_types" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Subject types insert for admins" ON "public"."subject_types" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Subject types update for admins" ON "public"."subject_types" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Subjects delete for admins" ON "public"."subjects" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Subjects insert for admins" ON "public"."subjects" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Subjects update for admins" ON "public"."subjects" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Task statuses delete for admins" ON "public"."task_statuses" FOR DELETE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Task statuses insert for admins" ON "public"."task_statuses" FOR INSERT TO "authenticated" WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



CREATE POLICY "Task statuses update for admins" ON "public"."task_statuses" FOR UPDATE TO "authenticated" USING (("public"."get_user_role"() = 'admin'::"text")) WITH CHECK (("public"."get_user_role"() = 'admin'::"text"));



ALTER TABLE "public"."app_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attendance_submissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."commercial_item_catalog" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_commercial_document_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_commercial_documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_numbering_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_opportunities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_opportunity_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_priority_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."crm_stage_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."doc_structures" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_storage_connections" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_storage_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."document_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."documents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."engineering_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."engineering_subjects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hourly_payout_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hourly_payouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."legal_forms" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_certifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."member_roles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."order_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."overhead_allocation_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."overhead_audit_logs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."overhead_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."overhead_monthly_allocations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payout_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."priority_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_field_definitions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."product_stock_movements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_comments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_contacts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_overhead_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_stages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_subcontractors" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_templates" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_templates_custom" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_to_tags" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."project_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projection_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realizace_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realizace_extra_costs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realizace_financials" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realizace_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realizace_overhead" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realizace_team_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realization_profit_shares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realization_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realization_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."realizations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."risk_levels" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."role_permissions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."salary_payouts" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subcontractor_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subcontractor_orders_deprecated" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subcontractor_statuses_deprecated" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subcontractors_deprecated" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subject_types" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."subjects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."task_statuses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_engineering_activities" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."template_tasks" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."units" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."user_roles" ENABLE ROW LEVEL SECURITY;


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



GRANT ALL ON FUNCTION "public"."get_company_financials"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_company_financials"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_company_financials"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_member_id"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_member_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_member_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_overhead_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_overhead_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_overhead_summary"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_permissions"("p_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_permissions"("p_role" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_permissions"("p_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_projects_with_balance"("p_member_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_projects_with_balance"("p_member_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_projects_with_balance"("p_member_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_realizace_financials"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_realizace_financials"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_realizace_financials"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_realizace_overhead_summary"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_realizace_overhead_summary"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_realizace_overhead_summary"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_realizations_with_balance"("p_member_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_realizations_with_balance"("p_member_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_realizations_with_balance"("p_member_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_activities"("p_member_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_activities"("p_member_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_activities"("p_member_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_financials"("p_member_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_financials"("p_member_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_financials"("p_member_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_id_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_id_by_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_id_by_email"("p_email" "text") TO "service_role";



GRANT ALL ON TABLE "public"."projects" TO "anon";
GRANT ALL ON TABLE "public"."projects" TO "authenticated";
GRANT ALL ON TABLE "public"."projects" TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_projects"("p_member_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_projects"("p_member_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_projects"("p_member_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_user_role"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_user_role"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_admin_payout_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_admin_payout_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_admin_payout_change"() TO "service_role";



GRANT ALL ON FUNCTION "public"."notify_member_hourly_payout_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."notify_member_hourly_payout_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."notify_member_hourly_payout_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."refresh_user_rewards"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."refresh_user_rewards"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."refresh_user_rewards"() TO "service_role";



GRANT ALL ON FUNCTION "public"."setup_project_rls"("table_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."setup_project_rls"("table_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."setup_project_rls"("table_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_realizace_order_stock_movements"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_realizace_order_stock_movements"("p_order_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_realizace_order_stock_movements"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_realizace_order_stock_movements"("p_order_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_realizace_team_members_to_array"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_realizace_team_members_to_array"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_realizace_team_members_to_array"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trigger_refresh_user_rewards"() TO "anon";
GRANT ALL ON FUNCTION "public"."trigger_refresh_user_rewards"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trigger_refresh_user_rewards"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_commercial_item_catalog_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_commercial_item_catalog_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_commercial_item_catalog_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_crm_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_crm_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_crm_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_hourly_payout_requests_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_hourly_payout_requests_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_hourly_payout_requests_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_monthly_allocations_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_monthly_allocations_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_monthly_allocations_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_overhead_costs_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_overhead_costs_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_overhead_costs_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_payout_total_amount"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_payout_total_amount"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_payout_total_amount"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_product_field_definitions_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_product_field_definitions_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_product_field_definitions_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_project_templates_custom_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_project_templates_custom_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_project_templates_custom_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_realizace_orders_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_realizace_orders_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_realizace_orders_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_realizations_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_realizations_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_realizations_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."update_subjects_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_subjects_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_subjects_updated_at"() TO "service_role";



GRANT ALL ON TABLE "public"."app_settings" TO "anon";
GRANT ALL ON TABLE "public"."app_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."app_settings" TO "service_role";



GRANT ALL ON TABLE "public"."attendance" TO "anon";
GRANT ALL ON TABLE "public"."attendance" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance" TO "service_role";



GRANT ALL ON TABLE "public"."attendance_submissions" TO "anon";
GRANT ALL ON TABLE "public"."attendance_submissions" TO "authenticated";
GRANT ALL ON TABLE "public"."attendance_submissions" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."commercial_item_catalog" TO "anon";
GRANT ALL ON TABLE "public"."commercial_item_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."commercial_item_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."crm_activities" TO "anon";
GRANT ALL ON TABLE "public"."crm_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_activities" TO "service_role";



GRANT ALL ON TABLE "public"."crm_commercial_document_items" TO "anon";
GRANT ALL ON TABLE "public"."crm_commercial_document_items" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_commercial_document_items" TO "service_role";



GRANT ALL ON TABLE "public"."crm_commercial_documents" TO "anon";
GRANT ALL ON TABLE "public"."crm_commercial_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_commercial_documents" TO "service_role";



GRANT ALL ON TABLE "public"."crm_notes" TO "anon";
GRANT ALL ON TABLE "public"."crm_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_notes" TO "service_role";



GRANT ALL ON TABLE "public"."crm_numbering_settings" TO "anon";
GRANT ALL ON TABLE "public"."crm_numbering_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_numbering_settings" TO "service_role";



GRANT ALL ON TABLE "public"."crm_opportunities" TO "anon";
GRANT ALL ON TABLE "public"."crm_opportunities" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_opportunities" TO "service_role";



GRANT ALL ON TABLE "public"."crm_opportunity_items" TO "anon";
GRANT ALL ON TABLE "public"."crm_opportunity_items" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_opportunity_items" TO "service_role";



GRANT ALL ON TABLE "public"."crm_priority_definitions" TO "anon";
GRANT ALL ON TABLE "public"."crm_priority_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_priority_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."crm_stage_definitions" TO "anon";
GRANT ALL ON TABLE "public"."crm_stage_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."crm_stage_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."doc_structures" TO "anon";
GRANT ALL ON TABLE "public"."doc_structures" TO "authenticated";
GRANT ALL ON TABLE "public"."doc_structures" TO "service_role";



GRANT ALL ON TABLE "public"."document_storage_connections" TO "anon";
GRANT ALL ON TABLE "public"."document_storage_connections" TO "authenticated";
GRANT ALL ON TABLE "public"."document_storage_connections" TO "service_role";



GRANT ALL ON TABLE "public"."document_storage_folders" TO "anon";
GRANT ALL ON TABLE "public"."document_storage_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."document_storage_folders" TO "service_role";



GRANT ALL ON TABLE "public"."document_types" TO "anon";
GRANT ALL ON TABLE "public"."document_types" TO "authenticated";
GRANT ALL ON TABLE "public"."document_types" TO "service_role";



GRANT ALL ON TABLE "public"."documents" TO "anon";
GRANT ALL ON TABLE "public"."documents" TO "authenticated";
GRANT ALL ON TABLE "public"."documents" TO "service_role";



GRANT ALL ON TABLE "public"."engineering_activities" TO "anon";
GRANT ALL ON TABLE "public"."engineering_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."engineering_activities" TO "service_role";



GRANT ALL ON TABLE "public"."engineering_subjects" TO "anon";
GRANT ALL ON TABLE "public"."engineering_subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."engineering_subjects" TO "service_role";



GRANT ALL ON TABLE "public"."hourly_payout_requests" TO "anon";
GRANT ALL ON TABLE "public"."hourly_payout_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."hourly_payout_requests" TO "service_role";



GRANT ALL ON TABLE "public"."hourly_payouts" TO "anon";
GRANT ALL ON TABLE "public"."hourly_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."hourly_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."legal_forms" TO "anon";
GRANT ALL ON TABLE "public"."legal_forms" TO "authenticated";
GRANT ALL ON TABLE "public"."legal_forms" TO "service_role";



GRANT ALL ON TABLE "public"."member_certifications" TO "anon";
GRANT ALL ON TABLE "public"."member_certifications" TO "authenticated";
GRANT ALL ON TABLE "public"."member_certifications" TO "service_role";



GRANT ALL ON TABLE "public"."member_roles" TO "anon";
GRANT ALL ON TABLE "public"."member_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."member_roles" TO "service_role";



GRANT ALL ON TABLE "public"."members" TO "anon";
GRANT ALL ON TABLE "public"."members" TO "authenticated";
GRANT ALL ON TABLE "public"."members" TO "service_role";



GRANT ALL ON TABLE "public"."project_members" TO "anon";
GRANT ALL ON TABLE "public"."project_members" TO "authenticated";
GRANT ALL ON TABLE "public"."project_members" TO "service_role";



GRANT ALL ON TABLE "public"."project_subcontractors" TO "anon";
GRANT ALL ON TABLE "public"."project_subcontractors" TO "authenticated";
GRANT ALL ON TABLE "public"."project_subcontractors" TO "service_role";



GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."mv_user_project_rewards" TO "anon";
GRANT INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN,UPDATE ON TABLE "public"."mv_user_project_rewards" TO "authenticated";
GRANT ALL ON TABLE "public"."mv_user_project_rewards" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."order_statuses" TO "anon";
GRANT ALL ON TABLE "public"."order_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."order_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."order_templates" TO "anon";
GRANT ALL ON TABLE "public"."order_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."order_templates" TO "service_role";



GRANT ALL ON TABLE "public"."overhead_allocation_items" TO "anon";
GRANT ALL ON TABLE "public"."overhead_allocation_items" TO "authenticated";
GRANT ALL ON TABLE "public"."overhead_allocation_items" TO "service_role";



GRANT ALL ON TABLE "public"."overhead_audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."overhead_audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."overhead_audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."overhead_costs" TO "anon";
GRANT ALL ON TABLE "public"."overhead_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."overhead_costs" TO "service_role";



GRANT ALL ON TABLE "public"."overhead_monthly_allocations" TO "anon";
GRANT ALL ON TABLE "public"."overhead_monthly_allocations" TO "authenticated";
GRANT ALL ON TABLE "public"."overhead_monthly_allocations" TO "service_role";



GRANT ALL ON TABLE "public"."payout_items" TO "anon";
GRANT ALL ON TABLE "public"."payout_items" TO "authenticated";
GRANT ALL ON TABLE "public"."payout_items" TO "service_role";



GRANT ALL ON TABLE "public"."payouts" TO "anon";
GRANT ALL ON TABLE "public"."payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."payouts" TO "service_role";



GRANT ALL ON TABLE "public"."priority_levels" TO "anon";
GRANT ALL ON TABLE "public"."priority_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."priority_levels" TO "service_role";



GRANT ALL ON TABLE "public"."product_field_definitions" TO "anon";
GRANT ALL ON TABLE "public"."product_field_definitions" TO "authenticated";
GRANT ALL ON TABLE "public"."product_field_definitions" TO "service_role";



GRANT ALL ON TABLE "public"."product_stock_movements" TO "anon";
GRANT ALL ON TABLE "public"."product_stock_movements" TO "authenticated";
GRANT ALL ON TABLE "public"."product_stock_movements" TO "service_role";



GRANT ALL ON TABLE "public"."product_stock_status" TO "anon";
GRANT ALL ON TABLE "public"."product_stock_status" TO "authenticated";
GRANT ALL ON TABLE "public"."product_stock_status" TO "service_role";



GRANT ALL ON TABLE "public"."project_comments" TO "anon";
GRANT ALL ON TABLE "public"."project_comments" TO "authenticated";
GRANT ALL ON TABLE "public"."project_comments" TO "service_role";



GRANT ALL ON TABLE "public"."project_contacts" TO "anon";
GRANT ALL ON TABLE "public"."project_contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."project_contacts" TO "service_role";



GRANT ALL ON TABLE "public"."project_costs" TO "anon";
GRANT ALL ON TABLE "public"."project_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."project_costs" TO "service_role";



GRANT ALL ON TABLE "public"."project_links" TO "anon";
GRANT ALL ON TABLE "public"."project_links" TO "authenticated";
GRANT ALL ON TABLE "public"."project_links" TO "service_role";



GRANT ALL ON TABLE "public"."project_orders" TO "anon";
GRANT ALL ON TABLE "public"."project_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."project_orders" TO "service_role";



GRANT ALL ON TABLE "public"."project_overhead_costs" TO "anon";
GRANT ALL ON TABLE "public"."project_overhead_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."project_overhead_costs" TO "service_role";



GRANT ALL ON TABLE "public"."project_stages" TO "anon";
GRANT ALL ON TABLE "public"."project_stages" TO "authenticated";
GRANT ALL ON TABLE "public"."project_stages" TO "service_role";



GRANT ALL ON TABLE "public"."project_tags" TO "anon";
GRANT ALL ON TABLE "public"."project_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."project_tags" TO "service_role";



GRANT ALL ON TABLE "public"."project_tasks" TO "anon";
GRANT ALL ON TABLE "public"."project_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."project_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."project_templates" TO "anon";
GRANT ALL ON TABLE "public"."project_templates" TO "authenticated";
GRANT ALL ON TABLE "public"."project_templates" TO "service_role";



GRANT ALL ON TABLE "public"."project_templates_custom" TO "anon";
GRANT ALL ON TABLE "public"."project_templates_custom" TO "authenticated";
GRANT ALL ON TABLE "public"."project_templates_custom" TO "service_role";



GRANT ALL ON TABLE "public"."project_to_tags" TO "anon";
GRANT ALL ON TABLE "public"."project_to_tags" TO "authenticated";
GRANT ALL ON TABLE "public"."project_to_tags" TO "service_role";



GRANT ALL ON TABLE "public"."project_types" TO "anon";
GRANT ALL ON TABLE "public"."project_types" TO "authenticated";
GRANT ALL ON TABLE "public"."project_types" TO "service_role";



GRANT ALL ON TABLE "public"."projection_statuses" TO "anon";
GRANT ALL ON TABLE "public"."projection_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."projection_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."realizace_costs" TO "anon";
GRANT ALL ON TABLE "public"."realizace_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."realizace_costs" TO "service_role";



GRANT ALL ON TABLE "public"."realizace_extra_costs" TO "anon";
GRANT ALL ON TABLE "public"."realizace_extra_costs" TO "authenticated";
GRANT ALL ON TABLE "public"."realizace_extra_costs" TO "service_role";



GRANT ALL ON TABLE "public"."realizace_financials" TO "anon";
GRANT ALL ON TABLE "public"."realizace_financials" TO "authenticated";
GRANT ALL ON TABLE "public"."realizace_financials" TO "service_role";



GRANT ALL ON TABLE "public"."realizace_orders" TO "anon";
GRANT ALL ON TABLE "public"."realizace_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."realizace_orders" TO "service_role";



GRANT ALL ON TABLE "public"."realizace_overhead" TO "anon";
GRANT ALL ON TABLE "public"."realizace_overhead" TO "authenticated";
GRANT ALL ON TABLE "public"."realizace_overhead" TO "service_role";



GRANT ALL ON TABLE "public"."realizace_team_members" TO "anon";
GRANT ALL ON TABLE "public"."realizace_team_members" TO "authenticated";
GRANT ALL ON TABLE "public"."realizace_team_members" TO "service_role";



GRANT ALL ON TABLE "public"."realization_profit_shares" TO "anon";
GRANT ALL ON TABLE "public"."realization_profit_shares" TO "authenticated";
GRANT ALL ON TABLE "public"."realization_profit_shares" TO "service_role";



GRANT ALL ON TABLE "public"."realization_statuses" TO "anon";
GRANT ALL ON TABLE "public"."realization_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."realization_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."realization_types" TO "anon";
GRANT ALL ON TABLE "public"."realization_types" TO "authenticated";
GRANT ALL ON TABLE "public"."realization_types" TO "service_role";



GRANT ALL ON TABLE "public"."realizations" TO "anon";
GRANT ALL ON TABLE "public"."realizations" TO "authenticated";
GRANT ALL ON TABLE "public"."realizations" TO "service_role";



GRANT ALL ON TABLE "public"."reports" TO "anon";
GRANT ALL ON TABLE "public"."reports" TO "authenticated";
GRANT ALL ON TABLE "public"."reports" TO "service_role";



GRANT ALL ON TABLE "public"."risk_levels" TO "anon";
GRANT ALL ON TABLE "public"."risk_levels" TO "authenticated";
GRANT ALL ON TABLE "public"."risk_levels" TO "service_role";



GRANT ALL ON TABLE "public"."role_permissions" TO "anon";
GRANT ALL ON TABLE "public"."role_permissions" TO "authenticated";
GRANT ALL ON TABLE "public"."role_permissions" TO "service_role";



GRANT ALL ON TABLE "public"."salary_payouts" TO "anon";
GRANT ALL ON TABLE "public"."salary_payouts" TO "authenticated";
GRANT ALL ON TABLE "public"."salary_payouts" TO "service_role";



GRANT ALL ON TABLE "public"."subcontractor_orders" TO "anon";
GRANT ALL ON TABLE "public"."subcontractor_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."subcontractor_orders" TO "service_role";



GRANT ALL ON TABLE "public"."subcontractor_orders_deprecated" TO "anon";
GRANT ALL ON TABLE "public"."subcontractor_orders_deprecated" TO "authenticated";
GRANT ALL ON TABLE "public"."subcontractor_orders_deprecated" TO "service_role";



GRANT ALL ON TABLE "public"."subcontractor_statuses_deprecated" TO "anon";
GRANT ALL ON TABLE "public"."subcontractor_statuses_deprecated" TO "authenticated";
GRANT ALL ON TABLE "public"."subcontractor_statuses_deprecated" TO "service_role";



GRANT ALL ON TABLE "public"."subcontractors_deprecated" TO "anon";
GRANT ALL ON TABLE "public"."subcontractors_deprecated" TO "authenticated";
GRANT ALL ON TABLE "public"."subcontractors_deprecated" TO "service_role";



GRANT ALL ON TABLE "public"."subject_types" TO "anon";
GRANT ALL ON TABLE "public"."subject_types" TO "authenticated";
GRANT ALL ON TABLE "public"."subject_types" TO "service_role";



GRANT ALL ON TABLE "public"."subjects" TO "anon";
GRANT ALL ON TABLE "public"."subjects" TO "authenticated";
GRANT ALL ON TABLE "public"."subjects" TO "service_role";



GRANT ALL ON TABLE "public"."task_statuses" TO "anon";
GRANT ALL ON TABLE "public"."task_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."task_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."template_engineering_activities" TO "anon";
GRANT ALL ON TABLE "public"."template_engineering_activities" TO "authenticated";
GRANT ALL ON TABLE "public"."template_engineering_activities" TO "service_role";



GRANT ALL ON TABLE "public"."template_tasks" TO "anon";
GRANT ALL ON TABLE "public"."template_tasks" TO "authenticated";
GRANT ALL ON TABLE "public"."template_tasks" TO "service_role";



GRANT ALL ON TABLE "public"."units" TO "anon";
GRANT ALL ON TABLE "public"."units" TO "authenticated";
GRANT ALL ON TABLE "public"."units" TO "service_role";



GRANT ALL ON TABLE "public"."user_roles" TO "anon";
GRANT ALL ON TABLE "public"."user_roles" TO "authenticated";
GRANT ALL ON TABLE "public"."user_roles" TO "service_role";



GRANT ALL ON TABLE "public"."v_project_budget_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_project_budget_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_project_budget_summary" TO "service_role";



GRANT ALL ON TABLE "public"."v_project_costs_summary" TO "anon";
GRANT ALL ON TABLE "public"."v_project_costs_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."v_project_costs_summary" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







