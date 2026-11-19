-- 0066 · Telegram: change one part of an entry, and add accounts and
-- categories (owner, 19 Nov 2026).
--
--   · The ✏️ Edit menu changes one field (amount, account, category, date,
--     note, payment type) of an entry made from that chat. To do that the bot
--     reads back that entry's own rows (`pocket_bot_entry`). The ids it asks
--     for derive from the chat and the message that made the entry, so it
--     can only ever read entries made in that chat.
--   · A step in progress (typing a new amount, naming a new account …) is
--     kept in telegram_pending.step. Such rows use kind 'edit' with a step,
--     so the kind check needs no change.
--
-- Additive: one column, one function. No DROP or DELETE.

alter table public.telegram_pending add column if not exists step jsonb;

create or replace function public.pocket_bot_entry(owner uuid, ids text[]) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_agg(pocket_tx_json(t) order by t.id), '[]'::jsonb)
    from transactions t
   where t.owner_id = owner and t.id = any(ids) and t.deleted_at is null
$$;
revoke all on function public.pocket_bot_entry(uuid, text[]) from public, anon, authenticated;
grant execute on function public.pocket_bot_entry(uuid, text[]) to service_role;
