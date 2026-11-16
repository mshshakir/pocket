-- 0046 · Pocket Pro Group: one person pays ₹1,999 a year and adds two others
-- by email; each of the three has their own Pocket Pro on their own book.
--
-- Decided by the owner on 16 Nov 2026: yearly only; 3 people; each member's
-- book is private (the organiser sees only who is in the group); AI credits
-- stay separate; once someone has joined, replacing them uses one of 2
-- changes a year; a place still "waiting" can be edited freely; members can
-- leave (frees the place, no change used).
--
-- How access works: pocket_effective_plan(user) is the plan that governs a
-- person — their own plan while it is active or in grace, otherwise the
-- Pocket Pro (code 'family') of a group they belong to, with the group's end
-- date, otherwise their own lapsed plan or nothing. pocket_own_access (the
-- sync/Telegram/sharing guards), pocket_guard_sharing (household seats) and
-- pocket_entitlements_for (the app and the bot) all read it, so a member gets
-- Pro everywhere and loses it when the group ends.
--
-- No DROP or DELETE: removed members are kept with removed_at set.

-- ── Plan ──────────────────────────────────────────────────────────────────
alter table public.plans add column if not exists group_size int check (group_size is null or group_size > 1);

insert into public.plans (code, name, sync, telegram, sharing, seats, monthly_paise, yearly_paise, trial_days, trial_paise, sort, active, group_size)
values ('group', 'Pocket Pro Group', true, true, true, 5, null, 199900, null, null, 3, true, 3)
on conflict (code) do update set name = excluded.name, yearly_paise = excluded.yearly_paise, monthly_paise = null,
  sync = true, telegram = true, sharing = true, seats = 5, active = true, group_size = 3, sort = 3;

-- ── Members ───────────────────────────────────────────────────────────────
create table if not exists public.group_members (
  id         bigint generated always as identity primary key,
  owner_id   uuid not null,
  email      text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  user_id    uuid,
  added_at   timestamptz not null default now(),
  joined_at  timestamptz,
  removed_at timestamptz,
  removed_by text check (removed_by is null or removed_by in ('organiser', 'member'))
);
-- A person is in at most one group at a time, and appears once in it.
create unique index if not exists group_members_one_group on public.group_members (email) where removed_at is null;
create index if not exists group_members_owner on public.group_members (owner_id) where removed_at is null;
alter table public.group_members enable row level security;
revoke all on public.group_members from anon, authenticated;

-- One row each time the organiser replaces someone who had joined.
create table if not exists public.group_changes (
  id       bigint generated always as identity primary key,
  owner_id uuid not null,
  email    text not null,
  at       timestamptz not null default now()
);
alter table public.group_changes enable row level security;
revoke all on public.group_changes from anon, authenticated;

alter table public.billing_settings
  add column if not exists group_changes_per_year int not null default 2 check (group_changes_per_year >= 0);

-- ── The plan that governs a person ────────────────────────────────────────
create or replace function public.pocket_effective_plan(p_user uuid)
returns table (plan text, state text, ends_at timestamptz, via_owner uuid)
language sql stable security definer set search_path = public as $$
  with g as (select grace_days d from billing_settings where id),
  own as (
    select s.plan, pocket_plan_state(s.ends_at, true, (select d from g)) st, s.ends_at
      from subscriptions s where s.user_id = p_user),
  grp as (
    select 'family'::text plan, pocket_plan_state(os.ends_at, true, (select d from g)) st, os.ends_at, gm.owner_id
      from group_members gm
      join subscriptions os on os.user_id = gm.owner_id and os.plan = 'group'
     where gm.removed_at is null and gm.owner_id <> p_user
       and (gm.user_id = p_user
            or (gm.user_id is null and gm.email = (select lower(u.email) from auth.users u where u.id = p_user)))
     order by os.ends_at desc nulls first limit 1)
  select plan, st, ends_at, via from (
    select plan, st, ends_at, null::uuid via, 1 rank from own where st in ('active', 'grace')
    union all
    select plan, st, ends_at, owner_id, case st when 'active' then 2 else 3 end from grp where st in ('active', 'grace')
    union all
    select plan, st, ends_at, null::uuid, 4 from own
  ) x
  order by rank,
           case st when 'active' then 0 else 1 end
  limit 1
$$;

-- Sync / Telegram / sharing access, now through the effective plan.
create or replace function public.pocket_own_access(p_user uuid, p_feature text) returns text
language sql stable security definer set search_path = public as $$
  select pocket_feature_access(
           coalesce(case p_feature when 'sync' then p.sync when 'telegram' then p.telegram
                                   when 'sharing' then p.sharing end, false),
           coalesce(e.state, 'free'))
  from (select 1) one
  left join pocket_effective_plan(p_user) e on true
  left join plans p on p.code = e.plan
$$;

