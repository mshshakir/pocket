-- Telegram bot: the step each chat is waiting on — a category to pick for an
-- entry (nothing is saved until one is chosen), or a correction for an entry
-- whose ✏️ Edit button was tapped. One row per chat; rows expire after 30 min.
create table if not exists public.telegram_pending (
  chat_id            bigint primary key references public.telegram_links on delete cascade,
  kind               text not null check (kind in ('category', 'edit')),
  seed_message_id    bigint not null,
  source_text        text,
  replace            boolean not null default false,
  prompt_message_id  bigint,
  confirm_message_id bigint,
  created_at         timestamptz not null default now()
);

-- RLS on with no policies: only the Edge Function (service role) can use it.
alter table public.telegram_pending enable row level security;
