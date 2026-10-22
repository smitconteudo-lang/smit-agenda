-- SMIT Agenda 0.2.0 — instalação independente. Apenas backend autorizado.
-- Sem credenciais, contas de redes ou publicações de exemplo.
begin;
create table public.smit_members (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null default '',
 role text not null default 'editor' check (role in ('admin','editor')),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create table public.smit_settings (
 id text primary key check (id='workspace'),
 brand jsonb not null default '{"name":"SMIT","guidelines":""}',
 updated_at timestamptz not null default now()
);
insert into public.smit_settings(id) values ('workspace');
create table public.smit_posts (
 id uuid primary key default gen_random_uuid(),
 version integer not null default 1 check(version>0),
 payload jsonb not null,
 created_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
create index smit_posts_updated_idx on public.smit_posts(updated_at desc);
create table public.smit_revisions (
 post_id uuid not null references public.smit_posts(id),
 version integer not null check(version>0),
 payload jsonb not null,
 created_at timestamptz not null default now(),
 primary key(post_id,version)
);
create table public.smit_accounts (
 id uuid primary key default gen_random_uuid(),
 channel text not null check(channel in ('instagram','facebook_page','linkedin','youtube')),
 remote_id text not null,
 name text not null,
 handle text,
 scopes text[] not null default '{}',
 verified_at timestamptz,
 publishing_enabled boolean not null default false,
 metadata jsonb not null default '{}',
 unique(channel,remote_id)
);
create table public.smit_account_secrets (
 account_id uuid primary key references public.smit_accounts(id) on delete cascade,
 ciphertext text not null,
 expires_at timestamptz,
 updated_at timestamptz not null default now()
);
create table public.smit_oauth_attempts (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id),
 state_hash text not null unique,
 provider text not null check(provider in ('meta','google','linkedin')),
 status text not null default 'pending' check(status in ('pending','processing','ready','connected','cancelled','expired','error')),
 expires_at timestamptz not null,
 encrypted_payload text,
 created_at timestamptz not null default now()
);
create index smit_oauth_user_idx on public.smit_oauth_attempts(user_id,created_at desc);
create table public.smit_jobs (
 id uuid primary key default gen_random_uuid(),
 post_id uuid not null,
 version integer not null,
 account_id uuid not null references public.smit_accounts(id),
 scheduled_at timestamptz not null,
 status text not null default 'pending' check(status in ('pending','claimed','sending','published','failed','unknown','cancelled')),
 attempts integer not null default 0 check(attempts>=0),
 lease_until timestamptz,
 remote_id text,
 last_error_code text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 foreign key(post_id,version) references public.smit_revisions(post_id,version),
 unique(post_id,version,account_id)
);
create index smit_jobs_due_idx on public.smit_jobs(scheduled_at) where status='pending';
create index smit_jobs_account_idx on public.smit_jobs(account_id);
create table public.smit_reports (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.smit_accounts(id),
 period_start date not null,
 period_end date not null,
 payload jsonb not null,
 observed_at timestamptz not null default now(),
 check(period_end>=period_start)
);
create index smit_reports_account_period_idx on public.smit_reports(account_id,period_start,period_end);
create table public.smit_runs (
 id uuid primary key default gen_random_uuid(),
 task text not null,
 status text not null check(status in ('started','succeeded','partial','failed','disabled')),
 summary jsonb not null default '{}',
 started_at timestamptz not null default now(),
 finished_at timestamptz
);
-- Dados editoriais e tokens acessíveis apenas pelo backend, após verificar usuário e associação.
-- Ausência intencional de políticas abertas. Não liberar acesso para corrigir um erro de configuração.
alter table public.smit_members enable row level security;
alter table public.smit_settings enable row level security;
alter table public.smit_posts enable row level security;
alter table public.smit_revisions enable row level security;
alter table public.smit_accounts enable row level security;
alter table public.smit_account_secrets enable row level security;
alter table public.smit_oauth_attempts enable row level security;
alter table public.smit_jobs enable row level security;
alter table public.smit_reports enable row level security;
alter table public.smit_runs enable row level security;
revoke all on public.smit_members,public.smit_settings,public.smit_posts,public.smit_revisions,public.smit_accounts,public.smit_account_secrets,public.smit_oauth_attempts,public.smit_jobs,public.smit_reports,public.smit_runs from anon,authenticated;
grant all on public.smit_members,public.smit_settings,public.smit_posts,public.smit_revisions,public.smit_accounts,public.smit_account_secrets,public.smit_oauth_attempts,public.smit_jobs,public.smit_reports,public.smit_runs to service_role;
commit;