-- Household sharing seats, from the effective plan.
create or replace function public.pocket_guard_sharing() returns trigger
language plpgsql security definer set search_path = public as $$
declare seats int; others int;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'family_members' and new.deleted_at is not null then return new; end if;
  if pocket_own_access(new.owner_id, 'sharing') <> 'write' then
    perform pocket_plan_refuse('sharing', 'Sharing with family needs Pocket Pro.');
  end if;
  if tg_table_name = 'family_members' then
    select p.seats into seats from pocket_effective_plan(new.owner_id) e join plans p on p.code = e.plan;
    select count(*) into others from family_members
      where owner_id = new.owner_id and deleted_at is null and id <> new.id;
    if others + 1 > coalesce(seats, 1) - 1 then
      perform pocket_plan_refuse('seats', format('Your plan covers %s people, you included.', coalesce(seats, 1)));
    end if;
  end if;
  return new;
end $$;

-- What a person's plan is, for the app and the Telegram bot.
create or replace function public.pocket_entitlements_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg   billing_settings;
  sub   subscriptions;
  eff   record;
  st    text;
  pl    plans;
  my_email text;
  used  int;
  covered jsonb;
  grp   jsonb := null;
  owner_row record;
begin
  if p_user is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into cfg from billing_settings where id;
  select * into sub from subscriptions where user_id = p_user;
  select * into eff from pocket_effective_plan(p_user);
  st := coalesce(eff.state, 'free');
  select * into pl from plans where code = case when st in ('free', 'lapsed') then 'free' else eff.plan end;
  select lower(email) into my_email from auth.users where id = p_user;

  select 1 + count(*) into used from family_members m where m.owner_id = p_user and m.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'ownerId', x.owner_id, 'ownerEmail', x.owner_email, 'plan', x.plan,
           'access', pocket_feature_access(x.sharing, x.state),
           'aiCredits', case when x.state = 'active' then pocket_ai_balance(x.owner_id) else 0 end,
           'aiUnlimited', x.state = 'active' and pocket_ai_unlimited(x.owner_id))
           order by x.owner_email), '[]')
    into covered
  from (
    select m.owner_id, lower(u.email) owner_email, op.code plan, op.sharing, op.seats, oe.state,
           (select count(*) from family_members m3
             where m3.owner_id = m.owner_id and m3.deleted_at is null
               and (m3.created_at, m3.id) <= (m.created_at, m.id)) seat
    from family_members m
    join auth.users u on u.id = m.owner_id
    cross join lateral pocket_effective_plan(m.owner_id) oe
    join plans op on op.code = oe.plan
    where m.deleted_at is null and m.owner_id <> p_user and lower(m.email) = my_email
  ) x
  where x.sharing and x.state <> 'lapsed' and x.seat <= x.seats - 1;

  if eff.via_owner is not null then
    select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''),
                    split_part(u.email, '@', 1)) as name, lower(u.email) as email
      into owner_row from auth.users u where u.id = eff.via_owner;
    grp := jsonb_build_object('role', 'member', 'ownerName', owner_row.name, 'ownerEmail', owner_row.email);
  elsif sub.plan = 'group' and st in ('active', 'grace') then
    grp := jsonb_build_object('role', 'organiser', 'size', (select group_size from plans where code = 'group'));
  end if;

  return jsonb_build_object(
    'plan',        pl.code,
    'planName',    pl.name,
    'paidPlan',    case when eff.via_owner is not null then 'family' else sub.plan end,
    'term',        case when eff.via_owner is not null then 'year' else sub.term end,
    'source',      case when eff.via_owner is not null then 'group' else sub.source end,
    'state',       st,
    'endsAt',      eff.ends_at,
    'graceUntil',  case when eff.ends_at is not null then eff.ends_at + make_interval(days => cfg.grace_days) end,
    'autoRenew',   case when eff.via_owner is not null then false else coalesce(sub.auto_renew, false) end,
    'access',      jsonb_build_object(
                     'sync',     pocket_feature_access(pl.sync, st),
                     'telegram', pocket_feature_access(pl.telegram, st),
                     'sharing',  pocket_feature_access(pl.sharing, st)),
    'seats',       pl.seats,
    'seatsUsed',   used,
    'coveredBy',   covered,
    'aiCredits',   pocket_ai_balance(p_user),
    'aiUnlimited', coalesce(sub.ai_unlimited, false) and st = 'active' and eff.via_owner is null,
    'trialAvailable', sub.trial_used_at is null,
    'group',       grp
  );
end $$;

