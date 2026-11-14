-- 0021 · Paid plans, phase 5: payments (Razorpay, one-time).
--
-- What can be bought (prices always from the plans table / billing_settings,
-- never from the app):
--   sync_month, sync_year, family_month, family_year   a plan for that term
--   family_trial                                        the paid trial, once per person
--   ai_pack                                             AI credits (ai_pack_paise / ai_credit_paise)
--
-- One-time payments, no auto-renew. Paying for the plan you already have adds
-- the term to its end date; paying for a different plan starts it now.
-- Accounts with a plan for life can't buy plans (they can buy AI packs).
--
-- Flow (server functions `payments` and `razorpay-webhook`):
--   1. pocket_payment_quote(user, product)   → what it costs, or why it can't be bought
--   2. the function creates the Razorpay order and records it (payment_orders)
--   3. after payment, the app's confirmation or Razorpay's webhook (whichever
--      arrives first) calls pocket_payment_fulfil(order, payment) — applied once.
--
-- Switch: billing_settings.payments_enabled (off until Razorpay keys are set).

alter table public.billing_settings add column if not exists payments_enabled boolean not null default false;

create table if not exists public.payment_orders (
  id           text primary key,                       -- Razorpay order id
  user_id      uuid not null references auth.users on delete cascade,
  product      text not null,
  plan         text references public.plans (code),
  term         text check (term in ('month', 'year', 'trial')),
  ai_credits   int,
  amount_paise int not null check (amount_paise > 0),
  currency     text not null default 'INR',
  status       text not null default 'created' check (status in ('created', 'paid')),
  payment_id   text unique,
  created_at   timestamptz not null default now(),
  paid_at      timestamptz
);
create index if not exists payment_orders_user on public.payment_orders (user_id, created_at desc);

alter table public.payment_orders enable row level security;
revoke all on public.payment_orders from anon, authenticated;
grant select on public.payment_orders to authenticated;
create policy own_orders on public.payment_orders for select to authenticated using (user_id = auth.uid());

-- ── Products ───────────────────────────────────────────────────────────────
-- Everything on sale now: [{product, name, plan, term, aiCredits, amountPaise}].
create or replace function public.pocket_payment_products() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x order by (x->>'sort')::int, x->>'product'), '[]') from (
    select jsonb_build_object('product', p.code || '_month', 'name', p.name || ' · 1 month', 'plan', p.code,
                              'term', 'month', 'amountPaise', p.monthly_paise, 'sort', p.sort * 10 + 1) x
      from plans p where p.active and p.monthly_paise > 0
    union all
    select jsonb_build_object('product', p.code || '_year', 'name', p.name || ' · 1 year', 'plan', p.code,
                              'term', 'year', 'amountPaise', p.yearly_paise, 'sort', p.sort * 10 + 2)
      from plans p where p.active and p.yearly_paise > 0
    union all
    select jsonb_build_object('product', p.code || '_trial', 'name', p.name || ' · ' || p.trial_days || '-day trial', 'plan', p.code,
                              'term', 'trial', 'amountPaise', p.trial_paise, 'sort', p.sort * 10)
      from plans p where p.active and p.trial_paise > 0 and p.trial_days > 0
    union all
    select jsonb_build_object('product', 'ai_pack', 'name', 'AI pack · ' || (b.ai_pack_paise / b.ai_credit_paise) || ' uses',
                              'aiCredits', b.ai_pack_paise / b.ai_credit_paise, 'amountPaise', b.ai_pack_paise, 'sort', 999)
      from billing_settings b where b.id
  ) s
$$;

