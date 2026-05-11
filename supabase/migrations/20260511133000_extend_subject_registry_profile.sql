alter table if exists public.subjects
  add column if not exists vat_payer boolean,
  add column if not exists vat_status text not null default 'unknown',
  add column if not exists vat_checked_at timestamptz,
  add column if not exists company_summary text,
  add column if not exists registry_checked_at timestamptz,
  add column if not exists registry_source text,
  add column if not exists registry_snapshot jsonb;

alter table if exists public.subjects
  drop constraint if exists subjects_vat_status_check;

alter table if exists public.subjects
  add constraint subjects_vat_status_check
  check (vat_status in ('unknown', 'payer', 'non_payer', 'identified_person'));

create index if not exists subjects_vat_status_idx
  on public.subjects(vat_status);
