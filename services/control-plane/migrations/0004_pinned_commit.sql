-- 0004 — A project can be pinned to one commit of its repository (phase 1d step 9). Corpus forks are pinned to
-- exact commits (CLAUDE.md rule 8), and the demo project opens its fork at that commit, not the branch's head.
-- repo_commit: a full lower-case SHA, and only with a repository address.
alter table projects
  add column repo_commit text check (repo_commit is null or repo_commit ~ '^[0-9a-f]{40}$'),
  add constraint projects_repo_commit_needs_url check (repo_commit is null or repo_url is not null);
