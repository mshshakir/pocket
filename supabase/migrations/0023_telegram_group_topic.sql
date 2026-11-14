-- 0023 · Group summaries go to the topic where /summary on was sent
-- (groups with topics); null means the group itself / its General topic.
alter table public.telegram_groups add column if not exists thread_id bigint;
