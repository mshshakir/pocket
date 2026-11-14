-- 0018 · Paid plans, phase 1: what each person is entitled to. No behaviour change yet.
--
-- Editable by the owner without code (Supabase → Table Editor):
--   plans             the catalogue: price, seats and what each plan includes
--   billing_settings  one row: grace days after a plan ends, AI price
-- Changed with the admin functions below (Supabase → SQL Editor), or by the
-- payment webhook later; every change is logged in subscription_events by a
-- trigger, including edits made by hand in the Table Editor:
--   subscriptions     one row per person: their current plan
--   ai_credit_ledger  AI credits bought, granted, used and refunded (1 credit = 1 use)
--
-- Users can read their own subscription, history and credits, and the plan
-- catalogue, but cannot write any of it.
--
-- pocket_entitlements() tells the signed-in app what the caller may do;
-- pocket_entitlements_for(user) tells the server (Telegram bot) the same.
-- Rules:
--   · No subscription row, or a plan that ended more than grace_days ago → Free.
--   · A plan that ended within grace_days → its features are read-only.
--   · A Family plan covers its owner plus up to (seats − 1) family members,
--     earliest-added first; members are covered for writing into the owner's
--     shared accounts while the owner's plan is active, read-only in grace.
--   · Money is in paise (₹1 = 100).

-- ── Catalogue ──────────────────────────────────────────────────────────────
create table if not exists public.plans (
  code          text primary key check (code ~ '^[a-z][a-z0-9_]*$'),
  name          text not null,
  seats         int  not null default 1 check (seats >= 1),   -- people, owner included
  sync          boolean not null default false,               -- cloud sync across devices
  telegram      boolean not null default false,               -- log by Telegram
  sharing       boolean not null default false,               -- share accounts with family
  monthly_paise int  check (monthly_paise >= 0),
  yearly_paise  int  check (yearly_paise >= 0),
  trial_paise   int  check (trial_paise >= 0),                -- paid trial price, if any
  trial_days    int  check (trial_days > 0),
  sort          int  not null default 0,
  active        boolean not null default true,                -- offered to new buyers
  updated_at    timestamptz not null default now()
);

insert into public.plans (code, name, seats, sync, telegram, sharing, monthly_paise, yearly_paise, trial_paise, trial_days, sort) values
  ('free',   'Free',   1, false, false, false, null,  null,   null, null, 0),
  ('sync',   'Sync',   1, true,  true,  false, 16900, 99900,  null, null, 1),
  ('family', 'Family', 5, true,  true,  true,  19900, 149900, 5000, 14,   2)
on conflict (code) do nothing;

create table if not exists public.billing_settings (
  id              boolean primary key default true check (id),  -- exactly one row
  grace_days      int not null default 30 check (grace_days >= 0),
  ai_credit_paise int not null default 10 check (ai_credit_paise > 0),   -- ₹0.10 per use
  ai_pack_paise   int not null default 10000 check (ai_pack_paise > 0),  -- packs of ₹100
  updated_at      timestamptz not null default now()
);
insert into public.billing_settings (id) values (true) on conflict (id) do nothing;

-- ── Per person ─────────────────────────────────────────────────────────────
create table if not exists public.subscriptions (
  user_id       uuid primary key references auth.users on delete cascade,
  plan          text not null references public.plans (code),
  term          text not null check (term in ('month', 'year', 'trial', 'lifetime')),
  source        text not null check (source in ('comp', 'manual', 'razorpay', 'play')),
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,                       -- null: no end (lifetime only)
  auto_renew    boolean not null default false,
  external_ref  text,                              -- payment provider's subscription id
  note          text,
  trial_used_at timestamptz,                       -- one paid trial per person
  updated_at    timestamptz not null default now(),
  check (term = 'lifetime' or ends_at is not null)
);

create table if not exists public.subscription_events (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users on delete cascade,
  at           timestamptz not null default now(),
  kind         text not null,                      -- created | changed | removed | ai
  plan         text,
  term         text,
  source       text,
  ends_at      timestamptz,
  amount_paise int,
  ref          text,
  note         text,
  -- who made the change: 'postgres' = you in the SQL/Table Editor, 'service_role' = webhook/bot
  actor        text not null default coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), session_user)
);
create index if not exists subscription_events_user on public.subscription_events (user_id, at desc);

create table if not exists public.ai_credit_ledger (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  delta   int  not null check (delta <> 0),
  reason  text not null check (reason in ('purchase', 'grant', 'use', 'refund')),
  ref     text,                                    -- payment id / request id: no double counting
  note    text,
  at      timestamptz not null default now(),
  unique (user_id, reason, ref)
);
create index if not exists ai_credit_ledger_user on public.ai_credit_ledger (user_id);

-- ── Who can see what ───────────────────────────────────────────────────────
alter table public.plans               enable row level security;
alter table public.billing_settings    enable row level security;
alter table public.subscriptions       enable row level security;
alter table public.subscription_events enable row level security;
alter table public.ai_credit_ledger    enable row level security;

