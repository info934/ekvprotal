-- Explicit employee enrollment, private employee evidence and audited requests.
-- No existing member is automatically enrolled or has their auth/portal role changed.
BEGIN;

CREATE TABLE public.employee_profiles (
  member_id uuid PRIMARY KEY REFERENCES public.members(id),
  employment_status text NOT NULL CHECK (employment_status IN ('active', 'inactive')),
  note text CHECK (char_length(note) <= 4000),
  created_by uuid REFERENCES public.members(id),
  updated_by uuid REFERENCES public.members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.employee_asset_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.employee_profiles(member_id),
  asset_type text NOT NULL CHECK (asset_type IN ('vehicle', 'key', 'device', 'license', 'other')),
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 200),
  identifier text CHECK (char_length(identifier) <= 200),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'returned')),
  assigned_on date NOT NULL DEFAULT current_date,
  due_on date,
  returned_on date,
  note text CHECK (char_length(note) <= 4000),
  created_by uuid REFERENCES public.members(id),
  updated_by uuid REFERENCES public.members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (isfinite(assigned_on) AND (due_on IS NULL OR isfinite(due_on)) AND (returned_on IS NULL OR isfinite(returned_on))),
  CHECK (due_on IS NULL OR due_on >= assigned_on),
  CHECK ((status = 'issued' AND returned_on IS NULL) OR (status = 'returned' AND returned_on IS NOT NULL AND returned_on >= assigned_on))
);

CREATE FUNCTION public.employee_reference_url_is_safe(p_url text)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_url IS NULL OR (
    char_length(p_url) <= 2000
    AND p_url ~* '^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]{1,5})?([/?#].*)?$'
    AND p_url !~ '[[:space:]<>"'']'
    AND strpos(p_url, chr(92)) = 0
  );
$$;
REVOKE ALL ON FUNCTION public.employee_reference_url_is_safe(text) FROM PUBLIC, anon, authenticated;

CREATE TABLE public.employee_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.employee_profiles(member_id),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN ('contract', 'verification', 'training')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'expired')),
  valid_from date,
  valid_until date,
  reference_url text CHECK (public.employee_reference_url_is_safe(reference_url)),
  note text CHECK (char_length(note) <= 4000),
  verified_by uuid REFERENCES public.members(id),
  verified_at timestamptz,
  created_by uuid REFERENCES public.members(id),
  updated_by uuid REFERENCES public.members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((valid_from IS NULL OR isfinite(valid_from)) AND (valid_until IS NULL OR isfinite(valid_until))),
  CHECK (valid_from IS NULL OR valid_until IS NULL OR valid_until >= valid_from),
  CHECK (status <> 'verified' OR (verified_by IS NOT NULL AND verified_at IS NOT NULL))
);

