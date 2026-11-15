-- 0032 — a short id for each bill reminder, so its Telegram buttons (64 bytes
-- of callback data at most) can say which bill and date they're about.
alter table public.bill_reminders add column if not exists id bigint generated always as identity;
create unique index if not exists bill_reminders_id on public.bill_reminders (id);
