-- Pocket — the API the apps and the Telegram bot use on the relational book.
--
--   pocket_put_<kind>(book, item, pos)   write one item (app shape → columns).
--                                        Update-then-insert, so row-level
--                                        security judges an edit as an edit.
--   pocket_remove(book, kind, id)        soft-delete one item.
--   pocket_apply_changes(book, changes)  one save: { put: {kind: [items]},
--                                        remove: {kind: [ids]}, user, fxRates,
--                                        merchantCategories }. Runs as the
--                                        caller, so the sharing rules apply.
--   pocket_get_book()                    the caller's own book, app shape.
--   pocket_get_shared()                  books shared with the caller, in the
--                                        shape the app's shared views use.
--   pocket_import_book(owner)            redefined on the put functions, so
--                                        import and saves share one mapping.
--
-- Members may also edit or delete the entries they added themselves on an
-- account they can add to (fixing your own mistake needs no extra rights).

-- Fields the app writes that no column existed for, plus `extra` on every
-- item table: any field the app sends that has no column of its own is kept
-- there as-is and returned on load, so a new app field can never be lost or
-- stop a save. Known fields always get real columns.
alter table public.transactions add column if not exists regular_log_id text;
alter table public.debts add column if not exists settled_externally boolean;
alter table public.debts add column if not exists settled_at date;
alter table public.book_settings add column if not exists book_extra jsonb;
do $$
declare t text;
begin
  foreach t in array array['transactions','accounts','categories','account_groups','budgets','debts',
                           'regular_items','family_members','spaces','book_settings'] loop
    execute format('alter table public.%I add column if not exists extra jsonb', t);
  end loop;
end $$;

-- The fields each kind maps to columns (everything else goes to `extra`).
create or replace function public.pocket_known(kind text) returns text[]
language sql immutable as $$
  select case kind
    when 'transaction' then array['id','accountId','categoryId','type','amount','currency','exchangeRate',
      'refAmount','acctMinor','payee','note','description','date','hijriDate','paymentType','recordState',
      'tags','transferPairId','transferDir','transferRate','recurring','recurringSourceId','qty','unitAmount',
      'debtId','debtRole','regularItemId','regularLogId','_fromFamily','addedBy','createdAt','splits']
    when 'account' then array['id','name','type','currency','color','icon','archived','balance',
      'openingBalance','groupId']
    when 'category' then array['id','name','type','color','icon','parentId','budgetLimit']
    when 'accountGroup' then array['id','name','color']
    when 'budget' then array['id','categoryId','categoryIds','amount','currency','period','rollover']
    when 'debt' then array['id','type','counterparty','accountId','currency','principal','dateTaken',
      'dueDate','status','note','initialTxId','settledExternally','settledAt']
    when 'regularItem' then array['id','name','accountId','categoryId','color','icon','currency',
      'defaultAmount','frequency','sharedOwnerId']
    when 'familyMember' then array['id','email','name','initials','color','spaceName','permissions',
      'budgetPermissions']
    when 'space' then array['id','name','accountIds','budgetIds','members']
    when 'user' then array['calendarMode','defaultCurrency','homeCurrency','showHijri','theme',
      'supabaseUrl','supabaseKey','geminiApiKey','dateFormat','collapsedAccountGroups',
      'collapsedCategories','hiddenPaymentTypes','hijriOffset','customPaymentTypes','defaultAccountId',
      'defaultPaymentType']
    when 'book' then array['_transferDirBackfilled','accountGroups','accounts','budgets','categories',
      'debts','family','fxRates','fxRatesUpdatedAt','merchantCategories','regularItems','spaces',
      'transactions','user']
  end
$$;

-- The fields of an item that have no column (null when there are none).
create or replace function public.pocket_extra(el jsonb, kind text) returns jsonb
language sql immutable as $$
  select case when el is null or jsonb_typeof(el) <> 'object' then null else
    (select jsonb_object_agg(k, v) from jsonb_each(el) e(k, v) where not (k = any(pocket_known(kind)))) end
$$;

