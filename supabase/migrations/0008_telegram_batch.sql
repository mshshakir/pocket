-- Telegram bot: several entries in one message. Lines still waiting for a
-- category queue behind the one being asked about.
alter table public.telegram_pending
  add column if not exists queue jsonb not null default '[]'::jsonb,
  add column if not exists shared boolean not null default false;
