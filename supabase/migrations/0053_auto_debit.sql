-- 0053 · Auto-debit (Razorpay Subscriptions) for plans that renew by
-- themselves: the ₹30 promise (monthly), Pocket Pro (monthly or yearly) and
-- Pocket Pro Group (yearly). Pocket Plus, AI packs, the 3-month offer and the
-- habit programme stay one-time payments.
--
-- Each charge Razorpay makes (the first and every renewal) becomes an
-- ordinary payment_orders row ('sub:' || payment id) and goes through
-- pocket_payment_fulfil, so end dates, upgrade credit and the history work
-- exactly as for one-time payments. Then the plan is marked auto_renew, and a
-- promise month adds its 150 AI credits.
--
-- Subscriptions are charged at the plan's list price: sales and coupon codes
-- apply to one-time payments only.
--
-- Cancelling stops future charges; the time already paid for runs to its end.
-- Moving to another renewing plan cancels the old one after the first charge
-- of the new one (the remaining time is credited as extra days, as for any
-- upgrade).
--
-- No DROP or DELETE.

-- Razorpay plan ids, one per product and price (a price change makes a new one).
create table if not exists public.razorpay_plans (
  product      text not null,
  amount_paise int  not null check (amount_paise > 0),
  rp_plan_id   text not null unique,
  created_at   timestamptz not null default now(),
  primary key (product, amount_paise)
);

create table if not exists public.razorpay_subscriptions (
  id           text primary key,                 -- Razorpay's sub_…
  user_id      uuid not null,
  product      text not null,
  plan         text not null references public.plans (code),
  term         text not null check (term in ('month', 'year')),
  amount_paise int  not null check (amount_paise > 0),
  rp_plan_id   text not null,
  status       text not null default 'created'
               check (status in ('created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired', 'paused', 'replaced')),
  charges      int  not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  ended_at     timestamptz
);
create index if not exists razorpay_subscriptions_user on public.razorpay_subscriptions (user_id, created_at desc);

alter table public.razorpay_plans enable row level security;
alter table public.razorpay_subscriptions enable row level security;
revoke all on public.razorpay_plans, public.razorpay_subscriptions from anon, authenticated;

-- Statuses in which a subscription will charge again.
create or replace function public.pocket_sub_live(p_status text) returns boolean
language sql immutable as $$ select p_status in ('authenticated', 'active', 'pending') $$;

-- ── May this person start auto-debit for this product? ────────────────────
-- p_product: '<plan>_month' | '<plan>_year'. Returns
-- {ok, renewing: true, product, plan, term, amountPaise, name, totalCount} or
-- {ok: false, renewing, reason}. renewing: false means "not an auto-debit
-- product, use a one-time order".
create or replace function public.pocket_subscription_quote(p_user uuid, p_product text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg billing_settings; code text; term text; pl plans; amount int; sub subscriptions; eff record;
begin
  select * into cfg from billing_settings where id;
  if p_product !~ '^[a-z]+_(month|year)$' then return jsonb_build_object('ok', false, 'renewing', false); end if;
  code := split_part(p_product, '_', 1);
  term := split_part(p_product, '_', 2);
  select * into pl from plans where plans.code = split_part(p_product, '_', 1);
  if pl.code is null or pl.code = 'free' or not (pl.active or pl.code = 'promise') then
    return jsonb_build_object('ok', false, 'renewing', false);
  end if;
  amount := case term when 'month' then pl.monthly_paise else pl.yearly_paise end;
  if coalesce(amount, 0) <= 0 then return jsonb_build_object('ok', false, 'renewing', false); end if;
  if not cfg.payments_enabled then return jsonb_build_object('ok', false, 'renewing', true, 'reason', 'closed'); end if;

  select * into sub from subscriptions where user_id = p_user;
  if sub.term = 'lifetime' then return jsonb_build_object('ok', false, 'renewing', true, 'reason', 'lifetime'); end if;
  if exists (select 1 from razorpay_subscriptions r where r.user_id = p_user and pocket_sub_live(r.status) and r.product = p_product) then
    return jsonb_build_object('ok', false, 'renewing', true, 'reason', 'has_subscription');
  end if;
  -- The promise is for people without a plan: Pocket Pro already lets you add entries.
  if pl.code = 'promise' then
    select * into eff from pocket_effective_plan(p_user);
    if eff.state = 'active' and eff.plan <> 'promise' then
      return jsonb_build_object('ok', false, 'renewing', true, 'reason', 'has_plan');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'renewing', true, 'product', p_product, 'plan', pl.code, 'term', term,
    'amountPaise', amount, 'name', pl.name || case term when 'month' then ' · monthly' else ' · yearly' end,
    'totalCount', case term when 'month' then 120 else 10 end);
end $$;

-- ── Razorpay plan ids ─────────────────────────────────────────────────────
create or replace function public.pocket_rp_plan_get(p_product text, p_amount int) returns text
language sql stable security definer set search_path = public as $$
  select rp_plan_id from razorpay_plans where product = p_product and amount_paise = p_amount
$$;

