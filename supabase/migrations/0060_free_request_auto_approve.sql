-- 0060 · Asking to use Pocket free is approved straight away for the first
-- 50 requests (owner, 17 Nov 2026). After that, requests wait for the admin
-- as before. The admin can change the limit or reset the counter. Nothing
-- about this is shown on the website; the person just sees their request
-- processed and approved.

alter table public.billing_settings
  add column if not exists free_auto_limit int not null default 50 check (free_auto_limit >= 0),
  add column if not exists free_auto_used  int not null default 0  check (free_auto_used >= 0);

alter table public.free_requests
  add column if not exists auto boolean not null default false;

create or replace function public.pocket_free_request_send(p_name text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text := btrim(coalesce(p_name, '')); why text := btrim(coalesce(p_reason, ''));
        cfg billing_settings; rid bigint;
begin
  if uid is null then raise exception 'Sign in to send a request' using errcode = '42501'; end if;
  if char_length(nm) = 0 then raise exception 'Enter your name' using errcode = 'PG001'; end if;
  if char_length(why) = 0 then raise exception 'Write a line about why' using errcode = 'PG001'; end if;
  if char_length(nm) > 120 or char_length(why) > 1000 then raise exception 'Keep it shorter' using errcode = 'PG001'; end if;
  if exists (select 1 from free_requests where user_id = uid and status = 'pending') then
    raise exception 'Your request is already with us' using errcode = 'PG001';
  end if;
  if exists (select 1 from free_requests where user_id = uid and status = 'approved' and valid_until > now() + interval '14 days') then
    raise exception 'You can already use Pocket free' using errcode = 'PG001';
  end if;
  insert into free_requests (user_id, email, name, reason)
  values (uid, (select lower(email) from auth.users where id = uid), nm, why)
  returning id into rid;

  -- Approved at once while the auto-approve allowance lasts.
  select * into cfg from billing_settings where id for update;
  if cfg.free_auto_used < cfg.free_auto_limit then
    update free_requests
       set status = 'approved', auto = true, decided_at = now(),
           valid_until = now() + make_interval(months => cfg.free_request_months)
     where id = rid;
    update billing_settings set free_auto_used = free_auto_used + 1, updated_at = now() where id;
  end if;
  return pocket_free_request_of(uid);
end $$;

-- Admin: the list also says how much of the allowance is used, and which were approved automatically.
create or replace function public.pocket_adm_free_requests(p_status text default null, p_limit integer default 300) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                 from (select status, count(*) n from free_requests group by status) c),
    'auto', (select jsonb_build_object('limit', b.free_auto_limit, 'used', b.free_auto_used) from billing_settings b where b.id),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', r.id, 'email', r.email, 'name', r.name, 'reason', r.reason, 'status', r.status, 'auto', r.auto,
                 'at', r.created_at, 'decidedAt', r.decided_at, 'validUntil', r.valid_until, 'note', r.note)
                 order by r.created_at desc), '[]'::jsonb)
                from (select * from free_requests where p_status is null or status = p_status
                       order by created_at desc limit greatest(1, least(coalesce(p_limit, 300), 1000))) r));
end $$;

-- Admin: change the allowance and/or start counting again from 0.
create or replace function public.pocket_adm_free_auto(p_limit integer default null, p_reset boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b billing_settings;
begin
  perform pocket_require_admin();
  if p_limit is not null and (p_limit < 0 or p_limit > 100000) then raise exception 'Limit must be 0 or more' using errcode = '22023'; end if;
  update billing_settings
     set free_auto_limit = coalesce(p_limit, free_auto_limit),
         free_auto_used = case when p_reset then 0 else free_auto_used end,
         updated_at = now()
   where id returning * into b;
  perform pocket_adm_log('free_auto', null, jsonb_build_object('limit', b.free_auto_limit, 'used', b.free_auto_used, 'reset', p_reset));
  return jsonb_build_object('limit', b.free_auto_limit, 'used', b.free_auto_used);
end $$;

revoke all on function public.pocket_adm_free_auto(integer, boolean) from public, anon;
grant execute on function public.pocket_adm_free_auto(integer, boolean) to authenticated;
