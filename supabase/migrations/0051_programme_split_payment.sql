-- Habit programme: pay in full (₹500 off) or half now and half at the end.
--
--   programme       the whole fee, less billing_settings.programme_upfront_off_paise
--   programme_half  half the batch price; confirms the place (pay_plan 'split')
--   programme_rest  the other half; any time after the first, asked for when
--                   the 6 weeks end
--
-- The 3 months of Pocket Pro that come with the programme are given once it is
-- fully paid AND the programme has ended (marked completed, or 42 days after
-- the batch started): straight away when the second half is paid late, by the
-- admin's "complete", or by the daily job below.

alter table public.billing_settings
  add column if not exists programme_upfront_off_paise int not null default 50000 check (programme_upfront_off_paise >= 0);

alter table public.programme_applications
  add column if not exists pay_plan       text check (pay_plan in ('full', 'split')),
  add column if not exists rest_order_id  text,
  add column if not exists rest_paid_at   timestamptz,
  add column if not exists pro_granted_at timestamptz;

-- Places confirmed before this change were paid in full.
update public.programme_applications set pay_plan = 'full'
 where pay_plan is null and paid_order_id is not null;

-- ── Prices for one place ────────────────────────────────────────────────────

create or replace function public.pocket_programme_prices(p_price int)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'fullPaise',    p_price,
    'upfrontPaise', greatest(p_price - (select programme_upfront_off_paise from billing_settings where id), 0),
    'halfPaise',    p_price / 2,
    'restPaise',    p_price - p_price / 2)
$$;

-- ── Quote ───────────────────────────────────────────────────────────────────

