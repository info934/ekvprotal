-- Product supplier matching suggestions for cross-shop price comparison.

create extension if not exists pg_trgm with schema extensions;

create table if not exists public.product_supplier_match_suggestions (
  id uuid primary key default gen_random_uuid(),
  source_offer_id uuid not null references public.product_supplier_offers(id) on delete cascade,
  target_offer_id uuid not null references public.product_supplier_offers(id) on delete cascade,
  source_catalog_item_id uuid not null references public.commercial_item_catalog(id) on delete cascade,
  target_catalog_item_id uuid not null references public.commercial_item_catalog(id) on delete cascade,
  confidence numeric(5, 4) not null default 0,
  match_method text not null default 'heuristic_ai',
  status text not null default 'pending',
  reasons jsonb not null default '{}'::jsonb,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint product_supplier_match_suggestions_status_check check (status in ('pending', 'approved', 'rejected', 'ignored')),
  constraint product_supplier_match_suggestions_not_same_offer check (source_offer_id <> target_offer_id),
  constraint product_supplier_match_suggestions_not_same_catalog check (source_catalog_item_id <> target_catalog_item_id)
);

create unique index if not exists idx_product_supplier_match_suggestions_pair
  on public.product_supplier_match_suggestions (source_offer_id, target_offer_id);

create index if not exists idx_product_supplier_match_suggestions_status_confidence
  on public.product_supplier_match_suggestions (status, confidence desc, created_at desc);

create or replace function public.normalize_product_match_text(p_value text)
returns text
language sql
immutable
set search_path = public
as $$
  select trim(regexp_replace(
    regexp_replace(
      lower(coalesce(p_value, '')),
      '[^a-z0-9áčďéěíňóřšťúůýžäöüß]+',
      ' ',
      'g'
    ),
    '\s+',
    ' ',
    'g'
  ));
$$;

create or replace function public.product_match_model_tokens(p_value text)
returns text[]
language sql
immutable
set search_path = public
as $$
  select coalesce(array_agg(distinct token order by token), '{}'::text[])
  from (
    select match[1] as token
    from regexp_matches(lower(coalesce(p_value, '')), '[a-z0-9][a-z0-9.+_-]{2,}', 'g') as match
    where match[1] ~ '[0-9]'
      and length(match[1]) >= 4
      and match[1] not in ('2024', '2025', '2026', '1000', '1500')
  ) tokens;
$$;

create or replace function public.product_match_token_overlap(p_left text[], p_right text[])
returns numeric
language sql
immutable
set search_path = public
as $$
  with left_tokens as (
    select distinct unnest(coalesce(p_left, '{}'::text[])) as token
  ),
  right_tokens as (
    select distinct unnest(coalesce(p_right, '{}'::text[])) as token
  ),
  counts as (
    select
      (select count(*) from left_tokens join right_tokens using (token))::numeric as shared_count,
      greatest((select count(*) from left_tokens), (select count(*) from right_tokens), 1)::numeric as max_count
  )
  select shared_count / max_count from counts;
$$;

create or replace function public.generate_product_supplier_match_suggestions(
  p_min_confidence numeric default 0.72,
  p_limit integer default 250
)
returns table (
  inserted_count integer,
  candidate_count integer
)
language plpgsql
set search_path = public, extensions
as $$
declare
  v_candidate_count integer := 0;
  v_inserted_count integer := 0;
