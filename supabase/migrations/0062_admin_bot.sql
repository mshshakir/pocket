-- 0062 · The admin bot (owner, 17 Nov 2026): a separate Telegram bot
-- (@Shakirs_PocketAdminBot, Edge Function telegram-admin) for running Pocket,
-- kept apart from the Pocket bot that logs entries.
--
-- · Linking: the admin dashboard makes a one-time code (15 minutes); sending
--   /start CODE to the admin bot links that chat to the admin. The bot then
--   answers only linked chats whose account is still in `admins`.
-- · Alerts: triggers put events in admin_events (a payment, a free request,
--   a programme application, feedback); telegram-admin sends them every few
--   minutes (pg_cron) and once a day a summary.
-- · Like the dashboard, nothing here ever shows the contents of a book.
-- The pocket_admbot_* functions are for the service role only.

create table if not exists public.admin_tg_links (
  chat_id   bigint primary key,
  user_id   uuid not null,
  linked_at timestamptz not null default now()
);
create table if not exists public.admin_tg_codes (
  code       text primary key,
  user_id    uuid not null,
  expires_at timestamptz not null,
  used_at    timestamptz
);
create table if not exists public.admin_events (
  id         bigint generated always as identity primary key,
  kind       text not null,
  payload    jsonb not null default '{}',
  created_at timestamptz not null default now(),
  sent_at    timestamptz
);
create index if not exists admin_events_unsent on public.admin_events (id) where sent_at is null;
create table if not exists public.admin_bot_state (
  id            boolean primary key default true check (id),
  summary_on    date,
  summary_minute int not null default 1290  -- 21:30 India time
);
insert into public.admin_bot_state (id) values (true) on conflict do nothing;

alter table public.admin_tg_links  enable row level security;
alter table public.admin_tg_codes  enable row level security;
alter table public.admin_events    enable row level security;
alter table public.admin_bot_state enable row level security;

-- ── Linking ─────────────────────────────────────────────────────────────────

-- Admin dashboard: a one-time code to link the admin bot.
create or replace function public.pocket_adm_tg_code() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := pocket_require_admin(); c text;
begin
  c := upper(substr(encode(extensions.gen_random_bytes(6), 'hex'), 1, 8));
  insert into admin_tg_codes (code, user_id, expires_at) values (c, uid, now() + interval '15 minutes');
  return jsonb_build_object('code', c, 'expiresAt', now() + interval '15 minutes',
    'linked', (select count(*) from admin_tg_links l where l.user_id = uid));
end $$;

