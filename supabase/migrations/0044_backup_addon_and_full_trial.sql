-- 0044 · Scheduled Google Drive backups as a one-time add-on; the trial is
-- called the "Full trial".
--
-- Decided by the owner on 16 Nov 2026:
--   · Free: backing up by hand (Back up now) and restoring stay free.
--     Scheduled and automatic backups are a one-time add-on, ₹199
--     (billing_settings.backup_paise), product 'drive_backup'.
--   · Sync and Family (and people covered by a Family plan) have it included.
--   · The ₹50 / 14-day trial is named "Full trial" (it gives everything).
--
-- The backup itself runs on the person's device; the server only remembers
-- who has the add-on (table addons) and says so in pocket_entitlements().
--
-- Create-or-replace and additive changes only: nothing is dropped or deleted.

alter table public.billing_settings
  add column if not exists backup_paise int not null default 19900 check (backup_paise > 0);

-- One row per add-on a person has bought. Kept for good (a one-time purchase).
create table if not exists public.addons (
  user_id    uuid not null,
  code       text not null check (code ~ '^[a-z][a-z0-9_]*$'),
  bought_at  timestamptz not null default now(),
  payment_id text,
  primary key (user_id, code)
);
alter table public.addons enable row level security;
revoke all on public.addons from anon, authenticated;

-- Whether scheduled / automatic backups are switched on for this person:
-- they bought the add-on, are on an active paid plan, or are covered by one.
create or replace function public.pocket_has_backup(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select p_user is not null and (
    exists (select 1 from addons a where a.user_id = p_user and a.code = 'drive_backup')
    or coalesce((select (e->>'plan') <> 'free' and (e->>'state') = 'active'
                        or jsonb_array_length(coalesce(e->'coveredBy', '[]'::jsonb)) > 0
                   from (select pocket_entitlements_for(p_user) e) x), false))
$$;

-- What can be bought: adds the backup add-on; the trial is the "Full trial".
create or replace function public.pocket_payment_products() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x || (pocket_offer_price(x->>'product', (x->>'amountPaise')::int, null) - 'offerIds')
                  order by (x->>'sort')::int, x->>'product'), '[]') from (
    select jsonb_build_object('product', p.code || '_month', 'name', p.name || ' · 1 month', 'plan', p.code,
                              'term', 'month', 'amountPaise', p.monthly_paise, 'sort', p.sort * 10 + 1) x
      from plans p where p.active and p.monthly_paise > 0
    union all
    select jsonb_build_object('product', p.code || '_year', 'name', p.name || ' · 1 year', 'plan', p.code,
                              'term', 'year', 'amountPaise', p.yearly_paise, 'sort', p.sort * 10 + 2)
      from plans p where p.active and p.yearly_paise > 0
    union all
    select jsonb_build_object('product', p.code || '_trial', 'name', 'Full trial · ' || p.trial_days || ' days', 'plan', p.code,
                              'term', 'trial', 'amountPaise', p.trial_paise, 'sort', p.sort * 10)
      from plans p where p.active and p.trial_paise > 0 and p.trial_days > 0
    union all
    select jsonb_build_object('product', 'drive_backup', 'name', 'Scheduled Google Drive backups', 'addon', 'drive_backup',
                              'amountPaise', b.backup_paise, 'sort', 998)
      from billing_settings b where b.id
    union all
    select jsonb_build_object('product', 'ai_pack', 'name', 'AI pack · ' || (b.ai_pack_paise / b.ai_credit_paise) || ' credits',
                              'aiCredits', b.ai_pack_paise / b.ai_credit_paise, 'amountPaise', b.ai_pack_paise, 'sort', 999)
      from billing_settings b where b.id
  ) s
$$;

-- What one product costs for this person, or why they can't buy it. As
-- before, plus: the backup add-on can't be bought twice or on top of a plan
-- that includes it (reason 'has_backup').
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

-- Apply a paid order once. As before, plus the backup add-on.
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

-- What the app is told: also whether scheduled backups are switched on.
create or replace function public.pocket_entitlements() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg billing_settings;
begin
  select * into cfg from billing_settings where id;
  if me is not null and not exists (select 1 from ai_credit_ledger where user_id = me and reason = 'grant' and ref = 'welcome') then
    perform pocket_ai_welcome(me);
  end if;
  return pocket_entitlements_for(me)
         || jsonb_build_object('paymentsOpen', cfg.payments_enabled,
                               'backup', pocket_has_backup(me),
                               'aiCosts', jsonb_build_object('scan', cfg.ai_scan_credits, 'voice', cfg.ai_voice_credits,
                                                             'voiceSeconds', cfg.ai_voice_block_secs));
end $$;

revoke execute on function public.pocket_has_backup(uuid) from public, anon, authenticated;
grant execute on function public.pocket_has_backup(uuid) to service_role;
revoke execute on function public.pocket_payment_products(), public.pocket_payment_quote_with(uuid, text, text),
  public.pocket_payment_fulfil(text, text) from public, anon, authenticated;
grant execute on function public.pocket_payment_products(), public.pocket_payment_quote_with(uuid, text, text),
  public.pocket_payment_fulfil(text, text) to service_role;
revoke execute on function public.pocket_entitlements() from public, anon;
grant execute on function public.pocket_entitlements() to authenticated;