-- What one product costs for this person, or why they can't buy it:
-- {ok, product, name, plan, term, aiCredits, amountPaise} | {ok:false, reason}
-- reason: closed | unknown | lifetime | trial_used | has_plan (a trial while paying for a plan)
create or replace function public.pocket_payment_quote(p_user uuid, p_product text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare item jsonb; sub subscriptions; st text;
begin
  if not (select payments_enabled from billing_settings where id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  select x into item from jsonb_array_elements(pocket_payment_products()) x where x->>'product' = p_product;
  if item is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  select * into sub from subscriptions where user_id = p_user;
  st := pocket_plan_state(sub.ends_at, sub.user_id is not null, (select grace_days from billing_settings where id));
  if item ? 'plan' and sub.term = 'lifetime' and st = 'active' then
    return jsonb_build_object('ok', false, 'reason', 'lifetime');
  end if;
  if item->>'term' = 'trial' and sub.trial_used_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'trial_used');
  end if;
  if item->>'term' = 'trial' and st = 'active' then
    return jsonb_build_object('ok', false, 'reason', 'has_plan');
  end if;
  return jsonb_build_object('ok', true) || (item - 'sort');
end $$;

-- ── Fulfilment ─────────────────────────────────────────────────────────────
-- Apply a paid order once. Returns {ok, applied: true|false (already applied)}.
create or replace function public.pocket_payment_fulfil(p_order text, p_payment text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o payment_orders; sub subscriptions; st text; base timestamptz; pl plans; ends timestamptz;
begin
  select * into o from payment_orders where id = p_order for update;
  if o.id is null then raise exception 'Unknown order %', p_order; end if;
  if o.status = 'paid' then return jsonb_build_object('ok', true, 'applied', false); end if;

  update payment_orders set status = 'paid', payment_id = p_payment, paid_at = now() where id = o.id;

  if o.ai_credits is not null then
    insert into ai_credit_ledger (user_id, delta, reason, ref, note)
    values (o.user_id, o.ai_credits, 'purchase', p_payment, 'AI pack (Razorpay)')
    on conflict (user_id, reason, ref) do nothing;
    return jsonb_build_object('ok', true, 'applied', true);
  end if;

  select * into pl from plans where code = o.plan;
  select * into sub from subscriptions where user_id = o.user_id for update;
  st := pocket_plan_state(sub.ends_at, sub.user_id is not null, (select grace_days from billing_settings where id));

  -- The same plan, still active: add the term to its end. Otherwise start now.
  base := case when sub.plan = o.plan and st = 'active' and sub.ends_at is not null then sub.ends_at else now() end;
  ends := base + case o.term when 'month' then interval '1 month'
                             when 'year'  then interval '1 year'
                             else make_interval(days => coalesce(pl.trial_days, 14)) end;

  insert into subscriptions as s (user_id, plan, term, source, starts_at, ends_at, external_ref, note, trial_used_at)
  values (o.user_id, o.plan, o.term, 'razorpay', now(), ends, p_payment, 'Paid ' || o.product,
          case when o.term = 'trial' then now() end)
  on conflict (user_id) do update set
    plan = excluded.plan, term = excluded.term, source = 'razorpay',
    starts_at = case when s.plan = excluded.plan and base <> now() then s.starts_at else now() end,
    ends_at = excluded.ends_at, external_ref = excluded.external_ref, note = excluded.note,
    auto_renew = false,
    trial_used_at = coalesce(s.trial_used_at, excluded.trial_used_at);

  update subscription_events set amount_paise = o.amount_paise
  where id = (select max(id) from subscription_events where user_id = o.user_id);
  return jsonb_build_object('ok', true, 'applied', true);
end $$;

-- Entitlements: say whether payments are open, so the app shows buy buttons.
create or replace function public.pocket_entitlements() returns jsonb
language sql stable security definer set search_path = public as $$
  select pocket_entitlements_for(auth.uid())
         || jsonb_build_object('paymentsOpen', (select payments_enabled from billing_settings where id))
$$;

revoke execute on function public.pocket_payment_products(), public.pocket_payment_quote(uuid, text),
  public.pocket_payment_fulfil(text, text) from public, anon, authenticated;
grant execute on function public.pocket_payment_quote(uuid, text), public.pocket_payment_fulfil(text, text),
  public.pocket_payment_products() to service_role;
revoke execute on function public.pocket_entitlements() from public, anon;
grant execute on function public.pocket_entitlements() to authenticated;
