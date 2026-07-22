import { supabase } from '@/lib/customSupabaseClient';
import { invokeWithTimeout } from '@/lib/requestControl';

const throwIfError = (result) => {
  if (result.error) throw result.error;
  return result.data;
};

const toIsoDateTime = (value) => value ? new Date(value).toISOString() : null;
const toDateOnly = (value, fallback = null) => value ? String(value).slice(0, 10) : fallback;

export const listPlanningPlans = async (entityType = null) => {
  const params = entityType ? { p_entity_type: entityType } : {};
  return throwIfError(await supabase.rpc('list_planning_plans_safe', params));
};

export const ensurePlanningPlan = async (entityType, entityId, { createIfMissing = true } = {}) => {
  const existingPlans = await listPlanningPlans(entityType);
  const existing = existingPlans.find((plan) => plan.entity_id === entityId);
  if (existing || !createIfMissing) return existing || null;

  const planId = throwIfError(await supabase.rpc('ensure_planning_plan', {
    p_entity_type: entityType,
    p_entity_id: entityId,
  }));

  const plans = await listPlanningPlans(entityType);
  return plans.find((plan) => plan.plan_id === planId) || {
    plan_id: planId,
    entity_type: entityType,
    entity_id: entityId,
  };
};

export const loadPlanningData = async (planId) => {
  const itemsResult = await supabase
    .from('planning_items')
    .select('*, calendar_link:planning_calendar_links(id, sync_status, mailbox_address, external_event_id, web_link, last_synced_at, last_error)')
    .eq('plan_id', planId)
    .order('sort_order')
    .order('start_at');
  const rawItems = throwIfError(itemsResult) || [];
  const itemIds = rawItems.map(({ id }) => id);

  const [
    dependenciesResult,
    assignmentsResult,
    subcontractorAssignmentsResult,
    travelResult,
    accommodationResult,
    membersResult,
    subcontractorsResult,
  ] = await Promise.all([
    supabase
      .from('planning_dependencies')
      .select('*')
      .eq('plan_id', planId),
    itemIds.length ? supabase
      .from('planning_assignments')
      .select('*')
      .in('item_id', itemIds) : Promise.resolve({ data: [], error: null }),
    itemIds.length ? supabase
      .from('planning_subcontractor_assignments')
      .select('*')
      .in('item_id', itemIds) : Promise.resolve({ data: [], error: null }),
    supabase
      .from('planning_travel_segments')
      .select('*')
      .eq('plan_id', planId)
      .order('travel_date'),
    supabase
      .from('planning_accommodations')
      .select('*, guests:planning_accommodation_guests(member_id)')
      .eq('plan_id', planId)
      .order('check_in'),
    supabase.rpc('list_planning_members_safe', { p_plan_id: planId }),
    supabase.rpc('list_planning_subcontractors_safe', { p_plan_id: planId }),
  ]);

  const members = throwIfError(membersResult) || [];
  const subcontractors = throwIfError(subcontractorsResult) || [];
  const membersById = new Map(members.map((member) => [member.id, member]));
  const subcontractorsById = new Map(subcontractors.map((subcontractor) => [subcontractor.id, subcontractor]));
  const assignmentsByItem = new Map();
  for (const assignment of throwIfError(assignmentsResult) || []) {
    const current = assignmentsByItem.get(assignment.item_id) || [];
    current.push({ ...assignment, member: membersById.get(assignment.member_id) || null });
    assignmentsByItem.set(assignment.item_id, current);
  }
  const subcontractorAssignmentsByItem = new Map();
  for (const assignment of throwIfError(subcontractorAssignmentsResult) || []) {
    const current = subcontractorAssignmentsByItem.get(assignment.item_id) || [];
    current.push({
      ...assignment,
      subcontractor: subcontractorsById.get(assignment.project_subcontractor_id) || null,
    });
    subcontractorAssignmentsByItem.set(assignment.item_id, current);
  }
  const items = rawItems.map((item) => ({
    ...item,
    member: item.member_id ? membersById.get(item.member_id) || null : null,
    assignments: assignmentsByItem.get(item.id) || [],
    subcontractor_assignments: subcontractorAssignmentsByItem.get(item.id) || [],
  }));

  const accommodations = (throwIfError(accommodationResult) || []).map((accommodation) => ({
    ...accommodation,
    guest_ids: (accommodation.guests || []).map(({ member_id }) => member_id),
    guest_members: (accommodation.guests || []).map(({ member_id }) => membersById.get(member_id)).filter(Boolean),
  }));

  return {
    items,
    dependencies: throwIfError(dependenciesResult) || [],
    travel: throwIfError(travelResult) || [],
    accommodations,
    members,
    subcontractors,
  };
};

export const savePlanningItem = async (planId, item) => {
  const startAt = item.start_at || `${item.start_date}T08:00`;
  const endAt = item.item_type === 'milestone' ? startAt : (item.end_at || `${item.end_date}T17:00`);
  const payload = {
    parent_id: item.parent_id || null,
    item_type: item.item_type || 'task',
    name: item.name.trim(),
    description: item.description?.trim() || null,
    start_at: startAt,
    end_at: endAt,
    progress: Math.max(0, Math.min(1, Number(item.progress) || 0)),
    status: item.status || 'planned',
    member_id: item.member_id || null,
    calendar_sync_enabled: item.item_type !== 'phase' && Boolean(item.calendar_sync_enabled),
    sort_order: Number(item.sort_order) || 0,
  };

  const savedId = throwIfError(await supabase.rpc('save_planning_item_with_resources', {
    p_plan_id: planId,
    p_item_id: item.id || null,
    p_item: payload,
    p_member_assignments: item.assignments || [],
    p_subcontractor_assignments: item.subcontractor_assignments || [],
  }));
  return throwIfError(await supabase
    .from('planning_items')
    .select('*, calendar_link:planning_calendar_links(id, sync_status, mailbox_address, external_event_id, web_link, last_synced_at, last_error)')
    .eq('id', savedId)
    .single());
};

