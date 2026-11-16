-- Telegram re-sends an update when it doesn't hear back in time. The bot
-- records each update id here first and skips any it has already seen, so a
-- message (a sign-in code, an entry) is only ever handled once.
create table if not exists public.telegram_updates (
  update_id bigint primary key,
  seen_at   timestamptz not null default now()
);

-- RLS on with no policies: only the Edge Function (service role) can use it.
alter table public.telegram_updates enable row level security;

create index if not exists telegram_updates_seen_at on public.telegram_updates (seen_at);
