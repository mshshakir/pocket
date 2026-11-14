-- 0028 · Admin dashboard, offers and the habit programme
--
-- Admin: the admins table lists who may use admin.html. Every pocket_adm_*
-- function checks pocket_require_admin() first and writes to admin_audit.
-- They show accounts, plans, payments and programme details; never the
-- contents of anyone's book (entries, amounts, notes).
--
-- Offers: a 'sale' lowers a product's price for a period (by percent, or to a
-- fixed price for one product); a 'coupon' is a code typed at checkout (percent
-- or amount off), applied after any sale. Uses are counted when paid.
--
-- Programme: people apply on programme.html (signed in) with their profile;
-- they wait on the waitlist until a place in a batch is offered, then pay
-- through Razorpay (product 'programme'), which confirms the place. The coach
-- keeps a daily yes/no tick and notes from each weekly call.

-- ── Admins and audit ──────────────────────────────────────────────────────
create table if not exists public.admins (
  user_id  uuid primary key references auth.users on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.admins enable row level security;
revoke all on public.admins from anon, authenticated;
insert into public.admins (user_id)
  select id from auth.users where lower(email) = 'mshshakir@gmail.com'
on conflict do nothing;

create table if not exists public.admin_audit (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  admin_id uuid,
  action   text not null,
  target   text,
  detail   jsonb
);
alter table public.admin_audit enable row level security;
revoke all on public.admin_audit from anon, authenticated;

create or replace function public.pocket_is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid())
$$;

create or replace function public.pocket_require_admin() returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null or not exists (select 1 from admins where user_id = auth.uid()) then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  return auth.uid();
end $$;

create or replace function public.pocket_adm_log(p_action text, p_target text, p_detail jsonb) returns void
language sql security definer set search_path = public as $$
  insert into admin_audit (admin_id, action, target, detail) values (auth.uid(), p_action, p_target, p_detail)
$$;

-- ── Offers ────────────────────────────────────────────────────────────────
create table if not exists public.offers (
  id               bigint generated always as identity primary key,
  kind             text not null check (kind in ('coupon', 'sale')),
  code             text unique check (code is null or code ~ '^[A-Z0-9_-]{3,32}$'),
  name             text not null,
  products         text[],                 -- null = every product
  percent_off      int check (percent_off between 1 and 100),
  amount_off_paise int check (amount_off_paise > 0),
  sale_price_paise int check (sale_price_paise >= 100),
  starts_at        timestamptz not null default now(),
  ends_at          timestamptz,
  max_uses         int check (max_uses > 0),
  uses             int not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  check ((kind = 'coupon') = (code is not null)),
  check (num_nonnulls(percent_off, amount_off_paise, sale_price_paise) = 1),
  check (sale_price_paise is null or (kind = 'sale' and cardinality(products) = 1)),
  check (amount_off_paise is null or kind = 'coupon')
);
alter table public.offers enable row level security;
revoke all on public.offers from anon, authenticated;