-- ── one mapping per kind ─────────────────────────────────────────────────────
create or replace function public.pocket_put_transaction(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
begin
  perform pocket_put_transaction_row(book, el, pos);
  perform pocket_put_transaction_splits(book, el);
end $$;

create or replace function public.pocket_put_transaction_row(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
declare tid text := el->>'id';
begin
  perform pocket_assert_keys('hijriDate', el->'hijriDate', array['year','month','day','offset']);
  perform pocket_assert_keys('recurring', el->'recurring', array['rule','interval','until','skipped']);

  update transactions set
    account_id = el->>'accountId', category_id = el->>'categoryId', type = el->>'type',
    amount = pocket_minor(el->'amount'), currency = el->>'currency',
    exchange_rate = (el->>'exchangeRate')::numeric, ref_amount = pocket_minor(el->'refAmount'),
    acct_minor = pocket_minor(el->'acctMinor'), payee = el->>'payee', note = el->>'note',
    description = el->>'description', date = (el->>'date')::date,
    hijri_year = (el->'hijriDate'->>'year')::int, hijri_month = (el->'hijriDate'->>'month')::int,
    hijri_day = (el->'hijriDate'->>'day')::int, hijri_offset = (el->'hijriDate'->>'offset')::int,
    payment_type = el->>'paymentType', record_state = el->>'recordState',
    tags = pocket_text_array(el->'tags'), transfer_pair_id = el->>'transferPairId',
    transfer_dir = el->>'transferDir', transfer_rate = (el->>'transferRate')::numeric,
    recurring_rule = case when jsonb_typeof(el->'recurring') = 'object' then el->'recurring'->>'rule' end, recurring_interval = (el->'recurring'->>'interval')::int,
    recurring_until = (el->'recurring'->>'until')::date,
    recurring_skipped = pocket_text_array(el->'recurring'->'skipped'),
    recurring_source_id = el->>'recurringSourceId', qty = (el->>'qty')::numeric,
    unit_amount = pocket_minor(el->'unitAmount'), debt_id = el->>'debtId', debt_role = el->>'debtRole',
    regular_item_id = el->>'regularItemId', from_family = (el->>'_fromFamily')::boolean,
    added_by = el->>'addedBy', client_created_at = (el->>'createdAt')::timestamptz,
    regular_log_id = el->>'regularLogId', extra = pocket_extra(el, 'transaction'),
    position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = tid;
  if not found then
    insert into transactions (owner_id, id, account_id, category_id, type, amount, currency,
      exchange_rate, ref_amount, acct_minor, payee, note, description, date,
      hijri_year, hijri_month, hijri_day, hijri_offset, payment_type, record_state, tags,
      transfer_pair_id, transfer_dir, transfer_rate,
      recurring_rule, recurring_interval, recurring_until, recurring_skipped, recurring_source_id,
      qty, unit_amount, debt_id, debt_role, regular_item_id, from_family, added_by,
      client_created_at, regular_log_id, extra, position)
    values (book, tid, el->>'accountId', el->>'categoryId', el->>'type',
      pocket_minor(el->'amount'), el->>'currency', (el->>'exchangeRate')::numeric,
      pocket_minor(el->'refAmount'), pocket_minor(el->'acctMinor'),
      el->>'payee', el->>'note', el->>'description', (el->>'date')::date,
      (el->'hijriDate'->>'year')::int, (el->'hijriDate'->>'month')::int,
      (el->'hijriDate'->>'day')::int, (el->'hijriDate'->>'offset')::int,
      el->>'paymentType', el->>'recordState', pocket_text_array(el->'tags'),
      el->>'transferPairId', el->>'transferDir', (el->>'transferRate')::numeric,
      case when jsonb_typeof(el->'recurring') = 'object' then el->'recurring'->>'rule' end,
      (el->'recurring'->>'interval')::int,
      (el->'recurring'->>'until')::date, pocket_text_array(el->'recurring'->'skipped'),
      el->>'recurringSourceId', (el->>'qty')::numeric, pocket_minor(el->'unitAmount'),
      el->>'debtId', el->>'debtRole', el->>'regularItemId', (el->>'_fromFamily')::boolean,
      el->>'addedBy', (el->>'createdAt')::timestamptz, el->>'regularLogId',
      pocket_extra(el, 'transaction'), pos);
  end if;
exception when unique_violation then
  -- The entry exists but the sharing rules hid it from this caller's update.
  raise exception 'You don''t have permission to change this entry' using errcode = '42501';
end $$;

create or replace function public.pocket_put_transaction_splits(book uuid, el jsonb)
returns void language plpgsql as $$
declare tid text := el->>'id';
begin
  -- Splits are part of the transaction: replace them only when they changed.
  if (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('accountId', s.account_id,
             'categoryId', s.category_id, 'amount', s.amount, 'acctMinor', s.acct_minor)) order by s.position), '[]')
      from transaction_splits s where s.owner_id = book and s.transaction_id = tid)
     is distinct from
     (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('accountId', x->>'accountId',
             'categoryId', x->>'categoryId', 'amount', pocket_minor(x->'amount'),
             'acctMinor', pocket_minor(x->'acctMinor'))) order by o), '[]')
      from jsonb_array_elements(case when jsonb_typeof(el->'splits') = 'array' then el->'splits' else '[]' end)
        with ordinality y(x, o))
  then
    delete from transaction_splits where owner_id = book and transaction_id = tid;
    insert into transaction_splits (owner_id, transaction_id, position, account_id, category_id, amount, acct_minor)
    select book, tid, o::int, x->>'accountId', x->>'categoryId', pocket_minor(x->'amount'), pocket_minor(x->'acctMinor')
    from jsonb_array_elements(case when jsonb_typeof(el->'splits') = 'array' then el->'splits' else '[]' end)
      with ordinality y(x, o)
    where pocket_assert_split(x);
  end if;
end $$;

create or replace function public.pocket_assert_split(x jsonb) returns boolean
language plpgsql immutable as $$
begin
  perform pocket_assert_keys('split', x, array['accountId','categoryId','amount','acctMinor']);
  return true;
end $$;

