-- Pocket Budget — normalized schema (v1)
-- Replaces the single-JSON-blob `user_data` model. One source of truth;
-- sharing via Row-Level Security; balances derived from frozen postings.
--
-- Conventions:
--   * UUID primary keys (client-generated, so offline inserts need no round-trip)
--   * money is bigint MINOR units
--   * every synced table has updated_at (delta pull) + deleted_at (soft delete)

-- ── helpers ───────────────────────────────────────────────────────────
create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- lower-cased email from the caller's JWT (used by sharing policies)
create or replace function jwt_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- ── profiles (1:1 auth.users) ─────────────────────────────────────────
create table profiles (
  id                   uuid primary key references auth.users on delete cascade,
  home_currency        text not null default 'USD',
  default_currency     text not null default 'USD',
  theme                text not null default 'system',
  show_hijri           boolean not null default true,
  calendar_mode        text not null default 'both',
  date_format          text not null default 'auto',
  hijri_offset         int  not null default 0,
  custom_payment_types text[] not null default '{}',
  updated_at           timestamptz not null default now()
);

-- ── account groups ────────────────────────────────────────────────────
create table account_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  sort_order int  not null default 0,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- ── accounts ──────────────────────────────────────────────────────────
create table accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  group_id        uuid references account_groups on delete set null,
  name            text not null,
  type            text not null default 'bank',
  currency        text not null,
  opening_balance bigint not null default 0,
  color           text,
  icon            text,
  archived        boolean not null default false,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index accounts_user_idx on accounts(user_id);

-- ── categories ────────────────────────────────────────────────────────
create table categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  parent_id  uuid references categories on delete set null,
  name       text not null,
  type       text not null default 'expense',   -- expense|income|transfer
  color      text,
  icon       text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index categories_user_idx on categories(user_id);

-- ── transactions ──────────────────────────────────────────────────────
create table transactions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users on delete cascade, -- OWNER
  account_id          uuid not null references accounts on delete cascade,
  category_id         uuid references categories on delete set null,
  type                text not null,            -- expense|income|transfer
  amount_minor        bigint not null,          -- in `currency`
  currency            text not null,
  exchange_rate       numeric,                  -- tx→home snapshot
  ref_amount_minor    bigint,                   -- amount in home currency snapshot
  acct_minor          bigint,                   -- amount in ACCOUNT currency, frozen
  payee               text default '',
  note                text default '',
  date                date not null,
  hijri_year          int,
  hijri_month         int,                      -- 0-based
  hijri_day           int,
  payment_type        text default 'card',
  record_state        text default 'cleared',
  transfer_pair_id    uuid references transactions on delete set null,
  transfer_dir        text,                     -- in|out|null
  transfer_rate       numeric,
  tags                text[] not null default '{}',
  recurring           jsonb,                    -- {rule, interval, until} on templates
  recurring_source_id uuid references transactions on delete cascade,
  debt_id             uuid,
  debt_role           text,
  regular_item_id     uuid,
  added_by            text,                     -- member email for shared contributions
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);
create index transactions_user_idx    on transactions(user_id);
create index transactions_account_idx on transactions(account_id);
create index transactions_date_idx    on transactions(date);

create table transaction_splits (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions on delete cascade,
  account_id     uuid not null references accounts on delete cascade,
  category_id    uuid references categories on delete set null,
  amount_minor   bigint not null,              -- in the tx currency
  acct_minor     bigint                        -- in the split account currency, frozen
);
create index splits_tx_idx  on transaction_splits(transaction_id);
create index splits_acc_idx on transaction_splits(account_id);

-- ── budgets ───────────────────────────────────────────────────────────
create table budgets (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  amount_minor bigint not null,
  currency     text not null,
  period       text not null default 'gregorian',   -- gregorian|hijri
  rollover     boolean not null default false,
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create table budget_categories (
  id          uuid primary key default gen_random_uuid(), -- PowerSync needs a single id
  budget_id   uuid references budgets on delete cascade,
  category_id uuid references categories on delete cascade,
  unique (budget_id, category_id)
);

-- ── debts, regular items, merchant map ────────────────────────────────
create table debts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  type            text not null,               -- borrowed|lent
  counterparty    text not null,
  principal_minor bigint not null,
  currency        text not null,
  account_id      uuid references accounts on delete set null,
  date_taken      date,
  due_date        date,
  note            text,
  status          text default 'active',
  initial_tx_id   uuid references transactions on delete set null,
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz
);

create table regular_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  category_id uuid references categories on delete set null,
  account_id  uuid references accounts on delete set null,
  currency    text,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create table merchant_categories (
  id          uuid primary key default gen_random_uuid(), -- PowerSync needs a single id
  user_id     uuid not null references auth.users on delete cascade,
  merchant    text not null,
  category_id uuid references categories on delete cascade,
  updated_at  timestamptz not null default now(),
  unique (user_id, merchant)
);

