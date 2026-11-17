-- 0058 · The ₹30 promise asks again as soon as the paid month is over
-- (owner, 17 Nov 2026): the 30-day grace that keeps a lapsed Pocket Pro's
-- cloud copy readable doesn't let a lapsed promise keep adding entries.
-- Other plans in grace still allow entries, as before. Then the promise is
-- switched on.

create or replace function public.pocket_entry_access(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg billing_settings; eff record; req jsonb; why text; my_email text;
begin
  select * into cfg from billing_settings where id;
  select * into eff from pocket_effective_plan(p_user);
  req := pocket_free_request_of(p_user);
  select lower(email) into my_email from auth.users where id = p_user;
  why := case
    when not cfg.promise_required then 'off'
    when eff.state = 'active' or (eff.state = 'grace' and eff.plan <> 'promise') then 'plan'
    when exists (select 1 from family_members m cross join lateral pocket_effective_plan(m.owner_id) oe
                  where m.deleted_at is null and m.owner_id <> p_user and lower(m.email) = my_email
                    and oe.state in ('active', 'grace')) then 'family'
    when req->>'status' = 'approved' then 'free'
    when req->>'status' = 'pending' then 'waiting'
    else 'none' end;
  return jsonb_build_object(
    'required', cfg.promise_required,
    'allowed', why <> 'none',
    'why', why,
    'waitLimit', cfg.free_request_wait_entries,
    'waitingSince', case when why = 'waiting' then req->'at' end,
    'freeUntil', case when why = 'free' then req->'validUntil' end,
    'request', req,
    'promisePaise', cfg.promise_paise,
    'promiseCredits', cfg.promise_credits,
    'promiseCreditDays', cfg.promise_credit_days);
end $$;

update public.billing_settings set promise_required = true where id;