create or replace function public.pocket_put_account(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
begin
  update accounts set name = el->>'name', type = el->>'type', currency = el->>'currency',
    color = el->>'color', icon = el->>'icon', archived = coalesce((el->>'archived')::boolean, false),
    balance = pocket_minor(el->'balance'), opening_balance = pocket_minor(el->'openingBalance'),
    group_id = el->>'groupId', extra = pocket_extra(el, 'account'), position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = el->>'id';
  if not found then
    insert into accounts (owner_id, id, name, type, currency, color, icon, archived, balance,
      opening_balance, group_id, extra, position)
    values (book, el->>'id', el->>'name', el->>'type', el->>'currency', el->>'color', el->>'icon',
      coalesce((el->>'archived')::boolean, false), pocket_minor(el->'balance'),
      pocket_minor(el->'openingBalance'), el->>'groupId', pocket_extra(el, 'account'), pos);
  end if;
end $$;

create or replace function public.pocket_put_category(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
begin
  update categories set name = el->>'name', type = el->>'type', color = el->>'color', icon = el->>'icon',
    parent_id = el->>'parentId', budget_limit = pocket_minor(el->'budgetLimit'),
    extra = pocket_extra(el, 'category'), position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = el->>'id';
  if not found then
    insert into categories (owner_id, id, name, type, color, icon, parent_id, budget_limit, extra, position)
    values (book, el->>'id', el->>'name', el->>'type', el->>'color', el->>'icon', el->>'parentId',
      pocket_minor(el->'budgetLimit'), pocket_extra(el, 'category'), pos);
  end if;
end $$;

create or replace function public.pocket_put_account_group(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
begin
  update account_groups set name = el->>'name', color = el->>'color',
    extra = pocket_extra(el, 'accountGroup'), position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = el->>'id';
  if not found then
    insert into account_groups (owner_id, id, name, color, extra, position)
    values (book, el->>'id', el->>'name', el->>'color', pocket_extra(el, 'accountGroup'), pos);
  end if;
end $$;

create or replace function public.pocket_put_budget(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
begin
  update budgets set category_id = el->>'categoryId', amount = pocket_minor(el->'amount'),
    currency = el->>'currency', period = el->>'period', rollover = (el->>'rollover')::boolean,
    extra = pocket_extra(el, 'budget'), position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = el->>'id';
  if not found then
    insert into budgets (owner_id, id, category_id, amount, currency, period, rollover, extra, position)
    values (book, el->>'id', el->>'categoryId', pocket_minor(el->'amount'), el->>'currency',
      el->>'period', (el->>'rollover')::boolean, pocket_extra(el, 'budget'), pos);
  end if;
  delete from budget_categories where owner_id = book and budget_id = el->>'id';
  insert into budget_categories (owner_id, budget_id, position, category_id)
  select book, el->>'id', o::int, c #>> '{}'
  from jsonb_array_elements(case when jsonb_typeof(el->'categoryIds') = 'array' then el->'categoryIds' else '[]' end)
    with ordinality y(c, o);
end $$;

create or replace function public.pocket_put_debt(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
begin
  update debts set type = el->>'type', counterparty = el->>'counterparty', account_id = el->>'accountId',
    currency = el->>'currency', principal = pocket_minor(el->'principal'),
    date_taken = (el->>'dateTaken')::date, due_date = (el->>'dueDate')::date, status = el->>'status',
    note = el->>'note', initial_tx_id = el->>'initialTxId',
    settled_externally = (el->>'settledExternally')::boolean, settled_at = (el->>'settledAt')::date,
    extra = pocket_extra(el, 'debt'), position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = el->>'id';
  if not found then
    insert into debts (owner_id, id, type, counterparty, account_id, currency, principal,
      date_taken, due_date, status, note, initial_tx_id, settled_externally, settled_at, extra, position)
    values (book, el->>'id', el->>'type', el->>'counterparty', el->>'accountId', el->>'currency',
      pocket_minor(el->'principal'), (el->>'dateTaken')::date, (el->>'dueDate')::date,
      el->>'status', el->>'note', el->>'initialTxId', (el->>'settledExternally')::boolean,
      (el->>'settledAt')::date, pocket_extra(el, 'debt'), pos);
  end if;
end $$;

create or replace function public.pocket_put_regular_item(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
begin
  update regular_items set name = el->>'name', account_id = el->>'accountId', category_id = el->>'categoryId',
    color = el->>'color', icon = el->>'icon', currency = el->>'currency',
    default_amount = pocket_minor(el->'defaultAmount'), frequency = el->>'frequency',
    shared_owner_id = (el->>'sharedOwnerId')::uuid, extra = pocket_extra(el, 'regularItem'),
    position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = el->>'id';
  if not found then
    insert into regular_items (owner_id, id, name, account_id, category_id, color, icon, currency,
      default_amount, frequency, shared_owner_id, extra, position)
    values (book, el->>'id', el->>'name', el->>'accountId', el->>'categoryId', el->>'color',
      el->>'icon', el->>'currency', pocket_minor(el->'defaultAmount'), el->>'frequency',
      (el->>'sharedOwnerId')::uuid, pocket_extra(el, 'regularItem'), pos);
  end if;
end $$;

create or replace function public.pocket_put_family_member(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
declare sub jsonb; j int;
begin
  update family_members set email = el->>'email', name = el->>'name', initials = el->>'initials',
    color = el->>'color', space_name = el->>'spaceName', extra = pocket_extra(el, 'familyMember'),
    position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = el->>'id';
  if not found then
    insert into family_members (owner_id, id, email, name, initials, color, space_name, extra, position)
    values (book, el->>'id', el->>'email', el->>'name', el->>'initials', el->>'color', el->>'spaceName',
      pocket_extra(el, 'familyMember'), pos);
  end if;
  delete from member_account_permissions where owner_id = book and member_id = el->>'id';
  for sub, j in select e, o::int from jsonb_array_elements(coalesce(el->'permissions','[]')) with ordinality y(e, o) loop
    perform pocket_assert_keys('permission', sub, array['accountId','access']);
    insert into member_account_permissions (owner_id, member_id, account_id, access, position)
    values (book, el->>'id', sub->>'accountId', sub->>'access', j);
  end loop;
  delete from member_budget_permissions where owner_id = book and member_id = el->>'id';
  for sub, j in select e, o::int from jsonb_array_elements(coalesce(el->'budgetPermissions','[]')) with ordinality y(e, o) loop
    perform pocket_assert_keys('budgetPermission', sub, array['budgetId','access']);
    insert into member_budget_permissions (owner_id, member_id, budget_id, access, position)
    values (book, el->>'id', sub->>'budgetId', sub->>'access', j);
  end loop;
end $$;

create or replace function public.pocket_put_space(book uuid, el jsonb, pos int default null)
returns void language plpgsql as $$
declare sub jsonb; j int;
begin
  update spaces set name = el->>'name', extra = pocket_extra(el, 'space'),
    position = coalesce(pos, position), deleted_at = null
  where owner_id = book and id = el->>'id';
  if not found then
    insert into spaces (owner_id, id, name, extra, position)
    values (book, el->>'id', el->>'name', pocket_extra(el, 'space'), pos);
  end if;
  delete from space_accounts where owner_id = book and space_id = el->>'id';
  insert into space_accounts (owner_id, space_id, position, account_id)
  select book, el->>'id', o::int, a #>> '{}' from jsonb_array_elements(coalesce(el->'accountIds','[]')) with ordinality y(a, o);
  delete from space_budgets where owner_id = book and space_id = el->>'id';
  insert into space_budgets (owner_id, space_id, position, budget_id)
  select book, el->>'id', o::int, b #>> '{}' from jsonb_array_elements(coalesce(el->'budgetIds','[]')) with ordinality y(b, o);
  delete from space_members where owner_id = book and space_id = el->>'id';
  for sub, j in select e, o::int from jsonb_array_elements(coalesce(el->'members','[]')) with ordinality y(e, o) loop
    perform pocket_assert_keys('spaceMember', sub, array['memberId','access','budgetAccess']);
    insert into space_members (owner_id, space_id, position, member_id, access, budget_access)
    values (book, el->>'id', j, sub->>'memberId', sub->>'access', sub->>'budgetAccess');
  end loop;
end $$;

-- Settings: the app's `user` object, plus the two book-level flags.
create or replace function public.pocket_put_settings(book uuid, u jsonb, fx_updated_at text, dir_backfilled boolean)
returns void language plpgsql as $$
begin
  insert into book_settings (owner_id, home_currency, default_currency, calendar_mode, show_hijri,
    hijri_offset, theme, date_format, default_account_id, default_payment_type,
    custom_payment_types, hidden_payment_types, collapsed_account_groups, collapsed_categories,
    fx_rates_updated_at, transfer_dir_backfilled, extra)
  values (book, u->>'homeCurrency', u->>'defaultCurrency', u->>'calendarMode',
    (u->>'showHijri')::boolean, (u->>'hijriOffset')::numeric::int, u->>'theme', u->>'dateFormat',
    u->>'defaultAccountId', u->>'defaultPaymentType',
    pocket_text_array(u->'customPaymentTypes'), pocket_text_array(u->'hiddenPaymentTypes'),
    pocket_text_array(u->'collapsedAccountGroups'), pocket_text_array(u->'collapsedCategories'),
    fx_updated_at::timestamptz, dir_backfilled, pocket_extra(u, 'user'))
  on conflict (owner_id) do update set
    home_currency = excluded.home_currency, default_currency = excluded.default_currency,
    calendar_mode = excluded.calendar_mode, show_hijri = excluded.show_hijri,
    hijri_offset = excluded.hijri_offset, theme = excluded.theme, date_format = excluded.date_format,
    default_account_id = excluded.default_account_id, default_payment_type = excluded.default_payment_type,
    custom_payment_types = excluded.custom_payment_types, hidden_payment_types = excluded.hidden_payment_types,
    collapsed_account_groups = excluded.collapsed_account_groups,
    collapsed_categories = excluded.collapsed_categories,
    fx_rates_updated_at = excluded.fx_rates_updated_at,
    transfer_dir_backfilled = excluded.transfer_dir_backfilled, extra = excluded.extra, deleted_at = null;
  insert into book_secrets (owner_id, gemini_api_key, supabase_url, supabase_key)
  values (book, u->>'geminiApiKey', u->>'supabaseUrl', u->>'supabaseKey')
  on conflict (owner_id) do update set gemini_api_key = excluded.gemini_api_key,
    supabase_url = excluded.supabase_url, supabase_key = excluded.supabase_key, deleted_at = null;
end $$;

-- Book-level data the app keeps outside its lists (e.g. legacy `regularLogs`).
create or replace function public.pocket_put_book_extra(book uuid, x jsonb) returns void
language plpgsql as $$
begin
  update book_settings set book_extra = nullif(x, '{}'::jsonb) where owner_id = book;
end $$;

-- Maps (currency → rate, merchant → category): replaced as a whole; they are small.
create or replace function public.pocket_put_fx_rates(book uuid, m jsonb) returns void
language plpgsql as $$
begin
  update book_fx_rates set deleted_at = now()
  where owner_id = book and deleted_at is null and not (coalesce(m, '{}') ? currency);
  insert into book_fx_rates (owner_id, currency, rate)
  select book, k, v::text::numeric from jsonb_each(coalesce(m, '{}')) e(k, v)
  on conflict (owner_id, currency) do update set rate = excluded.rate, deleted_at = null
  where book_fx_rates.rate is distinct from excluded.rate or book_fx_rates.deleted_at is not null;
end $$;

create or replace function public.pocket_put_merchant_categories(book uuid, m jsonb) returns void
language plpgsql as $$
begin
  update merchant_categories set deleted_at = now()
  where owner_id = book and deleted_at is null and not (coalesce(m, '{}') ? merchant);
  insert into merchant_categories (owner_id, merchant, category_id)
  select book, k, v #>> '{}' from jsonb_each(coalesce(m, '{}')) e(k, v)
  on conflict (owner_id, merchant) do update set category_id = excluded.category_id, deleted_at = null
  where merchant_categories.category_id is distinct from excluded.category_id
     or merchant_categories.deleted_at is not null;
end $$;

-- ── save ─────────────────────────────────────────────────────────────────
create or replace function public.pocket_remove(book uuid, kind text, item_id text) returns void
language plpgsql as $$
declare
  tbl text;
  n int;
  gone boolean;
begin
  tbl := case kind
      when 'transactions' then 'transactions' when 'accounts' then 'accounts'
      when 'categories' then 'categories' when 'accountGroups' then 'account_groups'
      when 'budgets' then 'budgets' when 'debts' then 'debts' when 'regularItems' then 'regular_items'
      when 'family' then 'family_members' when 'spaces' then 'spaces'
      else null end;
  execute format('update public.%I set deleted_at = now() where owner_id = $1 and id = $2 and deleted_at is null', tbl)
  using book, item_id;
  get diagnostics n = row_count;
  -- Nothing changed for someone else's book: either it was already deleted
  -- (fine) or the sharing rules didn't allow it (say so, don't fail silently).
  if n = 0 and auth.uid() is not null and auth.uid() <> book then
    execute format('select exists (select 1 from public.%I where owner_id = $1 and id = $2 and deleted_at is not null)', tbl)
      into gone using book, item_id;
    if not gone then
      raise exception 'You don''t have permission to delete this entry' using errcode = '42501';
    end if;
  end if;
end $$;

-- One save. Items carry their list position as `_pos`. Puts run before removes
-- and in dependency order (a budget's categories, an entry's account, …).
create or replace function public.pocket_apply_changes(book uuid, changes jsonb) returns timestamptz
language plpgsql as $$
declare
  kind text;
  el jsonb;
  rid text;
begin
  if book is null then raise exception 'No book'; end if;
  perform pocket_assert_keys('changes', changes, array['put','remove','user','fxRates','merchantCategories',
    'fxRatesUpdatedAt','_transferDirBackfilled','bookExtra']);

  if changes ? 'user' then
    perform pocket_put_settings(book, changes->'user', changes->>'fxRatesUpdatedAt',
      (changes->>'_transferDirBackfilled')::boolean);
  end if;
  if changes ? 'bookExtra' then perform pocket_put_book_extra(book, changes->'bookExtra'); end if;
  if changes ? 'fxRates' then perform pocket_put_fx_rates(book, changes->'fxRates'); end if;
  if changes ? 'merchantCategories' then
    perform pocket_put_merchant_categories(book, changes->'merchantCategories');
  end if;

  foreach kind in array array['accountGroups','accounts','categories','budgets','debts','regularItems',
                              'family','spaces','transactions'] loop
    for el in select e from jsonb_array_elements(coalesce(changes->'put'->kind, '[]')) e loop
      case kind
        when 'accountGroups' then perform pocket_put_account_group(book, el - '_pos', (el->>'_pos')::int);
        when 'accounts'      then perform pocket_put_account(book, el - '_pos', (el->>'_pos')::int);
        when 'categories'    then perform pocket_put_category(book, el - '_pos', (el->>'_pos')::int);
        when 'budgets'       then perform pocket_put_budget(book, el - '_pos', (el->>'_pos')::int);
        when 'debts'         then perform pocket_put_debt(book, el - '_pos', (el->>'_pos')::int);
        when 'regularItems'  then perform pocket_put_regular_item(book, el - '_pos', (el->>'_pos')::int);
        when 'family'        then perform pocket_put_family_member(book, el - '_pos', (el->>'_pos')::int);
        when 'spaces'        then perform pocket_put_space(book, el - '_pos', (el->>'_pos')::int);
        when 'transactions'  then perform pocket_put_transaction(book, el - '_pos', (el->>'_pos')::int);
      end case;
    end loop;
  end loop;

  for kind in select jsonb_object_keys(coalesce(changes->'remove', '{}')) loop
    for rid in select jsonb_array_elements_text(changes->'remove'->kind) loop
      perform pocket_remove(book, kind, rid);
    end loop;
  end loop;
  return now();
end $$;

-- ── load ─────────────────────────────────────────────────────────────────
-- Own book. Definer, but fixed to the caller's own id, so it reads nothing else.
create or replace function public.pocket_get_book() returns jsonb
language sql stable security definer set search_path = public as $$
  select pocket_export_book(auth.uid())
$$;

-- One transaction in app shape (shared by the shared-book view).
create or replace function public.pocket_tx_json(t public.transactions) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id', t.id, 'accountId', t.account_id, 'categoryId', t.category_id, 'type', t.type,
    'amount', t.amount, 'currency', t.currency, 'exchangeRate', t.exchange_rate,
    'refAmount', t.ref_amount, 'acctMinor', t.acct_minor, 'payee', t.payee,
    'note', t.note, 'description', t.description, 'date', to_char(t.date, 'YYYY-MM-DD'),
    'hijriDate', case when t.hijri_year is null then null else jsonb_build_object(
      'year', t.hijri_year, 'month', t.hijri_month, 'day', t.hijri_day, 'offset', t.hijri_offset) end,
    'paymentType', t.payment_type, 'recordState', t.record_state, 'tags', to_jsonb(t.tags),
    'transferPairId', t.transfer_pair_id, 'transferDir', t.transfer_dir, 'transferRate', t.transfer_rate,
    'recurring', case when t.recurring_rule is null then null else jsonb_build_object(
      'rule', t.recurring_rule, 'interval', t.recurring_interval,
      'until', to_char(t.recurring_until, 'YYYY-MM-DD'), 'skipped', to_jsonb(t.recurring_skipped)) end,
    'recurringSourceId', t.recurring_source_id, 'qty', t.qty, 'unitAmount', t.unit_amount,
    'debtId', t.debt_id, 'debtRole', t.debt_role, 'regularItemId', t.regular_item_id,
    '_fromFamily', t.from_family, 'addedBy', t.added_by, 'createdAt', pocket_iso(t.client_created_at),
    'regularLogId', t.regular_log_id,
    'splits', (select jsonb_agg(jsonb_build_object('accountId', p.account_id, 'categoryId', p.category_id,
                 'amount', p.amount, 'acctMinor', p.acct_minor) order by p.position)
               from public.transaction_splits p where p.owner_id = t.owner_id and p.transaction_id = t.id))
    || coalesce(t.extra, '{}'::jsonb))
$$;

-- Books shared with the caller, one entry per (owner, space), in the shape the
-- app's shared views already use. Built live from the owner's rows, scoped to
-- the accounts the caller was given, so nothing else of the owner's leaks.
create or replace function public.pocket_get_shared() returns jsonb
language sql stable security definer set search_path = public as $$
  with mine as (
    select m.owner_id, m.id as member_id, m.space_name,
           coalesce((select sm.space_id from space_members sm join spaces sp
                       on sp.owner_id = sm.owner_id and sp.id = sm.space_id and sp.deleted_at is null
                     where sm.owner_id = m.owner_id and sm.member_id = m.id
                     order by sm.space_id limit 1), 'default') as space_id
    from family_members m
    where m.deleted_at is null and lower(m.email) = jwt_email() and m.owner_id <> auth.uid()
  ), grants as (
    select x.owner_id, x.member_id, x.space_name, x.space_id,
           coalesce((select jsonb_object_agg(p.account_id, p.access) from member_account_permissions p
                     where p.owner_id = x.owner_id and p.member_id = x.member_id), '{}') as perm,
           coalesce((select jsonb_object_agg(p.budget_id, p.access) from member_budget_permissions p
                     where p.owner_id = x.owner_id and p.member_id = x.member_id), '{}') as bperm
    from mine x
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    '_ownerId', g.owner_id,
    '_spaceId', g.space_id,
    'sharedBy', coalesce(nullif(g.space_name, ''), nullif(s.extra->>'name', ''), u.email),
    'ownerName', coalesce(nullif(s.extra->>'name', ''), u.email),
    'homeCurrency', s.home_currency,
    'permission', g.perm,
    'budgetPermission', g.bperm,
    'accounts', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'name', a.name,
                   'type', a.type, 'currency', a.currency, 'color', a.color, 'icon', a.icon,
                   'archived', a.archived, 'balance', a.balance, 'openingBalance', a.opening_balance,
                   'groupId', a.group_id)) order by a.position, a.id), '[]')
                 from accounts a where a.owner_id = g.owner_id and a.deleted_at is null and g.perm ? a.id),
    'transactions', (select coalesce(jsonb_agg(pocket_tx_json(t) order by t.date desc, t.position desc), '[]')
                     from transactions t
                     where t.owner_id = g.owner_id and t.deleted_at is null
                       and (g.perm ? t.account_id
                            or exists (select 1 from transaction_splits sp where sp.owner_id = t.owner_id
                                       and sp.transaction_id = t.id and g.perm ? sp.account_id))),
    'categories', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
                     'type', c.type, 'color', c.color, 'icon', c.icon, 'parentId', c.parent_id,
                     'budgetLimit', c.budget_limit)) order by c.position, c.id), '[]')
                   from categories c where c.owner_id = g.owner_id and c.deleted_at is null),
    'debts', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', d.id, 'type', d.type,
                'counterparty', d.counterparty, 'accountId', d.account_id, 'currency', d.currency,
                'principal', d.principal, 'dateTaken', to_char(d.date_taken, 'YYYY-MM-DD'),
                'dueDate', to_char(d.due_date, 'YYYY-MM-DD'), 'status', d.status, 'note', d.note,
                'initialTxId', d.initial_tx_id, 'settledExternally', d.settled_externally,
                'settledAt', to_char(d.settled_at, 'YYYY-MM-DD')) || coalesce(d.extra, '{}'::jsonb))
                order by d.position, d.id), '[]')
              from debts d where d.owner_id = g.owner_id and d.deleted_at is null and g.perm ? d.account_id),
    'regularItems', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r.id, 'name', r.name,
                       'accountId', r.account_id, 'categoryId', r.category_id, 'color', r.color, 'icon', r.icon,
                       'currency', r.currency, 'defaultAmount', r.default_amount, 'frequency', r.frequency,
                       'sharedOwnerId', r.shared_owner_id)) order by r.position, r.id), '[]')
                     from regular_items r where r.owner_id = g.owner_id and r.deleted_at is null and g.perm ? r.account_id),
    'budgets', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', b.id,
                  'categoryId', b.category_id, 'amount', b.amount, 'currency', b.currency,
                  'period', b.period, 'rollover', b.rollover,
                  'categoryIds', (select jsonb_agg(bc.category_id order by bc.position) from budget_categories bc
                                  where bc.owner_id = b.owner_id and bc.budget_id = b.id),
                  -- spend over ALL the owner's accounts, recorded by their app
                  'spent', coalesce((b.extra->>'sharedSpend')::numeric, 0))) order by b.position, b.id), '[]')
                from budgets b where b.owner_id = g.owner_id and b.deleted_at is null and g.bperm ? b.id),
    'updatedAt', pocket_iso(now())
  ) order by g.owner_id, g.space_id), '[]')
  from grants g
  join auth.users u on u.id = g.owner_id
  left join book_settings s on s.owner_id = g.owner_id
  where g.perm <> '{}' or g.bperm <> '{}'
