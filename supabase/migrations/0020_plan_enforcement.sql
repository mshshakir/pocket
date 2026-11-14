-- 0020 · Paid plans, phase 2: the server enforces them.
--
-- Rules (decided 2026-11-14):
--   · Saving to the cloud needs Sync or Family (active). Free works on the device.
--   · When a plan ends, the cloud copy is read-only for billing_settings.grace_days
--     (30): the app tells the person to download their data in that time. After
--     that it can't be loaded. Nothing is deleted; paying again brings it back.
--   · Sharing with family needs Family. It covers the owner plus (seats − 1)
--     members, earliest-added first; adding more is refused.
--   · A member writes into an owner's shared space only while the owner's Family
--     plan is active; in its grace period they can see it but not change it.
--
-- How: a guard trigger on every table of the book checks each write made by a
-- signed-in user, whichever way it arrives (the app's save, or a direct API
-- write). The server (service_role, e.g. the Telegram bot, which checks plans
-- itself) and the owner in the SQL/Table Editor have no auth.uid() and pass.
-- Loading (pocket_get_changes / pocket_get_book) needs read access; shared books
-- are only listed while the owner's Family plan covers the person.
--
-- Refusals use SQLSTATE PP402 with detail 'sync' | 'shared' | 'sharing' | 'seats'
-- so the app can show the right prompt.

-- ── What a person may do ───────────────────────────────────────────────────
-- 'write' | 'read' | 'none' for one feature of a person's own plan.
create or replace function public.pocket_own_access(p_user uuid, p_feature text) returns text
language sql stable security definer set search_path = public as $$
  select pocket_feature_access(
           coalesce(case p_feature when 'sync' then p.sync when 'telegram' then p.telegram
                                   when 'sharing' then p.sharing end, false),
           st.state)
  from (select s.plan,
               pocket_plan_state(s.ends_at, s.user_id is not null, (select grace_days from billing_settings where id)) state
        from (select 1) one left join subscriptions s on s.user_id = p_user) st
  left join plans p on p.code = st.plan
$$;

-- The owners whose Family plan covers this person, and how ('write' | 'read').
create or replace function public.pocket_coverage(p_user uuid)
returns table (owner_id uuid, access text)
language sql stable security definer set search_path = public as $$
  select (c->>'ownerId')::uuid, c->>'access'
  from jsonb_array_elements(pocket_entitlements_for(p_user)->'coveredBy') c
  where c->>'access' in ('write', 'read')
$$;

-- May the signed-in caller write rows of this owner's book? Remembered for the
-- rest of the transaction, so a save of many rows asks once per book.
create or replace function public.pocket_can_write(p_owner uuid) returns boolean
language plpgsql volatile security definer set search_path = public as $$
declare uid uuid := auth.uid(); key text; ok boolean;
begin
  if uid is null then return true; end if;   -- server or SQL Editor
  key := 'pocket.cw_' || md5(uid::text || ':' || p_owner::text);   -- per caller and book
  if current_setting(key, true) = '1' then return true; end if;
  if p_owner = uid then
    ok := pocket_own_access(uid, 'sync') = 'write';
  else
    ok := exists (select 1 from pocket_coverage(uid) c where c.owner_id = p_owner and c.access = 'write');
  end if;
  if ok then perform set_config(key, '1', true); end if;
  return ok;
end $$;

-- Raise the plan refusal.
create or replace function public.pocket_plan_refuse(p_detail text, p_hint text) returns void
language plpgsql as $$
begin
  raise exception 'PLAN_REQUIRED' using errcode = 'PP402', detail = p_detail, hint = p_hint;
end $$;

-- ── Guards ─────────────────────────────────────────────────────────────────
create or replace function public.pocket_guard_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare owner uuid := case when tg_op = 'DELETE' then old.owner_id else new.owner_id end;
begin
  if not pocket_can_write(owner) then
    if owner = auth.uid() then
      perform pocket_plan_refuse('sync', 'Saving to the cloud needs a Sync or Family plan.');
    else
      perform pocket_plan_refuse('shared', 'This shared space is read-only: its owner''s Family plan is not active.');
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;