-- The price of a product after the best running sale and, if a code is given,
-- a coupon. {amountPaise, listPaise, offerIds[], sale?, coupon?, couponError?}
-- couponError: unknown | not_started | expired | used_up | not_for_this
create or replace function public.pocket_offer_price(p_product text, p_list int, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  price int := p_list; ids bigint[] := '{}'; sale offers; c offers; err text; res jsonb;
begin
  select * into sale from offers o
   where o.kind = 'sale' and o.active and o.starts_at <= now() and (o.ends_at is null or o.ends_at > now())
     and (o.max_uses is null or o.uses < o.max_uses)
     and (o.products is null or p_product = any (o.products))
   order by coalesce(o.sale_price_paise, p_list - p_list * coalesce(o.percent_off, 0) / 100) asc, o.id
   limit 1;
  if sale.id is not null then
    price := coalesce(sale.sale_price_paise, p_list - p_list * sale.percent_off / 100);
    ids := ids || sale.id;
  end if;

  if nullif(trim(coalesce(p_code, '')), '') is not null then
    select * into c from offers where kind = 'coupon' and code = upper(trim(p_code));
    err := case
      when c.id is null or not c.active then 'unknown'
      when c.starts_at > now() then 'not_started'
      when c.ends_at is not null and c.ends_at <= now() then 'expired'
      when c.max_uses is not null and c.uses >= c.max_uses then 'used_up'
      when c.products is not null and not (p_product = any (c.products)) then 'not_for_this'
    end;
    if err is null then
      price := price - coalesce(c.amount_off_paise, price * c.percent_off / 100);
      ids := ids || c.id;
    end if;
  end if;

  res := jsonb_build_object('amountPaise', greatest(100, price), 'listPaise', p_list, 'offerIds', to_jsonb(ids));
  if sale.id is not null then res := res || jsonb_build_object('sale', sale.name); end if;
  if c.id is not null and err is null then res := res || jsonb_build_object('coupon', c.code); end if;
  if err is not null then res := res || jsonb_build_object('couponError', err); end if;
  return res;
end $$;

-- ── Programme ─────────────────────────────────────────────────────────────
create table if not exists public.programme_batches (
  id          bigint generated always as identity primary key,
  name        text not null,
  starts_on   date,
  capacity    int not null default 10 check (capacity > 0),
  price_paise int not null default 500000 check (price_paise >= 100),
  status      text not null default 'planned' check (status in ('planned', 'open', 'running', 'done')),
  notes       text,
  created_at  timestamptz not null default now()
);

create table if not exists public.programme_applications (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references auth.users on delete cascade,
  email          text not null,
  full_name      text not null,
  whatsapp       text not null,
  telegram       text,
  household      text,           -- who else will log
  current_method text,           -- how they track money today
  goal           text,
  baseline_days  int check (baseline_days between 0 and 7),
  language       text,
  preferred_time text,           -- for the daily question and calls
  consent_at     timestamptz not null,
  status         text not null default 'waitlisted'
                 check (status in ('waitlisted', 'offered', 'confirmed', 'completed', 'withdrawn')),
  batch_id       bigint references public.programme_batches,
  offered_at     timestamptz,
  confirmed_at   timestamptz,
  paid_order_id  text,
  admin_notes    text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists programme_one_open_application on public.programme_applications (user_id)
  where status in ('waitlisted', 'offered', 'confirmed');

create table if not exists public.programme_days (
  application_id bigint not null references public.programme_applications on delete cascade,
  day            date not null,
  recorded       boolean,        -- null = cleared
  primary key (application_id, day)
);

create table if not exists public.programme_calls (
  id             bigint generated always as identity primary key,
  application_id bigint not null references public.programme_applications on delete cascade,
  week           int not null check (week between 0 and 6),
  held_on        date not null default current_date,
  days_recorded  int check (days_recorded between 0 and 7),
  win            text,
  miss           text,
  commitment     text,
  notes          text,
  created_at     timestamptz not null default now()
);

alter table public.programme_batches enable row level security;
alter table public.programme_applications enable row level security;
alter table public.programme_days enable row level security;
alter table public.programme_calls enable row level security;
revoke all on public.programme_batches, public.programme_applications, public.programme_days, public.programme_calls
  from anon, authenticated;

-- What a signed-in person sees of their own application.
create or replace function public.pocket_programme_mine() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object(
      'id', a.id, 'status', a.status, 'fullName', a.full_name, 'whatsapp', a.whatsapp, 'telegram', a.telegram,
      'household', a.household, 'currentMethod', a.current_method, 'goal', a.goal, 'baselineDays', a.baseline_days,
      'language', a.language, 'preferredTime', a.preferred_time, 'createdAt', a.created_at,
      'batch', case when b.id is null then null else jsonb_build_object('name', b.name, 'startsOn', b.starts_on, 'pricePaise', b.price_paise) end,
      'paymentsOpen', (select payments_enabled from billing_settings where id))
    from programme_applications a left join programme_batches b on b.id = a.batch_id
    where a.user_id = auth.uid()
    order by (a.status in ('waitlisted', 'offered', 'confirmed')) desc, a.created_at desc
    limit 1), 'null'::jsonb)
