-- 0027 · Yearly group summaries on a year-end date each group chooses
-- (31 December / end of Zilhaj by default; e.g. 31 March for a financial
-- year). The date is in the group's calendar unless yearly_calendar says
-- otherwise; a day past the month's end means its last day.
alter table public.telegram_groups
  add column if not exists yearly boolean not null default true,
  add column if not exists year_end_month int not null default 12 check (year_end_month between 1 and 12),
  add column if not exists year_end_day int not null default 31 check (year_end_day between 1 and 31),
  add column if not exists yearly_calendar text check (yearly_calendar in ('gregorian', 'hijri')),
  add column if not exists last_yearly date;

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
  elsif p_kind = 'yearly' then
    update telegram_groups set last_yearly = p_day
     where chat_id = p_chat and yearly and (last_yearly is null or last_yearly < p_day);
  else
    raise exception 'Unknown summary kind %', p_kind;
  end if;
  get diagnostics n = row_count;
  return n > 0;
end $$;

revoke execute on function public.pocket_group_claim(bigint, text, date) from public, anon, authenticated;
grant execute on function public.pocket_group_claim(bigint, text, date) to service_role;