begin
  with offer_source as (
    select
      offer.id as offer_id,
      offer.catalog_item_id,
      offer.supplier_product_name,
      offer.supplier_sku,
      offer.supplier_category,
      offer.last_price_without_vat,
      supplier.slug as supplier_slug,
      supplier.name as supplier_name,
      catalog.name as catalog_name,
      catalog.code as catalog_code,
      catalog.sku as catalog_sku,
      catalog.category as catalog_category,
      public.normalize_product_match_text(coalesce(offer.supplier_product_name, catalog.name)) as normalized_name,
      public.product_match_model_tokens(concat_ws(' ', offer.supplier_product_name, catalog.name, catalog.code, catalog.sku)) as model_tokens
    from public.product_supplier_offers offer
    join public.product_suppliers supplier on supplier.id = offer.supplier_id
    join public.commercial_item_catalog catalog on catalog.id = offer.catalog_item_id
    where offer.is_active = true
      and supplier.is_active = true
  ),
  scored as (
    select
      source.offer_id as source_offer_id,
      target.offer_id as target_offer_id,
      source.catalog_item_id as source_catalog_item_id,
      target.catalog_item_id as target_catalog_item_id,
      similarity(source.normalized_name, target.normalized_name) as name_similarity,
      public.product_match_token_overlap(source.model_tokens, target.model_tokens) as token_overlap,
      case
        when coalesce(source.supplier_category, source.catalog_category, '') <> ''
         and lower(coalesce(source.supplier_category, source.catalog_category, '')) = lower(coalesce(target.supplier_category, target.catalog_category, ''))
        then 1::numeric else 0::numeric
      end as category_match,
      case
        when source.last_price_without_vat is null or target.last_price_without_vat is null then 0.35::numeric
        when greatest(source.last_price_without_vat, target.last_price_without_vat) = 0 then 0.35::numeric
        else greatest(
          0::numeric,
          1 - (abs(source.last_price_without_vat - target.last_price_without_vat) / greatest(source.last_price_without_vat, target.last_price_without_vat))
        )
      end as price_similarity,
      source.supplier_name as source_supplier_name,
      target.supplier_name as target_supplier_name,
      source.supplier_product_name as source_name,
      target.supplier_product_name as target_name,
      source.supplier_sku as source_sku,
      target.supplier_sku as target_sku,
      source.last_price_without_vat as source_price,
      target.last_price_without_vat as target_price,
      source.model_tokens as source_tokens,
      target.model_tokens as target_tokens
    from offer_source source
    join offer_source target
      on source.supplier_slug <> target.supplier_slug
     and source.catalog_item_id <> target.catalog_item_id
     and source.offer_id < target.offer_id
     and (
       source.normalized_name % target.normalized_name
       or public.product_match_token_overlap(source.model_tokens, target.model_tokens) >= 0.5
     )
  ),
  ranked as (
    select
      scored.*,
      least(
        0.99::numeric,
        round((
          scored.name_similarity * 0.52
          + scored.token_overlap * 0.25
          + scored.category_match * 0.10
          + scored.price_similarity * 0.13
        )::numeric, 4)
      ) as confidence
    from scored
  ),
  candidates as (
    select *
    from ranked
    where confidence >= p_min_confidence
    order by confidence desc, name_similarity desc
    limit greatest(p_limit, 1)
  ),
  counted as (
    select count(*)::integer as total from candidates
  ),
  inserted as (
    insert into public.product_supplier_match_suggestions (
      source_offer_id,
      target_offer_id,
      source_catalog_item_id,
      target_catalog_item_id,
      confidence,
      match_method,
      reasons
    )
    select
      source_offer_id,
      target_offer_id,
      source_catalog_item_id,
      target_catalog_item_id,
      confidence,
      'heuristic_ai',
      jsonb_build_object(
        'name_similarity', name_similarity,
        'token_overlap', token_overlap,
        'category_match', category_match,
        'price_similarity', price_similarity,
        'source_supplier', source_supplier_name,
        'target_supplier', target_supplier_name,
        'source_name', source_name,
        'target_name', target_name,
        'source_sku', source_sku,
        'target_sku', target_sku,
        'source_price', source_price,
        'target_price', target_price,
        'source_tokens', source_tokens,
        'target_tokens', target_tokens
      )
    from candidates
    on conflict (source_offer_id, target_offer_id) do update
    set confidence = excluded.confidence,
        reasons = excluded.reasons,
        status = case
          when public.product_supplier_match_suggestions.status = 'pending' then 'pending'
          else public.product_supplier_match_suggestions.status
        end,
        updated_at = now()
    where public.product_supplier_match_suggestions.status = 'pending'
    returning id
  )
  select counted.total, count(inserted.id)::integer
  into v_candidate_count, v_inserted_count
  from counted
  left join inserted on true
  group by counted.total;

  return query select coalesce(v_inserted_count, 0), coalesce(v_candidate_count, 0);
end;
$$;

create or replace function public.review_product_supplier_match(
  p_suggestion_id uuid,
  p_status text
)
returns public.product_supplier_match_suggestions
language plpgsql
set search_path = public
as $$
declare
  suggestion public.product_supplier_match_suggestions;
  canonical_catalog_id uuid;
  moved_catalog_id uuid;