-- ── The group card (signed-in person) ─────────────────────────────────────
-- Organiser: { role: 'organiser', size, endsAt, changesLeft, members: [{email, joined}] }
-- Member:    { role: 'member', ownerName, ownerEmail, endsAt }
-- Neither:   { role: null }
create or replace function public.pocket_group_state() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare me uuid := auth.uid(); sub subscriptions; st text; eff record; size int; used int; owner_row record;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into sub from subscriptions where user_id = me;
  st := pocket_plan_state(sub.ends_at, sub.user_id is not null, (select grace_days from billing_settings where id));
  if sub.plan = 'group' and st in ('active', 'grace') then
    select group_size into size from plans where code = 'group';
    select count(*) into used from group_changes where owner_id = me and at > now() - interval '365 days';
    return jsonb_build_object('role', 'organiser', 'size', size, 'endsAt', sub.ends_at, 'state', st,
      'changesLeft', greatest(0, (select group_changes_per_year from billing_settings where id) - used),
      'members', coalesce((select jsonb_agg(jsonb_build_object('email', m.email, 'joined', m.joined_at is not null)
                                            order by m.added_at, m.id)
                             from group_members m where m.owner_id = me and m.removed_at is null), '[]'));
  end if;
  select * into eff from pocket_effective_plan(me);
  if eff.via_owner is not null then
    select coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''), nullif(trim(u.raw_user_meta_data->>'name'), ''),
                    split_part(u.email, '@', 1)) as name, lower(u.email) as email
      into owner_row from auth.users u where u.id = eff.via_owner;
    return jsonb_build_object('role', 'member', 'ownerName', owner_row.name, 'ownerEmail', owner_row.email,
                              'endsAt', eff.ends_at, 'state', eff.state);
  end if;
  return jsonb_build_object('role', null);
end $$;

-- Add someone (organiser). Errors are short sentences for the person.
create or replace function public.pocket_group_add(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); sub subscriptions; st text; size int; places int; e text := lower(trim(coalesce(p_email, '')));
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into sub from subscriptions where user_id = me;
  st := pocket_plan_state(sub.ends_at, sub.user_id is not null, (select grace_days from billing_settings where id));
  if sub.plan is distinct from 'group' or st <> 'active' then
    raise exception 'You need an active Pocket Pro Group to add people.' using errcode = 'PG001';
  end if;
  if e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That doesn''t look like an email address.' using errcode = 'PG001'; end if;
  if e = (select lower(email) from auth.users where id = me) then raise exception 'You''re already in your group.' using errcode = 'PG001'; end if;
  select group_size into size from plans where code = 'group';
  select count(*) into places from group_members where owner_id = me and removed_at is null;
  if places >= size - 1 then raise exception 'Your group is full. Remove someone to add another person.' using errcode = 'PG001'; end if;
  if exists (select 1 from group_members where email = e and removed_at is null) then
    raise exception 'That person is already in a Pocket Pro Group.' using errcode = 'PG001';
  end if;
  -- Joined only once they open Pocket signed in (pocket_entitlements), so fixing
  -- a mistyped address never uses up a change.
  insert into group_members (owner_id, email) values (me, e);
  return pocket_group_state();
end $$;

-- Remove someone (organiser). Removing a person who has joined uses one change.
create or replace function public.pocket_group_remove(p_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); m group_members; used int; allowed int; e text := lower(trim(coalesce(p_email, '')));
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into m from group_members where owner_id = me and email = e and removed_at is null for update;
  if m.id is null then raise exception 'That person isn''t in your group.' using errcode = 'PG001'; end if;
  if m.joined_at is not null then
    select group_changes_per_year into allowed from billing_settings where id;
    select count(*) into used from group_changes where owner_id = me and at > now() - interval '365 days';
    if used >= allowed then
      raise exception 'You''ve used this year''s % changes. Write to us if you need another.', allowed using errcode = 'PG001';
    end if;
    insert into group_changes (owner_id, email) values (me, e);
  end if;
  update group_members set removed_at = now(), removed_by = 'organiser' where id = m.id;
  return pocket_group_state();
end $$;

-- Leave a group (member). Frees the place; no change is used.
create or replace function public.pocket_group_leave() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); my_email text;
begin
  if me is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select lower(email) into my_email from auth.users where id = me;
  update group_members set removed_at = now(), removed_by = 'member'
   where removed_at is null and (user_id = me or (user_id is null and email = my_email));
  return pocket_group_state();
end $$;

-- What the app is told: as before, and a member's place is marked joined
-- the first time they open Pocket signed in.
create or replace function public.pocket_entitlements() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg billing_settings; my_email text;
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
  return pocket_entitlements_for(me)
         || jsonb_build_object('paymentsOpen', cfg.payments_enabled,
                               'backup', pocket_has_backup(me),
                               'aiCosts', jsonb_build_object('scan', cfg.ai_scan_credits, 'voice', cfg.ai_voice_credits,
                                                             'voiceSeconds', cfg.ai_voice_block_secs));
end $$;

revoke execute on function public.pocket_effective_plan(uuid) from public, anon, authenticated;
grant execute on function public.pocket_effective_plan(uuid) to service_role;
revoke execute on function public.pocket_group_state(), public.pocket_group_add(text), public.pocket_group_remove(text),
  public.pocket_group_leave() from public, anon;
grant execute on function public.pocket_group_state(), public.pocket_group_add(text), public.pocket_group_remove(text),
  public.pocket_group_leave() to authenticated;
revoke execute on function public.pocket_entitlements() from public, anon;
grant execute on function public.pocket_entitlements() to authenticated;
