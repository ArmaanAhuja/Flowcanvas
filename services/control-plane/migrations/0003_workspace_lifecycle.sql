-- 0003 — What the workspace lifecycle needs (phase 1d step 3, ADR 0016).
-- provider / provider_ref: which provider runs the workspace, and its name for it (a container name for now).
-- version: bumped by every state change. Each change is one compare-and-set statement on it, so two requests
--   at once can't both act (Neon's HTTP driver has no multi-call transactions).
-- running_since: set exactly while running, so usage is measured from it when the workspace stops running.
-- failure: a sentence for the person, never a raw error (which could quote a token or a path).
alter table workspaces
  add column provider text,
  add column provider_ref text check (provider_ref is null or char_length(provider_ref) <= 200),
  add column version integer not null default 0,
  add column state_changed_at timestamptz not null default now(),
  add column running_since timestamptz,
  add column last_active_at timestamptz,
  add column failure text check (failure is null or char_length(failure) <= 300),
  add constraint workspaces_running_since_check check ((state = 'running') = (running_since is not null));

create index workspaces_running_idx on workspaces (last_active_at) where state = 'running';
