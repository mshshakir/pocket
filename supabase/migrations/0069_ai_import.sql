-- 0069 · Import with AI (owner, 24 Nov 2026).
--
-- The app reads a CSV or Excel file on the device; the AI only sees the
-- column names, a few sample rows and the most used values, and writes the
-- rules Pocket applies to every row. All AI calls of one import share a
-- session id:
--   · an account's FIRST import is free when it has up to
--     ai_import_free_rows (5,000) rows;
--   · any other import costs ai_import_credits (5), charged on its first call
--     like any AI use (unlimited accounts are never charged);
--   · the corrections typed after that, in the same import, are free, up to
--     ai_import_calls_per_session (20) calls.
-- If the AI fails, the call isn't counted; on the call that charged, the
-- credits are given back (pocket_ai_import_refund) and the next call charges
-- again. A free first import that never worked stays free.
--
-- Additive: columns, one table, functions (pocket_ai_cost is replaced with the
-- same signature, keeping every kind it priced). No DROP or DELETE.

alter table public.billing_settings
  add column if not exists ai_import_credits           int not null default 5    check (ai_import_credits > 0),
  add column if not exists ai_import_free_rows         int not null default 5000 check (ai_import_free_rows >= 0),
  add column if not exists ai_import_calls_per_session int not null default 20   check (ai_import_calls_per_session > 0);

create or replace function public.pocket_ai_cost(p_kind text, p_seconds int) returns int
language sql stable security definer set search_path = public as $$
  select case when p_kind = 'voice'
              then b.ai_voice_credits * greatest(1, ceil(greatest(coalesce(p_seconds, 0), 1)::numeric / b.ai_voice_block_secs)::int)
              when p_kind = 'question' then b.ai_question_credits
              when p_kind = 'text' then b.ai_text_credits
              when p_kind = 'import' then b.ai_import_credits
              else b.ai_scan_credits end
    from billing_settings b where b.id
$$;

-- One row per import (session).
create table if not exists public.ai_imports (
  user_id    uuid not null,
  session    text not null,
  free       boolean not null default false,   -- the account's free first import
  paid       boolean not null default false,   -- credits taken for it (and not given back)
  calls      int not null default 0,
  rows_count int not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, session)
);
alter table public.ai_imports enable row level security;
revoke all on public.ai_imports from anon, authenticated;

-- One AI call of an import. Returns the pocket_ai_charge shape, plus
-- free: true when nothing is charged for this call, or
-- {ok: false, reason: 'too_many'} past the per-import limit.
create or replace function public.pocket_ai_import(p_user uuid, p_session text, p_rows int, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg billing_settings; cur ai_imports; r jsonb;
begin
  if p_user is null or coalesce(p_session, '') = '' or coalesce(p_ref, '') = '' then raise exception 'user, session and ref are required'; end if;
  select * into cfg from billing_settings where id;
  perform pg_advisory_xact_lock(hashtextextended('aiimport:' || p_user::text, 0));

  select * into cur from ai_imports where user_id = p_user and session = p_session;
  if cur.user_id is null then
    insert into ai_imports (user_id, session, rows_count) values (p_user, p_session, greatest(coalesce(p_rows, 0), 0));
    select * into cur from ai_imports where user_id = p_user and session = p_session;
  end if;

  -- Nothing has worked in this import yet: the first import of an account,
  -- small enough, is free.
  if cur.calls = 0 and not cur.free and not cur.paid
     and not exists (select 1 from ai_imports where user_id = p_user and session <> p_session and (free or paid))
     and coalesce(p_rows, 0) <= cfg.ai_import_free_rows then
    update ai_imports set free = true, calls = 1 where user_id = p_user and session = p_session;
    return jsonb_build_object('ok', true, 'free', true, 'firstFree', true, 'cost', 0);
  end if;

  if cur.calls >= cfg.ai_import_calls_per_session then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;

  if cur.free or cur.paid then
    update ai_imports set calls = calls + 1 where user_id = p_user and session = p_session;
    return jsonb_build_object('ok', true, 'free', true, 'cost', 0);
  end if;

  -- Not paid yet: this call charges the import.
  -- p_ref is new for every call, so a charge given back is never mistaken
  -- for one already made.
  r := pocket_ai_charge(p_user, p_user, 'import:' || p_ref, 'import', 0);
  if (r->>'ok')::boolean then
    update ai_imports set paid = true, calls = calls + 1 where user_id = p_user and session = p_session;
    return r || jsonb_build_object('chargeRef', 'import:' || p_ref);
  end if;
  return r;
end $$;

-- The AI failed: the call isn't counted. If it was the call that charged the
-- import (p_ref given), the credits are given back and the next call charges
-- again; a free first import that never worked stays free for the next try.
create or replace function public.pocket_ai_import_refund(p_user uuid, p_session text, p_ref text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or coalesce(p_session, '') = '' then return; end if;
  if coalesce(p_ref, '') <> '' then
    perform pocket_ai_refund(p_user, p_ref);
    update ai_imports set paid = false where user_id = p_user and session = p_session;
  end if;
  update ai_imports set calls = greatest(calls - 1, 0) where user_id = p_user and session = p_session;
  update ai_imports set free = false where user_id = p_user and session = p_session and free and calls = 0;
end $$;

revoke execute on function public.pocket_ai_import(uuid, text, int, text) from public, anon, authenticated;
revoke execute on function public.pocket_ai_import_refund(uuid, text, text) from public, anon, authenticated;
grant execute on function public.pocket_ai_import(uuid, text, int, text) to service_role;
grant execute on function public.pocket_ai_import_refund(uuid, text, text) to service_role;