revoke all on public.plans, public.billing_settings, public.subscriptions,
              public.subscription_events, public.ai_credit_ledger from anon, authenticated;
grant select on public.plans to anon, authenticated;
grant select on public.subscriptions, public.subscription_events, public.ai_credit_ledger to authenticated;

create policy plans_read on public.plans for select to anon, authenticated using (true);
create policy own_subscription on public.subscriptions for select to authenticated using (user_id = auth.uid());
create policy own_events on public.subscription_events for select to authenticated using (user_id = auth.uid());
create policy own_credits on public.ai_credit_ledger for select to authenticated using (user_id = auth.uid());

-- ── Housekeeping triggers ──────────────────────────────────────────────────
create trigger plans_touch before update on public.plans
  for each row execute function public.touch_updated_at();
create trigger billing_settings_touch before update on public.billing_settings
  for each row execute function public.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions
  for each row execute function public.touch_updated_at();

-- Every change to a subscription, however it was made, lands in the history.
create or replace function public.pocket_log_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into subscription_events (user_id, kind, plan, term, source, ends_at, note)
    values (old.user_id, 'removed', old.plan, old.term, old.source, old.ends_at, old.note);
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.plan, new.term, new.source, new.ends_at, new.auto_renew, new.external_ref, new.note)
       is not distinct from (old.plan, old.term, old.source, old.ends_at, old.auto_renew, old.external_ref, old.note) then
    return new;
  end if;
  insert into subscription_events (user_id, kind, plan, term, source, ends_at, ref, note)
  values (new.user_id, case tg_op when 'INSERT' then 'created' else 'changed' end,
          new.plan, new.term, new.source, new.ends_at, new.external_ref, new.note);
  return new;
end $$;

create trigger subscriptions_log after insert or update or delete on public.subscriptions
  for each row execute function public.pocket_log_subscription();

-- ── Entitlements ───────────────────────────────────────────────────────────
-- 'free' (no subscription) | 'active' | 'grace' | 'lapsed' (ended longer than grace_days ago).
create or replace function public.pocket_plan_state(p_ends_at timestamptz, p_has_row boolean, p_grace_days int)
returns text language sql stable as $$
  select case
    when not p_has_row then 'free'
    when p_ends_at is null or p_ends_at > now() then 'active'
    when p_ends_at + make_interval(days => p_grace_days) > now() then 'grace'
    else 'lapsed' end
$$;

-- 'write' | 'read' | 'none' for one feature of a plan in a given state.
create or replace function public.pocket_feature_access(p_included boolean, p_state text)
returns text language sql immutable as $$
  select case when not p_included then 'none'
              when p_state = 'active' then 'write'
              when p_state = 'grace'  then 'read'
              else 'none' end
$$;

create or replace function public.pocket_entitlements_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg   billing_settings;
  sub   subscriptions;
  st    text;
  pl    plans;
  my_email text;
  used  int;
  covered jsonb;
  credits int;
begin
  if p_user is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into cfg from billing_settings where id;
  select * into sub from subscriptions where user_id = p_user;
  st := pocket_plan_state(sub.ends_at, sub.user_id is not null, cfg.grace_days);
  select * into pl from plans where code = case when st in ('free', 'lapsed') then 'free' else sub.plan end;
  select lower(email) into my_email from auth.users where id = p_user;

  select 1 + count(*) into used from family_members m where m.owner_id = p_user and m.deleted_at is null;

  -- Family plans of other people that include me.
  select coalesce(jsonb_agg(jsonb_build_object(
           'ownerId', x.owner_id, 'ownerEmail', x.owner_email, 'plan', x.plan,
           'access', pocket_feature_access(x.sharing, x.state)) order by x.owner_email), '[]')
    into covered
  from (
    -- Each owner who lists me as a family member, my seat number in their list
    -- (earliest-added first), and the state of their plan.
    select m.owner_id, lower(u.email) owner_email, op.code plan, op.sharing, op.seats,
           pocket_plan_state(os.ends_at, true, cfg.grace_days) state,
           (select count(*) from family_members m3
             where m3.owner_id = m.owner_id and m3.deleted_at is null
               and (m3.created_at, m3.id) <= (m.created_at, m.id)) seat
    from family_members m
    join auth.users u on u.id = m.owner_id
    join subscriptions os on os.user_id = m.owner_id
    join plans op on op.code = os.plan
    where m.deleted_at is null and m.owner_id <> p_user and lower(m.email) = my_email
  ) x
  where x.sharing and x.state <> 'lapsed' and x.seat <= x.seats - 1;

  select coalesce(sum(delta), 0) into credits from ai_credit_ledger where user_id = p_user;

  return jsonb_build_object(
    'plan',        pl.code,
    'planName',    pl.name,
    'paidPlan',    sub.plan,                       -- what they bought, even if it has lapsed
    'term',        sub.term,
    'source',      sub.source,
    'state',       st,
    'endsAt',      sub.ends_at,
    'graceUntil',  case when sub.ends_at is not null then sub.ends_at + make_interval(days => cfg.grace_days) end,
    'autoRenew',   coalesce(sub.auto_renew, false),
    'access',      jsonb_build_object(
                     'sync',     pocket_feature_access(pl.sync, st),
                     'telegram', pocket_feature_access(pl.telegram, st),
                     'sharing',  pocket_feature_access(pl.sharing, st)),
    'seats',       pl.seats,
    'seatsUsed',   used,
    'coveredBy',   covered,
    'aiCredits',   credits,
    'trialAvailable', sub.trial_used_at is null
  );
