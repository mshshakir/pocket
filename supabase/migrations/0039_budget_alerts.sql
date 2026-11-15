-- 0039_budget_alerts.sql
-- Telegram budget alerts (80%, 100%, spending faster than planned).
--
-- The app stamps each budget with its current totals in
-- budgets.extra->'alertStatus' (spent, limit, how far ahead of plan, the
-- period and the categories' names — never entries); the owner approved this
-- on 15 Nov 2026. The 10-minute job (telegram-summaries → BudgetAlertRunner)
-- reads those totals through pocket_budget_alert_status() and claims each
-- alert once per budget, period and level in budget_alerts before sending.
-- Alerts go to the book owner's own Telegram chat(s).
--
-- No DROP, no DELETE, no cascades.

create table if not exists public.budget_alerts (
  owner_id   uuid not null,
  budget_id  text not null,
  period_key text not null,
  level      text not null check (level in ('near', 'over', 'fast')),
  created_at timestamptz not null default now(),
  primary key (owner_id, budget_id, period_key, level)
);
alter table public.budget_alerts enable row level security;
revoke all on public.budget_alerts from anon, authenticated;

-- Every budget that carries totals, with the owner's linked chats.
create or replace function public.pocket_budget_alert_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'ownerId', b.owner_id,
           'budgetId', b.id,
           'status', b.extra->'alertStatus',
           'chats', (select coalesce(jsonb_agg(distinct l.chat_id), '[]')
                       from telegram_links l
                       left join auth.users u on u.id = b.owner_id
                      where l.user_id = b.owner_id or lower(l.email) = lower(u.email)))), '[]')
    from budgets b
   where b.deleted_at is null
     and jsonb_typeof(b.extra->'alertStatus') = 'object'
$$;
revoke execute on function public.pocket_budget_alert_status() from public, anon, authenticated;