$$;

-- Apply, or update the profile of an open application. Consent is required.
create or replace function public.pocket_programme_apply(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); mail text; open_id bigint;
  txt  text;
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
            left(nullif(trim(p->>'language'), ''), 60), left(nullif(trim(p->>'preferredTime'), ''), 60), now());
  else
    update programme_applications set
      full_name = trim(p->>'fullName'), whatsapp = trim(p->>'whatsapp'), telegram = nullif(trim(p->>'telegram'), ''),
      household = left(nullif(trim(p->>'household'), ''), 500), current_method = left(nullif(trim(p->>'currentMethod'), ''), 500),
      goal = left(nullif(trim(p->>'goal'), ''), 500), baseline_days = nullif(p->>'baselineDays', '')::int,
      language = left(nullif(trim(p->>'language'), ''), 60), preferred_time = left(nullif(trim(p->>'preferredTime'), ''), 60),
      updated_at = now()
    where id = open_id;
  end if;
  return pocket_programme_mine();
end $$;

-- Leave the waitlist, or decline an offered place (before paying).
create or replace function public.pocket_programme_withdraw() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update programme_applications set status = 'withdrawn', updated_at = now()
   where user_id = auth.uid() and status in ('waitlisted', 'offered');
  return pocket_programme_mine();
end $$;

-- ── Payments: offers and the programme fee ────────────────────────────────
alter table public.payment_orders
  add column if not exists list_paise     int,
  add column if not exists offer_ids      bigint[],
  add column if not exists coupon_code    text,
  add column if not exists application_id bigint references public.programme_applications;

-- Products for sale, with any running sale applied.
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
    select jsonb_build_object('product', p.code || '_trial', 'name', p.name || ' · ' || p.trial_days || '-day trial', 'plan', p.code,
                              'term', 'trial', 'amountPaise', p.trial_paise, 'sort', p.sort * 10)
      from plans p where p.active and p.trial_paise > 0 and p.trial_days > 0
    union all
    select jsonb_build_object('product', 'ai_pack', 'name', 'AI pack · ' || (b.ai_pack_paise / b.ai_credit_paise) || ' uses',
                              'aiCredits', b.ai_pack_paise / b.ai_credit_paise, 'amountPaise', b.ai_pack_paise, 'sort', 999)
      from billing_settings b where b.id
  ) s
$$;