create or replace function public.pocket_payment_quote_with(p_user uuid, p_product text, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare item jsonb; sub subscriptions; st text; app programme_applications; bat programme_batches; priced jsonb; sw jsonb; pr jsonb;
begin
  if not (select payments_enabled from billing_settings where id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if p_product in ('programme', 'programme_half') then
    select * into app from programme_applications where user_id = p_user and status = 'offered';
    if app.id is null then return jsonb_build_object('ok', false, 'reason', 'no_place'); end if;
    select * into bat from programme_batches where id = app.batch_id;
    if bat.id is null then return jsonb_build_object('ok', false, 'reason', 'no_place'); end if;
    pr := pocket_programme_prices(bat.price_paise);
    item := jsonb_build_object('product', p_product, 'applicationId', app.id,
      'name', 'Habit programme · ' || bat.name || case when p_product = 'programme_half' then ' · first half' else '' end,
      'amountPaise', case when p_product = 'programme_half' then pr->'halfPaise' else pr->'upfrontPaise' end);
  elsif p_product = 'programme_rest' then
    select * into app from programme_applications
     where user_id = p_user and pay_plan = 'split' and rest_paid_at is null and status in ('confirmed', 'completed')
     order by created_at desc limit 1;
    if app.id is null then return jsonb_build_object('ok', false, 'reason', 'no_rest'); end if;
    select * into bat from programme_batches where id = app.batch_id;
    if bat.id is null then return jsonb_build_object('ok', false, 'reason', 'no_rest'); end if;
    pr := pocket_programme_prices(bat.price_paise);
    item := jsonb_build_object('product', p_product, 'applicationId', app.id,
      'name', 'Habit programme · ' || bat.name || ' · second half', 'amountPaise', pr->'restPaise');
  else
    select x into item from jsonb_array_elements(pocket_payment_products()) x where x->>'product' = p_product;
    if item is null then return jsonb_build_object('ok', false, 'reason', 'unknown'); end if;
    item := item - 'sale';
    item := jsonb_set(item, '{amountPaise}', item->'listPaise');
    if p_product = 'drive_backup' and pocket_has_backup(p_user) then return jsonb_build_object('ok', false, 'reason', 'has_backup'); end if;
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

-- ── The 3 months of Pocket Pro ──────────────────────────────────────────────

-- Gives them once, when the place is fully paid and the programme has ended.
-- An active plan is extended by 90 days (lifetime: nothing to add); otherwise
-- Pocket Pro starts now for 90 days.
create or replace function public.pocket_programme_grant_pro(p_app bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare a programme_applications; b programme_batches; sub subscriptions; st text; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into a from programme_applications where id = p_app for update;
  if a.id is null or a.pro_granted_at is not null then return false; end if;
  if not (a.pay_plan = 'full' or (a.pay_plan = 'split' and a.rest_paid_at is not null)) then return false; end if;
  select * into b from programme_batches where id = a.batch_id;
  if not (a.status = 'completed' or (a.status = 'confirmed' and b.starts_on is not null and today >= b.starts_on + 42)) then
    return false;
  end if;

  select * into sub from subscriptions where user_id = a.user_id for update;
  st := pocket_plan_state(sub.ends_at, sub.user_id is not null, (select grace_days from billing_settings where id));
  if sub.user_id is not null and st = 'active' and sub.plan not in ('free', 'promise') then
    if sub.term is distinct from 'lifetime' and sub.ends_at is not null then
      update subscriptions set ends_at = ends_at + interval '90 days',
             note = coalesce(note || ' · ', '') || '+90 days Pocket Pro (habit programme)'
       where user_id = a.user_id;
    end if;
  else
    insert into subscriptions as s (user_id, plan, term, source, starts_at, ends_at, note)
    values (a.user_id, 'family', 'month', 'comp', now(), now() + interval '90 days', '3 months Pocket Pro (habit programme)')
    on conflict (user_id) do update set plan = 'family', term = 'month', source = 'comp', starts_at = now(),
      ends_at = now() + interval '90 days', note = excluded.note, auto_renew = false, day_value_paise = null;
  end if;
  update programme_applications set pro_granted_at = now(), updated_at = now() where id = a.id;
  return true;
end $$;

-- Everyone due their Pocket Pro (run daily).
create or replace function public.pocket_programme_grant_due()
returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from programme_applications
            where pro_granted_at is null and status in ('confirmed', 'completed')
              and (pay_plan = 'full' or (pay_plan = 'split' and rest_paid_at is not null)) loop
    if pocket_programme_grant_pro(r.id) then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke execute on function public.pocket_programme_grant_pro(bigint) from public, anon, authenticated;
revoke execute on function public.pocket_programme_grant_due() from public, anon, authenticated;
revoke execute on function public.pocket_programme_prices(int) from public, anon, authenticated;

select cron.unschedule('programme-pro') where exists (select 1 from cron.job where jobname = 'programme-pro');
select cron.schedule('programme-pro', '41 0 * * *', $cron$ select public.pocket_programme_grant_due() $cron$);

-- ── Fulfil ──────────────────────────────────────────────────────────────────

create or replace function public.pocket_payment_fulfil(p_order text, p_payment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o payment_orders; sub subscriptions; st text; base timestamptz; pl plans; ends timestamptz; sw jsonb; extra int := 0; val numeric;
begin
  select * into o from payment_orders where id = p_order for update;
  if o.id is null then raise exception 'Unknown order %', p_order; end if;
  if o.status = 'paid' then return jsonb_build_object('ok', true, 'applied', false); end if;

  update payment_orders set status = 'paid', payment_id = p_payment, paid_at = now() where id = o.id;
  if o.offer_ids is not null then update offers set uses = uses + 1 where id = any (o.offer_ids); end if;

  if o.product in ('programme', 'programme_half') then
    update programme_applications set status = 'confirmed', confirmed_at = now(), paid_order_id = o.id,
           pay_plan = case when o.product = 'programme_half' then 'split' else 'full' end, updated_at = now()
     where id = o.application_id;
    return jsonb_build_object('ok', true, 'applied', true);
  end if;

  if o.product = 'programme_rest' then
    update programme_applications set rest_order_id = o.id, rest_paid_at = now(), updated_at = now()
     where id = o.application_id;
    perform pocket_programme_grant_pro(o.application_id); -- straight away if the programme has already ended
    return jsonb_build_object('ok', true, 'applied', true);
  end if;

  if o.product = 'drive_backup' then
    insert into addons (user_id, code, payment_id) values (o.user_id, 'drive_backup', p_payment)
    on conflict (user_id, code) do nothing;
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

-- ── What the person sees on the programme page ──────────────────────────────

create or replace function public.pocket_programme_mine()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'id', a.id, 'status', a.status, 'fullName', a.full_name, 'whatsapp', a.whatsapp, 'telegram', a.telegram,
      'household', a.household, 'currentMethod', a.current_method, 'goal', a.goal, 'baselineDays', a.baseline_days,
      'language', a.language, 'preferredTime', a.preferred_time, 'createdAt', a.created_at,
      'payPlan', a.pay_plan, 'restPaid', a.rest_paid_at is not null, 'proGranted', a.pro_granted_at is not null,
      'batch', case when b.id is null then null else
        jsonb_build_object('name', b.name, 'startsOn', b.starts_on, 'endsOn', b.starts_on + 42, 'pricePaise', b.price_paise)
        || pocket_programme_prices(b.price_paise) end,
      'paymentsOpen', (select payments_enabled from billing_settings where id))
    from programme_applications a left join programme_batches b on b.id = a.batch_id
    where a.user_id = auth.uid()
    order by (a.status in ('waitlisted', 'offered', 'confirmed')) desc, a.created_at desc
    limit 1), 'null'::jsonb)
$$;

-- ── Admin: "complete" also gives the Pocket Pro months, if fully paid ───────

create or replace function public.pocket_adm_application(p_id bigint, p_action text, p_args jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a programme_applications; b programme_batches; taken int;
begin
  perform pocket_require_admin();
  select * into a from programme_applications where id = p_id for update;
  if a.id is null then raise exception 'Unknown application %', p_id; end if;
  case p_action
    when 'offer' then
      select * into b from programme_batches where id = (p_args->>'batchId')::bigint;
      if b.id is null then raise exception 'Choose a batch'; end if;
      select count(*) into taken from programme_applications
       where batch_id = b.id and status in ('offered', 'confirmed', 'completed') and id <> a.id;
      if taken >= b.capacity then raise exception 'Batch % is full (% of %)', b.name, taken, b.capacity; end if;
      if a.status not in ('waitlisted', 'offered') then raise exception 'Only someone on the waitlist can be offered a place'; end if;
      update programme_applications set status = 'offered', batch_id = b.id, offered_at = now(), updated_at = now() where id = a.id;
    when 'waitlist' then
      if a.status not in ('offered', 'withdrawn') then raise exception 'Only an offered or withdrawn application goes back to the waitlist'; end if;
      update programme_applications set status = 'waitlisted', batch_id = null, offered_at = null, updated_at = now() where id = a.id;
    when 'confirm' then
      if a.batch_id is null then raise exception 'Offer a place in a batch first'; end if;
      update programme_applications set status = 'confirmed', confirmed_at = now(), pay_plan = coalesce(pay_plan, 'full'), updated_at = now() where id = a.id;
    when 'complete' then
      update programme_applications set status = 'completed', updated_at = now() where id = a.id;
      perform pocket_programme_grant_pro(a.id);
    when 'withdraw' then
      update programme_applications set status = 'withdrawn', updated_at = now() where id = a.id;
    when 'notes' then
      update programme_applications set admin_notes = nullif(p_args->>'notes', ''), updated_at = now() where id = a.id;
    else raise exception 'Unknown action %', p_action;
  end case;
  perform pocket_adm_log('application_' || p_action, p_id::text, p_args);
  return pocket_adm_programme();
end $$;
