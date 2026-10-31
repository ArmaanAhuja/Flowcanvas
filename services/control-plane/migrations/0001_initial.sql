-- 0001 — Phase 1c: accounts, sessions, projects, workspace records, secrets vault, usage.
-- Never edit this file once applied anywhere; add a new numbered migration instead.

-- People who may sign in while in private development (decisions log, 30 Oct 2026). Filled by
-- `pnpm db:allow`, never by a migration: the repository is public, so no emails live in it.
create table sign_in_allowlist (
  email text primary key check (email = lower(email) and email like '%_@_%'),
  role text not null default 'member' check (role in ('member', 'admin')),
  added_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null check (email = lower(email) and email like '%_@_%'),
  display_name text not null check (char_length(display_name) between 1 and 200),
  avatar_url text check (avatar_url is null or avatar_url like 'https://%'),
  role text not null default 'member' check (role in ('member', 'admin')),
  created_at timestamptz not null default now(),
  last_signed_in_at timestamptz
);
create unique index users_email_key on users (email);

-- One row per external account (GitHub, Google) linked to a user.
create table identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users (id) on delete cascade,
  provider text not null check (provider in ('github', 'google')),
  provider_user_id text not null check (char_length(provider_user_id) between 1 and 200),
  username text,
  created_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);
create index identities_user_id_idx on identities (user_id);

-- The browser holds a random session token; only its SHA-256 hash is stored, so a database leak
-- doesn't hand out live sessions.
create table sessions (
  token_hash bytea primary key check (octet_length(token_hash) = 32),
  user_id uuid not null references users (id) on delete cascade,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  user_agent text check (user_agent is null or char_length(user_agent) <= 500),
  check (expires_at > created_at)
);
create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 100 and name = btrim(name)),
  repo_url text check (repo_url is null or repo_url like 'https://%'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, name)
);

-- One cloud workspace per project. Records only for now; the machines arrive in phase 1d.
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null unique references projects (id) on delete cascade,
  state text not null default 'not_created'
    check (state in ('not_created', 'creating', 'running', 'sleeping', 'resuming', 'stopped', 'failed')),
  region text,
  machine_size text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Envelope encryption: each project has its own data key, stored only encrypted (wrapped) by a master
-- key that lives in a Worker secret, never in the database. key_version names which master key.
create table project_keys (
  project_id uuid primary key references projects (id) on delete cascade,
  wrapped_key bytea not null check (octet_length(wrapped_key) between 32 and 64),
  wrap_iv bytea not null check (octet_length(wrap_iv) = 12),
  key_version integer not null check (key_version > 0),
  created_at timestamptz not null default now()
);

-- Secret values are write-only: stored as AES-GCM ciphertext under the project's data key, never in
-- plain text, never returned by the API.
create table project_secrets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects (id) on delete cascade,
  name text not null check (name ~ '^[A-Z_][A-Z0-9_]{0,127}$'),
  ciphertext bytea not null check (octet_length(ciphertext) between 17 and 65552),
  iv bytea not null check (octet_length(iv) = 12),
  created_by uuid references users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

-- Usage metering skeleton: measured amounts per user, e.g. workspace seconds (phase 1d onward).
create table usage_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references users (id) on delete cascade,
  workspace_id uuid references workspaces (id) on delete set null,
  kind text not null check (kind in ('workspace_seconds', 'storage_byte_hours')),
  quantity bigint not null check (quantity >= 0),
  started_at timestamptz not null,
  ended_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  check (ended_at >= started_at)
);
create index usage_records_user_period_idx on usage_records (user_id, started_at);