-- Quote with an optional coupon code. Adds the programme fee for someone who
-- has been offered a place. {ok, ...item, amountPaise, listPaise, offerIds,
-- sale?, coupon?, couponError?} or {ok:false, reason}.
create or replace function public.pocket_payment_quote_with(p_user uuid, p_product text, p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare item jsonb; sub subscriptions; st text; app programme_applications; bat programme_batches; priced jsonb;
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
  end if;

  priced := pocket_offer_price(p_product, (item->>'amountPaise')::int, p_code);
  if priced ? 'couponError' then
    return jsonb_build_object('ok', false, 'reason', 'coupon_' || (priced->>'couponError'));
  end if;
  return jsonb_build_object('ok', true) || (item - 'sort' - 'listPaise') || priced;
end $$;

-- The two-argument quote stays for callers that don't send a code.
create or replace function public.pocket_payment_quote(p_user uuid, p_product text) returns jsonb
language sql stable security definer set search_path = public as $$
  select pocket_payment_quote_with(p_user, p_product, null)
$$;

create or replace function public.pocket_payment_fulfil(p_order text, p_payment text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o payment_orders; sub subscriptions; st text; base timestamptz; pl plans; ends timestamptz;
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

-- ── Admin: statistics ─────────────────────────────────────────────────────
create or replace function public.pocket_adm_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g int := (select grace_days from billing_settings where id); res jsonb;
begin
  perform pocket_require_admin();
  with u as (
    select u.id, u.created_at, u.last_sign_in_at, s.plan, s.term, s.ends_at,
           pocket_plan_state(s.ends_at, s.user_id is not null, g) as state
      from auth.users u left join subscriptions s on s.user_id = u.id
  )
  select jsonb_build_object(
    'users', (select count(*) from u),
    'new7', (select count(*) from u where created_at > now() - interval '7 days'),
    'new30', (select count(*) from u where created_at > now() - interval '30 days'),
    'active7', (select count(*) from u where last_sign_in_at > now() - interval '7 days'),
    'loggedEntries7', (select count(distinct owner_id) from transactions where updated_at > now() - interval '7 days'),
    'signupsByWeek', (select jsonb_agg(jsonb_build_object('week', w::date, 'count',
                        (select count(*) from u where created_at >= w and created_at < w + interval '7 days')) order by w)
                      from generate_series(date_trunc('week', now()) - interval '11 weeks', date_trunc('week', now()), interval '1 week') w),
    'plans', (select jsonb_object_agg(k, n) from (select coalesce(case when state = 'free' then 'free' else plan || ':' || state end, 'free') k, count(*) n from u group by 1) x),
    'lifetime', (select count(*) from u where term = 'lifetime' and state = 'active'),
    'trials', (select count(*) from u where term = 'trial' and state = 'active'),
    'expiring7', (select count(*) from u where state = 'active' and term <> 'lifetime' and ends_at < now() + interval '7 days'),
    'telegramLinked', (select count(distinct user_id) from telegram_links),
    'groups', (select count(*) from telegram_groups),
    'aiUses30', (select count(*) from ai_credit_ledger where reason = 'use' and at > now() - interval '30 days'),
    'revenueTotal', (select coalesce(sum(amount_paise), 0) from payment_orders where status = 'paid'),
    'revenue30', (select coalesce(sum(amount_paise), 0) from payment_orders where status = 'paid' and paid_at > now() - interval '30 days'),
    'revenueByMonth', (select jsonb_agg(jsonb_build_object('month', m::date, 'paise',
                        (select coalesce(sum(amount_paise), 0) from payment_orders where status = 'paid' and paid_at >= m and paid_at < m + interval '1 month')) order by m)
                      from generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m),
    'ordersByProduct', (select coalesce(jsonb_object_agg(product, n), '{}') from (select product, count(*) n from payment_orders where status = 'paid' group by 1) x),
    'programme', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from programme_applications group by 1) x),
    'paymentsOpen', (select payments_enabled from billing_settings where id)
  ) into res;
  return res;
end $$;