$$;

-- ── import, now on the same put functions ────────────────────────────────
create or replace function public.pocket_import_book(owner uuid) returns void
language plpgsql as $$
declare
  d jsonb;
  el jsonb;
  i int;
  kind text;
begin
  select data into d from user_data where id = owner;
  if d is null then raise exception 'No user_data record for %', owner; end if;
  perform set_config('pocket.bulk_import', 'on', true);
  delete from transactions where owner_id = owner;
  delete from budgets where owner_id = owner;
  delete from family_members where owner_id = owner;
  delete from spaces where owner_id = owner;
  delete from accounts where owner_id = owner;
  delete from account_groups where owner_id = owner;
  delete from categories where owner_id = owner;
  delete from debts where owner_id = owner;
  delete from regular_items where owner_id = owner;
  delete from merchant_categories where owner_id = owner;
  delete from book_fx_rates where owner_id = owner;
  delete from book_secrets where owner_id = owner;
  delete from book_settings where owner_id = owner;

  perform pocket_put_settings(owner, coalesce(d->'user', '{}'), d->>'fxRatesUpdatedAt',
    (d->>'_transferDirBackfilled')::boolean);
  perform pocket_put_book_extra(owner, pocket_extra(d, 'book'));
  perform pocket_put_fx_rates(owner, d->'fxRates');
  perform pocket_put_merchant_categories(owner, d->'merchantCategories');

  foreach kind in array array['accountGroups','accounts','categories','budgets','debts','regularItems',
                              'family','spaces','transactions'] loop
    for el, i in select e, o::int from jsonb_array_elements(coalesce(d->kind, '[]')) with ordinality x(e, o) loop
      case kind
        when 'accountGroups' then perform pocket_put_account_group(owner, el, i);
        when 'accounts'      then perform pocket_put_account(owner, el, i);
        when 'categories'    then perform pocket_put_category(owner, el, i);
        when 'budgets'       then perform pocket_put_budget(owner, el, i);
        when 'debts'         then perform pocket_put_debt(owner, el, i);
        when 'regularItems'  then perform pocket_put_regular_item(owner, el, i);
        when 'family'        then perform pocket_put_family_member(owner, el, i);
        when 'spaces'        then perform pocket_put_space(owner, el, i);
        when 'transactions'  then perform pocket_put_transaction(owner, el, i);
      end case;
    end loop;
  end loop;

  perform set_config('pocket.bulk_import', 'off', true);
  perform rebuild_daily_totals(owner);
