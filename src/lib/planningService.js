import { supabase } from '@/lib/customSupabaseClient';

const throwIfError = (result) => {
  if (result.error) throw result.error;
  return result.data;
};

export const listPlanningPlans = async (entityType = null) => {
  const params = entityType ? { p_entity_type: entityType } : {};
  return throwIfError(await supabase.rpc('list_planning_plans_safe', params));
};

export const ensurePlanningPlan = async (entityType, entityId) => {
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
  const [itemsResult, dependenciesResult, travelResult, accommodationResult, membersResult] = await Promise.all([
    supabase
      .from('planning_items')
      .select('*, member:members(id, name, email, microsoft_calendar_email, microsoft_calendar_enabled), calendar_link:planning_calendar_links(id, sync_status, mailbox_address, external_event_id, web_link, last_synced_at, last_error)')
      .eq('plan_id', planId)
      .order('sort_order')
      .order('start_date'),
    supabase
      .from('planning_dependencies')
      .select('*')
      .eq('plan_id', planId),
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
    supabase
      .from('members')
      .select('id, name, email, microsoft_calendar_email, microsoft_calendar_enabled')
      .order('name'),
  ]);

  return {
    items: throwIfError(itemsResult) || [],
    dependencies: throwIfError(dependenciesResult) || [],
    travel: throwIfError(travelResult) || [],
    accommodations: throwIfError(accommodationResult) || [],
    members: throwIfError(membersResult) || [],
  };
};

export const savePlanningItem = async (planId, item) => {
  const payload = {
    plan_id: planId,
    parent_id: item.parent_id || null,
    item_type: item.item_type || 'task',
    name: item.name.trim(),
    description: item.description?.trim() || null,
    start_date: item.start_date,
    end_date: item.item_type === 'milestone' ? item.start_date : item.end_date,
    progress: Math.max(0, Math.min(1, Number(item.progress) || 0)),
    status: item.status || 'planned',
    member_id: item.member_id || null,
    calendar_sync_enabled: item.item_type !== 'phase' && Boolean(item.member_id) && Boolean(item.calendar_sync_enabled),
    sort_order: Number(item.sort_order) || 0,
  };

  if (item.id) {
    return throwIfError(await supabase
      .from('planning_items')
      .update(payload)
      .eq('id', item.id)
      .select('*, member:members(id, name, email, microsoft_calendar_email, microsoft_calendar_enabled), calendar_link:planning_calendar_links(id, sync_status, mailbox_address, external_event_id, web_link, last_synced_at, last_error)')
      .single());
  }

  return throwIfError(await supabase
    .from('planning_items')
    .insert(payload)
    .select('*, member:members(id, name, email, microsoft_calendar_email, microsoft_calendar_enabled), calendar_link:planning_calendar_links(id, sync_status, mailbox_address, external_event_id, web_link, last_synced_at, last_error)')
    .single());
};

export const updatePlanningItemDates = async (id, values) => throwIfError(await supabase
  .from('planning_items')
  .update(values)
  .eq('id', id)
  .select('*, member:members(id, name, email, microsoft_calendar_email, microsoft_calendar_enabled), calendar_link:planning_calendar_links(id, sync_status, mailbox_address, external_event_id, web_link, last_synced_at, last_error)')
  .single());

const invokePlanningCalendar = async (action, itemId) => {
  const { data, error } = await supabase.functions.invoke('planning-calendar', {
    body: { action, itemId },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Microsoft calendar operation failed.');
  return data;
};

export const syncPlanningItemCalendar = async (itemId) => invokePlanningCalendar('syncItem', itemId);

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
  const payload = {
    plan_id: planId,
    item_id: segment.item_id || null,
    travel_date: segment.travel_date,
    origin_label: segment.origin_label.trim(),
    destination_label: segment.destination_label.trim(),
    travel_mode: segment.travel_mode || 'car',
    route_provider: 'manual',
    distance_m: segment.distance_km ? Math.round(Number(segment.distance_km) * 1000) : null,
    duration_minutes: segment.duration_minutes ? Number(segment.duration_minutes) : null,
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
  return throwIfError(await query.select().single());
};

export const deleteAccommodation = async (id) => throwIfError(await supabase
  .from('planning_accommodations')
  .delete()
  .eq('id', id));