CREATE TABLE public.employee_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES public.employee_profiles(member_id),
  request_type text NOT NULL CHECK (request_type IN ('training', 'license', 'equipment')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 4000),
  estimated_cost numeric(12, 2) CHECK (estimated_cost IS NULL OR (estimated_cost >= 0 AND estimated_cost <> 'NaN'::numeric)),
  requested_for date CHECK (requested_for IS NULL OR isfinite(requested_for)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled', 'cancelled')),
  decision_note text CHECK (char_length(decision_note) <= 4000),
  decided_by uuid REFERENCES public.members(id),
  decided_at timestamptz,
  fulfilled_by uuid REFERENCES public.members(id),
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT employee_requests_member_id_members_fkey FOREIGN KEY (member_id) REFERENCES public.members(id),
  CHECK (status <> 'rejected' OR char_length(btrim(coalesce(decision_note, ''))) > 0),
  CHECK (status = 'pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL)),
  CHECK (status <> 'fulfilled' OR (fulfilled_by IS NOT NULL AND fulfilled_at IS NOT NULL))
);

CREATE TABLE public.employee_request_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.employee_requests(id),
  member_id uuid NOT NULL REFERENCES public.employee_profiles(member_id),
  -- Snapshot identifiers/names are deliberately not rewritten on later account changes.
  actor_member_id uuid NOT NULL,
  actor_name text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.employee_asset_assignments (member_id, status, assigned_on DESC);
CREATE INDEX ON public.employee_records (member_id, kind, valid_until);
CREATE INDEX ON public.employee_requests (member_id, created_at DESC);
CREATE INDEX ON public.employee_requests (status, created_at);
CREATE INDEX ON public.employee_request_events (request_id, created_at);

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['employee_profiles', 'employee_asset_assignments', 'employee_records', 'employee_requests', 'employee_request_events'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated, service_role', v_table);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated, service_role', v_table);
    EXECUTE format('CREATE POLICY employee_active_account_required ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING ((SELECT public.get_user_role()) IS NOT NULL) WITH CHECK ((SELECT public.get_user_role()) IS NOT NULL)', v_table);
    EXECUTE format('CREATE POLICY employee_admin_read ON public.%I FOR SELECT TO authenticated USING ((SELECT public.get_user_role()) = ''admin'')', v_table);
  END LOOP;
END;
$$;

CREATE POLICY employee_own_profile_read ON public.employee_profiles FOR SELECT TO authenticated
USING (member_id = (SELECT public.get_member_id()) AND employment_status = 'active');

DO $$
DECLARE v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY['employee_asset_assignments', 'employee_records', 'employee_requests', 'employee_request_events'] LOOP
    EXECUTE format('CREATE POLICY employee_own_read ON public.%I FOR SELECT TO authenticated USING (member_id = (SELECT public.get_member_id()) AND EXISTS (SELECT 1 FROM public.employee_profiles ep WHERE ep.member_id = %I.member_id AND ep.employment_status = ''active''))', v_table, v_table);
  END LOOP;
END;
$$;

CREATE FUNCTION public.employee_request_audit_transition()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := public.get_member_id(); v_actor_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN RETURN NEW; END IF;
  IF v_actor IS NULL THEN RAISE EXCEPTION 'Authenticated employee actor required' USING ERRCODE = '42501'; END IF;
  SELECT name INTO v_actor_name FROM public.members WHERE id = v_actor;
  INSERT INTO public.employee_request_events (request_id, member_id, actor_member_id, actor_name, from_status, to_status, note)
  VALUES (NEW.id, NEW.member_id, v_actor, coalesce(v_actor_name, 'Uživatel'),
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status, NEW.decision_note);
  RETURN NEW;
END;
$$;
CREATE TRIGGER employee_request_transition_audit AFTER INSERT OR UPDATE OF status ON public.employee_requests
FOR EACH ROW EXECUTE FUNCTION public.employee_request_audit_transition();

CREATE FUNCTION public.employee_request_event_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'Employee request audit events are immutable' USING ERRCODE = '42501';
END;
$$;
CREATE TRIGGER employee_request_event_no_changes BEFORE UPDATE OR DELETE ON public.employee_request_events
FOR EACH ROW EXECUTE FUNCTION public.employee_request_event_immutable();
REVOKE ALL ON FUNCTION public.employee_request_audit_transition() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.employee_request_event_immutable() FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.set_employee_profile(p_member_id uuid, p_employment_status text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := public.get_member_id(); v_row public.employee_profiles%rowtype;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.get_user_role(), '') <> 'admin' THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.employee_profiles (member_id, employment_status, note, created_by, updated_by)
  VALUES (p_member_id, p_employment_status, nullif(btrim(p_note), ''), v_actor, v_actor)
  ON CONFLICT (member_id) DO UPDATE SET employment_status = excluded.employment_status, note = excluded.note,
    updated_by = v_actor, updated_at = now()
  RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE FUNCTION public.save_employee_asset(p_member_id uuid, p_asset jsonb, p_asset_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := public.get_member_id(); v_row public.employee_asset_assignments%rowtype; v_id uuid; v_assigned_on date;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.get_user_role(), '') <> 'admin' THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE = '42501'; END IF;
  IF p_asset IS NULL OR jsonb_typeof(p_asset) <> 'object' THEN RAISE EXCEPTION 'Asset data required'; END IF;
  PERFORM 1 FROM public.employee_profiles WHERE member_id = p_member_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee profile required'; END IF;
  IF p_asset_id IS NULL THEN
    -- The create UUID is carried inside the payload; p_asset_id remains edit-only.
    -- ON CONFLICT waits for a concurrent creator before the locked replay check.
    v_id := coalesce(nullif(p_asset ->> 'id', '')::uuid, gen_random_uuid());
    v_assigned_on := coalesce(nullif(p_asset ->> 'assigned_on', '')::date, current_date);
    INSERT INTO public.employee_asset_assignments (id, member_id, asset_type, label, identifier, assigned_on, due_on, note, created_by, updated_by)
    VALUES (v_id, p_member_id, p_asset ->> 'asset_type', btrim(p_asset ->> 'label'), nullif(btrim(p_asset ->> 'identifier'), ''),
      v_assigned_on, nullif(p_asset ->> 'due_on', '')::date,
      nullif(btrim(p_asset ->> 'note'), ''), v_actor, v_actor)
    ON CONFLICT (id) DO NOTHING RETURNING * INTO v_row;
    IF NOT FOUND THEN
      SELECT * INTO v_row FROM public.employee_asset_assignments WHERE id = v_id AND member_id = p_member_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Asset identifier is unavailable'; END IF;
      IF v_row.asset_type IS DISTINCT FROM (p_asset ->> 'asset_type')
        OR v_row.label IS DISTINCT FROM btrim(p_asset ->> 'label')
        OR v_row.identifier IS DISTINCT FROM nullif(btrim(p_asset ->> 'identifier'), '')
        OR v_row.assigned_on IS DISTINCT FROM v_assigned_on
        OR v_row.due_on IS DISTINCT FROM nullif(p_asset ->> 'due_on', '')::date
        OR v_row.note IS DISTINCT FROM nullif(btrim(p_asset ->> 'note'), '')
      THEN RAISE EXCEPTION 'Asset identifier is already used with different data'; END IF;
      -- Do not reset status, return evidence or timestamps on a create replay.
    END IF;
  ELSE
    SELECT * INTO v_row FROM public.employee_asset_assignments WHERE id = p_asset_id AND member_id = p_member_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Asset assignment not found'; END IF;
    IF v_row.status <> 'issued' THEN RAISE EXCEPTION 'Returned asset assignment cannot be edited'; END IF;
    UPDATE public.employee_asset_assignments SET asset_type = p_asset ->> 'asset_type', label = btrim(p_asset ->> 'label'),
      identifier = nullif(btrim(p_asset ->> 'identifier'), ''), assigned_on = coalesce(nullif(p_asset ->> 'assigned_on', '')::date, assigned_on),
      due_on = nullif(p_asset ->> 'due_on', '')::date, note = nullif(btrim(p_asset ->> 'note'), ''), updated_by = v_actor, updated_at = now()
    WHERE id = p_asset_id RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE FUNCTION public.return_employee_asset(p_asset_id uuid, p_returned_on date DEFAULT current_date, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := public.get_member_id(); v_row public.employee_asset_assignments%rowtype;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.get_user_role(), '') <> 'admin' THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_row FROM public.employee_asset_assignments WHERE id = p_asset_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Asset assignment not found'; END IF;
  IF v_row.status <> 'issued' THEN RAISE EXCEPTION 'Asset has already been returned'; END IF;
  IF p_returned_on IS NULL OR p_returned_on < v_row.assigned_on THEN RAISE EXCEPTION 'Invalid return date'; END IF;
  UPDATE public.employee_asset_assignments SET status = 'returned', returned_on = p_returned_on,
    note = coalesce(nullif(btrim(p_note), ''), note), updated_by = v_actor, updated_at = now()
  WHERE id = p_asset_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE FUNCTION public.save_employee_record(p_member_id uuid, p_record jsonb, p_record_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid := public.get_member_id(); v_row public.employee_records%rowtype; v_status text := coalesce(p_record ->> 'status', 'pending'); v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR coalesce(public.get_user_role(), '') <> 'admin' THEN RAISE EXCEPTION 'Active administrator required' USING ERRCODE = '42501'; END IF;
  IF p_record IS NULL OR jsonb_typeof(p_record) <> 'object' THEN RAISE EXCEPTION 'Record data required'; END IF;
  PERFORM 1 FROM public.employee_profiles WHERE member_id = p_member_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee profile required'; END IF;
  IF p_record_id IS NULL THEN
    -- Same create-only UUID contract as employee assets and requests.
    v_id := coalesce(nullif(p_record ->> 'id', '')::uuid, gen_random_uuid());
    INSERT INTO public.employee_records (id, member_id, title, kind, status, valid_from, valid_until, reference_url, note, verified_by, verified_at, created_by, updated_by)
    VALUES (v_id, p_member_id, btrim(p_record ->> 'title'), p_record ->> 'kind', v_status, nullif(p_record ->> 'valid_from', '')::date,
      nullif(p_record ->> 'valid_until', '')::date, nullif(btrim(p_record ->> 'reference_url'), ''), nullif(btrim(p_record ->> 'note'), ''),
      CASE WHEN v_status = 'verified' THEN v_actor END, CASE WHEN v_status = 'verified' THEN now() END, v_actor, v_actor)
    ON CONFLICT (id) DO NOTHING RETURNING * INTO v_row;
    IF NOT FOUND THEN
      SELECT * INTO v_row FROM public.employee_records WHERE id = v_id AND member_id = p_member_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Record identifier is unavailable'; END IF;
      IF v_row.title IS DISTINCT FROM btrim(p_record ->> 'title')
        OR v_row.kind IS DISTINCT FROM (p_record ->> 'kind') OR v_row.status IS DISTINCT FROM v_status
        OR v_row.valid_from IS DISTINCT FROM nullif(p_record ->> 'valid_from', '')::date
        OR v_row.valid_until IS DISTINCT FROM nullif(p_record ->> 'valid_until', '')::date
        OR v_row.reference_url IS DISTINCT FROM nullif(btrim(p_record ->> 'reference_url'), '')
        OR v_row.note IS DISTINCT FROM nullif(btrim(p_record ->> 'note'), '')
      THEN RAISE EXCEPTION 'Record identifier is already used with different data'; END IF;
      -- A retry does not renew verification or replace its original actor/time.
    END IF;
  ELSE
    SELECT * INTO v_row FROM public.employee_records WHERE id = p_record_id AND member_id = p_member_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Employee record not found'; END IF;
    UPDATE public.employee_records SET title = btrim(p_record ->> 'title'), kind = p_record ->> 'kind', status = v_status,
      valid_from = nullif(p_record ->> 'valid_from', '')::date, valid_until = nullif(p_record ->> 'valid_until', '')::date,
      reference_url = nullif(btrim(p_record ->> 'reference_url'), ''), note = nullif(btrim(p_record ->> 'note'), ''),
      verified_by = CASE WHEN v_status = 'verified' THEN v_actor WHEN v_status = 'expired' THEN verified_by ELSE NULL END,
      verified_at = CASE WHEN v_status = 'verified' THEN now() WHEN v_status = 'expired' THEN verified_at ELSE NULL END,
      updated_by = v_actor, updated_at = now()
    WHERE id = p_record_id RETURNING * INTO v_row;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE FUNCTION public.create_employee_request(p_request jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := public.get_member_id();
  v_row public.employee_requests%rowtype;
  v_id uuid := coalesce(nullif(p_request ->> 'id', '')::uuid, gen_random_uuid());
  v_cost numeric(12, 2) := nullif(p_request ->> 'estimated_cost', '')::numeric;
  v_date date := nullif(p_request ->> 'requested_for', '')::date;
BEGIN
  IF auth.uid() IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'Active employee account required' USING ERRCODE = '42501'; END IF;
  IF p_request IS NULL OR jsonb_typeof(p_request) <> 'object' THEN RAISE EXCEPTION 'Request data required'; END IF;
  PERFORM 1 FROM public.employee_profiles WHERE member_id = v_actor AND employment_status = 'active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Active employee profile required' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.employee_requests (id, member_id, request_type, title, description, estimated_cost, requested_for)
  VALUES (v_id, v_actor, p_request ->> 'request_type', btrim(p_request ->> 'title'), btrim(p_request ->> 'description'), v_cost, v_date)
  ON CONFLICT (id) DO NOTHING RETURNING * INTO v_row;
  IF NOT FOUND THEN
    SELECT * INTO v_row FROM public.employee_requests WHERE id = v_id AND member_id = v_actor FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Request identifier is unavailable'; END IF;
    IF v_row.request_type IS DISTINCT FROM (p_request ->> 'request_type')
      OR v_row.title IS DISTINCT FROM btrim(p_request ->> 'title')
      OR v_row.description IS DISTINCT FROM btrim(p_request ->> 'description')
      OR v_row.estimated_cost IS DISTINCT FROM v_cost OR v_row.requested_for IS DISTINCT FROM v_date
    THEN RAISE EXCEPTION 'Request identifier is already used with different data'; END IF;
  END IF;
  RETURN to_jsonb(v_row);
END;
$$;

CREATE FUNCTION public.transition_employee_request(p_request_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := public.get_member_id();
  v_admin boolean := coalesce(public.get_user_role() = 'admin', false);
  v_row public.employee_requests%rowtype;
  v_note text := nullif(btrim(p_note), '');
BEGIN
  IF auth.uid() IS NULL OR v_actor IS NULL THEN RAISE EXCEPTION 'Active account required' USING ERRCODE = '42501'; END IF;
  IF p_status = 'cancelled' THEN
    PERFORM 1 FROM public.employee_profiles WHERE member_id = v_actor AND employment_status = 'active' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Active employee profile required' USING ERRCODE = '42501'; END IF;
  ELSIF NOT v_admin THEN
    RAISE EXCEPTION 'Active administrator required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.employee_requests
  WHERE id = p_request_id AND (v_admin OR member_id = v_actor) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee request not found' USING ERRCODE = '42501'; END IF;
  IF p_status = 'cancelled' THEN
    IF v_row.member_id <> v_actor OR v_row.status <> 'pending' THEN RAISE EXCEPTION 'Only an own pending request can be cancelled' USING ERRCODE = '42501'; END IF;
  ELSIF NOT ((v_row.status = 'pending' AND p_status IN ('approved', 'rejected')) OR (v_row.status = 'approved' AND p_status = 'fulfilled')) THEN
    RAISE EXCEPTION 'Request status changed or transition is not allowed';
  END IF;
  IF p_status IS NULL OR p_status NOT IN ('approved', 'rejected', 'fulfilled', 'cancelled') THEN RAISE EXCEPTION 'Invalid request status'; END IF;
  IF p_status = 'rejected' AND v_note IS NULL THEN RAISE EXCEPTION 'Rejection reason is required'; END IF;
  UPDATE public.employee_requests SET status = p_status,
    decision_note = CASE WHEN p_status = 'fulfilled' THEN coalesce(v_note, decision_note) ELSE v_note END,
    decided_by = CASE WHEN p_status = 'fulfilled' THEN decided_by ELSE v_actor END,
    decided_at = CASE WHEN p_status = 'fulfilled' THEN decided_at ELSE now() END,
    fulfilled_by = CASE WHEN p_status = 'fulfilled' THEN v_actor ELSE NULL END,
    fulfilled_at = CASE WHEN p_status = 'fulfilled' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = p_request_id RETURNING * INTO v_row;
  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.set_employee_profile(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_employee_asset(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.return_employee_asset(uuid, date, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_employee_record(uuid, jsonb, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_employee_request(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.transition_employee_request(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_employee_profile(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_employee_asset(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.return_employee_asset(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_employee_record(uuid, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_employee_request(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_employee_request(uuid, text, text) TO authenticated;

COMMENT ON TABLE public.employee_records IS 'Private metadata for employee contracts, verification and training. No public files or license secrets.';
COMMENT ON TABLE public.employee_request_events IS 'Immutable request transition history, created only by the database audit trigger.';
NOTIFY pgrst, 'reload schema';
COMMIT;
