-- Habit programme: when a batch is open with places left, applying offers a
-- place in it straight away, so the person can pay there and then. The place
-- is held for 48 hours (hold_until); unpaid by then, it goes back to the
-- batch and the person back to the waitlist. People on the waitlist get a
-- place the same way when they open the programme page and one is free.
-- Places the admin offers by hand have no hold, as before.

alter table public.programme_applications add column if not exists hold_until timestamptz;

-- Offers this application a place in the earliest open batch with room. The
-- batch row is locked while counting, so two people can't take its last place.
create or replace function public.pocket_programme_seat(p_app bigint)
returns boolean language plpgsql security definer set search_path = public as $$
declare a programme_applications; b record; taken int;
begin
  select * into a from programme_applications where id = p_app for update;
  if a.id is null or a.status <> 'waitlisted' then return false; end if;
  -- Only while payments are open: a held place must be one they can pay for.
  if not (select payments_enabled from billing_settings where id) then return false; end if;
  for b in select pb.* from programme_batches pb order by pb.starts_on nulls last, pb.id loop
    perform 1 from programme_batches where id = b.id for update;
    select count(*)::int into taken from programme_applications
     where batch_id = b.id and status in ('offered', 'confirmed', 'completed');
    if pocket_programme_state(b.status, b.starts_on, b.opens_on, b.closes_on, b.closed_now, b.capacity, taken) = 'open' then
      update programme_applications set status = 'offered', batch_id = b.id, offered_at = now(),
             hold_until = now() + interval '48 hours', updated_at = now()
       where id = a.id;
      return true;
    end if;
  end loop;
  return false;
end $$;

-- Places held but not paid in time go back.
create or replace function public.pocket_programme_release_holds()
returns int language sql security definer set search_path = public as $$
  with r as (
    update programme_applications set status = 'waitlisted', batch_id = null, offered_at = null, hold_until = null, updated_at = now()
     where status = 'offered' and hold_until is not null and hold_until < now()
    returning 1)
  select count(*)::int from r
$$;

-- The signed-in person, if on the waitlist: a place now, if one is free.
create or replace function public.pocket_programme_claim()
returns jsonb language plpgsql security definer set search_path = public as $$
declare app_id bigint;
begin
  perform pocket_programme_release_holds();
  select id into app_id from programme_applications where user_id = auth.uid() and status = 'waitlisted';
  if app_id is not null then perform pocket_programme_seat(app_id); end if;
  return pocket_programme_mine();
end $$;

revoke execute on function public.pocket_programme_seat(bigint) from public, anon, authenticated;
revoke execute on function public.pocket_programme_release_holds() from public, anon, authenticated;
revoke execute on function public.pocket_programme_claim() from public, anon;
grant execute on function public.pocket_programme_claim() to authenticated;

select cron.unschedule('programme-holds') where exists (select 1 from cron.job where jobname = 'programme-holds');
select cron.schedule('programme-holds', '17 * * * *', $cron$ select public.pocket_programme_release_holds() $cron$);

-- Applying: a place straight away when a batch has room.
create or replace function public.pocket_programme_apply(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mail text; open_id bigint;
begin
  if uid is null then raise exception 'Please sign in first' using errcode = '42501'; end if;
  if coalesce((p->>'consent')::boolean, false) is not true then raise exception 'Please agree to the programme terms'; end if;
  if length(trim(coalesce(p->>'fullName', ''))) < 2 then raise exception 'Please enter your name'; end if;
  if regexp_replace(coalesce(p->>'whatsapp', ''), '[^0-9]', '', 'g') !~ '^[0-9]{8,15}$' then
    raise exception 'Please enter your WhatsApp number with the country code';
  end if;
  select email into mail from auth.users where id = uid;
  select id into open_id from programme_applications where user_id = uid and status in ('waitlisted', 'offered', 'confirmed');
  if open_id is null then
    insert into programme_applications (user_id, email, full_name, whatsapp, telegram, household, current_method,
                                        goal, baseline_days, language, preferred_time, consent_at)
    values (uid, lower(mail), trim(p->>'fullName'), trim(p->>'whatsapp'), nullif(trim(p->>'telegram'), ''),
            left(nullif(trim(p->>'household'), ''), 500), left(nullif(trim(p->>'currentMethod'), ''), 500),
            left(nullif(trim(p->>'goal'), ''), 500), nullif(p->>'baselineDays', '')::int,
            left(nullif(trim(p->>'language'), ''), 60), left(nullif(trim(p->>'preferredTime'), ''), 60), now())
    returning id into open_id;
  else
    update programme_applications set
      full_name = trim(p->>'fullName'), whatsapp = trim(p->>'whatsapp'), telegram = nullif(trim(p->>'telegram'), ''),
      household = left(nullif(trim(p->>'household'), ''), 500), current_method = left(nullif(trim(p->>'currentMethod'), ''), 500),
      goal = left(nullif(trim(p->>'goal'), ''), 500), baseline_days = nullif(p->>'baselineDays', '')::int,
      language = left(nullif(trim(p->>'language'), ''), 60), preferred_time = left(nullif(trim(p->>'preferredTime'), ''), 60),
      updated_at = now()
    where id = open_id;
  end if;
  perform pocket_programme_release_holds();
  perform pocket_programme_seat(open_id);
  return pocket_programme_mine();
end $$;

-- Paying for a held place after its hold ran out: refused (the place may be someone else's now).
create or replace function public.pocket_payment_quote_with(p_user uuid, p_product text, p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare item jsonb; sub subscriptions; st text; app programme_applications; bat programme_batches; priced jsonb; sw jsonb; pr jsonb;
begin
  if not (select payments_enabled from billing_settings where id) then
    return jsonb_build_object('ok', false, 'reason', 'closed');
  end if;

  if p_product in ('programme', 'programme_half') then
    select * into app from programme_applications
     where user_id = p_user and status = 'offered' and (hold_until is null or hold_until > now());
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

-- Paid: the hold is done with.
create or replace function public.pocket_programme_clear_hold() returns trigger language plpgsql as $$
begin
  if new.status <> 'offered' then new.hold_until := null; end if;
  return new;
end $$;
drop trigger if exists programme_clear_hold on public.programme_applications;
create trigger programme_clear_hold before update on public.programme_applications
  for each row execute function public.pocket_programme_clear_hold();

-- The page shows how long the place is held.
create or replace function public.pocket_programme_mine()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'id', a.id, 'status', a.status, 'fullName', a.full_name, 'whatsapp', a.whatsapp, 'telegram', a.telegram,
      'household', a.household, 'currentMethod', a.current_method, 'goal', a.goal, 'baselineDays', a.baseline_days,
      'language', a.language, 'preferredTime', a.preferred_time, 'createdAt', a.created_at,
      'payPlan', a.pay_plan, 'restPaid', a.rest_paid_at is not null, 'proGranted', a.pro_granted_at is not null,
      'holdUntil', a.hold_until,
      'batch', case when b.id is null then null else
        jsonb_build_object('name', b.name, 'startsOn', b.starts_on, 'endsOn', b.starts_on + 42, 'pricePaise', b.price_paise)
        || pocket_programme_prices(b.price_paise) end,
      'paymentsOpen', (select payments_enabled from billing_settings where id))
    from programme_applications a left join programme_batches b on b.id = a.batch_id
    where a.user_id = auth.uid()
    order by (a.status in ('waitlisted', 'offered', 'confirmed')) desc, a.created_at desc
    limit 1), 'null'::jsonb)
$$;
