-- 0047 · The ₹30-a-month promise, asking to use Pocket free, and AI credits
-- that expire.
--
-- Decided by the owner on 16 Nov 2026:
--   · Adding entries needs either the ₹30-a-month promise (auto-debit), a paid
--     plan, or an approved request to use Pocket free.
--   · While a request waits, the person may add up to 20 entries.
--   · An approved request lasts 6 months; then they ask again.
--   · Each paid month gives 150 AI credits that expire after 1 month.
--   · Everyone gets the 20 welcome credits; they expire 6 months after they
--     were given (6 months from today for credits already given).
--   · Credits that expire soonest are spent first (promise, then welcome,
--     then packs, which still last ai_credit_days = 1 year; admin grants
--     never expire).
--   · Current free users are included from launch.
--
-- The promise is charged by auto-debit only, which waits for Razorpay to
-- approve payments. Until then billing_settings.promise_required stays false
-- and nothing changes for anyone: the app reads `entries` from the
-- entitlements and only gates adding entries when it is required.
--
-- No DROP or DELETE. The one UPDATE dates the welcome credits already given.

-- ── Settings ──────────────────────────────────────────────────────────────
alter table public.billing_settings
  add column if not exists promise_required          boolean not null default false,
  add column if not exists promise_paise             int not null default 3000 check (promise_paise > 0),
  add column if not exists promise_credits           int not null default 150  check (promise_credits >= 0),
  add column if not exists promise_credit_days       int not null default 30   check (promise_credit_days > 0),
  add column if not exists ai_welcome_months         int not null default 6    check (ai_welcome_months > 0),
  add column if not exists free_request_months       int not null default 6    check (free_request_months > 0),
  add column if not exists free_request_wait_entries int not null default 20   check (free_request_wait_entries >= 0);

-- The plan the ₹30 buys: nothing beyond adding entries on your own device.
-- Not on sale (active = false) until auto-debit is built.
insert into public.plans (code, name, sync, telegram, sharing, seats, monthly_paise, yearly_paise, trial_days, trial_paise, sort, active)
values ('promise', 'Pocket Promise', false, false, false, 1, 3000, null, null, null, 0, false)
on conflict (code) do nothing;

-- ── Credits that expire ───────────────────────────────────────────────────
-- A positive row with expires_at set is a batch of credits that lapses then.
-- On a 'use' row, expires_at is when the credits it spent would have lapsed,
-- so a refund puts them back with the same date.
alter table public.ai_credit_ledger add column if not exists expires_at timestamptz;

update public.ai_credit_ledger
   set expires_at = now() + make_interval(months => (select ai_welcome_months from billing_settings where id))
 where reason = 'grant' and ref = 'welcome' and expires_at is null;

