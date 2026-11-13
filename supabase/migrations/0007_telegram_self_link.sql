-- Telegram bot: self-service linking. A chat is tied to the Pocket user who
-- proved their email with a sign-in code (/link), and can write to that
-- user's own book plus any book shared with their email.
alter table public.telegram_links rename column owner_id to user_id;
alter table public.telegram_links rename column member_email to email;
alter table public.telegram_links
  add column if not exists default_owner_id uuid references auth.users on delete set null;
update public.telegram_links set default_owner_id = user_id where default_owner_id is null;

-- Which book the entry being corrected (✏️ Edit) lives in.
alter table public.telegram_pending add column if not exists owner_id uuid;

-- A /link in progress: the email a code was sent to, and wrong-code attempts.
create table if not exists public.telegram_link_requests (
  chat_id    bigint primary key,
  email      text not null,
  attempts   int not null default 0,
  created_at timestamptz not null default now()
);

-- RLS on with no policies: only the Edge Function (service role) can use it.
alter table public.telegram_link_requests enable row level security;
