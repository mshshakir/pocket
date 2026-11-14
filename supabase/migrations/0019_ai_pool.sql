-- 0019 · AI credits: unlimited for chosen accounts, and one shared pool per Family plan.
--
-- Decided 2026-11-14:
--   · The four free-for-life accounts have unlimited AI (subscriptions.ai_unlimited).
--   · A Family plan's pool (the owner's credits) applies to its shared space:
--       in the owner's shared space  → owner unlimited, else the owner's pool,
--                                      else the member's own credits;
--       in your own book             → you unlimited, else your own credits only.
--     Every use is recorded on the account it was charged to, with used_by naming
--     who used it.
--
-- pocket_ai_spend(user, book, ref) / pocket_ai_refund(user, ref) are for the
-- server (the AI edge function, phase 4). `book` is whose book the entry is going
-- into; `ref` is the request id: spending the same request twice charges once,
-- and a refund is paid once.

-- ── Data ──────────────────────────────────────────────────────────────────
alter table public.subscriptions add column if not exists ai_unlimited boolean not null default false;

alter table public.ai_credit_ledger add column if not exists used_by uuid references auth.users on delete set null;
alter table public.ai_credit_ledger drop constraint if exists ai_credit_ledger_delta_check;
-- Unlimited uses are recorded with delta 0 so usage is still counted.
alter table public.ai_credit_ledger add constraint ai_credit_ledger_delta_check
  check (delta <> 0 or reason = 'use');
create index if not exists ai_credit_ledger_ref on public.ai_credit_ledger (ref, used_by) where reason = 'use';

-- Members see the uses they made from the family pool, as well as their own rows.
drop policy if exists own_credits on public.ai_credit_ledger;
create policy own_credits on public.ai_credit_ledger for select to authenticated
  using (user_id = auth.uid() or used_by = auth.uid());

-- The history also notes switching unlimited on or off.
create or replace function public.pocket_log_subscription() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into subscription_events (user_id, kind, plan, term, source, ends_at, note)
    values (old.user_id, 'removed', old.plan, old.term, old.source, old.ends_at, old.note);
    return old;
  end if;
  if tg_op = 'UPDATE' and (new.plan, new.term, new.source, new.ends_at, new.auto_renew, new.external_ref, new.note, new.ai_unlimited)
       is not distinct from (old.plan, old.term, old.source, old.ends_at, old.auto_renew, old.external_ref, old.note, old.ai_unlimited) then
    return new;
  end if;
  insert into subscription_events (user_id, kind, plan, term, source, ends_at, ref, note)
  values (new.user_id, case tg_op when 'INSERT' then 'created' else 'changed' end,
          new.plan, new.term, new.source, new.ends_at, new.external_ref,
          concat_ws(' · ', new.note, case when new.ai_unlimited then 'AI unlimited' end));
  return new;
end $$;

update public.subscriptions s set ai_unlimited = true
from auth.users u
where u.id = s.user_id
  and lower(u.email) in ('mshshakir@gmail.com', 'hdshakir@gmail.com', 'sakina0019@gmail.com', 'tshshakir@gmail.com');

-- ── Helpers ───────────────────────────────────────────────────────────────
create or replace function public.pocket_ai_balance(p_user uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(delta), 0)::int from ai_credit_ledger where user_id = p_user
$$;

-- Unlimited AI: switched on and the plan is active.
create or replace function public.pocket_ai_unlimited(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select s.ai_unlimited
                     and pocket_plan_state(s.ends_at, true, (select grace_days from billing_settings where id)) = 'active'
                   from subscriptions s where s.user_id = p_user), false)
$$;

-- Whether this person is on an active Family plan of the book's owner (holding a seat),
-- so the owner's pool pays for AI used in that shared space.
create or replace function public.pocket_ai_in_pool(p_user uuid, p_book uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from jsonb_array_elements(pocket_entitlements_for(p_user)->'coveredBy') c
                 where (c->>'ownerId')::uuid = p_book and c->>'access' = 'write')
$$;

-- ── Spending (server only) ────────────────────────────────────────────────
-- Charge one AI use by p_user for an entry going into p_book's book.
-- Returns {ok, chargedTo: 'unlimited'|'own'|'family', ownerEmail?, remaining?}
-- or {ok: false, reason: 'no_credits'|'no_access'}. Safe to call twice with the same ref.
create or replace function public.pocket_ai_spend(p_user uuid, p_book uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prior ai_credit_ledger; left_ int; shared boolean; owner_email text;
begin
  if p_user is null or p_book is null or coalesce(p_ref, '') = '' then
    raise exception 'user, book and ref are required';
  end if;

  select * into prior from ai_credit_ledger where reason = 'use' and ref = p_ref and used_by = p_user;
  if prior.id is not null then
    return jsonb_build_object('ok', true, 'repeat', true,
      'chargedTo', case when prior.delta = 0 then 'unlimited' when prior.user_id = p_user then 'own' else 'family' end);
  end if;

  shared := p_book <> p_user;
  if shared and not pocket_ai_in_pool(p_user, p_book) then
    return jsonb_build_object('ok', false, 'reason', 'no_access');
  end if;

  -- Unlimited: the space owner's in a shared space, your own in your book.
  if pocket_ai_unlimited(p_book) or pocket_ai_unlimited(p_user) then
    insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_book, 0, 'use', p_ref, p_user);
    return jsonb_build_object('ok', true, 'chargedTo', 'unlimited');
  end if;

  -- The family pool pays first in a shared space. One spender at a time per
  -- balance, so two uses at once can't overdraw it.
  if shared then
    perform pg_advisory_xact_lock(hashtextextended('ai:' || p_book::text, 0));
    left_ := pocket_ai_balance(p_book);
    if left_ >= 1 then
      select lower(email) into owner_email from auth.users where id = p_book;
      insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_book, -1, 'use', p_ref, p_user);
      return jsonb_build_object('ok', true, 'chargedTo', 'family', 'ownerEmail', owner_email, 'remaining', left_ - 1);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text, 0));
  left_ := pocket_ai_balance(p_user);
  if left_ >= 1 then
    insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_user, -1, 'use', p_ref, p_user);
    return jsonb_build_object('ok', true, 'chargedTo', 'own', 'remaining', left_ - 1);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'no_credits');