-- ── sharing (replaces family_shares + family_contributions) ───────────
create table account_shares (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users on delete cascade,
  account_id   uuid not null references accounts on delete cascade,
  member_email text not null,
  access       text not null default 'view',   -- view|edit|full
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (account_id, member_email)
);
create index account_shares_member_idx on account_shares(lower(member_email));

-- ── global FX table (refreshed by an edge function on a cron) ──────────
create table fx_rates (
  code       text primary key,                 -- units per 1 USD
  rate       numeric not null,
  updated_at timestamptz not null default now()
);

-- ── updated_at triggers ───────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','account_groups','accounts','categories','transactions',
    'budgets','debts','regular_items','merchant_categories','account_shares'
  ] loop
    execute format(
      'create trigger %I_set_updated before update on %I
         for each row execute function set_updated_at()', t, t);
  end loop;
end $$;

-- ── derived balances (validation view; clients also compute via Dart) ──
create view account_balances as
select a.id as account_id,
       a.opening_balance
       + coalesce((
           select sum(case t.type
                        when 'expense' then -t.acct_minor
                        when 'income'  then  t.acct_minor
                        when 'transfer' then case t.transfer_dir
                                               when 'out' then -t.acct_minor
                                               when 'in'  then  t.acct_minor
                                               else 0 end
                        else 0 end)
           from transactions t
           where t.account_id = a.id
             and t.deleted_at is null
             and not exists (select 1 from transaction_splits s where s.transaction_id = t.id)
         ), 0)
       + coalesce((
           select sum(case t.type when 'expense' then -sp.acct_minor
                                  when 'income'  then  sp.acct_minor
                                  else 0 end)
           from transaction_splits sp
           join transactions t on t.id = sp.transaction_id
           where sp.account_id = a.id and t.deleted_at is null
         ), 0) as balance
from accounts a
where a.deleted_at is null;

-- ── Row-Level Security ────────────────────────────────────────────────
alter table profiles            enable row level security;
alter table account_groups      enable row level security;
alter table accounts            enable row level security;
alter table categories          enable row level security;
alter table transactions        enable row level security;
alter table transaction_splits  enable row level security;
alter table budgets             enable row level security;
alter table budget_categories   enable row level security;
alter table debts               enable row level security;
alter table regular_items       enable row level security;
alter table merchant_categories enable row level security;
alter table account_shares      enable row level security;
alter table fx_rates            enable row level security;

create policy profile_self on profiles for all
  using (id = auth.uid()) with check (id = auth.uid());

-- owner-only tables (same shape for each)
create policy grp_owner    on account_groups      for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy cat_owner    on categories          for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy bud_owner    on budgets             for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy debt_owner   on debts               for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy reg_owner    on regular_items       for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy merch_owner  on merchant_categories for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy budcat_owner on budget_categories   for all
  using (exists (select 1 from budgets b where b.id = budget_id and b.user_id = auth.uid()))
  with check (exists (select 1 from budgets b where b.id = budget_id and b.user_id = auth.uid()));

-- accounts: owner full; shared members read
create policy acc_owner on accounts for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy acc_shared_read on accounts for select
  using (exists (
    select 1 from account_shares s
    where s.account_id = accounts.id and lower(s.member_email) = jwt_email()));

-- transactions: owner full; member rw with edit/full; member delete own
create policy tx_owner on transactions for all
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy tx_member_rw on transactions for all
  using (exists (
    select 1 from account_shares s
    where s.account_id = transactions.account_id
      and lower(s.member_email) = jwt_email()
      and s.access in ('edit','full')))
  with check (exists (
    select 1 from account_shares s
    where s.account_id = transactions.account_id
      and lower(s.member_email) = jwt_email()
      and s.access in ('edit','full')));
create policy tx_member_delete_own on transactions for delete
  using (added_by = jwt_email() and exists (
    select 1 from account_shares s
    where s.account_id = transactions.account_id and lower(s.member_email) = jwt_email()));

-- splits inherit access from their parent transaction
create policy split_via_tx on transaction_splits for all
  using (exists (select 1 from transactions t where t.id = transaction_id))
  with check (exists (select 1 from transactions t where t.id = transaction_id));

-- shares: only the owner manages them; members may read shares aimed at them
create policy share_owner on account_shares for all
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy share_member_read on account_shares for select
  using (lower(member_email) = jwt_email());

-- fx_rates: world-readable, no client writes (edge function uses service role)
create policy fx_read on fx_rates for select using (true);
