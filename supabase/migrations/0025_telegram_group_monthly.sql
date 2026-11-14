-- 0025 · Monthly group summaries, by each group's chosen calendar
-- (regular months or Hijri months), posted at 9 pm on the month's last day
-- with the change from the month before.
alter table public.telegram_groups
  add column if not exists monthly boolean not null default true,
  add column if not exists calendar text not null default 'gregorian',
  add column if not exists last_monthly date;

do $$ begin
  alter table public.telegram_groups add constraint telegram_groups_calendar check (calendar in ('gregorian', 'hijri'));
exception when duplicate_object then null; end $$;

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
  elsif p_kind = 'monthly' then
    update telegram_groups set last_monthly = p_day
     where chat_id = p_chat and monthly and (last_monthly is null or last_monthly < p_day);
  else
    raise exception 'Unknown summary kind %', p_kind;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke execute on function public.pocket_group_claim(bigint, text, date) from public, anon, authenticated;
grant execute on function public.pocket_group_claim(bigint, text, date) to service_role;
