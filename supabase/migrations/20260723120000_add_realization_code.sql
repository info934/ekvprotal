-- Stores the originating opportunity reference on a realization.
-- Existing records remain untouched; the unique index only applies to populated codes.
alter table public.realizations
  add column if not exists code text;

create unique index if not exists realizations_code_unique_ci
  on public.realizations (lower(btrim(code)))
  where code is not null and btrim(code) <> '';

comment on column public.realizations.code is
  'Business reference for a realization, for example OP-26-119. Imported codes are immutable source identifiers.';