create or replace function public.pocket_rp_plan_save(p_product text, p_amount int, p_plan_id text) returns text
language plpgsql security definer set search_path = public as $$
begin
  insert into razorpay_plans (product, amount_paise, rp_plan_id) values (p_product, p_amount, p_plan_id)
  on conflict (product, amount_paise) do nothing;
  return pocket_rp_plan_get(p_product, p_amount);
end $$;

-- A subscription Razorpay has just created, before it is paid.
create or replace function public.pocket_subscription_save(p_id text, p_user uuid, p_quote jsonb, p_rp_plan text) returns void
language sql security definer set search_path = public as $$
  insert into razorpay_subscriptions (id, user_id, product, plan, term, amount_paise, rp_plan_id)
  values (p_id, p_user, p_quote->>'product', p_quote->>'plan', p_quote->>'term', (p_quote->>'amountPaise')::int, p_rp_plan)
  on conflict (id) do nothing
$$;

create or replace function public.pocket_subscription_owner(p_id text) returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from razorpay_subscriptions where id = p_id
$$;

-- ── A charge ──────────────────────────────────────────────────────────────
-- Applies one paid charge. Safe to repeat (the app and the webhook both call
-- it). Returns {ok, applied, cancel: [ids of the person's other renewing
-- subscriptions, now replaced — the caller cancels them at Razorpay]}.
create or replace function public.pocket_subscription_charge(p_sub text, p_payment text, p_amount int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r razorpay_subscriptions; oid text := 'sub:' || p_payment; res jsonb; old text[];
begin
  select * into r from razorpay_subscriptions where id = p_sub for update;
  if r.id is null then raise exception 'Unknown subscription %', p_sub; end if;
  if coalesce(p_payment, '') = '' then raise exception 'payment id is required'; end if;

  if exists (select 1 from payment_orders where id = oid and status = 'paid') then
    return jsonb_build_object('ok', true, 'applied', false, 'cancel', '[]'::jsonb);
  end if;
  insert into payment_orders (id, user_id, product, plan, term, amount_paise, list_paise)
  values (oid, r.user_id, r.product, r.plan, r.term, coalesce(nullif(p_amount, 0), r.amount_paise), r.amount_paise)
  on conflict (id) do nothing;
  res := pocket_payment_fulfil(oid, p_payment);

  update subscriptions set auto_renew = true, external_ref = r.id,
         note = 'Auto-debit ' || r.product || ' (charge ' || (r.charges + 1) || ')'
   where user_id = r.user_id;
  if r.plan = 'promise' then perform pocket_promise_credits(r.user_id, p_payment); end if;

  update razorpay_subscriptions set status = 'active', charges = charges + 1, updated_at = now() where id = r.id;

  select coalesce(array_agg(id), '{}') into old from razorpay_subscriptions
   where user_id = r.user_id and id <> r.id and pocket_sub_live(status);
  update razorpay_subscriptions set status = 'replaced', ended_at = now(), updated_at = now() where id = any (old);

  return jsonb_build_object('ok', true, 'applied', coalesce((res->>'applied')::boolean, true), 'cancel', to_jsonb(old));
end $$;

-- A status change from Razorpay (authenticated, halted, cancelled, …). When
-- the subscription that renews the plan stops, the plan stops renewing (the
-- paid time still runs to its end).
create or replace function public.pocket_subscription_status(p_sub text, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r razorpay_subscriptions;
begin
  select * into r from razorpay_subscriptions where id = p_sub for update;
  if r.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  if r.status = 'replaced' or p_status not in ('authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired', 'paused') then
    return jsonb_build_object('ok', true, 'changed', false);
  end if;
  update razorpay_subscriptions set status = p_status, updated_at = now(),
         ended_at = case when pocket_sub_live(p_status) then null else coalesce(ended_at, now()) end
   where id = r.id;
  if not pocket_sub_live(p_status) then
    update subscriptions set auto_renew = false where user_id = r.user_id and external_ref = r.id;
  end if;
  return jsonb_build_object('ok', true, 'changed', true);
end $$;

-- The person's renewing subscription, if any (to cancel it).
create or replace function public.pocket_subscription_current(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', r.id, 'product', r.product, 'plan', r.plan, 'term', r.term, 'status', r.status)
    from razorpay_subscriptions r where r.user_id = p_user and pocket_sub_live(r.status)
   order by r.created_at desc limit 1
$$;

revoke execute on function public.pocket_subscription_quote(uuid, text), public.pocket_rp_plan_get(text, int),
  public.pocket_rp_plan_save(text, int, text), public.pocket_subscription_save(text, uuid, jsonb, text),
  public.pocket_subscription_owner(text), public.pocket_subscription_charge(text, text, int),
  public.pocket_subscription_status(text, text), public.pocket_subscription_current(uuid) from public, anon, authenticated;
grant execute on function public.pocket_subscription_quote(uuid, text), public.pocket_rp_plan_get(text, int),
  public.pocket_rp_plan_save(text, int, text), public.pocket_subscription_save(text, uuid, jsonb, text),
  public.pocket_subscription_owner(text), public.pocket_subscription_charge(text, text, int),
  public.pocket_subscription_status(text, text), public.pocket_subscription_current(uuid) to service_role;