-- ── Admin: users ──────────────────────────────────────────────────────────
create or replace function public.pocket_adm_users(p_search text default null, p_limit int default 100, p_offset int default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g int := (select grace_days from billing_settings where id); res jsonb;
begin
  perform pocket_require_admin();
  select coalesce(jsonb_agg(r order by r->>'signedUp' desc), '[]') into res from (
    select jsonb_build_object(
      'id', u.id, 'email', lower(u.email), 'name', u.raw_user_meta_data->>'full_name',
      'signedUp', u.created_at, 'lastSignIn', u.last_sign_in_at,
      'plan', coalesce(s.plan, 'free'), 'term', s.term, 'source', s.source, 'endsAt', s.ends_at,
      'state', pocket_plan_state(s.ends_at, s.user_id is not null, g), 'note', s.note,
      'aiUnlimited', coalesce(s.ai_unlimited, false), 'aiCredits', pocket_ai_balance(u.id),
      'telegram', exists (select 1 from telegram_links t where t.user_id = u.id),
      'family', (select count(*) from family_members m where m.owner_id = u.id and m.deleted_at is null),
      'lastEntry', (select max(t.updated_at) from transactions t where t.owner_id = u.id),
      'paidPaise', (select coalesce(sum(o.amount_paise), 0) from payment_orders o where o.user_id = u.id and o.status = 'paid')
    ) r
    from auth.users u left join subscriptions s on s.user_id = u.id
    where p_search is null or p_search = ''
       or lower(u.email) like '%' || lower(p_search) || '%'
       or lower(coalesce(u.raw_user_meta_data->>'full_name', '')) like '%' || lower(p_search) || '%'
    order by u.created_at desc
    limit least(greatest(p_limit, 1), 500) offset greatest(p_offset, 0)
  ) x;
  return res;
end $$;

-- One action on one account: set_plan {plan, term, endsAt?, note?} · end_plan {note?}
-- · grant_ai {credits, note?} · ai_unlimited {on}
create or replace function public.pocket_adm_user_action(p_email text, p_action text, p_args jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  perform pocket_require_admin();
  case p_action
    when 'set_plan' then
      res := pocket_admin_set_plan(p_email, p_args->>'plan', p_args->>'term', nullif(p_args->>'endsAt', '')::timestamptz,
                                   coalesce(nullif(p_args->>'note', ''), 'Set in admin'), 'manual');
    when 'end_plan' then res := pocket_admin_end_plan(p_email, nullif(p_args->>'note', ''));
    when 'grant_ai' then res := pocket_admin_grant_ai(p_email, (p_args->>'credits')::int, coalesce(nullif(p_args->>'note', ''), 'Granted in admin'));
    when 'ai_unlimited' then res := pocket_admin_set_ai_unlimited(p_email, coalesce((p_args->>'on')::boolean, true));
    else raise exception 'Unknown action %', p_action;
  end case;
  perform pocket_adm_log(p_action, lower(p_email), p_args);
  return res;
end $$;

-- ── Admin: payments ───────────────────────────────────────────────────────
create or replace function public.pocket_adm_payments(p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform pocket_require_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'email', lower(u.email), 'product', o.product, 'status', o.status,
    'amountPaise', o.amount_paise, 'listPaise', o.list_paise, 'coupon', o.coupon_code,
    'paymentId', o.payment_id, 'createdAt', o.created_at, 'paidAt', o.paid_at) order by o.created_at desc), '[]')
  into res from (select * from payment_orders order by created_at desc limit least(greatest(p_limit, 1), 1000)) o
  left join auth.users u on u.id = o.user_id;
  return res;
end $$;

-- ── Admin: prices, settings and offers ────────────────────────────────────
create or replace function public.pocket_adm_pricing() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  return jsonb_build_object(
    'plans', (select jsonb_agg(to_jsonb(p) order by p.sort) from plans p),
    'settings', (select to_jsonb(b) - 'id' from billing_settings b where b.id),
    'offers', (select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at desc), '[]') from offers o));
end $$;

