-- 0055 · Deleting your own Pocket account: the request and the change of mind.
--
-- Decided by the owner on 17 Nov 2026: people delete their own account in
-- Settings; everything goes 7 days later (sign-in, cloud book, Telegram links,
-- plan, AI credits, requests, feedback); payment records stay (tax, refunds).
-- Until then they can keep the account with one tap.
--
-- This migration only records the request. The deletion itself is done by
-- pocket_account_delete_due() in 0056, which the owner runs in the SQL Editor
-- (it deletes rows).
--
-- Additive only: no DROP or DELETE.

create table if not exists public.account_deletions (
  user_id      uuid primary key,
  email        text,
  requested_at timestamptz not null default now(),
  delete_after timestamptz not null,
  cancelled_at timestamptz,
  done_at      timestamptz
);
alter table public.account_deletions enable row level security;
revoke all on public.account_deletions from anon, authenticated;

alter table public.billing_settings
  add column if not exists account_delete_days int not null default 7 check (account_delete_days between 0 and 60);

-- The signed-in person's pending deletion: {pending: true, deleteAfter} or {pending: false}.
create or replace function public.pocket_account_deletion() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object('pending', true, 'deleteAfter', d.delete_after, 'requestedAt', d.requested_at)
       from account_deletions d
      where d.user_id = auth.uid() and d.cancelled_at is null and d.done_at is null),
    jsonb_build_object('pending', false))
$$;

-- Ask for the account to be deleted. Asking again keeps the first date.
create or replace function public.pocket_account_delete_request() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); days int := (select account_delete_days from billing_settings where id);
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  insert into account_deletions as d (user_id, email, requested_at, delete_after)
  values (me, (select lower(email) from auth.users where id = me), now(), now() + make_interval(days => days))
  on conflict (user_id) do update set
    requested_at = case when d.cancelled_at is null and d.done_at is null then d.requested_at else now() end,
    delete_after = case when d.cancelled_at is null and d.done_at is null then d.delete_after else excluded.delete_after end,
    email = excluded.email, cancelled_at = null, done_at = null;
  -- Nothing renews while the account is on its way out.
  update subscriptions set auto_renew = false where user_id = me;
  return pocket_account_deletion();
end $$;

-- Keep the account after all.
create or replace function public.pocket_account_delete_cancel() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  update account_deletions set cancelled_at = now() where user_id = me and cancelled_at is null and done_at is null;
  return pocket_account_deletion();
end $$;

revoke execute on function public.pocket_account_deletion(), public.pocket_account_delete_request(),
  public.pocket_account_delete_cancel() from public, anon;
grant execute on function public.pocket_account_deletion(), public.pocket_account_delete_request(),
  public.pocket_account_delete_cancel() to authenticated;
