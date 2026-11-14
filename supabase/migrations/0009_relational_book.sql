-- Pocket — relational book (replaces the one-JSON-record-per-user `user_data` model).
--
-- Additive: creates new tables next to `user_data`, which stays untouched as the
-- backup until cut-over. Every field found in the existing books has a column.
--
-- Conventions
--   * Every row belongs to a book: owner_id (the book owner's auth user id).
--   * Item ids are the app's own text ids (tx_…, acc_…), unique within a book:
--     primary key (owner_id, id).
--   * Money is bigint MINOR units (paise, cents), as in the app.
--   * updated_at / deleted_at on every synced row: apps pull only what changed,
--     and deletions travel as soft deletes. updated_by records who changed it.
--   * owner_id can never change after insert (trigger), so no row can be moved
--     into someone else's book.
--
-- Sharing: a family member (by sign-in email) gets per-account access
-- view < add < edit < full from member_account_permissions. The database
-- enforces it on accounts, transactions and splits; members can read the
-- owner's categories, account groups, settings (not secrets) and FX rates.

-- ── helpers ─────────────────────────────────────────────────────────────────────────
create or replace function public.jwt_email() returns text
language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.access_rank(access text) returns int
language sql immutable as $$
  select case access when 'view' then 0 when 'add' then 1 when 'edit' then 2 when 'full' then 3
                     when 'owner' then 4 else -1 end
$$;

-- Stamps updated_at / updated_by and keeps owner_id fixed.
create or replace function public.book_row_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.owner_id is distinct from old.owner_id then
    raise exception 'owner_id cannot change';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- ── settings ───────────────────────────────────────────────────────────────────────
create table public.book_settings (
  owner_id                 uuid primary key references auth.users on delete cascade,
  home_currency            text,
  default_currency         text,
  calendar_mode            text,
  show_hijri               boolean,
  hijri_offset             int,
  theme                    text,
  date_format              text,
  default_account_id       text,
  default_payment_type     text,
  custom_payment_types     text[],
  hidden_payment_types     text[],
  collapsed_account_groups text[],
  collapsed_categories     text[],
  fx_rates_updated_at      timestamptz,
  transfer_dir_backfilled  boolean,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  updated_by               uuid,
  deleted_at               timestamptz
);

-- Owner-only: never readable by family members.
create table public.book_secrets (
  owner_id       uuid primary key references auth.users on delete cascade,
  gemini_api_key text,
  supabase_url   text,
  supabase_key   text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  deleted_at     timestamptz
);

create table public.book_fx_rates (
  owner_id   uuid not null references auth.users on delete cascade,
  currency   text not null,
  rate       numeric not null,              -- units per 1 USD
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (owner_id, currency)
);

create table public.merchant_categories (
  owner_id    uuid not null references auth.users on delete cascade,
  merchant    text not null,
  category_id text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  primary key (owner_id, merchant)
);

-- ── structure ──────────────────────────────────────────────────────────────────────
create table public.account_groups (
  owner_id   uuid not null references auth.users on delete cascade,
  id         text not null,
  name       text not null,
  color      text,
  position   int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (owner_id, id)
);

create table public.accounts (
  owner_id        uuid not null references auth.users on delete cascade,
  id              text not null,
  name            text not null,
  type            text,
  currency        text not null,
  color           text,
  icon            text,
  archived        boolean not null default false,
  balance         bigint,                  -- derived by the app, kept for snapshots
  opening_balance bigint,
  group_id        text,
  position        int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  primary key (owner_id, id)
);

create table public.categories (
  owner_id     uuid not null references auth.users on delete cascade,
  id           text not null,
  name         text not null,
  type         text,
  color        text,
  icon         text,
  parent_id    text,
  budget_limit bigint,
  position     int,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  updated_by   uuid,
  deleted_at   timestamptz,
  primary key (owner_id, id)
);

-- ── transactions ─────────────────────────────────────────────────────────────────────
create table public.transactions (
  owner_id            uuid not null references auth.users on delete cascade,
  id                  text not null,
  account_id          text not null,
  category_id         text,
  type                text not null check (type in ('expense','income','transfer')),
  amount              bigint not null,
  currency            text not null,
  exchange_rate       numeric,
  ref_amount          bigint,
  acct_minor          bigint,
  payee               text,
  note                text,
  description         text,
  date                date not null,
  hijri_year          int,
  hijri_month         int,
  hijri_day           int,
  hijri_offset        int,
  payment_type        text,
  record_state        text,
  tags                text[],
  transfer_pair_id    text,
  transfer_dir        text check (transfer_dir in ('out','in')),
  transfer_rate       numeric,
  recurring_rule      text,
  recurring_interval  int,
  recurring_until     date,
  recurring_skipped   text[],
  recurring_source_id text,
  qty                 numeric,
  unit_amount         bigint,
  debt_id             text,
  debt_role           text,
  regular_item_id     text,
  from_family         boolean,
  added_by            text,
  client_created_at   timestamptz,         -- the app's createdAt
  position            int,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  updated_by          uuid,
  deleted_at          timestamptz,
  primary key (owner_id, id)
);
create index transactions_owner_date on public.transactions (owner_id, date);
create index transactions_owner_account on public.transactions (owner_id, account_id);

create table public.transaction_splits (
  owner_id       uuid not null references auth.users on delete cascade,
  transaction_id text not null,
  position       int not null,
  account_id     text,
  category_id    text,
  amount         bigint not null,
  acct_minor     bigint,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  primary key (owner_id, transaction_id, position),
  foreign key (owner_id, transaction_id) references public.transactions (owner_id, id) on delete cascade
);

-- ── budgets, debts, regular items ────────────────────────────────────────
create table public.budgets (
  owner_id    uuid not null references auth.users on delete cascade,
  id          text not null,
  category_id text,
  amount      bigint not null,
  currency    text,
  period      text,
  rollover    boolean,
  position    int,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  deleted_at  timestamptz,
  primary key (owner_id, id)
);

create table public.budget_categories (     -- a budget's categoryIds
  owner_id    uuid not null references auth.users on delete cascade,
  budget_id   text not null,
  position    int not null,
  category_id text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  updated_by  uuid,
  primary key (owner_id, budget_id, position),
  foreign key (owner_id, budget_id) references public.budgets (owner_id, id) on delete cascade
);

create table public.debts (
  owner_id      uuid not null references auth.users on delete cascade,
  id            text not null,
  type          text,
  counterparty  text,
  account_id    text,
  currency      text,
  principal     bigint,
  date_taken    date,
  due_date      date,
  status        text,
  note          text,
  initial_tx_id text,
  position      int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  deleted_at    timestamptz,
  primary key (owner_id, id)
);

create table public.regular_items (
  owner_id        uuid not null references auth.users on delete cascade,
  id              text not null,
  name            text not null,
  account_id      text,
  category_id     text,
  color           text,
  icon            text,
  currency        text,
  default_amount  bigint,
  frequency       text,
  shared_owner_id uuid,
  position        int,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  updated_by      uuid,
  deleted_at      timestamptz,
  primary key (owner_id, id)
);

-- ── family & spaces ──────────────────────────────────────────────────────────────────
create table public.family_members (
  owner_id   uuid not null references auth.users on delete cascade,
  id         text not null,
  email      text not null,
  name       text,
  initials   text,
  color      text,
  space_name text,
  position   int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (owner_id, id)
);
create index family_members_email on public.family_members (lower(email));

create table public.member_account_permissions (
  owner_id   uuid not null references auth.users on delete cascade,
  member_id  text not null,
  account_id text not null,
  access     text not null check (access in ('view','add','edit','full')),
  position   int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (owner_id, member_id, account_id),
  foreign key (owner_id, member_id) references public.family_members (owner_id, id) on delete cascade
);

create table public.member_budget_permissions (
  owner_id   uuid not null references auth.users on delete cascade,
  member_id  text not null,
  budget_id  text not null,
  access     text not null,
  position   int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (owner_id, member_id, budget_id),
  foreign key (owner_id, member_id) references public.family_members (owner_id, id) on delete cascade
);

create table public.spaces (
  owner_id   uuid not null references auth.users on delete cascade,
  id         text not null,
  name       text not null,
  position   int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  deleted_at timestamptz,
  primary key (owner_id, id)
);

create table public.space_accounts (
  owner_id   uuid not null references auth.users on delete cascade,
  space_id   text not null,
  position   int not null,
  account_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (owner_id, space_id, position),
  foreign key (owner_id, space_id) references public.spaces (owner_id, id) on delete cascade
);

create table public.space_budgets (
  owner_id   uuid not null references auth.users on delete cascade,
  space_id   text not null,
  position   int not null,
  budget_id  text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (owner_id, space_id, position),
  foreign key (owner_id, space_id) references public.spaces (owner_id, id) on delete cascade
);

create table public.space_members (
  owner_id      uuid not null references auth.users on delete cascade,
  space_id      text not null,
  position      int not null,
  member_id     text not null,
  access        text,
  budget_access text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  updated_by    uuid,
  primary key (owner_id, space_id, position),
  foreign key (owner_id, space_id) references public.spaces (owner_id, id) on delete cascade
);

-- ── access functions (security definer: read the grants without exposing them) ──
-- The caller's access to one account of a book: 'owner', view/add/edit/full, or null.
create or replace function public.account_access(book uuid, account text) returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() = book then 'owner' else (
    select p.access
    from member_account_permissions p
    join family_members m on m.owner_id = p.owner_id and m.id = p.member_id
    where p.owner_id = book and p.account_id = account
      and m.deleted_at is null and lower(m.email) = jwt_email()
    limit 1) end
$$;

-- Whether the caller is a (non-deleted) family member of a book.
create or replace function public.is_book_member(book uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from family_members m
                 where m.owner_id = book and m.deleted_at is null and lower(m.email) = jwt_email())
$$;

-- The caller's access to a transaction: the weaker of its account's access
-- (and, for a transfer, nothing extra — each leg is checked on its own row).
create or replace function public.transaction_access(book uuid, tx text) returns text
language sql stable security definer set search_path = public as $$
  select account_access(book, t.account_id) from transactions t where t.owner_id = book and t.id = tx
$$;

grant execute on function public.jwt_email(), public.access_rank(text),
  public.account_access(uuid, text), public.is_book_member(uuid),
  public.transaction_access(uuid, text) to authenticated;

-- ── triggers & row level security ────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'book_settings','book_secrets','book_fx_rates','merchant_categories','account_groups',
    'accounts','categories','transactions','transaction_splits','budgets','budget_categories',
    'debts','regular_items','family_members','member_account_permissions',
    'member_budget_permissions','spaces','space_accounts','space_budgets','space_members']
  loop
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function public.book_row_stamp()', t || '_stamp', t);
    execute format('alter table public.%I enable row level security', t);
    -- The owner can do anything in their own book.
    execute format('create policy owner_all on public.%I for all
                    using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Updated-since indexes for delta pulls.
do $$
declare t text;
begin
  foreach t in array array['book_fx_rates','merchant_categories','account_groups','accounts',
    'categories','transactions','transaction_splits','budgets','budget_categories','debts',
    'regular_items','family_members','member_account_permissions','member_budget_permissions',
    'spaces','space_accounts','space_budgets','space_members']
  loop
    execute format('create index %I on public.%I (owner_id, updated_at)', t || '_delta', t);
  end loop;
end $$;

-- Members: read what the owner's book needs to show shared accounts.
create policy member_read on public.book_settings  for select using (public.is_book_member(owner_id));
create policy member_read on public.book_fx_rates  for select using (public.is_book_member(owner_id));
create policy member_read on public.account_groups for select using (public.is_book_member(owner_id));
create policy member_read on public.categories     for select using (public.is_book_member(owner_id));

-- Members: only the accounts shared with them.
create policy member_read on public.accounts for select
  using (public.access_rank(public.account_access(owner_id, id)) >= 0);

-- Members: their own member row and grants (so the app knows what it may do).
create policy member_read_self on public.family_members for select
  using (deleted_at is null and lower(email) = public.jwt_email());
create policy member_read_self on public.member_account_permissions for select
  using (exists (select 1 from public.family_members m where m.owner_id = member_account_permissions.owner_id
                 and m.id = member_account_permissions.member_id and lower(m.email) = public.jwt_email()));
create policy member_read_self on public.member_budget_permissions for select
  using (exists (select 1 from public.family_members m where m.owner_id = member_budget_permissions.owner_id
                 and m.id = member_budget_permissions.member_id and lower(m.email) = public.jwt_email()));

-- Members: budgets granted to them.
create policy member_read on public.budgets for select
  using (exists (select 1 from public.member_budget_permissions p
                 join public.family_members m on m.owner_id = p.owner_id and m.id = p.member_id
                 where p.owner_id = budgets.owner_id and p.budget_id = budgets.id
                   and m.deleted_at is null and lower(m.email) = public.jwt_email()));
create policy member_read on public.budget_categories for select
  using (exists (select 1 from public.budgets b where b.owner_id = budget_categories.owner_id
                 and b.id = budget_categories.budget_id));

-- Members and transactions, per account:
--   view → read · add → create (signed as themselves) · edit → change · full → delete.
-- Deleting is a soft delete (setting deleted_at), so it is checked on update.
create policy member_read on public.transactions for select
  using (public.access_rank(public.account_access(owner_id, account_id)) >= 0);

create policy member_insert on public.transactions for insert
  with check (owner_id <> auth.uid()
              and deleted_at is null
              and added_by = public.jwt_email()
              and public.access_rank(public.account_access(owner_id, account_id)) >= 1);

create policy member_update on public.transactions for update
  using (public.access_rank(public.account_access(owner_id, account_id)) >= 2)
  with check (case when deleted_at is null
                   then public.access_rank(public.account_access(owner_id, account_id)) >= 2
                   else public.access_rank(public.account_access(owner_id, account_id)) >= 3 end);

create policy member_read on public.transaction_splits for select
  using (public.access_rank(public.transaction_access(owner_id, transaction_id)) >= 0);
create policy member_write on public.transaction_splits for all
  using (public.access_rank(public.transaction_access(owner_id, transaction_id)) >= 1
         and public.access_rank(public.account_access(owner_id, coalesce(account_id, ''))) >= 1)
  with check (public.access_rank(public.transaction_access(owner_id, transaction_id)) >= 1
              and public.access_rank(public.account_access(owner_id, coalesce(account_id, ''))) >= 1);

-- ── live updates ─────────────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['book_settings','book_fx_rates','merchant_categories','account_groups',
    'accounts','categories','transactions','transaction_splits','budgets','budget_categories',
    'debts','regular_items','family_members','member_account_permissions',
    'member_budget_permissions','spaces','space_accounts','space_budgets','space_members']
  loop
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end $$;
