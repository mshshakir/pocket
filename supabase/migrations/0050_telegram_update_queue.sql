-- Telegram updates become a small queue (builds on 0049). The webhook stores
-- each update, with its content, before telling Telegram it arrived; then it
-- is handled and marked done. One whose handling never finished (the function
-- stopped midway) is picked up again by pocket_telegram_stale_updates — by the
-- bot after its next message, and by the scheduled telegram-summaries call.
alter table public.telegram_updates
  add column if not exists payload    jsonb,
  add column if not exists attempts   int not null default 0,
  add column if not exists claimed_at timestamptz,
  add column if not exists done_at    timestamptz,
  add column if not exists last_error text;

create index if not exists telegram_updates_open
  on public.telegram_updates (update_id) where done_at is null;

-- Claims up to p_limit updates left unfinished for over 90 seconds (at most
-- 3 tries, within the last hour), so two callers never take the same one.
create or replace function public.pocket_telegram_stale_updates(p_limit int default 10)
returns setof public.telegram_updates
language sql
security definer
set search_path = public
as $$
  update public.telegram_updates u
     set claimed_at = now(), attempts = u.attempts + 1
   where u.update_id in (
     select update_id from public.telegram_updates
      where done_at is null and payload is not null and attempts < 3
        and seen_at > now() - interval '1 hour'
        and coalesce(claimed_at, seen_at) < now() - interval '90 seconds'
      order by update_id
      limit p_limit
      for update skip locked)
  returning u.*;
$$;

revoke execute on function public.pocket_telegram_stale_updates(int) from public, anon, authenticated;
grant execute on function public.pocket_telegram_stale_updates(int) to service_role;

-- Rows from the earlier dedup-only version count as done.
update public.telegram_updates set done_at = coalesce(done_at, seen_at) where payload is null;