-- Sharing with family: Family plan, within its seats. Removing is always allowed.
create or replace function public.pocket_guard_sharing() returns trigger
language plpgsql security definer set search_path = public as $$
declare seats int; others int;
begin
  if auth.uid() is null then return new; end if;
  if tg_table_name = 'family_members' and new.deleted_at is not null then return new; end if;
  if pocket_own_access(new.owner_id, 'sharing') <> 'write' then
    perform pocket_plan_refuse('sharing', 'Sharing with family needs a Family plan.');
  end if;
  if tg_table_name = 'family_members' then
    select p.seats into seats from subscriptions s join plans p on p.code = s.plan where s.user_id = new.owner_id;
    select count(*) into others from family_members
      where owner_id = new.owner_id and deleted_at is null and id <> new.id;
    if others + 1 > seats - 1 then
      perform pocket_plan_refuse('seats', format('Your plan covers %s people, you included.', seats));
    end if;
  end if;
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array['account_groups', 'accounts', 'book_fx_rates', 'book_settings', 'budget_categories',
                           'budgets', 'categories', 'debts', 'family_members', 'member_account_permissions',
                           'member_budget_permissions', 'merchant_categories', 'regular_items', 'space_accounts',
                           'space_budgets', 'space_members', 'spaces', 'transaction_splits', 'transactions'] loop
    execute format('drop trigger if exists zz_plan_guard on public.%I', t);
    execute format('create trigger zz_plan_guard before insert or update or delete on public.%I
                    for each row execute function public.pocket_guard_write()', t);
  end loop;
  foreach t in array array['family_members', 'member_account_permissions', 'member_budget_permissions', 'space_members'] loop
    execute format('drop trigger if exists zz_plan_sharing on public.%I', t);
    execute format('create trigger zz_plan_sharing before insert or update on public.%I
                    for each row execute function public.pocket_guard_sharing()', t);
  end loop;
end $$;

-- ── Loading ────────────────────────────────────────────────────────────────
-- Own book: active or grace (read-only) plans only.
create or replace function public.pocket_require_read() returns void
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid();
begin
  if uid is not null and pocket_own_access(uid, 'sync') = 'none' then
    perform pocket_plan_refuse('sync', 'The cloud copy needs a Sync or Family plan.');
  end if;
end $$;

create or replace function public.pocket_get_changes(since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  owner uuid := auth.uid();
  head jsonb;
  overlap timestamptz := since - interval '5 minutes';
begin
  if owner is null then return null; end if;
  perform pocket_require_read();
  head := pocket_book_head(owner);
  if head is null then return null; end if;
  return head || jsonb_build_object('_delta', jsonb_build_object(
    'cursor', pocket_iso(now()),
    'full', since is null,
    'count', (select count(*) from transactions where owner_id = owner and deleted_at is null),
    'put', (select coalesce(jsonb_agg(pocket_tx_json(t) order by t.position, t.date, t.id), '[]')
            from transactions t
            where t.owner_id = owner and t.deleted_at is null
              and (since is null or t.updated_at > overlap)),
    'remove', case when since is null then '[]'::jsonb else
              (select coalesce(jsonb_agg(t.id), '[]') from transactions t
               where t.owner_id = owner and t.deleted_at is not null and t.updated_at > overlap) end));
end $$;

create or replace function public.pocket_get_book() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform pocket_require_read();
  return pocket_export_book(auth.uid());
end $$;

-- Shared books: only owners whose Family plan covers the caller; in the plan's
-- grace period every permission reads as 'view'.
create or replace function public.pocket_my_grants()
returns table (owner_id uuid, member_id text, space_name text, space_id text, perm jsonb, bperm jsonb)
language sql stable security definer set search_path = public as $$
  with mine as (
    select m.owner_id, m.id as member_id, m.space_name,
           coalesce((select sm.space_id from space_members sm join spaces sp
                       on sp.owner_id = sm.owner_id and sp.id = sm.space_id and sp.deleted_at is null
                     where sm.owner_id = m.owner_id and sm.member_id = m.id
                     order by sm.space_id limit 1), 'default') as space_id
    from family_members m
    where m.deleted_at is null and lower(m.email) = jwt_email() and m.owner_id <> auth.uid()
  ), covered as (
    select * from pocket_coverage(auth.uid())
  ), grants as (
    select x.owner_id, x.member_id, x.space_name, x.space_id, c.access,
           coalesce((select jsonb_object_agg(p.account_id, p.access) from member_account_permissions p
                     where p.owner_id = x.owner_id and p.member_id = x.member_id), '{}') as perm,
           coalesce((select jsonb_object_agg(p.budget_id, p.access) from member_budget_permissions p
                     where p.owner_id = x.owner_id and p.member_id = x.member_id), '{}') as bperm
    from mine x join covered c on c.owner_id = x.owner_id
  )
  select g.owner_id, g.member_id, g.space_name, g.space_id,
         case when g.access = 'read' then (select coalesce(jsonb_object_agg(k, 'view'), '{}') from jsonb_object_keys(g.perm) k) else g.perm end,
         case when g.access = 'read' then (select coalesce(jsonb_object_agg(k, 'view'), '{}') from jsonb_object_keys(g.bperm) k) else g.bperm end
  from grants g
  where g.perm <> '{}' or g.bperm <> '{}'
$$;

-- ── Execute rights ─────────────────────────────────────────────────────────
revoke execute on function
  public.pocket_own_access(uuid, text), public.pocket_coverage(uuid), public.pocket_can_write(uuid),
  public.pocket_plan_refuse(text, text), public.pocket_guard_write(), public.pocket_guard_sharing(),
  public.pocket_require_read(), public.pocket_my_grants()
from public, anon, authenticated;
revoke execute on function public.pocket_get_changes(timestamptz), public.pocket_get_book() from public, anon;
grant execute on function public.pocket_get_changes(timestamptz), public.pocket_get_book() to authenticated, service_role;