export const updatePlanningItemDates = async (id, values) => {
  const payload = { ...values };
  if (values.start_at) {
    payload.start_at = toIsoDateTime(values.start_at);
    payload.start_date = toDateOnly(values.start_at);
  }
  if (values.end_at) {
    payload.end_at = toIsoDateTime(values.end_at);
    payload.end_date = toDateOnly(values.end_at);
  }
  return throwIfError(await supabase
    .from('planning_items')
    .update(payload)
    .eq('id', id)
    .select('*, calendar_link:planning_calendar_links(id, sync_status, mailbox_address, external_event_id, web_link, last_synced_at, last_error)')
    .single());
};

const invokePlanningCalendar = async (action, itemId) => {
  const { data, error } = await invokeWithTimeout(supabase, 'planning-calendar', {
    body: { action, itemId },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Microsoft calendar operation failed.');
  return data;
};

export const syncPlanningItemCalendar = async (itemId) => invokePlanningCalendar('syncItem', itemId);

export const syncPlanningPlanCalendar = async (items) => {
  const enabledItems = (items || []).filter((item) => item.calendar_sync_enabled && item.item_type !== 'phase');
  const results = [];
  for (const item of enabledItems) {
    try {
      results.push({ itemId: item.id, success: true, result: await syncPlanningItemCalendar(item.id) });
    } catch (error) {
      results.push({ itemId: item.id, success: false, error });
    }
  }
  return results;
};

export const checkPlanningItemAvailability = async (itemId) => invokePlanningCalendar('checkAvailability', itemId);

export const deletePlanningItem = async (id) => throwIfError(await supabase
  .from('planning_items')
  .delete()
  .eq('id', id));

export const savePlanningDependency = async (planId, dependency) => throwIfError(await supabase
  .from('planning_dependencies')
  .insert({
    plan_id: planId,
    predecessor_id: dependency.predecessor_id,
    successor_id: dependency.successor_id,
    dependency_type: dependency.dependency_type || 'fs',
    lag_days: Number(dependency.lag_days) || 0,
  })
  .select()
  .single());

export const deletePlanningDependency = async (id) => throwIfError(await supabase
  .from('planning_dependencies')
  .delete()
  .eq('id', id));

export const saveTravelSegment = async (planId, segment) => {
  const departureAt = toIsoDateTime(segment.departure_at);
  const arrivalAt = toIsoDateTime(segment.arrival_at);
  const computedDuration = departureAt && arrivalAt
    ? Math.max(0, Math.round((new Date(arrivalAt) - new Date(departureAt)) / 60000))
    : null;
  const payload = {
    plan_id: planId,
    item_id: segment.item_id || null,
    travel_date: toDateOnly(segment.departure_at, segment.travel_date),
    origin_label: segment.origin_label.trim(),
    destination_label: segment.destination_label.trim(),
    travel_mode: segment.travel_mode || 'car',
    route_provider: 'manual',
    distance_m: segment.distance_km ? Math.round(Number(segment.distance_km) * 1000) : null,
    duration_minutes: segment.duration_minutes ? Number(segment.duration_minutes) : computedDuration,
    departure_at: departureAt,
    arrival_at: arrivalAt,
    overnight_recommended: Boolean(segment.overnight_recommended),
    overnight_required: Boolean(segment.overnight_required),
    status: segment.status || 'planned',
    notes: segment.notes?.trim() || null,
  };

  const query = segment.id
    ? supabase.from('planning_travel_segments').update(payload).eq('id', segment.id)
    : supabase.from('planning_travel_segments').insert(payload);
  return throwIfError(await query.select().single());
};

export const deleteTravelSegment = async (id) => throwIfError(await supabase
  .from('planning_travel_segments')
  .delete()
  .eq('id', id));

export const saveAccommodation = async (planId, accommodation) => {
  const payload = {
    plan_id: planId,
    item_id: accommodation.item_id || null,
    hotel_name: accommodation.hotel_name.trim(),
    address: accommodation.address?.trim() || null,
    check_in: accommodation.check_in,
    check_out: accommodation.check_out,
    status: accommodation.status || 'proposal',
    booking_reference: accommodation.booking_reference?.trim() || null,
    notes: accommodation.notes?.trim() || null,
  };

  const query = accommodation.id
    ? supabase.from('planning_accommodations').update(payload).eq('id', accommodation.id)
    : supabase.from('planning_accommodations').insert(payload);
  const saved = throwIfError(await query.select().single());
  throwIfError(await supabase.rpc('replace_planning_accommodation_guests', {
    p_accommodation_id: saved.id,
    p_member_ids: accommodation.guest_ids || [],
  }));
  return saved;
};

export const deleteAccommodation = async (id) => throwIfError(await supabase
  .from('planning_accommodations')
  .delete()
  .eq('id', id));
