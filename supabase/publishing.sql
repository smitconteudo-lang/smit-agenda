begin;
create table public.smit_media (
 id uuid primary key, user_id uuid not null references auth.users(id),
 name text not null, object_path text not null unique, mime text not null check(mime in ('image/jpeg','image/png','video/mp4')),
 bytes bigint not null check(bytes between 1 and 52428800),
 status text not null default 'uploading' check(status in ('uploading','ready')),
 created_at timestamptz not null default now()
);
alter table public.smit_media enable row level security;
revoke all on public.smit_media from anon,authenticated;
grant select on public.smit_media to authenticated;
grant all on public.smit_media to service_role;
create policy smit_media_read on public.smit_media for select to authenticated
using(exists(select 1 from public.smit_access where active and email=(select auth.jwt()->>'email')));
alter table public.smit_jobs add column payload jsonb not null default '{}',
 add column progress_ciphertext text, add column lease_id uuid,
 add column next_attempt_at timestamptz not null default now(), add column last_error text;
alter table public.smit_jobs drop constraint smit_jobs_status_check;
alter table public.smit_jobs add constraint smit_jobs_status_check check(status in ('pending','claimed','sending','confirming','published','failed','unknown','cancelled'));
create index smit_jobs_wake_idx on public.smit_jobs(next_attempt_at,scheduled_at) where status='pending';
create index smit_jobs_post_status_idx on public.smit_jobs(post_id,status);
create index smit_media_user_idx on public.smit_media(user_id);

create function public.smit_save_draft(p_actor uuid,p_id uuid,p_expected integer,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare current_version integer;
begin
 if not exists(select 1 from auth.users u join public.smit_access a on a.email=u.email and a.active where u.id=p_actor and u.email_confirmed_at is not null) then raise insufficient_privilege; end if;
 if p_expected<0 or length(p_payload->>'title') not between 1 and 120 or length(p_payload->>'caption')>5000 or (p_payload->>'version')::integer<>p_expected+1 or p_payload->>'status'<>'draft' then raise exception 'Invalid post'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select version into current_version from public.smit_posts where id=p_id for update;
 if (found and current_version<>p_expected) or (not found and p_expected<>0) then raise exception 'Version conflict' using errcode='40001'; end if;
 if exists(select 1 from public.smit_jobs where post_id=p_id and status in ('claimed','sending','confirming','unknown')) then raise exception 'Envio em andamento ou resultado desconhecido. Confira a fila antes de editar.' using errcode='40001'; end if;
 update public.smit_jobs set status='cancelled',updated_at=now() where post_id=p_id and status='pending';
 insert into public.smit_posts(id,version,payload,created_by) values(p_id,p_expected+1,p_payload,p_actor) on conflict(id) do update set version=excluded.version,payload=excluded.payload,updated_at=now();
 insert into public.smit_revisions(post_id,version,payload) values(p_id,p_expected+1,p_payload);
 return p_payload;
end; $$;
revoke insert,update on public.smit_posts from authenticated;
revoke insert on public.smit_revisions from authenticated;
revoke execute on function public.smit_save_post(uuid,integer,jsonb),public.smit_plan_post(uuid,integer,text,timestamptz) from authenticated;
revoke all on function public.smit_save_draft(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.smit_save_draft(uuid,uuid,integer,jsonb) to service_role;
-- Scheduling and queue controls are server-only. The server checks the live
-- user and account permissions, then freezes a payload for every destination.
create function public.smit_schedule(p_actor uuid,p_id uuid,p_version integer,p_at timestamptz,p_local text,p_destinations jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare post public.smit_posts%rowtype; item jsonb; account public.smit_accounts%rowtype;
begin
 if not exists(select 1 from auth.users u join public.smit_access a on a.email=u.email and a.active where u.id=p_actor and u.email_confirmed_at is not null) then raise insufficient_privilege; end if;
 if p_at<now()+interval '1 minute' or pg_catalog.to_char(p_at at time zone 'America/Sao_Paulo','YYYY-MM-DD"T"HH24:MI')<>p_local or jsonb_typeof(p_destinations)<>'array' or jsonb_array_length(p_destinations) not between 1 and 10 then raise exception 'Invalid schedule'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 select * into post from public.smit_posts where id=p_id for update;
 if not found or post.version<>p_version then raise exception 'Version conflict' using errcode='40001'; end if;
 if exists(select 1 from public.smit_jobs where post_id=p_id and version=p_version and status<>'cancelled') then raise exception 'Esta versão já possui agendamento. Cancele ou crie uma nova versão.' using errcode='40001'; end if;
 for item in select value from jsonb_array_elements(p_destinations) loop
  select * into account from public.smit_accounts where id=(item->>'account_id')::uuid;
  if not found or account.verified_at is null or item->'payload'->>'channel'<>account.channel or item->'payload'->>'remote_id'<>account.remote_id then raise exception 'Invalid destination'; end if;
  insert into public.smit_jobs(post_id,version,account_id,scheduled_at,payload)
  values(p_id,p_version,account.id,p_at,item->'payload')
  on conflict(post_id,version,account_id) do update set status='pending',scheduled_at=excluded.scheduled_at,payload=excluded.payload,progress_ciphertext=null,attempts=0,next_attempt_at=now(),last_error=null,last_error_code=null,remote_id=null;
 end loop;
 update public.smit_posts set payload=payload||jsonb_build_object('status','scheduled','planned_local',p_local,'planned_utc',extract(epoch from p_at)),updated_at=now() where id=p_id;
 return jsonb_build_object('scheduled',jsonb_array_length(p_destinations));
end; $$;
create function public.smit_claim_job() returns setof public.smit_jobs
language plpgsql security invoker set search_path='' as $$
declare candidate public.smit_jobs%rowtype; result public.smit_jobs%rowtype;
begin
 -- A lost publishing response must NEVER be retried automatically.
 update public.smit_jobs set status='unknown',last_error='A confirmação do envio foi interrompida. Confira na rede antes de qualquer nova tentativa.',lease_id=null,updated_at=now() where status='sending' and lease_until<now();
 update public.smit_jobs set status='pending',lease_id=null,updated_at=now() where status='claimed' and lease_until<now();
 for candidate in select * from public.smit_jobs where status in ('pending','confirming') and scheduled_at<=now()+interval '10 minutes' and next_attempt_at<=now() order by scheduled_at limit 20 loop
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(candidate.post_id::text,0)) then continue; end if;
  select * into result from public.smit_jobs where id=candidate.id and status in ('pending','confirming') for update skip locked;
  if not found then continue; end if;
  if not exists(select 1 from public.smit_posts where id=result.post_id and version=result.version and payload->>'status'='scheduled') then update public.smit_jobs set status='cancelled',updated_at=now() where id=result.id;continue;end if;
  update public.smit_jobs set status='claimed',attempts=attempts+1,lease_id=gen_random_uuid(),lease_until=now()+interval '10 minutes',updated_at=now() where id=result.id returning * into result;
  return next result;return;
 end loop;
end; $$;
create function public.smit_job_sending(p_id uuid,p_lease uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare job public.smit_jobs%rowtype;
begin
 select * into job from public.smit_jobs where id=p_id;
 if not found then return false;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(job.post_id::text,0));
 update public.smit_jobs set status='sending',updated_at=now() where id=p_id and lease_id=p_lease and status='claimed' and lease_until>now() and scheduled_at<=now() and exists(select 1 from public.smit_posts where id=job.post_id and version=job.version and payload->>'status'='scheduled');
 return found;
end; $$;
create function public.smit_job_finish(p_id uuid,p_lease uuid,p_status text,p_progress text,p_remote text,p_error text,p_next timestamptz) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_status not in ('pending','confirming','published','failed','unknown') or (p_status='published' and coalesce(p_remote,'')='') then raise exception 'Invalid transition';end if;
 update public.smit_jobs set status=p_status,progress_ciphertext=p_progress,remote_id=p_remote,last_error=left(p_error,300),lease_id=null,lease_until=null,next_attempt_at=coalesce(p_next,now()+interval '1 minute'),updated_at=now()
 where id=p_id and lease_id=p_lease and status in ('claimed','sending') and (status<>'sending' or p_status<>'pending');
 return found;
end; $$;
create function public.smit_cancel_schedule(p_actor uuid,p_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from auth.users u join public.smit_access a on a.email=u.email and a.active where u.id=p_actor and u.email_confirmed_at is not null) then raise insufficient_privilege;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_id::text,0));
 if exists(select 1 from public.smit_jobs where post_id=p_id and status in ('claimed','sending','confirming','unknown')) then raise exception 'Envio em andamento ou resultado desconhecido. Confira o resultado antes de cancelar.' using errcode='40001';end if;
 update public.smit_jobs set status='cancelled',updated_at=now() where post_id=p_id and status='pending';
 update public.smit_posts set payload=payload||jsonb_build_object('status','draft','planned_local',null,'planned_utc',null),updated_at=now() where id=p_id;
 return true;
