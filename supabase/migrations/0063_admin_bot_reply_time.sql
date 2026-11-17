-- 0063 · /stats in the admin bot shows how fast the Pocket bot replies
-- (owner, 17 Nov 2026): from Telegram delivering a message to the bot having
-- handled it (telegram_updates.seen_at → done_at, migration 0050). Updates are
-- kept for 3 days, so that's the longest window.

create or replace function public.pocket_admbot_bot_speed() returns jsonb
language sql stable security definer set search_path = public as $$
  with d as (
    select seen_at, extract(epoch from done_at - seen_at) s from telegram_updates where done_at is not null
  )
  select jsonb_build_object(
    'count24', (select count(*) from d where seen_at > now() - interval '24 hours'),
    'avg24',   (select round(avg(s)::numeric, 1) from d where seen_at > now() - interval '24 hours'),
    'p90_24',  (select round((percentile_cont(0.9) within group (order by s))::numeric, 1) from d where seen_at > now() - interval '24 hours'),
    'count3d', (select count(*) from d),
    'avg3d',   (select round(avg(s)::numeric, 1) from d),
    'failed3d', (select count(*) from telegram_updates where done_at is null and attempts >= 3))
$$;

revoke all on function public.pocket_admbot_bot_speed() from public, anon, authenticated;
grant execute on function public.pocket_admbot_bot_speed() to service_role;