end $$;

-- ── export, redefined: same transaction mapping as the shared view, plus the
--    new columns and every `extra` merged back, so load returns what was saved.
create or replace function public.pocket_export_book(owner uuid) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(coalesce(s.book_extra, '{}'::jsonb) || jsonb_build_object(
    '_transferDirBackfilled', s.transfer_dir_backfilled,
    'fxRatesUpdatedAt', pocket_iso(s.fx_rates_updated_at),
    'user', jsonb_build_object(
      'calendarMode', s.calendar_mode, 'defaultCurrency', s.default_currency,
      'homeCurrency', s.home_currency, 'showHijri', s.show_hijri, 'theme', s.theme,
      'supabaseUrl', k.supabase_url, 'supabaseKey', k.supabase_key, 'geminiApiKey', k.gemini_api_key,
      'dateFormat', s.date_format, 'collapsedAccountGroups', to_jsonb(s.collapsed_account_groups),
      'collapsedCategories', to_jsonb(s.collapsed_categories),
      'hiddenPaymentTypes', to_jsonb(s.hidden_payment_types), 'hijriOffset', s.hijri_offset,
      'customPaymentTypes', to_jsonb(s.custom_payment_types),
      'defaultAccountId', s.default_account_id, 'defaultPaymentType', s.default_payment_type)
      || coalesce(s.extra, '{}'::jsonb),
    'fxRates', (select jsonb_object_agg(currency, rate) from book_fx_rates
                where owner_id = owner and deleted_at is null),
    'merchantCategories', (select coalesce(jsonb_object_agg(merchant, category_id), '{}') from merchant_categories
                           where owner_id = owner and deleted_at is null),
    'accountGroups', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'color', color)
                       || coalesce(extra, '{}'::jsonb) order by position, id), '[]')
                      from account_groups where owner_id = owner and deleted_at is null),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type,
                   'currency', currency, 'color', color, 'icon', icon, 'archived', archived,
                   'balance', balance, 'openingBalance', opening_balance, 'groupId', group_id)
                   || coalesce(extra, '{}'::jsonb) order by position, id), '[]')
                 from accounts where owner_id = owner and deleted_at is null),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type,
                     'color', color, 'icon', icon, 'parentId', parent_id, 'budgetLimit', budget_limit)
                     || coalesce(extra, '{}'::jsonb) order by position, id), '[]')
                   from categories where owner_id = owner and deleted_at is null),
    'transactions', (select coalesce(jsonb_agg(pocket_tx_json(t) order by t.position, t.date, t.id), '[]')
                     from transactions t where t.owner_id = owner and t.deleted_at is null),
    'budgets', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'categoryId', b.category_id,
                  'amount', b.amount, 'currency', b.currency, 'period', b.period, 'rollover', b.rollover,
                  'categoryIds', (select jsonb_agg(c.category_id order by c.position) from budget_categories c
                                  where c.owner_id = b.owner_id and c.budget_id = b.id))
                  || coalesce(b.extra, '{}'::jsonb) order by b.position, b.id), '[]')
                from budgets b where b.owner_id = owner and b.deleted_at is null),
    'debts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type,
                'counterparty', counterparty, 'accountId', account_id, 'currency', currency,
                'principal', principal, 'dateTaken', to_char(date_taken, 'YYYY-MM-DD'),
                'dueDate', to_char(due_date, 'YYYY-MM-DD'), 'status', status, 'note', note,
                'initialTxId', initial_tx_id, 'settledExternally', settled_externally,
                'settledAt', to_char(settled_at, 'YYYY-MM-DD'))
                || coalesce(extra, '{}'::jsonb) order by position, id), '[]')
              from debts where owner_id = owner and deleted_at is null),
    'regularItems', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name,
                       'accountId', account_id, 'categoryId', category_id, 'color', color, 'icon', icon,
                       'currency', currency, 'defaultAmount', default_amount, 'frequency', frequency,
                       'sharedOwnerId', shared_owner_id)
                       || coalesce(extra, '{}'::jsonb) order by position, id), '[]')
                     from regular_items where owner_id = owner and deleted_at is null),
    'family', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'email', m.email, 'name', m.name,
                 'initials', m.initials, 'color', m.color, 'spaceName', m.space_name,
                 'permissions', (select coalesce(jsonb_agg(jsonb_build_object('accountId', p.account_id,
                                   'access', p.access) order by p.position), '[]')
                                 from member_account_permissions p where p.owner_id = m.owner_id and p.member_id = m.id),
                 'budgetPermissions', (select coalesce(jsonb_agg(jsonb_build_object('budgetId', p.budget_id,
                                         'access', p.access) order by p.position), '[]')
                                       from member_budget_permissions p where p.owner_id = m.owner_id and p.member_id = m.id))
                 || coalesce(m.extra, '{}'::jsonb) order by m.position, m.id), '[]')
               from family_members m where m.owner_id = owner and m.deleted_at is null),
    'spaces', (select coalesce(jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name,
                 'accountIds', (select coalesce(jsonb_agg(a.account_id order by a.position), '[]')
                                from space_accounts a where a.owner_id = sp.owner_id and a.space_id = sp.id),
                 'budgetIds', (select coalesce(jsonb_agg(b.budget_id order by b.position), '[]')
                               from space_budgets b where b.owner_id = sp.owner_id and b.space_id = sp.id),
                 'members', (select coalesce(jsonb_agg(jsonb_build_object('memberId', x.member_id,
                               'access', x.access, 'budgetAccess', x.budget_access) order by x.position), '[]')
                             from space_members x where x.owner_id = sp.owner_id and x.space_id = sp.id))
                 || coalesce(sp.extra, '{}'::jsonb) order by sp.position, sp.id), '[]')
               from spaces sp where sp.owner_id = owner and sp.deleted_at is null)
  ))
  from book_settings s left join book_secrets k on k.owner_id = s.owner_id
  where s.owner_id = owner
