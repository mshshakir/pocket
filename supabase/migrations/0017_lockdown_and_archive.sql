-- 0017 · Signed-out callers lose the book API; the pre-relational tables are archived.
--
-- 1. Lock down. Every pocket_* function that the anon role (anyone holding the
--    public key, signed out) could still EXECUTE now runs only for signed-in
--    users and the server (service_role, used by the Telegram bot). They were
--    already safe in practice — they run as the caller, so row-level security
--    found no rows for a signed-out caller — but the API should not accept the
--    call at all. Functions the RLS policies use (is_book_member,
--    account_access, transaction_access, access_rank, jwt_email) and trigger
--    functions are left as they are.
--
-- 2. Archive. user_data (one JSON blob per user), family_shares (snapshots for
--    family members) and family_contributions (members' entries waiting for
--    the owner) were replaced by the relational book in 'relational_book'
--    (2026-11-14 00:01 UTC). Their last writes predate that cut-over, and every
--    transaction in each user_data blob is in public.transactions. They move to
--    a schema the API does not expose, so nothing can read or write them, but
--    nothing is deleted. Dropping them is a separate, manual step.

-- ── 1 ───────────────────────────────────────────────────────────────────────
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'pocket\_%'
      and has_function_privilege('anon', p.oid, 'execute')
  loop
    execute format('revoke execute on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
end $$;

-- ── 2 ───────────────────────────────────────────────────────────────────────
create schema if not exists archive;
revoke all on schema archive from public, anon, authenticated;

alter publication supabase_realtime drop table public.user_data, public.family_shares, public.family_contributions;

alter table public.user_data            set schema archive;
alter table public.family_shares        set schema archive;
alter table public.family_contributions set schema archive;

comment on schema archive is
  'Tables retired by the relational book (0012/relational_book). Not exposed by the API. Safe to drop once no longer needed.';
