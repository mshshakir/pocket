-- 0022 · Telegram group summaries
--
-- A Family-plan owner adds the Pocket bot to a Telegram group and sends
-- /summary on there. The group is then tied to ONE of the owner's shared
-- spaces, and the bot posts a daily summary (and on Sundays a weekly one) of
-- the entries in that space's accounts only. Personal accounts never appear,
-- and transfers are left out. The bot never reads the group's messages.
--
-- Everything here is used by the bot with the service key; app users have no
-- access to these tables or functions.

create table if not exists public.telegram_groups (
  chat_id        bigint primary key,           -- the Telegram group
  owner_id       uuid not null references auth.users on delete cascade,
  space_id       text not null,                -- one of the owner's spaces
  title          text,                         -- the group's name, for messages
  daily          boolean not null default true,
  weekly         boolean not null default true,
  names          boolean not null default true, -- say who logged entries
  last_daily     date,                         -- the last day a daily summary went out
  last_weekly    date,                         -- the Sunday the last weekly one went out
  paused_notice  boolean not null default false, -- told the group the plan has ended
  created_at     timestamptz not null default now()
);
create index if not exists telegram_groups_owner on public.telegram_groups (owner_id);

alter table public.telegram_groups enable row level security;
revoke all on public.telegram_groups from anon, authenticated;

-- Marks a summary as sent for a day, once. Returns false when another run
-- already took it, so two overlapping runs never post twice.
create or replace function public.pocket_group_claim(p_chat bigint, p_kind text, p_day date) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_kind = 'daily' then
    update telegram_groups set last_daily = p_day
     where chat_id = p_chat and daily and (last_daily is null or last_daily < p_day);
  elsif p_kind = 'weekly' then
    update telegram_groups set last_weekly = p_day
     where chat_id = p_chat and weekly and (last_weekly is null or last_weekly < p_day);
  else
    raise exception 'Unknown summary kind %', p_kind;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- What happened in one shared space between two dates (inclusive), in the
-- book's home currency (minor units): spending and money received, spending
-- by main category, and how many entries each person logged. Only entries in
-- the space's own accounts count; transfers are left out.
create or replace function public.pocket_space_summary(p_owner uuid, p_space text, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with space as (
    select s.id, s.name from spaces s
     where s.owner_id = p_owner and s.id = p_space and s.deleted_at is null
  ),
  accts as (
    select distinct sa.account_id
      from space_accounts sa join space on space.id = sa.space_id
      join accounts a on a.owner_id = p_owner and a.id = sa.account_id and a.deleted_at is null
     where sa.owner_id = p_owner
  ),
  tx as (
    select t.id, t.type, lower(nullif(trim(t.added_by), '')) as who,
           coalesce(t.ref_amount, t.amount) as ref, t.amount, t.category_id
      from transactions t
     where t.owner_id = p_owner and t.deleted_at is null
       and t.type in ('expense', 'income')
       and t.date between p_from and p_to
       and t.account_id in (select account_id from accts)
  ),
  -- A split entry spreads its home-currency value over its parts by their amounts.
  parts as (
    select tx.type, coalesce(s.category_id, tx.category_id) as category_id,
           case when s.transaction_id is null then tx.ref
                when tx.amount = 0 then 0
                else round(tx.ref::numeric * s.amount / tx.amount)::bigint end as amt
      from tx left join transaction_splits s on s.owner_id = p_owner and s.transaction_id = tx.id
  ),
  cats as (
    select coalesce(main.name, c.name, 'Uncategorised') as name, sum(parts.amt) as amt
      from parts
      left join categories c    on c.owner_id = p_owner and c.id = parts.category_id
      left join categories main on main.owner_id = p_owner and main.id = c.parent_id
     where parts.type = 'expense'
     group by 1
  ),
  owner_email as (select lower(email) as email from auth.users where id = p_owner),
  people as (
    select coalesce(nullif(tx.who, (select email from owner_email)), '') as who, count(*) as n
      from tx group by 1
  ),
  named as (
    select p.n, coalesce(
             nullif(split_part(trim(fm.name), ' ', 1), ''),
             nullif(split_part(trim(u.raw_user_meta_data->>'full_name'), ' ', 1), ''),
             nullif(split_part(p.who, '@', 1), ''),
             'Someone') as name
      from people p
      left join lateral (
        select f.name from family_members f
         where f.owner_id = p_owner and f.deleted_at is null and lower(f.email) = p.who and p.who <> ''
         limit 1) fm on true
      left join auth.users u on (p.who = '' and u.id = p_owner) or (p.who <> '' and lower(u.email) = p.who)
  )
  select case when not exists (select 1 from space) then null else jsonb_build_object(
    'space',      (select name from space),
    'currency',   coalesce((select home_currency from book_settings where owner_id = p_owner), 'INR'),
    'accounts',   (select count(*) from accts),
    'spent',      coalesce((select sum(ref) from tx where type = 'expense'), 0),
    'received',   coalesce((select sum(ref) from tx where type = 'income'), 0),
    'entries',    (select count(*) from tx),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'amount', amt) order by amt desc, name) from cats where amt <> 0), '[]'),
    'people',     coalesce((select jsonb_agg(jsonb_build_object('name', name, 'entries', n) order by n desc, name) from named), '[]')
  ) end
$$;

revoke execute on function public.pocket_group_claim(bigint, text, date),
  public.pocket_space_summary(uuid, text, date, date) from public, anon, authenticated;
grant execute on function public.pocket_group_claim(bigint, text, date),
  public.pocket_space_summary(uuid, text, date, date) to service_role;

-- Every hour, ask the telegram-summaries function to post what is due. The
-- function decides what's due (after 9 pm India time, once a day / once a
-- week), so calling it more often, or by anyone, posts nothing extra.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('telegram-summaries') where exists (select 1 from cron.job where jobname = 'telegram-summaries');
select cron.schedule('telegram-summaries', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://nvsfxdnnakzfzsrsfftp.supabase.co/functions/v1/telegram-summaries',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cron$);
