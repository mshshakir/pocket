-- Telegram bot: which Telegram chats may log entries, and into whose book.
--   owner_id      the Pocket user whose book receives the entry (auth.users id)
--   member_email  who is logging: the owner's own email writes straight to the
--                 owner's book; a family member's email goes through
--                 family_contributions and needs add/edit/full access.
--   default_account_id  used when a message names no #account (e.g. acc_4rwhie3fmn)
create table if not exists public.telegram_links (
  chat_id            bigint primary key,
  owner_id           uuid not null references auth.users on delete cascade,
  member_email       text not null,
  default_account_id text,
  created_at         timestamptz not null default now()
);

-- RLS on with no policies: only the Edge Function (service role) can read it,
-- and the app's public key cannot see or change who is linked.
alter table public.telegram_links enable row level security;
