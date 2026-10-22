begin;
create table public.smit_access (
 email text primary key check(email=lower(email)),
 active boolean not null default true,
 created_at timestamptz not null default now()
);
alter table public.smit_access enable row level security;
revoke all on public.smit_access from anon,authenticated;
grant select on public.smit_access to authenticated;
grant all on public.smit_access to service_role;
create policy smit_self_access on public.smit_access for select to authenticated
 using(email=(select auth.jwt()->>'email'));
insert into public.smit_access(email) values('equipe@example.invalid');
-- Esta primeira instalação é um único espaço da SMIT, compartilhado apenas com e-mails autorizados.
grant select on public.smit_settings,public.smit_posts,public.smit_accounts,public.smit_reports,public.smit_revisions to authenticated;
grant update on public.smit_settings,public.smit_posts to authenticated;
grant insert on public.smit_posts,public.smit_revisions to authenticated;
create policy smit_settings_read on public.smit_settings for select to authenticated using(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
create policy smit_settings_write on public.smit_settings for update to authenticated using(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email'))) with check(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
create policy smit_posts_read on public.smit_posts for select to authenticated using(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
create policy smit_posts_insert on public.smit_posts for insert to authenticated with check(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
create policy smit_posts_update on public.smit_posts for update to authenticated using(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email'))) with check(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
create policy smit_revisions_read on public.smit_revisions for select to authenticated using(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
create policy smit_revisions_insert on public.smit_revisions for insert to authenticated with check(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
create policy smit_accounts_read on public.smit_accounts for select to authenticated using(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
create policy smit_reports_read on public.smit_reports for select to authenticated using(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
-- Invoker: os RPCs respeitam RLS. Versões e revisões são gravadas na mesma transação.
create function public.smit_save_post(p_id uuid,p_expected integer,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_version integer;
begin
 if not exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')) then raise insufficient_privilege; end if;
 if p_expected<0 or length(p_payload->>'title') not between 1 and 120 or length(p_payload->>'caption')>5000 or (p_payload->>'version')::integer<>p_expected+1 or p_payload->>'status'<>'draft' then raise exception 'Invalid post'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select version into current_version from public.smit_posts where id=p_id for update;
 if (found and current_version<>p_expected) or (not found and p_expected<>0) then raise exception 'Version conflict' using errcode='40001'; end if;
 insert into public.smit_posts(id,version,payload,created_by) values(p_id,p_expected+1,p_payload,auth.uid())
 on conflict(id) do update set version=excluded.version,payload=excluded.payload,updated_at=now();
 insert into public.smit_revisions(post_id,version,payload) values(p_id,p_expected+1,p_payload);
 return p_payload;
end; $$;
create function public.smit_plan_post(p_id uuid,p_expected integer,p_when text,p_utc timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare post public.smit_posts%rowtype; result jsonb;
begin
 if p_utc<=now() or p_when !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$' or pg_catalog.to_char(p_utc at time zone 'America/Sao_Paulo','YYYY-MM-DD"T"HH24:MI')<>p_when then raise exception 'Invalid date'; end if;
 select * into post from public.smit_posts where id=p_id for update;
 if not found or post.version<>p_expected then raise exception 'Version conflict' using errcode='40001'; end if;
 result=post.payload||pg_catalog.jsonb_build_object('status','planned','planned_local',p_when,'planned_utc',extract(epoch from p_utc),'updated',extract(epoch from now()));
 update public.smit_posts set payload=result,updated_at=now() where id=p_id;
 return result;
end; $$;
revoke all on function public.smit_save_post(uuid,integer,jsonb),public.smit_plan_post(uuid,integer,text,timestamptz) from public,anon;
grant execute on function public.smit_save_post(uuid,integer,jsonb),public.smit_plan_post(uuid,integer,text,timestamptz) to authenticated;
commit;
