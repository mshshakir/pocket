# Backend redesign — normalized, authoritative Supabase schema

**Status:** proposal for approval. Nothing here is applied yet. The existing
`user_data` / `family_shares` / `family_contributions` tables and the live web
app stay untouched until cutover.

## Why change the backend at all

Today the entire app state is one JSON blob in `user_data.data`, every client
recomputes balances itself, and family sharing is done by copying snapshots and
writing delete-markers into `family_contributions`. That design caused the exact
bugs we just fixed (whole-blob last-write-wins, the `account_id` NOT-NULL delete
marker, snapshot drift). A normalized schema with Row-Level Security fixes that
class of problem permanently and gives every client (Flutter iOS/Android/Web)
one unambiguous source of truth.

## Core principles

1. **One source of truth** = normalized Postgres tables. Clients are caches.
2. **Sharing = Row-Level Security**, not snapshot copies or markers. A member
   reads the owner's rows directly, filtered by policy. The whole
   `family_shares` / `family_contributions` machinery is deleted.
3. **Each posting stores the amount in its account's currency** (`acct_minor`),
   frozen at write time — so a balance is a pure `SUM`, no FX at read time, and
   no drift when rates move (this is the rate-freeze fix, moved into the data
   model).
4. **Derived values** (balances, budget spend) are exposed as SQL views for
   validation and thin clients, but the canonical computation still lives in the
   shared Dart `domain` package so the app works fully offline (see doc 02).

## Tables (DDL sketch — for review, not final)

```sql
-- 1:1 with auth.users. True user settings only; device-only UI prefs
-- (collapsed groups, etc.) stay local on the client.
create table profiles (
  id               uuid primary key references auth.users on delete cascade,
  home_currency    text not null default 'USD',
  default_currency text not null default 'USD',
  theme            text not null default 'system',
  show_hijri       boolean not null default true,
  calendar_mode    text not null default 'both',
  date_format      text not null default 'auto',
  hijri_offset     int  not null default 0,
  custom_payment_types text[] not null default '{}',
  updated_at       timestamptz not null default now()
);

create table account_groups (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users on delete cascade,
  name      text not null,
  sort_order int not null default 0
);

create table accounts (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users on delete cascade,
  group_id        uuid references account_groups on delete set null,
  name            text not null,
  type            text not null default 'bank',
  currency        text not null,
  opening_balance bigint not null default 0,   -- minor units
  color           text,
  icon            text,
  archived        boolean not null default false,
  created_at      timestamptz not null default now()
);

create table categories (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users on delete cascade,
  parent_id uuid references categories on delete set null,
  name      text not null,
  type      text not null,                      -- expense|income|transfer
  color     text,
  icon      text
);

create table transactions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users on delete cascade, -- the OWNER
  account_id        uuid not null references accounts on delete cascade,
  category_id       uuid references categories on delete set null,
  type              text not null,              -- expense|income|transfer
  amount_minor      bigint not null,            -- in `currency`
  currency          text not null,
  exchange_rate     numeric,                    -- tx->home, snapshot
  ref_amount_minor  bigint,                     -- amount in home currency, snapshot
  acct_minor        bigint,                     -- amount in ACCOUNT currency, frozen
  payee             text default '',
  note              text default '',
  date              date not null,
  hijri_year        int, hijri_month int, hijri_day int,  -- snapshot
  payment_type      text default 'card',
  record_state      text default 'cleared',
  transfer_pair_id  uuid references transactions on delete set null,
  transfer_dir      text,                       -- in|out|null
  transfer_rate     numeric,
  tags              text[] not null default '{}',
  recurring         jsonb,                      -- {rule, interval, until} on templates
  recurring_source_id uuid references transactions on delete cascade,
  debt_id           uuid,
  debt_role         text,
  regular_item_id   uuid,
  added_by          text,                       -- member email for shared contributions
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table transaction_splits (
  id             uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references transactions on delete cascade,
  account_id     uuid not null references accounts on delete cascade,
  category_id    uuid references categories on delete set null,
  amount_minor   bigint not null,              -- in the tx currency
  acct_minor     bigint                        -- in the split account's currency, frozen
);

create table budgets (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references auth.users on delete cascade,
  amount_minor bigint not null,
  currency  text not null,
  period    text not null default 'gregorian', -- gregorian|hijri
  rollover  boolean not null default false
);
create table budget_categories (
  budget_id   uuid references budgets on delete cascade,
  category_id uuid references categories on delete cascade,
  primary key (budget_id, category_id)
);

create table debts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  type         text not null,                  -- borrowed|lent
  counterparty text not null,
  principal_minor bigint not null,
  currency     text not null,
  account_id   uuid references accounts on delete set null,
  date_taken   date, due_date date,
  note         text, status text default 'active',
  initial_tx_id uuid references transactions on delete set null
);

create table regular_items (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users on delete cascade,
  name        text not null,
  category_id uuid references categories on delete set null,
  account_id  uuid references accounts on delete set null,
  currency    text
);

create table merchant_categories (
  user_id     uuid not null references auth.users on delete cascade,
  merchant    text not null,
  category_id uuid references categories on delete cascade,
  primary key (user_id, merchant)
);

-- Global, shared across all users; refreshed by an edge function on a cron.
create table fx_rates (
  code       text primary key,                 -- units per 1 USD
  rate       numeric not null,
  updated_at timestamptz not null default now()
);
```