end $$;

create or replace function public.pocket_entitlements() returns jsonb
language sql stable security definer set search_path = public as $$
  select pocket_entitlements_for(auth.uid())
$$;

-- ── Admin (SQL Editor / server only) ───────────────────────────────────────
create or replace function public.pocket_admin_user(p_email text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare uid uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No account with email %', p_email; end if;
  return uid;
end $$;

-- Give someone a plan. term: month | year | trial | lifetime.
-- ends_at defaults to now + 1 month / 1 year / the plan's trial_days; none for lifetime.
create or replace function public.pocket_admin_set_plan(
  p_email text, p_plan text, p_term text,
  p_ends_at timestamptz default null, p_note text default null, p_source text default 'manual')
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := pocket_admin_user(p_email); pl plans; ends timestamptz;
begin
  select * into pl from plans where code = p_plan;
  if pl.code is null then raise exception 'Unknown plan %', p_plan; end if;
  ends := coalesce(p_ends_at, case p_term
            when 'month' then now() + interval '1 month'
            when 'year'  then now() + interval '1 year'
            when 'trial' then now() + make_interval(days => coalesce(pl.trial_days, 14))
            else null end);
  insert into subscriptions as s (user_id, plan, term, source, starts_at, ends_at, note, trial_used_at)
  values (uid, p_plan, p_term, p_source, now(), ends, p_note, case when p_term = 'trial' then now() end)
  on conflict (user_id) do update set
    plan = excluded.plan, term = excluded.term, source = excluded.source,
    starts_at = excluded.starts_at, ends_at = excluded.ends_at, note = excluded.note,
    trial_used_at = coalesce(s.trial_used_at, excluded.trial_used_at);
  return pocket_entitlements_for(uid);
end $$;

-- End someone's plan now (they get the grace period, then Free).
create or replace function public.pocket_admin_end_plan(p_email text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := pocket_admin_user(p_email);
begin
  update subscriptions set ends_at = now(), auto_renew = false, note = coalesce(p_note, note)
  where user_id = uid;
  return pocket_entitlements_for(uid);
end $$;

-- Add (or with a negative number, remove) AI credits. 1 credit = 1 use.
create or replace function public.pocket_admin_grant_ai(p_email text, p_credits int, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := pocket_admin_user(p_email);
begin
  insert into ai_credit_ledger (user_id, delta, reason, note) values (uid, p_credits, 'grant', p_note);
  insert into subscription_events (user_id, kind, note) values (uid, 'ai', format('%s AI credits. %s', p_credits, coalesce(p_note, '')));
  return pocket_entitlements_for(uid);
end $$;

-- Everyone at a glance.
create or replace function public.pocket_admin_overview()
returns table (email text, plan text, term text, state text, ends_at timestamptz,
               seats_used int, ai_credits bigint, signed_up date, note text)
language sql stable security definer set search_path = public as $$
  select lower(u.email)::text, coalesce(s.plan, 'free'), s.term,
         pocket_plan_state(s.ends_at, s.user_id is not null, (select grace_days from billing_settings where id)),
         s.ends_at,
         1 + (select count(*)::int from family_members m where m.owner_id = u.id and m.deleted_at is null),
         (select coalesce(sum(delta), 0) from ai_credit_ledger l where l.user_id = u.id),
         u.created_at::date, s.note
  from auth.users u left join subscriptions s on s.user_id = u.id
  order by u.created_at
$$;

-- ── Execute rights ─────────────────────────────────────────────────────────
-- New functions are callable by everyone by default; take that back.
revoke execute on function
  public.pocket_log_subscription(), public.pocket_plan_state(timestamptz, boolean, int),
  public.pocket_feature_access(boolean, text), public.pocket_entitlements_for(uuid),
  public.pocket_entitlements(), public.pocket_admin_user(text),
  public.pocket_admin_set_plan(text, text, text, timestamptz, text, text),
  public.pocket_admin_end_plan(text, text), public.pocket_admin_grant_ai(text, int, text),
  public.pocket_admin_overview()
from public, anon, authenticated;

grant execute on function public.pocket_entitlements() to authenticated;
grant execute on function public.pocket_entitlements_for(uuid) to service_role;

-- ── Seed: family and friends ───────────────────────────────────────────────
select public.pocket_admin_set_plan(e, 'family', 'lifetime', null, 'Family, free for life', 'comp')
from unnest(array['mshshakir@gmail.com', 'hdshakir@gmail.com', 'sakina0019@gmail.com', 'tshshakir@gmail.com']) e
where exists (select 1 from auth.users where lower(email) = e);
