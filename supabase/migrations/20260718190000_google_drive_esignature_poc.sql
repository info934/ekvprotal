-- Google Drive eSignature proof of concept.
-- Google does not expose a public API for placing/sending eSignature fields,
-- therefore EKVPortal prepares an immutable PDF and tracks the manual Drive flow.

create table if not exists public.google_drive_oauth_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  state_hash text not null unique,
  redirect_after text,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.google_drive_oauth_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  google_email text,
  encrypted_access_token text not null,
  encrypted_refresh_token text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  status text not null default 'active' check (status in ('active', 'expired', 'revoked', 'error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_signature_requests (
  id uuid primary key default gen_random_uuid(),
  protocol_id uuid references public.handover_protocols(id) on delete cascade,
  commercial_document_id uuid references public.crm_commercial_documents(id) on delete cascade,
  provider text not null default 'google_drive' check (provider in ('google_drive', 'internal', 'external')),
  status text not null default 'prepared' check (status in ('prepared', 'sent', 'signed', 'rejected', 'cancelled', 'error')),
  drive_file_id text,
  drive_web_url text,
  source_document_hash text,
  signed_drive_file_id text,
  signed_drive_url text,
  signed_document_hash text,
  requested_by uuid references auth.users(id) on delete set null,
  prepared_at timestamptz not null default now(),
  sent_at timestamptz,
  signed_at timestamptz,
  cancelled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_signature_request_target check (
    (protocol_id is not null and commercial_document_id is null)
    or (protocol_id is null and commercial_document_id is not null)
  )
);

create table if not exists public.document_signature_signers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.document_signature_requests(id) on delete cascade,
  signer_order integer not null default 1 check (signer_order between 1 and 10),
  name text not null,
  email text not null,
  role text,
  status text not null default 'pending' check (status in ('pending', 'sent', 'viewed', 'signed', 'rejected')),
  sent_at timestamptz,
  signed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (request_id, signer_order)
);

create table if not exists public.document_signature_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.document_signature_requests(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  from_status text,
  to_status text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists google_drive_oauth_states_expiry_idx on public.google_drive_oauth_states(expires_at);
create index if not exists document_signature_requests_protocol_idx on public.document_signature_requests(protocol_id, created_at desc);
create index if not exists document_signature_requests_document_idx on public.document_signature_requests(commercial_document_id, created_at desc);
create index if not exists document_signature_events_request_idx on public.document_signature_events(request_id, created_at desc);

alter table public.google_drive_oauth_states enable row level security;
alter table public.google_drive_oauth_connections enable row level security;
alter table public.document_signature_requests enable row level security;
alter table public.document_signature_signers enable row level security;
alter table public.document_signature_events enable row level security;

drop policy if exists "Google Drive OAuth admin access" on public.google_drive_oauth_connections;
create policy "Google Drive OAuth admin access" on public.google_drive_oauth_connections
for select to authenticated using (coalesce(public.get_user_role() = 'admin', false));

drop policy if exists "Signature requests visible to admins" on public.document_signature_requests;
create policy "Signature requests visible to admins" on public.document_signature_requests
for select to authenticated using (coalesce(public.get_user_role() = 'admin', false));

drop policy if exists "Signature signers visible to admins" on public.document_signature_signers;
create policy "Signature signers visible to admins" on public.document_signature_signers
for select to authenticated using (coalesce(public.get_user_role() = 'admin', false));

drop policy if exists "Signature events visible to admins" on public.document_signature_events;
create policy "Signature events visible to admins" on public.document_signature_events
for select to authenticated using (coalesce(public.get_user_role() = 'admin', false));

grant select on public.google_drive_oauth_connections to authenticated;
grant select on public.document_signature_requests, public.document_signature_signers, public.document_signature_events to authenticated;

comment on table public.document_signature_requests is 'Audit trail for internal and external document signature workflows.';