-- Expiry used to be written as negative 'exp:' rows by an hourly job (0026),
-- oldest credits first. It is now worked out when the balance is read, so a
-- promise month can be spent before a pack: pack rows expire ai_credit_days
-- after purchase, 'exp:' rows are skipped, and the job does nothing.
--
-- The batches a person still has, oldest-expiring first. Replays the ledger:
-- every spend takes from the batch that expires soonest among those still
-- valid at that moment; credits with no date are spent last. A spend with
-- nothing left to take from (it can't normally happen) is taken from the
-- next credits that arrive.
create or replace function public.pocket_ai_batches(p_user uuid)
returns table (expires_at timestamptz, credits int)
language plpgsql stable security definer set search_path = public as $$
declare
  r record; exp timestamptz[] := '{}'; rem int[] := '{}'; owed int := 0;
  need int; best int; i int; take int;
  pack_days int := (select ai_credit_days from billing_settings where id);
begin
  for r in select l.delta, l.at,
                  case when l.reason = 'purchase' and l.delta > 0 and l.expires_at is null
                       then l.at + make_interval(days => pack_days) else l.expires_at end e
             from ai_credit_ledger l
            where l.user_id = p_user and l.delta <> 0
              and not (l.reason = 'grant' and coalesce(l.ref, '') like 'exp:%')
            order by l.at, l.id loop
    if r.delta > 0 then
      take := least(owed, r.delta); owed := owed - take;
      if r.delta - take > 0 then exp := exp || r.e; rem := rem || (r.delta - take); end if;
    else
      need := -r.delta;
      while need > 0 loop
        best := null;
        for i in 1 .. coalesce(array_length(rem, 1), 0) loop
          if rem[i] > 0 and (exp[i] is null or exp[i] > r.at)
             and (best is null or (exp[i] is not null and (exp[best] is null or exp[i] < exp[best]))) then
            best := i;
          end if;
        end loop;
        if best is null then owed := owed + need; exit; end if;
        take := least(need, rem[best]); rem[best] := rem[best] - take; need := need - take;
      end loop;
    end if;
  end loop;
  return query
    select x.e, sum(x.c)::int from unnest(exp, rem) as x(e, c)
     where x.c > 0 and (x.e is null or x.e > now())
     group by x.e order by x.e nulls last;
end $$;

-- The balance: only credits that haven't expired.
create or replace function public.pocket_ai_balance(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(credits), 0)::int from pocket_ai_batches(p_user)
$$;

-- The hourly job from 0026 no longer writes expiry rows.
create or replace function public.pocket_ai_expire(p_user uuid) returns int
language sql security definer set search_path = public as $$ select 0 $$;
create or replace function public.pocket_ai_expire_all() returns int
language sql security definer set search_path = public as $$ select 0 $$;

-- When the next credits to be spent would expire (null: they don't).
create or replace function public.pocket_ai_next_expiry(p_user uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select expires_at from pocket_ai_batches(p_user) limit 1
$$;

-- Welcome credits now lapse after ai_welcome_months.
create or replace function public.pocket_ai_welcome(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare cfg billing_settings;
begin
  select * into cfg from billing_settings where id;
  if p_user is null or coalesce(cfg.ai_welcome_credits, 0) <= 0 then return false; end if;
  insert into ai_credit_ledger (user_id, delta, reason, ref, note, expires_at)
  values (p_user, cfg.ai_welcome_credits, 'grant', 'welcome', 'Free credits to try AI',
          now() + make_interval(months => cfg.ai_welcome_months))
  on conflict (user_id, reason, ref) do nothing;
  return found;
end $$;

-- A paid month of the promise: 150 credits for one month. Safe to call twice
-- with the same payment ref. Called by the payments function once auto-debit
-- exists.
create or replace function public.pocket_promise_credits(p_user uuid, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
declare cfg billing_settings;
begin
  select * into cfg from billing_settings where id;
  if p_user is null or coalesce(p_ref, '') = '' or cfg.promise_credits <= 0 then return false; end if;
  perform pocket_ai_welcome(p_user);
  insert into ai_credit_ledger (user_id, delta, reason, ref, note, expires_at)
  values (p_user, cfg.promise_credits, 'grant', 'promise:' || p_ref, 'Your ₹30 promise, back as AI credits',
          now() + make_interval(days => cfg.promise_credit_days))
  on conflict (user_id, reason, ref) do nothing;
  return found;
end $$;

-- Charging: as in 0043, plus the use row notes when its credits would have
-- expired, so a refund gives them back with the same date.
create or replace function public.pocket_ai_charge(p_user uuid, p_book uuid, p_ref text, p_kind text, p_seconds int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare prior ai_credit_ledger; left_ int; shared boolean; owner_email text; cost int;
begin
  if p_user is null or p_book is null or coalesce(p_ref, '') = '' then
    raise exception 'user, book and ref are required';
  end if;
  cost := pocket_ai_cost(p_kind, p_seconds);

  select * into prior from ai_credit_ledger where reason = 'use' and ref = p_ref and used_by = p_user;
  if prior.id is not null then
    return jsonb_build_object('ok', true, 'repeat', true, 'cost', -prior.delta,
      'chargedTo', case when prior.delta = 0 then 'unlimited' when prior.user_id = p_user then 'own' else 'family' end);
  end if;

  shared := p_book <> p_user;
  if shared and not pocket_ai_in_pool(p_user, p_book) then
    return jsonb_build_object('ok', false, 'reason', 'no_access');
  end if;

  if pocket_ai_unlimited(p_book) or pocket_ai_unlimited(p_user) then
    insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_book, 0, 'use', p_ref, p_user);
    return jsonb_build_object('ok', true, 'chargedTo', 'unlimited', 'cost', 0);
  end if;

  if shared then
    perform pg_advisory_xact_lock(hashtextextended('ai:' || p_book::text, 0));
    left_ := pocket_ai_balance(p_book);
    if left_ >= cost then
      select lower(email) into owner_email from auth.users where id = p_book;
      insert into ai_credit_ledger (user_id, delta, reason, ref, used_by, expires_at)
      values (p_book, -cost, 'use', p_ref, p_user, pocket_ai_next_expiry(p_book));
      return jsonb_build_object('ok', true, 'chargedTo', 'family', 'ownerEmail', owner_email, 'cost', cost, 'remaining', left_ - cost);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text, 0));
  perform pocket_ai_welcome(p_user);
  left_ := pocket_ai_balance(p_user);
  if left_ >= cost then
    insert into ai_credit_ledger (user_id, delta, reason, ref, used_by, expires_at)
    values (p_user, -cost, 'use', p_ref, p_user, pocket_ai_next_expiry(p_user));
    return jsonb_build_object('ok', true, 'chargedTo', 'own', 'cost', cost, 'remaining', left_ - cost);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'no_credits', 'cost', cost, 'remaining', greatest(left_, 0));
end $$;

create or replace function public.pocket_ai_refund(p_user uuid, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
declare used ai_credit_ledger;
begin
  select * into used from ai_credit_ledger where reason = 'use' and ref = p_ref and used_by = p_user;
  if used.id is null or used.delta = 0 then return false; end if;
  insert into ai_credit_ledger (user_id, delta, reason, ref, used_by, expires_at)
  values (used.user_id, -used.delta, 'refund', p_ref, p_user, used.expires_at)
  on conflict (user_id, reason, ref) do nothing;
  return found;
end $$;

-- ── Asking to use Pocket free ─────────────────────────────────────────────
create table if not exists public.free_requests (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  email       text,
  name        text not null check (char_length(name) between 1 and 120),
  reason      text not null check (char_length(reason) between 1 and 1000),
  status      text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  valid_until timestamptz,
  note        text
);
alter table public.free_requests enable row level security;
revoke all on public.free_requests from anon, authenticated;
create index if not exists free_requests_user on public.free_requests (user_id, created_at desc);
create index if not exists free_requests_status on public.free_requests (status, created_at desc);
-- One waiting request per person.
create unique index if not exists free_requests_one_pending on public.free_requests (user_id) where status = 'pending';

-- A person's latest request, as the app sees it.
create or replace function public.pocket_free_request_of(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('status', case when r.status = 'approved' and r.valid_until <= now() then 'expired' else r.status end,
                            'at', r.created_at, 'validUntil', r.valid_until)
    from free_requests r where r.user_id = p_user order by r.created_at desc, r.id desc limit 1
$$;

-- Send a request. Refused while one is waiting or an approval still runs for
-- more than 14 days.
create or replace function public.pocket_free_request_send(p_name text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); nm text := btrim(coalesce(p_name, '')); why text := btrim(coalesce(p_reason, ''));
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
  values (uid, (select lower(email) from auth.users where id = uid), nm, why);
  return pocket_free_request_of(uid);
end $$;

-- Admin: the requests, newest first.
create or replace function public.pocket_adm_free_requests(p_status text default null, p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                 from (select status, count(*) n from free_requests group by status) c),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', r.id, 'email', r.email, 'name', r.name, 'reason', r.reason, 'status', r.status,
                 'at', r.created_at, 'decidedAt', r.decided_at, 'validUntil', r.valid_until, 'note', r.note)
                 order by r.created_at desc), '[]'::jsonb)
                from (select * from free_requests where p_status is null or status = p_status
                       order by created_at desc limit greatest(1, least(coalesce(p_limit, 300), 1000))) r));
