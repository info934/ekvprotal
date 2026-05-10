alter table if exists public.order_templates
  add column if not exists is_active boolean not null default true;

create index if not exists idx_order_templates_is_active
  on public.order_templates (is_active);
