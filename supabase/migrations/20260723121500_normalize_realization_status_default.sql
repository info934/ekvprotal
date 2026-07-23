-- Keep direct database inserts aligned with the status labels accepted by the portal workflow.
alter table public.realizations
  alter column status set default 'Připravuje se';
