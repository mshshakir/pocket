-- Switching plans: the time left on a paid plan becomes extra days on the new one.
--
-- The time left is valued at what one day of the current plan was paid for
-- (subscriptions.day_value_paise; for older rows, the last paid order, never
-- more than the plan's list price), then turned into days of the new plan at
-- its list price for the term being bought.
--   Moving up:   pay the full price; the credit is added as extra days.
--   Moving down: no payment; the credit becomes the whole new period.
-- Trials, plans given by an admin and lifetime plans carry no credit.

alter table public.subscriptions add column if not exists day_value_paise numeric;

-- One day of a plan at list price for a term (null when that term isn't sold).
create or replace function public.pocket_plan_day_rate(p plans, p_term text) returns numeric
language sql immutable as $$
  select case
    when p_term = 'month' and p.monthly_paise is not null then p.monthly_paise / 30.4375
    when p.yearly_paise is not null then p.yearly_paise / 365.25
    when p.monthly_paise is not null then p.monthly_paise / 30.4375
  end
$$;

-- What the time left is worth on another plan: {fromPlan, fromName, creditPaise, days, lower} or null.
create or replace function public.pocket_switch_credit(p_user uuid, p_plan text, p_term text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare sub subscriptions; cur plans; tgt plans; last payment_orders; val numeric; credit numeric; rate numeric; days int;
begin
  select * into sub from subscriptions where user_id = p_user;
  if sub.user_id is null or sub.plan = p_plan or sub.term not in ('month', 'year')
     or sub.source <> 'razorpay' or sub.ends_at is null or sub.ends_at <= now() then return null; end if;
  select * into cur from plans where code = sub.plan;
  select * into tgt from plans where code = p_plan;
  if tgt.code is null or tgt.code = 'free' then return null; end if;

  val := sub.day_value_paise;
  if val is null then
    select * into last from payment_orders
     where user_id = p_user and status = 'paid' and plan = sub.plan and term in ('month', 'year')
     order by paid_at desc limit 1;
    if last.id is null then return null; end if;
    val := least(last.amount_paise / case last.term when 'month' then 30.4375 else 365.25 end,
                 coalesce(pocket_plan_day_rate(cur, last.term), 1e12));
  end if;

  credit := floor(extract(epoch from sub.ends_at - now()) / 86400 * val);
  rate := pocket_plan_day_rate(tgt, p_term);
  if rate is null or rate <= 0 or credit <= 0 then return null; end if;
  days := floor(credit / rate);
  if days < 1 then return null; end if;
  return jsonb_build_object('fromPlan', cur.code, 'fromName', cur.name, 'creditPaise', credit::int, 'days', days,
    'lower', coalesce(tgt.yearly_paise, tgt.monthly_paise * 12) < coalesce(cur.yearly_paise, cur.monthly_paise * 12));
end $$;

-- For the plan chooser: every other plan this person could switch to, with the days their time left gives.
create or replace function public.pocket_switch_options(p_user uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(p.code, c), '{}')
    from plans p
    cross join lateral (select pocket_switch_credit(p_user, p.code, (select term from subscriptions where user_id = p_user)) c) x
   where p.active and p.code <> 'free' and c is not null
$$;

-- Moving down to a cheaper plan: no payment, the time left becomes days on it.
create or replace function public.pocket_payment_switch(p_user uuid, p_plan text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare sub subscriptions; tgt plans; sw jsonb; ends timestamptz;
begin
  if not (select payments_enabled from billing_settings where id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;
  select * into sub from subscriptions where user_id = p_user for update;
  select * into tgt from plans where code = p_plan and active;
  if tgt.code is null or tgt.code = 'free' then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
  sw := pocket_switch_credit(p_user, p_plan, sub.term);
  if sw is null then return jsonb_build_object('ok', false, 'reason', 'no_credit'); end if;
  if not (sw->>'lower')::boolean then return jsonb_build_object('ok', false, 'reason', 'not_lower'); end if;
  ends := now() + make_interval(days => (sw->>'days')::int);
  update subscriptions set plan = p_plan, starts_at = now(), ends_at = ends,
         day_value_paise = (sw->>'creditPaise')::numeric / (sw->>'days')::int,
         note = 'Switched from ' || (sw->>'fromName') || ' (time left as days)', auto_renew = false
   where user_id = p_user;
  return jsonb_build_object('ok', true, 'applied', true, 'plan', p_plan, 'days', (sw->>'days')::int, 'endsAt', ends);
end $$;

-- The price check now also says how many extra days a switch brings.
create or replace function public.pocket_payment_quote_with(p_user uuid, p_product text, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare item jsonb; sub subscriptions; st text; app programme_applications; bat programme_batches; priced jsonb; sw jsonb;
begin
  if not (select payments_enabled from billing_settings where id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if p_product = 'programme' then
    select * into app from programme_applications where user_id = p_user and status = 'offered';
    if app.id is null then return jsonb_build_object('ok', false, 'reason', 'no_place'); end if;
    select * into bat from programme_batches where id = app.batch_id;
    if bat.id is null then return jsonb_build_object('ok', false, 'reason', 'no_place'); end if;
    item := jsonb_build_object('product', 'programme', 'name', 'Habit programme · ' || bat.name,
                               'applicationId', app.id, 'amountPaise', bat.price_paise);
  else
    select x into item from jsonb_array_elements(pocket_payment_products()) x where x->>'product' = p_product;
    if item is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
    item := item - 'sale';
    item := jsonb_set(item, '{amountPaise}', item->'listPaise');
    select * into sub from subscriptions where user_id = p_user;
    st := pocket_plan_state(sub.ends_at, sub.user_id is not null, (select grace_days from billing_settings where id));
    if item ? 'plan' and sub.term = 'lifetime' and st = 'active' then return jsonb_build_object('ok', false, 'reason', 'lifetime'); end if;
    if item->>'term' = 'trial' and sub.trial_used_at is not null then return jsonb_build_object('ok', false, 'reason', 'trial_used'); end if;
    if item->>'term' = 'trial' and st = 'active' then return jsonb_build_object('ok', false, 'reason', 'has_plan'); end if;
    if item->>'term' in ('month', 'year') then
      sw := pocket_switch_credit(p_user, item->>'plan', item->>'term');
      if sw is not null then item := item || jsonb_build_object('switchDays', sw->'days', 'switchFrom', sw->'fromName'); end if;
    end if;
  end if;

  priced := pocket_offer_price(p_product, (item->>'amountPaise')::int, p_code);
  if priced ? 'couponError' then
    return jsonb_build_object('ok', false, 'reason', 'coupon_' || (priced->>'couponError'));
  end if;
  return jsonb_build_object('ok', true) || (item - 'sort' - 'listPaise') || priced;
end $$;

-- Applying a payment: a switch to another plan adds the time left as extra days,
-- and the day's value is kept for the next switch.
create or replace function public.pocket_payment_fulfil(p_order text, p_payment text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o payment_orders; sub subscriptions; st text; base timestamptz; pl plans; ends timestamptz; sw jsonb; extra int := 0; val numeric;
begin
  select * into o from payment_orders where id = p_order for update;
  if o.id is null then raise exception 'Unknown order %', p_order; end if;
  if o.status = 'paid' then return jsonb_build_object('ok', true, 'applied', false); end if;

  update payment_orders set status = 'paid', payment_id = p_payment, paid_at = now() where id = o.id;
  if o.offer_ids is not null then update offers set uses = uses + 1 where id = any (o.offer_ids); end if;

  if o.product = 'programme' then
    update programme_applications set status = 'confirmed', confirmed_at = now(), paid_order_id = o.id, updated_at = now()
     where id = o.application_id;
    return jsonb_build_object('ok', true, 'applied', true);
  end if;

  if o.ai_credits is not null then
    insert into ai_credit_ledger (user_id, delta, reason, ref, note)
    values (o.user_id, o.ai_credits, 'purchase', p_payment, 'AI pack (Razorpay)')
    on conflict (user_id, reason, ref) do nothing;
    return jsonb_build_object('ok', true, 'applied', true);
  end if;

  select * into pl from plans where code = o.plan;
  select * into sub from subscriptions where user_id = o.user_id for update;
  st := pocket_plan_state(sub.ends_at, sub.user_id is not null, (select grace_days from billing_settings where id));
  if o.term in ('month', 'year') then
    sw := pocket_switch_credit(o.user_id, o.plan, o.term);
    extra := coalesce((sw->>'days')::int, 0);
  end if;
  base := case when sub.plan = o.plan and st = 'active' and sub.ends_at is not null then sub.ends_at else now() end;
  ends := base + case o.term when 'month' then interval '1 month'
                             when 'year'  then interval '1 year'
                             else make_interval(days => coalesce(pl.trial_days, 14)) end
               + make_interval(days => extra);
  val := case when o.term in ('month', 'year')
              then least(o.amount_paise / case o.term when 'month' then 30.4375 else 365.25 end,
                         coalesce(pocket_plan_day_rate(pl, o.term), 1e12)) end;

  insert into subscriptions as s (user_id, plan, term, source, starts_at, ends_at, external_ref, note, trial_used_at, day_value_paise)
  values (o.user_id, o.plan, o.term, 'razorpay', now(), ends, p_payment,
          'Paid ' || o.product || case when extra > 0 then ' (+' || extra || ' days from ' || (sw->>'fromName') || ')' else '' end,
          case when o.term = 'trial' then now() end, val)
  on conflict (user_id) do update set
    plan = excluded.plan, term = excluded.term, source = 'razorpay',
    starts_at = case when s.plan = excluded.plan and base <> now() then s.starts_at else now() end,
    ends_at = excluded.ends_at, external_ref = excluded.external_ref, note = excluded.note,
    auto_renew = false, day_value_paise = excluded.day_value_paise,
    trial_used_at = coalesce(s.trial_used_at, excluded.trial_used_at);

  update subscription_events set amount_paise = o.amount_paise
  where id = (select max(id) from subscription_events where user_id = o.user_id);
  return jsonb_build_object('ok', true, 'applied', true, 'extraDays', extra);
end $$;

revoke execute on function public.pocket_switch_credit(uuid, text, text), public.pocket_switch_options(uuid),
  public.pocket_payment_switch(uuid, text), public.pocket_plan_day_rate(plans, text)
  from public, anon, authenticated;
grant execute on function public.pocket_switch_credit(uuid, text, text), public.pocket_switch_options(uuid),
  public.pocket_payment_switch(uuid, text), public.pocket_plan_day_rate(plans, text)
  to service_role;
