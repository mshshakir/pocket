-- Pocket — daily totals per account, kept up to date by the database.
--
--   account_daily_totals    one row per account per day that had entries:
--                           money in, money out, net change, number of entries.
--                           Written ONLY by triggers, never by the apps, so it
--                           can't drift from the transactions.
--   account_daily_balances  a view adding the running balance:
--                           opening balance + every net up to that day.
--
-- Posting rules match the app's LedgerMath exactly:
--   expense −, income +, transfer by transfer_dir (out −, in +);
--   a split posts each part to its own account (or the transaction's);
--   amounts in the ACCOUNT's currency: the frozen acct_minor when present,
--   else the amount (same currency) or a conversion at the book's saved rate;
--   an unconvertible amount counts as 0, as in the app.
-- Soft-deleted transactions don't count.

create table public.account_daily_totals (
  owner_id   uuid not null references auth.users on delete cascade,
  account_id text not null,
  date       date not null,
  money_in   bigint not null default 0,
  money_out  bigint not null default 0,
  net        bigint not null default 0,
  entries    int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner_id, account_id, date)
);
create index account_daily_totals_delta on public.account_daily_totals (owner_id, updated_at);

-- Every posting a book's live transactions make: one row per account touched.
create or replace view public.ledger_postings with (security_invoker = true) as
with legs as (
  -- no splits: the whole transaction posts to its account
  select t.owner_id, t.id as transaction_id, t.account_id, t.date, t.type, t.transfer_dir,
         t.currency, t.amount, t.acct_minor
  from public.transactions t
  where t.deleted_at is null
    and not exists (select 1 from public.transaction_splits s
                    where s.owner_id = t.owner_id and s.transaction_id = t.id)
  union all
  -- splits (expense/income only): each part posts to its own account
  select t.owner_id, t.id, coalesce(s.account_id, t.account_id), t.date, t.type, t.transfer_dir,
         t.currency, s.amount, s.acct_minor
  from public.transactions t
  join public.transaction_splits s on s.owner_id = t.owner_id and s.transaction_id = t.id
  where t.deleted_at is null and t.type in ('expense', 'income')
)
select l.owner_id, l.transaction_id, l.account_id, l.date,
       (case
          when l.type = 'expense' then -1
          when l.type = 'income' then 1
          when l.type = 'transfer' and l.transfer_dir = 'out' then -1
          when l.type = 'transfer' and l.transfer_dir = 'in' then 1
          else 0
        end)
       * coalesce(
           l.acct_minor,
           case when a.currency is null or a.currency = l.currency then l.amount
                else round(l.amount * (select r.rate from public.book_fx_rates r
                                       where r.owner_id = l.owner_id and r.currency = a.currency and r.deleted_at is null)
                                    / nullif((select r.rate from public.book_fx_rates r
                                              where r.owner_id = l.owner_id and r.currency = l.currency and r.deleted_at is null), 0))::bigint
           end,
           0) as posted
from legs l
left join public.accounts a on a.owner_id = l.owner_id and a.id = l.account_id;

-- Recompute one book's totals for one day from scratch (never incremental).
create or replace function public.refresh_daily_totals(book uuid, day date) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from account_daily_totals where owner_id = book and date = day;
  insert into account_daily_totals (owner_id, account_id, date, money_in, money_out, net, entries)
  select owner_id, account_id, date,
         coalesce(sum(posted) filter (where posted > 0), 0),
         coalesce(-sum(posted) filter (where posted < 0), 0),
         coalesce(sum(posted), 0),
         count(*)
  from ledger_postings
  where owner_id = book and date = day
  group by owner_id, account_id, date;
end $$;

-- Recompute a whole book (used after a bulk import, or to repair).
create or replace function public.rebuild_daily_totals(book uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from account_daily_totals where owner_id = book;
  insert into account_daily_totals (owner_id, account_id, date, money_in, money_out, net, entries)
  select owner_id, account_id, date,
         coalesce(sum(posted) filter (where posted > 0), 0),
         coalesce(-sum(posted) filter (where posted < 0), 0),
         coalesce(sum(posted), 0),
         count(*)
  from ledger_postings
  where owner_id = book
  group by owner_id, account_id, date;
end $$;

-- Triggers: any change to a transaction or split refreshes the day(s) it
-- touched — the old day and the new day when an entry's date changes.
-- Skipped while a bulk import runs (it rebuilds once at the end).
create or replace function public.daily_totals_from_transaction() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('pocket.bulk_import', true) = 'on' then return null; end if;
  if tg_op in ('UPDATE', 'DELETE') then
    perform refresh_daily_totals(old.owner_id, old.date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') and (tg_op = 'INSERT' or new.date is distinct from old.date) then
    perform refresh_daily_totals(new.owner_id, new.date);
  end if;
  return null;
end $$;

create or replace function public.daily_totals_from_split() returns trigger
language plpgsql security definer set search_path = public as $$
declare day date;
begin
  if current_setting('pocket.bulk_import', true) = 'on' then return null; end if;
  select t.date into day from transactions t
  where t.owner_id = coalesce(new.owner_id, old.owner_id)
    and t.id = coalesce(new.transaction_id, old.transaction_id);
  -- No parent row: it was just deleted, and its own trigger refreshes the day.
  if day is not null then
    perform refresh_daily_totals(coalesce(new.owner_id, old.owner_id), day);
  end if;
  return null;
end $$;

create trigger transactions_daily_totals
  after insert or update or delete on public.transactions
  for each row execute function public.daily_totals_from_transaction();

create trigger transaction_splits_daily_totals
  after insert or update or delete on public.transaction_splits
  for each row execute function public.daily_totals_from_split();

-- An account's currency or a saved FX rate can change how un-frozen rows
-- convert, so those changes rebuild the book's totals too.
create or replace function public.daily_totals_rebuild_book() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('pocket.bulk_import', true) = 'on' then return null; end if;
  perform rebuild_daily_totals(coalesce(new.owner_id, old.owner_id));
  return null;
end $$;

create trigger accounts_currency_daily_totals
  after update of currency on public.accounts
  for each row when (new.currency is distinct from old.currency)
  execute function public.daily_totals_rebuild_book();

create trigger fx_rates_daily_totals
  after insert or update or delete on public.book_fx_rates
  for each row execute function public.daily_totals_rebuild_book();

-- Running balance: opening balance + all nets up to and including each day.
create or replace view public.account_daily_balances with (security_invoker = true) as
select d.owner_id, d.account_id, d.date, d.money_in, d.money_out, d.net, d.entries,
       coalesce(a.opening_balance, 0)
         + sum(d.net) over (partition by d.owner_id, d.account_id order by d.date) as balance
from public.account_daily_totals d
left join public.accounts a on a.owner_id = d.owner_id and a.id = d.account_id;

-- Read access: the owner, and members for the accounts shared with them.
-- No write policies: only the triggers above write this table.
alter table public.account_daily_totals enable row level security;
create policy owner_read on public.account_daily_totals for select using (owner_id = auth.uid());
create policy member_read on public.account_daily_totals for select
  using (public.access_rank(public.account_access(owner_id, account_id)) >= 0);

grant select on public.ledger_postings, public.account_daily_balances to authenticated;
revoke all on function public.refresh_daily_totals(uuid, date), public.rebuild_daily_totals(uuid)
  from public, anon, authenticated;

alter publication supabase_realtime add table public.account_daily_totals;