$$;

-- Verify: `recurring: false` (legacy rows) means "no rule", same as null.
create or replace function public.pocket_normalise(d jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(
    (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(d) e(k, v)
     where v not in ('[]'::jsonb, '{}'::jsonb))
    - 'transactions' - 'fxRatesUpdatedAt'
    || jsonb_build_object('fxRatesUpdatedAt', pocket_iso((d->>'fxRatesUpdatedAt')::timestamptz))
    || jsonb_build_object('transactions', coalesce((
         select jsonb_agg(
           (jsonb_strip_nulls(t) - 'createdAt' - 'splits'
              - (case when t->'recurring' = 'false'::jsonb then 'recurring' else '' end))
           || case when t->>'createdAt' is null then '{}'::jsonb
                   else jsonb_build_object('createdAt', pocket_iso((t->>'createdAt')::timestamptz)) end
           || case when jsonb_typeof(t->'splits') = 'array' and jsonb_array_length(t->'splits') > 0
                   then jsonb_build_object('splits', jsonb_strip_nulls(t->'splits')) else '{}'::jsonb end
           order by o)
         from jsonb_array_elements(coalesce(d->'transactions', '[]')) with ordinality x(t, o)), '[]'::jsonb)))
$$;

-- ── members may fix their own entries ────────────────────────────────────
drop policy if exists member_update_own on public.transactions;
create policy member_update_own on public.transactions for update
  using (added_by = public.jwt_email()
         and public.access_rank(public.account_access(owner_id, account_id)) >= 1)
  with check (added_by = public.jwt_email()
              and public.access_rank(public.account_access(owner_id, account_id)) >= 1);

-- ── who may call what ────────────────────────────────────────────────────
grant execute on function public.pocket_apply_changes(uuid, jsonb), public.pocket_get_book(),
  public.pocket_get_shared() to authenticated, service_role;
grant execute on function public.pocket_export_book(uuid), public.pocket_import_book(uuid),
  public.pocket_verify_book(uuid) to service_role;

-- ── FX rate changes rebuild totals once per save, not once per rate ──────
drop trigger if exists fx_rates_daily_totals on public.book_fx_rates;
drop trigger if exists fx_rates_daily_totals_ins on public.book_fx_rates;
drop trigger if exists fx_rates_daily_totals_upd on public.book_fx_rates;
drop trigger if exists fx_rates_daily_totals_del on public.book_fx_rates;

create or replace function public.daily_totals_rebuild_books() returns trigger
language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  if current_setting('pocket.bulk_import', true) = 'on' then return null; end if;
  for b in select distinct owner_id from changed_rows loop
    perform rebuild_daily_totals(b);
  end loop;
  return null;
end $$;

create trigger fx_rates_daily_totals_ins after insert on public.book_fx_rates
  referencing new table as changed_rows for each statement execute function public.daily_totals_rebuild_books();
create trigger fx_rates_daily_totals_upd after update on public.book_fx_rates
  referencing new table as changed_rows for each statement execute function public.daily_totals_rebuild_books();
create trigger fx_rates_daily_totals_del after delete on public.book_fx_rates
  referencing old table as changed_rows for each statement execute function public.daily_totals_rebuild_books();