create or replace function public.pocket_admbot_link(p_code text, p_chat bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c admin_tg_codes;
begin
  select * into c from admin_tg_codes where code = upper(btrim(coalesce(p_code, ''))) for update;
  if c.code is null or c.used_at is not null or c.expires_at < now()
     or not exists (select 1 from admins where user_id = c.user_id) then
    return jsonb_build_object('ok', false);
  end if;
  update admin_tg_codes set used_at = now() where code = c.code;
  insert into admin_tg_links (chat_id, user_id) values (p_chat, c.user_id)
  on conflict (chat_id) do update set user_id = excluded.user_id, linked_at = now();
  insert into admin_audit (admin_id, action, target, detail) values (c.user_id, 'admin_bot_linked', null, jsonb_build_object('chat', p_chat));
  return jsonb_build_object('ok', true, 'email', (select lower(email) from auth.users where id = c.user_id));
end $$;

-- The admin behind a chat, or null (not linked, or no longer an admin).
create or replace function public.pocket_admbot_admin(p_chat bigint) returns uuid
language sql stable security definer set search_path = public as $$
  select l.user_id from admin_tg_links l join admins a on a.user_id = l.user_id where l.chat_id = p_chat
$$;

-- Every chat to send alerts to.
create or replace function public.pocket_admbot_chats() returns bigint[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(l.chat_id), '{}') from admin_tg_links l join admins a on a.user_id = l.user_id
$$;

-- ── Stats ───────────────────────────────────────────────────────────────────

create or replace function public.pocket_admbot_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare g int := (select grace_days from billing_settings where id);
        today timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
        month timestamptz := date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
        res jsonb;
begin
  with u as (
    select u.id, u.created_at, u.last_sign_in_at, s.plan, s.term, s.ends_at,
           pocket_plan_state(s.ends_at, s.user_id is not null, g) as state
      from auth.users u left join subscriptions s on s.user_id = u.id
  ), paid as (
    select o.*, coalesce(o.currency, 'INR') cur from payment_orders o where o.status = 'paid'
  )
  select jsonb_build_object(
    'users', (select count(*) from u),
    'newToday', (select count(*) from u where created_at >= today),
    'new7', (select count(*) from u where created_at > now() - interval '7 days'),
    'new30', (select count(*) from u where created_at > now() - interval '30 days'),
    'active7', (select count(*) from u where last_sign_in_at > now() - interval '7 days'),
    'recorded7', (select count(distinct owner_id) from transactions where updated_at > now() - interval '7 days'),
    'plans', (select coalesce(jsonb_object_agg(k, n), '{}') from (
                select case when term = 'trial' then plan || '_trial' when term = 'lifetime' then 'lifetime' else plan end k, count(*) n
                  from u where state = 'active' and plan is not null and plan <> 'free' group by 1) x),
    'expiring7', (select count(*) from u where state = 'active' and term not in ('lifetime') and ends_at < now() + interval '7 days'),
    'plus', (select count(*) from addons where code = 'drive_backup'),
    'freeApproved', (select count(*) from free_requests where status = 'approved' and valid_until > now()),
    'freeWaiting', (select count(*) from free_requests where status = 'pending'),
    'auto', (select jsonb_build_object('limit', free_auto_limit, 'used', free_auto_used) from billing_settings where id),
    'feedbackNew', (select count(*) from feedback where status = 'new'),
    'telegram', (select count(distinct user_id) from telegram_links),
    'aiUses30', (select count(*) from ai_credit_ledger where reason = 'use' and at > now() - interval '30 days'),
    'todayInr', (select coalesce(sum(amount_paise), 0) from paid where cur = 'INR' and paid_at >= today),
    'todayUsd', (select coalesce(sum(charged_minor), 0) from paid where cur = 'USD' and paid_at >= today),
    'monthInr', (select coalesce(sum(amount_paise), 0) from paid where cur = 'INR' and paid_at >= month),
    'monthUsd', (select coalesce(sum(charged_minor), 0) from paid where cur = 'USD' and paid_at >= month),
    'paymentsToday', (select count(*) from paid where paid_at >= today),
    'programme', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from programme_applications group by 1) x)
  ) into res;
  return res;
end $$;

-- ── Free requests ───────────────────────────────────────────────────────────

create or replace function public.pocket_admbot_requests() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'email', r.email, 'reason', r.reason, 'at', r.created_at)
                            order by r.created_at), '[]')
    from (select * from free_requests where status = 'pending' order by created_at limit 20) r
$$;

create or replace function public.pocket_admbot_request_set(p_chat bigint, p_id bigint, p_status text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := pocket_admbot_admin(p_chat); r free_requests; months int := (select free_request_months from billing_settings where id);
begin
  if uid is null then raise exception 'not an admin'; end if;
  if p_status not in ('approved', 'declined') then raise exception 'Unknown status'; end if;
  update free_requests
     set status = p_status, decided_at = now(),
         valid_until = case when p_status = 'approved' then now() + make_interval(months => months) end
   where id = p_id and status = 'pending' returning * into r;
  if r.id is null then return jsonb_build_object('ok', false); end if;
  insert into admin_audit (admin_id, action, target, detail) values (uid, 'free_request_' || p_status, r.email, jsonb_build_object('id', r.id, 'via', 'admin_bot'));
  return jsonb_build_object('ok', true, 'name', r.name, 'email', r.email, 'status', r.status, 'validUntil', r.valid_until);
end $$;

create or replace function public.pocket_admbot_auto(p_chat bigint, p_limit integer, p_reset boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := pocket_admbot_admin(p_chat); b billing_settings;
begin
  if uid is null then raise exception 'not an admin'; end if;
  if p_limit is not null and (p_limit < 0 or p_limit > 100000) then raise exception 'bad limit'; end if;
  update billing_settings
     set free_auto_limit = coalesce(p_limit, free_auto_limit),
         free_auto_used = case when p_reset then 0 else free_auto_used end, updated_at = now()
   where id returning * into b;
  insert into admin_audit (admin_id, action, target, detail) values (uid, 'free_auto', null,
    jsonb_build_object('limit', b.free_auto_limit, 'used', b.free_auto_used, 'reset', p_reset, 'via', 'admin_bot'));
  return jsonb_build_object('limit', b.free_auto_limit, 'used', b.free_auto_used);
end $$;

-- ── Alerts ──────────────────────────────────────────────────────────────────

create or replace function public.pocket_admbot_events_take(p_limit integer default 20) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'payload', e.payload, 'at', e.created_at) order by e.id), '[]')
    from (select * from admin_events where sent_at is null order by id limit greatest(1, least(p_limit, 50))) e