-- Change a plan: any of name, seats, monthly_paise, yearly_paise, trial_paise, trial_days, active
-- (a price set to null stops selling that term).
create or replace function public.pocket_adm_update_plan(p_code text, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  update plans set
    name          = case when p ? 'name' then p->>'name' else name end,
    seats         = case when p ? 'seats' then (p->>'seats')::int else seats end,
    monthly_paise = case when p ? 'monthly_paise' then (p->>'monthly_paise')::int else monthly_paise end,
    yearly_paise  = case when p ? 'yearly_paise' then (p->>'yearly_paise')::int else yearly_paise end,
    trial_paise   = case when p ? 'trial_paise' then (p->>'trial_paise')::int else trial_paise end,
    trial_days    = case when p ? 'trial_days' then (p->>'trial_days')::int else trial_days end,
    active        = case when p ? 'active' then (p->>'active')::boolean else active end,
    updated_at    = now()
  where code = p_code;
  if not found then raise exception 'Unknown plan %', p_code; end if;
  perform pocket_adm_log('update_plan', p_code, p);
  return pocket_adm_pricing();
end $$;

-- Change billing settings: grace_days, ai_credit_paise, ai_pack_paise, ai_credit_days, payments_enabled.
create or replace function public.pocket_adm_update_settings(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  update billing_settings set
    grace_days       = case when p ? 'grace_days' then (p->>'grace_days')::int else grace_days end,
    ai_credit_paise  = case when p ? 'ai_credit_paise' then (p->>'ai_credit_paise')::int else ai_credit_paise end,
    ai_pack_paise    = case when p ? 'ai_pack_paise' then (p->>'ai_pack_paise')::int else ai_pack_paise end,
    ai_credit_days   = case when p ? 'ai_credit_days' then (p->>'ai_credit_days')::int else ai_credit_days end,
    payments_enabled = case when p ? 'payments_enabled' then (p->>'payments_enabled')::boolean else payments_enabled end,
    updated_at       = now()
  where id;
  perform pocket_adm_log('update_settings', null, p);
  return pocket_adm_pricing();
end $$;

-- Create (no id) or change (id) an offer.
create or replace function public.pocket_adm_save_offer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare oid bigint := nullif(p->>'id', '')::bigint;
  prods text[] := case when jsonb_typeof(p->'products') = 'array' and jsonb_array_length(p->'products') > 0
                       then array(select jsonb_array_elements_text(p->'products')) end;
begin
  perform pocket_require_admin();
  if oid is null then
    insert into offers (kind, code, name, products, percent_off, amount_off_paise, sale_price_paise, starts_at, ends_at, max_uses, active)
    values (p->>'kind', upper(nullif(trim(p->>'code'), '')), p->>'name', prods,
            nullif(p->>'percent_off', '')::int, nullif(p->>'amount_off_paise', '')::int, nullif(p->>'sale_price_paise', '')::int,
            coalesce(nullif(p->>'starts_at', '')::timestamptz, now()), nullif(p->>'ends_at', '')::timestamptz,
            nullif(p->>'max_uses', '')::int, coalesce((p->>'active')::boolean, true))
    returning id into oid;
  else
    update offers set
      name = coalesce(p->>'name', name), products = case when p ? 'products' then prods else products end,
      percent_off = case when p ? 'percent_off' then nullif(p->>'percent_off', '')::int else percent_off end,
      amount_off_paise = case when p ? 'amount_off_paise' then nullif(p->>'amount_off_paise', '')::int else amount_off_paise end,
      sale_price_paise = case when p ? 'sale_price_paise' then nullif(p->>'sale_price_paise', '')::int else sale_price_paise end,
      starts_at = case when p ? 'starts_at' then coalesce(nullif(p->>'starts_at', '')::timestamptz, starts_at) else starts_at end,
      ends_at = case when p ? 'ends_at' then nullif(p->>'ends_at', '')::timestamptz else ends_at end,
      max_uses = case when p ? 'max_uses' then nullif(p->>'max_uses', '')::int else max_uses end,
      active = case when p ? 'active' then (p->>'active')::boolean else active end
    where id = oid;
    if not found then raise exception 'Unknown offer %', oid; end if;
  end if;
  perform pocket_adm_log('save_offer', oid::text, p);
  return pocket_adm_pricing();
end $$;

-- ── Admin: programme ──────────────────────────────────────────────────────
create or replace function public.pocket_adm_programme() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  return jsonb_build_object(
    'batches', (select coalesce(jsonb_agg(to_jsonb(b) || jsonb_build_object(
                  'confirmed', (select count(*) from programme_applications a where a.batch_id = b.id and a.status in ('confirmed', 'completed')),
                  'offered', (select count(*) from programme_applications a where a.batch_id = b.id and a.status = 'offered'))
                order by b.starts_on nulls last, b.id), '[]') from programme_batches b),
    'applications', (select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at), '[]') from programme_applications a));
