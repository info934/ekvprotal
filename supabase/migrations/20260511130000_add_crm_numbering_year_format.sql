alter table if exists public.crm_numbering_settings
  add column if not exists year_format text not null default 'YY';

alter table if exists public.crm_numbering_settings
  drop constraint if exists crm_numbering_settings_year_format_check;

alter table if exists public.crm_numbering_settings
  add constraint crm_numbering_settings_year_format_check
  check (year_format in ('YY', 'YYYY', 'NONE'));

update public.crm_numbering_settings
set year_format = 'YY'
where year_format is null;
