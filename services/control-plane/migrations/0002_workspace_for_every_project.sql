-- 0002 — Every project has its workspace record from the start (step 1c.7). Projects created before
-- this get theirs now; new ones get it in the same statement that creates the project.
insert into workspaces (project_id)
select id from projects
on conflict (project_id) do nothing;