end $$;

-- Give back the credit for a use that failed (the AI call errored). Paid once.
create or replace function public.pocket_ai_refund(p_user uuid, p_ref text) returns boolean
language plpgsql security definer set search_path = public as $$
declare used ai_credit_ledger;
begin
  select * into used from ai_credit_ledger where reason = 'use' and ref = p_ref and used_by = p_user;
  if used.id is null or used.delta = 0 then return false; end if;
  insert into ai_credit_ledger (user_id, delta, reason, ref, used_by)
  values (used.user_id, -used.delta, 'refund', p_ref, p_user)
  on conflict (user_id, reason, ref) do nothing;
  return found;
end $$;

-- ── Entitlements: add unlimited and the family pool ───────────────────────
create or replace function public.pocket_entitlements_for(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  cfg   billing_settings;
  sub   subscriptions;
  st    text;
  pl    plans;
  my_email text;
  used  int;
  covered jsonb;
begin
  if p_user is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into cfg from billing_settings where id;
  select * into sub from subscriptions where user_id = p_user;
  st := pocket_plan_state(sub.ends_at, sub.user_id is not null, cfg.grace_days);
  select * into pl from plans where code = case when st in ('free', 'lapsed') then 'free' else sub.plan end;
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
    select m.owner_id, lower(u.email) owner_email, op.code plan, op.sharing, op.seats,
           pocket_plan_state(os.ends_at, true, cfg.grace_days) state,
           (select count(*) from family_members m3
             where m3.owner_id = m.owner_id and m3.deleted_at is null
               and (m3.created_at, m3.id) <= (m.created_at, m.id)) seat
    from family_members m
    join auth.users u on u.id = m.owner_id
    join subscriptions os on os.user_id = m.owner_id
    join plans op on op.code = os.plan
    where m.deleted_at is null and m.owner_id <> p_user and lower(m.email) = my_email
  ) x
  where x.sharing and x.state <> 'lapsed' and x.seat <= x.seats - 1;

  return jsonb_build_object(
    'plan',        pl.code,
    'planName',    pl.name,
    'paidPlan',    sub.plan,
    'term',        sub.term,
    'source',      sub.source,
    'state',       st,
    'endsAt',      sub.ends_at,
    'graceUntil',  case when sub.ends_at is not null then sub.ends_at + make_interval(days => cfg.grace_days) end,
    'autoRenew',   coalesce(sub.auto_renew, false),
    'access',      jsonb_build_object(
                     'sync',     pocket_feature_access(pl.sync, st),
                     'telegram', pocket_feature_access(pl.telegram, st),
                     'sharing',  pocket_feature_access(pl.sharing, st)),
    'seats',       pl.seats,
    'seatsUsed',   used,
    'coveredBy',   covered,
    'aiCredits',   pocket_ai_balance(p_user),       -- own credits; for a Family owner, also the pool for their shared space
    'aiUnlimited', coalesce(sub.ai_unlimited, false) and st = 'active',
    'trialAvailable', sub.trial_used_at is null
  );
end $$;

-- ── Admin ─────────────────────────────────────────────────────────────────
create or replace function public.pocket_admin_set_ai_unlimited(p_email text, p_on boolean default true)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := pocket_admin_user(p_email);
begin
  update subscriptions set ai_unlimited = p_on where user_id = uid;
  if not found then raise exception '% has no plan; give them one first (pocket_admin_set_plan)', p_email; end if;
  return pocket_entitlements_for(uid);
end $$;

drop function if exists public.pocket_admin_overview();
create or replace function public.pocket_admin_overview()
returns table (email text, plan text, term text, state text, ends_at timestamptz,
               seats_used int, ai text, ai_uses_30d bigint, signed_up date, note text)
language sql stable security definer set search_path = public as $$
  select lower(u.email)::text, coalesce(s.plan, 'free'), s.term,
         pocket_plan_state(s.ends_at, s.user_id is not null, (select grace_days from billing_settings where id)),
         s.ends_at,
         1 + (select count(*)::int from family_members m where m.owner_id = u.id and m.deleted_at is null),
         case when coalesce(s.ai_unlimited, false) then 'unlimited' else pocket_ai_balance(u.id)::text || ' credits' end,
         (select count(*) from ai_credit_ledger l where l.used_by = u.id and l.reason = 'use' and l.at > now() - interval '30 days'),
         u.created_at::date, s.note
  from auth.users u left join subscriptions s on s.user_id = u.id
  order by u.created_at
$$;

-- ── Execute rights ────────────────────────────────────────────────────────
revoke execute on function
  public.pocket_ai_balance(uuid), public.pocket_ai_unlimited(uuid), public.pocket_ai_in_pool(uuid, uuid),
  public.pocket_ai_spend(uuid, uuid, text), public.pocket_ai_refund(uuid, text),
  public.pocket_entitlements_for(uuid), public.pocket_admin_set_ai_unlimited(text, boolean),
  public.pocket_admin_overview(), public.pocket_log_subscription()
from public, anon, authenticated;
grant execute on function public.pocket_ai_spend(uuid, uuid, text), public.pocket_ai_refund(uuid, text),
                          public.pocket_entitlements_for(uuid) to service_role;
