-- Run after publishing.sql inside the SAME transaction, followed by ROLLBACK.
-- Creates only temporary database fixtures; performs no network operation.
do $$
declare actor uuid; post_id uuid:=gen_random_uuid(); account_id uuid:=gen_random_uuid();
 job public.smit_jobs%rowtype; second_job public.smit_jobs%rowtype;
 scheduled timestamptz:=date_trunc('minute',now()+interval '5 minutes'); payload jsonb;
begin
 select u.id into actor from auth.users u join public.smit_access a on a.email=u.email and a.active where u.email_confirmed_at is not null limit 1;
 if actor is null then raise exception 'Test requires an active confirmed workspace member';end if;
 insert into public.smit_accounts(id,channel,remote_id,name,verified_at) values(account_id,'instagram','fixture-only','Rollback fixture',now());
 payload:=jsonb_build_object('id',post_id,'version',1,'title','Rollback fixture','caption','Private database test','status','draft');
 perform public.smit_save_draft(actor,post_id,0,payload);
 perform public.smit_schedule(actor,post_id,1,scheduled,to_char(scheduled at time zone 'America/Sao_Paulo','YYYY-MM-DD"T"HH24:MI'),jsonb_build_array(jsonb_build_object('account_id',account_id,'payload',jsonb_build_object('channel','instagram','remote_id','fixture-only'))));
 begin
  perform public.smit_schedule(actor,post_id,1,scheduled,to_char(scheduled at time zone 'America/Sao_Paulo','YYYY-MM-DD"T"HH24:MI'),'[]');
  raise exception 'Invalid schedule was accepted';
 exception when others then if sqlerrm='Invalid schedule was accepted' then raise;end if;end;
 select * into job from public.smit_claim_job();
 if job.id is null or job.post_id<>post_id or job.status<>'claimed' then raise exception 'Claim failed';end if;
 if public.smit_job_sending(job.id,job.lease_id) then raise exception 'Published before scheduled time';end if;
 begin
  perform public.smit_save_draft(actor,post_id,1,payload||'{"version":2}');
  raise exception 'Editing a claimed post was allowed';
 exception when serialization_failure then null;end;
 update public.smit_jobs set lease_until=now()-interval '1 second' where id=job.id;
 select * into second_job from public.smit_claim_job();
 if second_job.id<>job.id or second_job.lease_id=job.lease_id then raise exception 'Expired claim was not renewed';end if;
 if public.smit_job_finish(job.id,job.lease_id,'published',null,'obsolete',null,null) then raise exception 'Stale lease wrote a result';end if;
 update public.smit_jobs set scheduled_at=now()-interval '1 second' where id=job.id;
 if not public.smit_job_sending(job.id,second_job.lease_id) then raise exception 'Due sending fence failed';end if;
 begin
  perform public.smit_cancel_schedule(actor,post_id);
  raise exception 'Cancelling an active send was allowed';
 exception when serialization_failure then null;end;
 update public.smit_jobs set lease_until=now()-interval '1 second' where id=job.id;
 perform public.smit_claim_job();
 if not exists(select 1 from public.smit_jobs where id=job.id and status='unknown') then raise exception 'Interrupted send was automatically retried';end if;
 if not public.smit_confirm_delivery(actor,job.id,'verified-remote-fixture') then raise exception 'Verified delivery could not be reconciled';end if;
 if public.smit_confirm_delivery(actor,job.id,'second-fixture') then raise exception 'Published job was reconciled twice';end if;
 if has_function_privilege('authenticated','public.smit_claim_job()','execute') or has_function_privilege('anon','public.smit_schedule(uuid,uuid,integer,timestamptz,text,jsonb)','execute') then raise exception 'Queue RPC exposed';end if;
 if has_table_privilege('authenticated','public.smit_posts','update') then raise exception 'Browser can bypass the queue fence';end if;
 if (select public from storage.buckets where id='smit-media') then raise exception 'Media bucket is public';end if;
end $$;
