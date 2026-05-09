alter table public.subjects
  alter column ico drop not null;

alter table public.subjects
  add column if not exists subject_kind text not null default 'company',
  add column if not exists birth_date date;

alter table public.subjects
  drop constraint if exists subjects_subject_kind_check;

alter table public.subjects
  add constraint subjects_subject_kind_check
  check (subject_kind in ('person', 'entrepreneur', 'company'));

create index if not exists subjects_subject_kind_idx on public.subjects(subject_kind);