begin
  if p_status not in ('approved', 'rejected', 'ignored') then
    raise exception 'Unsupported match status: %', p_status;
  end if;

  select *
  into suggestion
  from public.product_supplier_match_suggestions
  where id = p_suggestion_id
  for update;

  if suggestion.id is null then
    raise exception 'Product supplier match suggestion not found';
  end if;

  if suggestion.status <> 'pending' then
    return suggestion;
  end if;

  if p_status = 'approved' then
    select target_catalog_item_id, source_catalog_item_id
    into canonical_catalog_id, moved_catalog_id
    from public.product_supplier_match_suggestions
    where id = p_suggestion_id;

    update public.product_supplier_offers
    set catalog_item_id = canonical_catalog_id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'matched_catalog_item_id', canonical_catalog_id,
          'matched_from_catalog_item_id', moved_catalog_id,
          'matched_by_suggestion_id', p_suggestion_id,
          'matched_at', now()
        )
    where id = suggestion.source_offer_id;

    update public.product_supplier_match_suggestions
    set status = 'ignored',
        reviewed_by = auth.uid(),
        reviewed_at = now(),
        updated_at = now(),
        reasons = coalesce(reasons, '{}'::jsonb) || jsonb_build_object('auto_ignored_reason', 'catalog_item_relinked')
    where status = 'pending'
      and id <> p_suggestion_id
      and (
        source_offer_id = suggestion.source_offer_id
        or source_catalog_item_id = moved_catalog_id
      );

    perform public.refresh_product_preferred_supplier(canonical_catalog_id);
    perform public.refresh_product_preferred_supplier(moved_catalog_id);
  end if;

  update public.product_supplier_match_suggestions
  set status = p_status,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  where id = p_suggestion_id
  returning * into suggestion;

  return suggestion;
end;
$$;

alter table public.product_supplier_match_suggestions enable row level security;

drop policy if exists "Product supplier match suggestions read access" on public.product_supplier_match_suggestions;
create policy "Product supplier match suggestions read access"
on public.product_supplier_match_suggestions
for select
to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module in ('crm', 'realizace', 'projects', 'settings')
      and role_permissions.can_read = true
  )
);

drop policy if exists "Product supplier match suggestions admin access" on public.product_supplier_match_suggestions;
create policy "Product supplier match suggestions admin access"
on public.product_supplier_match_suggestions
for all
to authenticated
using (
  get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module = 'settings'
      and role_permissions.can_admin = true
  )
)
with check (
  get_user_role() = 'admin'
  or exists (
    select 1
    from public.role_permissions
    where role_permissions.role = get_user_role()
      and role_permissions.module = 'settings'
      and role_permissions.can_admin = true
  )
);

drop view if exists public.product_supplier_match_suggestion_details;
create view public.product_supplier_match_suggestion_details with (security_invoker = true) as
select
  suggestion.id,
  suggestion.source_offer_id,
  suggestion.target_offer_id,
  suggestion.source_catalog_item_id,
  suggestion.target_catalog_item_id,
  suggestion.confidence,
  suggestion.match_method,
  suggestion.status,
  suggestion.reasons,
  suggestion.reviewed_by,
  suggestion.reviewed_at,
  suggestion.created_at,
  source_supplier.name as source_supplier_name,
  source_supplier.slug as source_supplier_slug,
  source_offer.supplier_sku as source_supplier_sku,
  source_offer.supplier_product_name as source_product_name,
  source_offer.supplier_product_url as source_product_url,
  source_offer.last_price_without_vat as source_price_without_vat,
  source_offer.currency as source_currency,
  source_catalog.code as source_catalog_code,
  source_catalog.name as source_catalog_name,
  source_catalog.category as source_category,
  target_supplier.name as target_supplier_name,
  target_supplier.slug as target_supplier_slug,
  target_offer.supplier_sku as target_supplier_sku,
  target_offer.supplier_product_name as target_product_name,
  target_offer.supplier_product_url as target_product_url,
  target_offer.last_price_without_vat as target_price_without_vat,
  target_offer.currency as target_currency,
  target_catalog.code as target_catalog_code,
  target_catalog.name as target_catalog_name,
  target_catalog.category as target_category
from public.product_supplier_match_suggestions suggestion
join public.product_supplier_offers source_offer on source_offer.id = suggestion.source_offer_id
join public.product_suppliers source_supplier on source_supplier.id = source_offer.supplier_id
join public.commercial_item_catalog source_catalog on source_catalog.id = suggestion.source_catalog_item_id
join public.product_supplier_offers target_offer on target_offer.id = suggestion.target_offer_id
join public.product_suppliers target_supplier on target_supplier.id = target_offer.supplier_id
join public.commercial_item_catalog target_catalog on target_catalog.id = suggestion.target_catalog_item_id;

grant select on public.product_supplier_match_suggestions to authenticated;
grant select on public.product_supplier_match_suggestion_details to authenticated;
grant all on public.product_supplier_match_suggestions to service_role;
grant execute on function public.generate_product_supplier_match_suggestions(numeric, integer) to authenticated;
grant execute on function public.review_product_supplier_match(uuid, text) to authenticated;