end; $$;
revoke all on function public.smit_schedule(uuid,uuid,integer,timestamptz,text,jsonb),public.smit_claim_job(),public.smit_job_sending(uuid,uuid),public.smit_job_finish(uuid,uuid,text,text,text,text,timestamptz),public.smit_cancel_schedule(uuid,uuid) from public,anon,authenticated;
grant execute on function public.smit_schedule(uuid,uuid,integer,timestamptz,text,jsonb),public.smit_claim_job(),public.smit_job_sending(uuid,uuid),public.smit_job_finish(uuid,uuid,text,text,text,text,timestamptz),public.smit_cancel_schedule(uuid,uuid) to service_role;
-- The browser has no direct write access to this bucket or these queue rows.
create function public.smit_confirm_delivery(p_actor uuid,p_id uuid,p_remote text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare post_id uuid;
begin
 if not exists(select 1 from auth.users u join public.smit_access a on a.email=u.email and a.active where u.id=p_actor and u.email_confirmed_at is not null) then raise insufficient_privilege;end if;
 select j.post_id into post_id from public.smit_jobs j where j.id=p_id;
 if post_id is null then return false;end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(post_id::text,0));
 update public.smit_jobs set status='published',remote_id=p_remote,last_error=null,progress_ciphertext=null,updated_at=now() where id=p_id and status='unknown' and length(p_remote) between 1 and 150;
 return found;
end; $$;
revoke all on function public.smit_confirm_delivery(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.smit_confirm_delivery(uuid,uuid,text) to service_role;
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('smit-media','smit-media',false,52428800,array['image/jpeg','image/png','video/mp4']);
commit;