$$;

create or replace function public.pocket_admbot_events_done(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update admin_events set sent_at = now() where id = any (p_ids) and sent_at is null
$$;

-- The daily summary is due (once a day, from summary_minute India time): claims it.
create or replace function public.pocket_admbot_summary_claim() returns boolean
language plpgsql security definer set search_path = public as $$
declare local timestamp := now() at time zone 'Asia/Kolkata'; s admin_bot_state;
begin
  select * into s from admin_bot_state where id for update;
  if s.summary_on = local::date or extract(hour from local) * 60 + extract(minute from local) < s.summary_minute then
    return false;
  end if;
  update admin_bot_state set summary_on = local::date where id;
  return true;
end $$;

-- Triggers: a short, book-free note of each event. A failure here never blocks the change itself.
create or replace function public.pocket_admbot_note() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    if tg_table_name = 'payment_orders' then
      if new.status = 'paid' and (tg_op = 'INSERT' or old.status is distinct from 'paid') then
        insert into admin_events (kind, payload) values ('payment', jsonb_build_object(
          'product', new.product, 'amountPaise', new.amount_paise, 'currency', coalesce(new.currency, 'INR'),
          'chargedMinor', new.charged_minor, 'coupon', new.coupon_code,
          'email', coalesce(new.email, (select lower(email) from auth.users where id = new.user_id))));
      end if;
    elsif tg_table_name = 'programme_applications' then
      insert into admin_events (kind, payload) values ('programme', jsonb_build_object(
        'id', new.id, 'name', new.full_name, 'email', new.email, 'status', new.status));
    elsif tg_table_name = 'feedback' then
      insert into admin_events (kind, payload) values ('feedback', jsonb_build_object(
        'id', new.id, 'email', new.email, 'kind', new.kind, 'message', left(new.message, 600), 'page', new.page));
    end if;
  exception when others then
    raise warning 'admin bot note failed: %', sqlerrm;
  end;
  return new;
end $$;

-- free_requests: notes the row as it stands once the insert's own auto-approval has run (deferred).
create or replace function public.pocket_admbot_note_request() returns trigger
language plpgsql security definer set search_path = public as $$
declare r free_requests;
begin
  begin
    select * into r from free_requests where id = new.id;
    if r.id is not null then
      insert into admin_events (kind, payload) values ('free_request', jsonb_build_object(
        'id', r.id, 'name', r.name, 'email', r.email, 'reason', r.reason, 'status', r.status, 'auto', r.auto));
    end if;
  exception when others then
    raise warning 'admin bot note failed: %', sqlerrm;
  end;
  return null;
end $$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'admbot_payment') then
    create trigger admbot_payment after insert or update of status on public.payment_orders
      for each row execute function public.pocket_admbot_note();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'admbot_free_request') then
    create constraint trigger admbot_free_request after insert on public.free_requests
      deferrable initially deferred for each row execute function public.pocket_admbot_note_request();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'admbot_programme') then
    create trigger admbot_programme after insert on public.programme_applications
      for each row execute function public.pocket_admbot_note();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'admbot_feedback') then
    create trigger admbot_feedback after insert on public.feedback
      for each row execute function public.pocket_admbot_note();
  end if;
end $$;

-- Service role only.
do $$ declare f text; begin
  foreach f in array array[
    'pocket_admbot_link(text,bigint)', 'pocket_admbot_admin(bigint)', 'pocket_admbot_chats()', 'pocket_admbot_stats()',
    'pocket_admbot_requests()', 'pocket_admbot_request_set(bigint,bigint,text)', 'pocket_admbot_auto(bigint,integer,boolean)',
    'pocket_admbot_events_take(integer)', 'pocket_admbot_events_done(bigint[])', 'pocket_admbot_summary_claim()'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
revoke all on function public.pocket_adm_tg_code() from public, anon;
grant execute on function public.pocket_adm_tg_code() to authenticated;

-- Alerts every 5 minutes (the function also sets its own webhook and the daily summary).
select cron.unschedule('admin-bot') where exists (select 1 from cron.job where jobname = 'admin-bot');
select cron.schedule('admin-bot', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://nvsfxdnnakzfzsrsfftp.supabase.co/functions/v1/telegram-admin/notify',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cron$);