end $$;

create or replace function public.pocket_adm_save_batch(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bid bigint := nullif(p->>'id', '')::bigint;
begin
  perform pocket_require_admin();
  if bid is null then
    insert into programme_batches (name, starts_on, capacity, price_paise, status, notes)
    values (p->>'name', nullif(p->>'starts_on', '')::date, coalesce(nullif(p->>'capacity', '')::int, 10),
            coalesce(nullif(p->>'price_paise', '')::int, 500000), coalesce(nullif(p->>'status', ''), 'planned'), nullif(p->>'notes', ''))
    returning id into bid;
  else
    update programme_batches set
      name = coalesce(p->>'name', name),
      starts_on = case when p ? 'starts_on' then nullif(p->>'starts_on', '')::date else starts_on end,
      capacity = coalesce(nullif(p->>'capacity', '')::int, capacity),
      price_paise = coalesce(nullif(p->>'price_paise', '')::int, price_paise),
      status = coalesce(nullif(p->>'status', ''), status),
      notes = case when p ? 'notes' then nullif(p->>'notes', '') else notes end
    where id = bid;
    if not found then raise exception 'Unknown batch %', bid; end if;
  end if;
  perform pocket_adm_log('save_batch', bid::text, p);
  return pocket_adm_programme();
end $$;

-- offer {batchId} · waitlist · confirm (paid outside Razorpay) · complete · withdraw · notes {notes}
create or replace function public.pocket_adm_application(p_id bigint, p_action text, p_args jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
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
      update programme_applications set status = 'confirmed', confirmed_at = now(), updated_at = now() where id = a.id;
    when 'complete' then
      update programme_applications set status = 'completed', updated_at = now() where id = a.id;
    when 'withdraw' then
      update programme_applications set status = 'withdrawn', updated_at = now() where id = a.id;
    when 'notes' then
      update programme_applications set admin_notes = nullif(p_args->>'notes', ''), updated_at = now() where id = a.id;
    else raise exception 'Unknown action %', p_action;
  end case;
  perform pocket_adm_log('application_' || p_action, p_id::text, p_args);
  return pocket_adm_programme();
end $$;

-- A batch's daily ticks and calls, for the tracker.
create or replace function public.pocket_adm_tracker(p_batch bigint) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  return jsonb_build_object(
    'days', (select coalesce(jsonb_agg(jsonb_build_object('applicationId', d.application_id, 'day', d.day, 'recorded', d.recorded)), '[]')
               from programme_days d join programme_applications a on a.id = d.application_id
              where a.batch_id = p_batch and d.recorded is not null),
    'calls', (select coalesce(jsonb_agg(to_jsonb(c) order by c.week, c.id), '[]')
               from programme_calls c join programme_applications a on a.id = c.application_id where a.batch_id = p_batch));
end $$;

-- Set (true/false) or clear (null) one day's answer to "did you record today?".
create or replace function public.pocket_adm_set_day(p_application bigint, p_day date, p_recorded boolean) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  insert into programme_days (application_id, day, recorded) values (p_application, p_day, p_recorded)
  on conflict (application_id, day) do update set recorded = excluded.recorded;
end $$;

-- Save notes from a weekly call (no id: a new call; id: change it).
create or replace function public.pocket_adm_save_call(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cid bigint := nullif(p->>'id', '')::bigint;
begin
  perform pocket_require_admin();
  if cid is null then
    insert into programme_calls (application_id, week, held_on, days_recorded, win, miss, commitment, notes)
    values ((p->>'application_id')::bigint, (p->>'week')::int, coalesce(nullif(p->>'held_on', '')::date, current_date),
            nullif(p->>'days_recorded', '')::int, nullif(p->>'win', ''), nullif(p->>'miss', ''),
            nullif(p->>'commitment', ''), nullif(p->>'notes', ''))
    returning id into cid;
  else
    update programme_calls set
      week = coalesce(nullif(p->>'week', '')::int, week), held_on = coalesce(nullif(p->>'held_on', '')::date, held_on),
      days_recorded = nullif(p->>'days_recorded', '')::int, win = nullif(p->>'win', ''), miss = nullif(p->>'miss', ''),
      commitment = nullif(p->>'commitment', ''), notes = nullif(p->>'notes', '')
    where id = cid;
  end if;
  return jsonb_build_object('id', cid);
end $$;

create or replace function public.pocket_adm_audit(p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform pocket_require_admin();
  select coalesce(jsonb_agg(jsonb_build_object('at', l.at, 'admin', lower(u.email), 'action', l.action, 'target', l.target, 'detail', l.detail)
                  order by l.at desc), '[]')
  into res from (select * from admin_audit order by at desc limit least(greatest(p_limit, 1), 1000)) l
  left join auth.users u on u.id = l.admin_id;
  return res;
end $$;

-- ── Execute rights ────────────────────────────────────────────────────────
revoke execute on function
  public.pocket_is_admin(), public.pocket_require_admin(), public.pocket_adm_log(text, text, jsonb),
  public.pocket_offer_price(text, int, text), public.pocket_payment_quote_with(uuid, text, text),
  public.pocket_payment_quote(uuid, text), public.pocket_payment_fulfil(text, text), public.pocket_payment_products(),
  public.pocket_programme_mine(), public.pocket_programme_apply(jsonb), public.pocket_programme_withdraw(),
  public.pocket_adm_stats(), public.pocket_adm_users(text, int, int), public.pocket_adm_user_action(text, text, jsonb),
  public.pocket_adm_payments(int), public.pocket_adm_pricing(), public.pocket_adm_update_plan(text, jsonb),
  public.pocket_adm_update_settings(jsonb), public.pocket_adm_save_offer(jsonb), public.pocket_adm_programme(),
  public.pocket_adm_save_batch(jsonb), public.pocket_adm_application(bigint, text, jsonb), public.pocket_adm_tracker(bigint),
  public.pocket_adm_set_day(bigint, date, boolean), public.pocket_adm_save_call(jsonb), public.pocket_adm_audit(int)
from public, anon;

-- Signed-in people: the admin check, their own programme application, and the
-- admin functions (which refuse anyone not in admins).
grant execute on function
  public.pocket_is_admin(), public.pocket_programme_mine(), public.pocket_programme_apply(jsonb), public.pocket_programme_withdraw(),
  public.pocket_adm_stats(), public.pocket_adm_users(text, int, int), public.pocket_adm_user_action(text, text, jsonb),
  public.pocket_adm_payments(int), public.pocket_adm_pricing(), public.pocket_adm_update_plan(text, jsonb),
  public.pocket_adm_update_settings(jsonb), public.pocket_adm_save_offer(jsonb), public.pocket_adm_programme(),
  public.pocket_adm_save_batch(jsonb), public.pocket_adm_application(bigint, text, jsonb), public.pocket_adm_tracker(bigint),
  public.pocket_adm_set_day(bigint, date, boolean), public.pocket_adm_save_call(jsonb), public.pocket_adm_audit(int)
to authenticated;

-- Server only (the payments function).
revoke execute on function public.pocket_offer_price(text, int, text), public.pocket_payment_quote_with(uuid, text, text),
  public.pocket_payment_quote(uuid, text), public.pocket_payment_fulfil(text, text), public.pocket_payment_products(),
  public.pocket_require_admin(), public.pocket_adm_log(text, text, jsonb)
from authenticated;
grant execute on function public.pocket_offer_price(text, int, text), public.pocket_payment_quote_with(uuid, text, text),
  public.pocket_payment_quote(uuid, text), public.pocket_payment_fulfil(text, text), public.pocket_payment_products()
to service_role;