### Sharing table (replaces family_shares + family_contributions)

```sql
create table account_shares (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users on delete cascade,
  account_id   uuid not null references accounts on delete cascade,
  member_email text not null,                  -- matched against the member's JWT email
  access       text not null default 'view',   -- view|edit|full
  created_at   timestamptz not null default now(),
  unique (account_id, member_email)
);
```

## Row-Level Security (the heart of sharing)

Enable RLS on every table. A member reads/writes the owner's rows **directly**;
no copies, no markers.

```sql
alter table accounts enable row level security;

-- Owner sees their own accounts.
create policy acc_owner on accounts
  for all using (user_id = auth.uid());

-- Shared members see accounts shared with their email (read).
create policy acc_shared_read on accounts
  for select using (exists (
    select 1 from account_shares s
    where s.account_id = accounts.id
      and lower(s.member_email) = lower(auth.jwt()->>'email')
  ));
```

```sql
alter table transactions enable row level security;

-- Owner: full control of their transactions.
create policy tx_owner on transactions
  for all using (user_id = auth.uid());

-- Member with edit/full on the account: can read + insert + update.
create policy tx_member_rw on transactions
  for all using (exists (
    select 1 from account_shares s
    where s.account_id = transactions.account_id
      and lower(s.member_email) = lower(auth.jwt()->>'email')
      and s.access in ('edit','full')
  ));

-- Member can always delete a transaction THEY added (added_by = their email),
-- even with only edit access — this is the case that was buggy before, now a
-- one-line policy with no marker table.
create policy tx_member_delete_own on transactions
  for delete using (
    added_by = lower(auth.jwt()->>'email')
    and exists (select 1 from account_shares s
                where s.account_id = transactions.account_id
                  and lower(s.member_email) = lower(auth.jwt()->>'email'))
  );
```

The contribution/marker dance, optimistic `#pendingRemovals`/`#pendingAdditions`,
and `#commitState` CAS all disappear — the DB enforces who can touch what.

## Derived balances (validation view; math also lives in the Dart domain)

Because each posting stores `acct_minor` (account-currency, frozen), a balance is
a pure sum — no FX at read time:

```sql
create view account_balances as
select a.id as account_id,
       a.opening_balance
       + coalesce((
           -- non-split postings
           select sum(case t.type
                        when 'expense' then -t.acct_minor
                        when 'income'  then  t.acct_minor
                        when 'transfer' then case t.transfer_dir
                                               when 'out' then -t.acct_minor
                                               when 'in'  then  t.acct_minor else 0 end
                        else 0 end)
           from transactions t
           where t.account_id = a.id and (t.splits is null) ), 0)
       + coalesce((
           -- split postings
           select sum(case t.type when 'expense' then -sp.acct_minor
                                  when 'income'  then  sp.acct_minor else 0 end)
           from transaction_splits sp join transactions t on t.id = sp.transaction_id
           where sp.account_id = a.id ), 0) as balance
from accounts a;
```

This mirrors `LedgerMath.contributions()` exactly. It's optional (clients compute
offline via the Dart domain package) but invaluable for cross-checking and for
any future thin client.

## Sync model

- **Realtime:** clients subscribe to `postgres_changes` on their tables (RLS
  scopes what they receive). A member is pushed the owner's changes directly.
- **Offline-first:** the client keeps a local DB (Drift) as the working copy and
  an **outbox** of pending mutations with client-generated UUIDs. On reconnect it
  flushes the outbox (idempotent upserts) and pulls deltas via `updated_at`.
- **Conflicts:** per-row `updated_at` last-writer-wins is fine for a personal/
  family app; UUID PKs mean inserts never collide. (Optionally evaluate
  **PowerSync**, which provides this offline-sync layer for Supabase out of the
  box — see doc 02.)

## Migration from the JSON blob (one-time, non-destructive)

1. Keep `user_data` as-is (becomes a backup).
2. An edge function / SQL routine reads each `user_data.data` jsonb and inserts
   the normalized rows (accounts → `accounts`, transactions → `transactions` +
   `transaction_splits`, etc.), computing `acct_minor` from the stored data.
3. Verify each migrated user's `account_balances` view equals the balance the old
   app showed (we have the exact rules to assert this).
4. Only after the Flutter app reaches parity do we stop writing to `user_data`.

## Open decisions for you

- **Gemini API key:** keep it **client-only** (never stored server-side) — agreed?
  Storing third-party keys in Postgres in plaintext is a risk.
- **PowerSync vs. hand-rolled outbox** for offline sync (cost vs. control).
- **fx_rates refresh:** Supabase scheduled edge function (recommended) vs. each
  client fetching `open.er-api.com` as today.