end $$;

-- Admin: approve (for free_request_months) or decline.
create or replace function public.pocket_adm_free_request_set(p_id bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r free_requests; months int := (select free_request_months from billing_settings where id);
begin
  perform pocket_require_admin();
  if p_status not in ('approved', 'declined') then raise exception 'Unknown status' using errcode = '22023'; end if;
  update free_requests
     set status = p_status, decided_at = now(), note = coalesce(p_note, note),
         valid_until = case when p_status = 'approved' then now() + make_interval(months => months) end
   where id = p_id returning * into r;
  if r.id is null then raise exception 'Unknown request %', p_id; end if;
  perform pocket_adm_log('free_request_' || p_status, r.email, jsonb_build_object('id', r.id));
  return jsonb_build_object('id', r.id, 'status', r.status, 'validUntil', r.valid_until);
end $$;

-- ── May this person add entries? ──────────────────────────────────────────
-- { required, allowed, why: 'off'|'plan'|'family'|'free'|'waiting'|'none',
--   waitLimit, waitingSince, freeUntil, request, promisePaise, promiseCredits }
-- 'waiting': allowed up to waitLimit entries added since waitingSince (the
-- app counts them; books stay on the device).
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
    when eff.state in ('active', 'grace') then 'plan'
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

-- The app gets `entries` and the next AI credits to expire with its plan.
create or replace function public.pocket_entitlements() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg billing_settings; my_email text; nxt record;
begin
  select * into cfg from billing_settings where id;
  if me is not null then
    if not exists (select 1 from ai_credit_ledger where user_id = me and reason = 'grant' and ref = 'welcome') then
      perform pocket_ai_welcome(me);
    end if;
    select lower(email) into my_email from auth.users where id = me;
    update group_members set user_id = me, joined_at = coalesce(joined_at, now())
     where removed_at is null and email = my_email and (user_id is null or joined_at is null);
  end if;
  select b.expires_at, b.credits into nxt from pocket_ai_batches(me) b where b.expires_at is not null limit 1;
  return pocket_entitlements_for(me)
         || jsonb_build_object('paymentsOpen', cfg.payments_enabled,
                               'backup', pocket_has_backup(me),
                               'entries', pocket_entry_access(me),
                               'aiExpiring', case when nxt.expires_at is not null
                                               then jsonb_build_object('credits', nxt.credits, 'at', nxt.expires_at) end,
                               'aiCosts', jsonb_build_object('scan', cfg.ai_scan_credits, 'voice', cfg.ai_voice_credits,
                                                             'voiceSeconds', cfg.ai_voice_block_secs));
end $$;

-- ── Who may call what ─────────────────────────────────────────────────────
revoke execute on function public.pocket_ai_batches(uuid), public.pocket_ai_next_expiry(uuid),
  public.pocket_promise_credits(uuid, text), public.pocket_free_request_of(uuid),
  public.pocket_entry_access(uuid) from public, anon, authenticated;
grant execute on function public.pocket_ai_batches(uuid), public.pocket_ai_next_expiry(uuid),
  public.pocket_promise_credits(uuid, text), public.pocket_free_request_of(uuid),
  public.pocket_entry_access(uuid) to service_role;
revoke execute on function public.pocket_ai_charge(uuid, uuid, text, text, int), public.pocket_ai_refund(uuid, text),
  public.pocket_ai_welcome(uuid) from public, anon, authenticated;
grant execute on function public.pocket_ai_charge(uuid, uuid, text, text, int), public.pocket_ai_refund(uuid, text),
  public.pocket_ai_welcome(uuid) to service_role;
revoke execute on function public.pocket_free_request_send(text, text),
  public.pocket_adm_free_requests(text, int), public.pocket_adm_free_request_set(bigint, text, text) from public, anon;
grant execute on function public.pocket_free_request_send(text, text),
  public.pocket_adm_free_requests(text, int), public.pocket_adm_free_request_set(bigint, text, text) to authenticated;
revoke execute on function public.pocket_entitlements() from public, anon;
grant execute on function public.pocket_entitlements() to authenticated;
