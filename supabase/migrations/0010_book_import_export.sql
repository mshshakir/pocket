-- Pocket — copy books between the old single record (`user_data.data`) and the
-- relational tables of 0009.
--
--   pocket_import_book(owner)  replaces that owner's rows with a copy of their
--                              user_data record. Stops with an error on any
--                              field it doesn't know, so nothing is dropped.
--   pocket_export_book(owner)  rebuilds the old record shape from the tables.
--   pocket_verify_book(owner)  true when export(import(record)) equals the
--                              record (ignoring null-vs-missing and empty splits).
--
-- Service role / SQL editor only: not granted to app users.

-- ── field guards ─────────────────────────────────────────────────────────────────────────────────
create or replace function public.pocket_assert_keys(what text, obj jsonb, allowed text[])
returns void language plpgsql immutable as $$
declare extra text[];
begin
  if obj is null or jsonb_typeof(obj) <> 'object' then return; end if;
  select array_agg(k) into extra from jsonb_object_keys(obj) k where not (k = any(allowed));
  if extra is not null then
    raise exception 'Unknown % field(s): %', what, extra;
  end if;
end $$;

create or replace function public.pocket_text_array(v jsonb) returns text[]
language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' then null
              else array(select jsonb_array_elements_text(v)) end
$$;

create or replace function public.pocket_minor(v jsonb) returns bigint
language sql immutable as $$
  select case when v is null or jsonb_typeof(v) = 'null' then null else (v #>> '{}')::numeric::bigint end
$$;

-- ── import ─────────────────────────────────────────────────────────────────────────────
create or replace function public.pocket_import_book(owner uuid) returns void
language plpgsql as $$
declare
  d jsonb;
  u jsonb;
  el jsonb;
  sub jsonb;
  i int;
  j int;
begin
  select data into d from user_data where id = owner;
  if d is null then raise exception 'No user_data record for %', owner; end if;

  -- Daily totals (0011) are rebuilt once at the end, not per row.
  perform set_config('pocket.bulk_import', 'on', true);

  perform pocket_assert_keys('book', d, array['_transferDirBackfilled','accountGroups','accounts',
    'budgets','categories','debts','family','fxRates','fxRatesUpdatedAt','merchantCategories',
    'regularItems','spaces','transactions','user']);

  -- Start clean for this owner (children cascade).
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

  -- settings + secrets
  u := coalesce(d->'user', '{}');
  perform pocket_assert_keys('user', u, array['calendarMode','defaultCurrency','homeCurrency',
    'showHijri','theme','supabaseUrl','supabaseKey','geminiApiKey','dateFormat',
    'collapsedAccountGroups','collapsedCategories','hiddenPaymentTypes','hijriOffset',
    'customPaymentTypes','defaultAccountId','defaultPaymentType']);
  insert into book_settings (owner_id, home_currency, default_currency, calendar_mode, show_hijri,
    hijri_offset, theme, date_format, default_account_id, default_payment_type,
    custom_payment_types, hidden_payment_types, collapsed_account_groups, collapsed_categories,
    fx_rates_updated_at, transfer_dir_backfilled)
  values (owner, u->>'homeCurrency', u->>'defaultCurrency', u->>'calendarMode',
    (u->>'showHijri')::boolean, (u->>'hijriOffset')::numeric::int, u->>'theme', u->>'dateFormat',
    u->>'defaultAccountId', u->>'defaultPaymentType',
    pocket_text_array(u->'customPaymentTypes'), pocket_text_array(u->'hiddenPaymentTypes'),
    pocket_text_array(u->'collapsedAccountGroups'), pocket_text_array(u->'collapsedCategories'),
    (d->>'fxRatesUpdatedAt')::timestamptz, (d->>'_transferDirBackfilled')::boolean);
  insert into book_secrets (owner_id, gemini_api_key, supabase_url, supabase_key)
  values (owner, u->>'geminiApiKey', u->>'supabaseUrl', u->>'supabaseKey');

  insert into book_fx_rates (owner_id, currency, rate)
  select owner, k, v::text::numeric from jsonb_each(coalesce(d->'fxRates', '{}')) e(k, v);

  insert into merchant_categories (owner_id, merchant, category_id)
  select owner, k, v #>> '{}' from jsonb_each(coalesce(d->'merchantCategories', '{}')) e(k, v);

  -- account groups
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'accountGroups','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('accountGroup', el, array['id','name','color']);
    insert into account_groups (owner_id, id, name, color, position)
    values (owner, el->>'id', el->>'name', el->>'color', i);
  end loop;

  -- accounts
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'accounts','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('account', el, array['id','name','type','currency','color','icon',
      'archived','balance','openingBalance','groupId']);
    insert into accounts (owner_id, id, name, type, currency, color, icon, archived, balance,
      opening_balance, group_id, position)
    values (owner, el->>'id', el->>'name', el->>'type', el->>'currency', el->>'color', el->>'icon',
      coalesce((el->>'archived')::boolean, false), pocket_minor(el->'balance'),
      pocket_minor(el->'openingBalance'), el->>'groupId', i);
  end loop;

  -- categories
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'categories','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('category', el, array['id','name','type','color','icon','parentId','budgetLimit']);
    insert into categories (owner_id, id, name, type, color, icon, parent_id, budget_limit, position)
    values (owner, el->>'id', el->>'name', el->>'type', el->>'color', el->>'icon', el->>'parentId',
      pocket_minor(el->'budgetLimit'), i);
  end loop;

  -- transactions + splits
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'transactions','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('transaction', el, array['id','accountId','categoryId','type','amount',
      'currency','exchangeRate','refAmount','acctMinor','payee','note','description','date',
      'hijriDate','paymentType','recordState','tags','transferPairId','transferDir','transferRate',
      'recurring','recurringSourceId','qty','unitAmount','debtId','debtRole','regularItemId',
      '_fromFamily','addedBy','createdAt','splits']);
    perform pocket_assert_keys('hijriDate', el->'hijriDate', array['year','month','day','offset']);
    perform pocket_assert_keys('recurring', el->'recurring', array['rule','interval','until','skipped']);
    insert into transactions (owner_id, id, account_id, category_id, type, amount, currency,
      exchange_rate, ref_amount, acct_minor, payee, note, description, date,
      hijri_year, hijri_month, hijri_day, hijri_offset, payment_type, record_state, tags,
      transfer_pair_id, transfer_dir, transfer_rate,
      recurring_rule, recurring_interval, recurring_until, recurring_skipped, recurring_source_id,
      qty, unit_amount, debt_id, debt_role, regular_item_id, from_family, added_by,
      client_created_at, position)
    values (owner, el->>'id', el->>'accountId', el->>'categoryId', el->>'type',
      pocket_minor(el->'amount'), el->>'currency', (el->>'exchangeRate')::numeric,
      pocket_minor(el->'refAmount'), pocket_minor(el->'acctMinor'),
      el->>'payee', el->>'note', el->>'description', (el->>'date')::date,
      (el->'hijriDate'->>'year')::int, (el->'hijriDate'->>'month')::int,
      (el->'hijriDate'->>'day')::int, (el->'hijriDate'->>'offset')::int,
      el->>'paymentType', el->>'recordState', pocket_text_array(el->'tags'),
      el->>'transferPairId', el->>'transferDir', (el->>'transferRate')::numeric,
      el->'recurring'->>'rule', (el->'recurring'->>'interval')::int,
      (el->'recurring'->>'until')::date, pocket_text_array(el->'recurring'->'skipped'),
      el->>'recurringSourceId', (el->>'qty')::numeric, pocket_minor(el->'unitAmount'),
      el->>'debtId', el->>'debtRole', el->>'regularItemId', (el->>'_fromFamily')::boolean,
      el->>'addedBy', (el->>'createdAt')::timestamptz, i);
    if jsonb_typeof(el->'splits') = 'array' then
      for sub, j in select e, o::int from jsonb_array_elements(el->'splits') with ordinality y(e, o) loop
        perform pocket_assert_keys('split', sub, array['accountId','categoryId','amount','acctMinor']);
        insert into transaction_splits (owner_id, transaction_id, position, account_id, category_id, amount, acct_minor)
        values (owner, el->>'id', j, sub->>'accountId', sub->>'categoryId',
          pocket_minor(sub->'amount'), pocket_minor(sub->'acctMinor'));
      end loop;
    end if;
  end loop;

  -- budgets
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'budgets','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('budget', el, array['id','categoryId','categoryIds','amount','currency','period','rollover']);
    insert into budgets (owner_id, id, category_id, amount, currency, period, rollover, position)
    values (owner, el->>'id', el->>'categoryId', pocket_minor(el->'amount'), el->>'currency',
      el->>'period', (el->>'rollover')::boolean, i);
    insert into budget_categories (owner_id, budget_id, position, category_id)
    select owner, el->>'id', o::int, c #>> '{}'
    from jsonb_array_elements(case when jsonb_typeof(el->'categoryIds') = 'array' then el->'categoryIds' else '[]' end)
      with ordinality y(c, o);
  end loop;

  -- debts
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'debts','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('debt', el, array['id','type','counterparty','accountId','currency',
      'principal','dateTaken','dueDate','status','note','initialTxId']);
    insert into debts (owner_id, id, type, counterparty, account_id, currency, principal,
      date_taken, due_date, status, note, initial_tx_id, position)
    values (owner, el->>'id', el->>'type', el->>'counterparty', el->>'accountId', el->>'currency',
      pocket_minor(el->'principal'), (el->>'dateTaken')::date, (el->>'dueDate')::date,
      el->>'status', el->>'note', el->>'initialTxId', i);
  end loop;

  -- regular items
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'regularItems','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('regularItem', el, array['id','name','accountId','categoryId','color',
      'icon','currency','defaultAmount','frequency','sharedOwnerId']);
    insert into regular_items (owner_id, id, name, account_id, category_id, color, icon, currency,
      default_amount, frequency, shared_owner_id, position)
    values (owner, el->>'id', el->>'name', el->>'accountId', el->>'categoryId', el->>'color',
      el->>'icon', el->>'currency', pocket_minor(el->'defaultAmount'), el->>'frequency',
      (el->>'sharedOwnerId')::uuid, i);
  end loop;

  -- family members + their grants
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'family','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('familyMember', el, array['id','email','name','initials','color',
      'spaceName','permissions','budgetPermissions']);
    insert into family_members (owner_id, id, email, name, initials, color, space_name, position)
    values (owner, el->>'id', el->>'email', el->>'name', el->>'initials', el->>'color',
      el->>'spaceName', i);
    for sub, j in select e, o::int from jsonb_array_elements(coalesce(el->'permissions','[]')) with ordinality y(e, o) loop
      perform pocket_assert_keys('permission', sub, array['accountId','access']);
      insert into member_account_permissions (owner_id, member_id, account_id, access, position)
      values (owner, el->>'id', sub->>'accountId', sub->>'access', j);
    end loop;
    for sub, j in select e, o::int from jsonb_array_elements(coalesce(el->'budgetPermissions','[]')) with ordinality y(e, o) loop
      perform pocket_assert_keys('budgetPermission', sub, array['budgetId','access']);
      insert into member_budget_permissions (owner_id, member_id, budget_id, access, position)
      values (owner, el->>'id', sub->>'budgetId', sub->>'access', j);
    end loop;
  end loop;

  -- spaces
  for el, i in select e, o::int from jsonb_array_elements(coalesce(d->'spaces','[]')) with ordinality x(e, o) loop
    perform pocket_assert_keys('space', el, array['id','name','accountIds','budgetIds','members']);
    insert into spaces (owner_id, id, name, position) values (owner, el->>'id', el->>'name', i);
    insert into space_accounts (owner_id, space_id, position, account_id)
    select owner, el->>'id', o::int, a #>> '{}' from jsonb_array_elements(coalesce(el->'accountIds','[]')) with ordinality y(a, o);
    insert into space_budgets (owner_id, space_id, position, budget_id)
    select owner, el->>'id', o::int, b #>> '{}' from jsonb_array_elements(coalesce(el->'budgetIds','[]')) with ordinality y(b, o);
    for sub, j in select e, o::int from jsonb_array_elements(coalesce(el->'members','[]')) with ordinality y(e, o) loop
      perform pocket_assert_keys('spaceMember', sub, array['memberId','access','budgetAccess']);
      insert into space_members (owner_id, space_id, position, member_id, access, budget_access)
      values (owner, el->>'id', j, sub->>'memberId', sub->>'access', sub->>'budgetAccess');
    end loop;
  end loop;

  perform set_config('pocket.bulk_import', 'off', true);
  if to_regproc('public.rebuild_daily_totals') is not null then
    perform rebuild_daily_totals(owner);
  end if;
end $$;

-- ── export (rebuilds the old record shape) ───────────────────────────────
create or replace function public.pocket_iso(ts timestamptz) returns text
language sql immutable as $$
  select to_char(ts at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

create or replace function public.pocket_export_book(owner uuid) returns jsonb
language sql stable as $$
  select jsonb_strip_nulls(jsonb_build_object(
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
      'defaultAccountId', s.default_account_id, 'defaultPaymentType', s.default_payment_type),
    'fxRates', (select jsonb_object_agg(currency, rate) from book_fx_rates
                where owner_id = owner and deleted_at is null),
    'merchantCategories', (select coalesce(jsonb_object_agg(merchant, category_id), '{}') from merchant_categories
                           where owner_id = owner and deleted_at is null),
    'accountGroups', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'color', color)
                       order by position, id), '[]') from account_groups where owner_id = owner and deleted_at is null),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type,
                   'currency', currency, 'color', color, 'icon', icon, 'archived', archived,
                   'balance', balance, 'openingBalance', opening_balance, 'groupId', group_id)
                   order by position, id), '[]') from accounts where owner_id = owner and deleted_at is null),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type,
                     'color', color, 'icon', icon, 'parentId', parent_id, 'budgetLimit', budget_limit)
                     order by position, id), '[]') from categories where owner_id = owner and deleted_at is null),
    'transactions', (select coalesce(jsonb_agg(jsonb_build_object(
                       'id', t.id, 'accountId', t.account_id, 'categoryId', t.category_id, 'type', t.type,
                       'amount', t.amount, 'currency', t.currency, 'exchangeRate', t.exchange_rate,
                       'refAmount', t.ref_amount, 'acctMinor', t.acct_minor, 'payee', t.payee,
                       'note', t.note, 'description', t.description, 'date', to_char(t.date, 'YYYY-MM-DD'),
                       'hijriDate', case when t.hijri_year is null then null else jsonb_build_object(
                         'year', t.hijri_year, 'month', t.hijri_month, 'day', t.hijri_day, 'offset', t.hijri_offset) end,
                       'paymentType', t.payment_type, 'recordState', t.record_state, 'tags', to_jsonb(t.tags),
                       'transferPairId', t.transfer_pair_id, 'transferDir', t.transfer_dir,
                       'transferRate', t.transfer_rate,
                       'recurring', case when t.recurring_rule is null then null else jsonb_build_object(
                         'rule', t.recurring_rule, 'interval', t.recurring_interval,
                         'until', to_char(t.recurring_until, 'YYYY-MM-DD'), 'skipped', to_jsonb(t.recurring_skipped)) end,
                       'recurringSourceId', t.recurring_source_id, 'qty', t.qty, 'unitAmount', t.unit_amount,
                       'debtId', t.debt_id, 'debtRole', t.debt_role, 'regularItemId', t.regular_item_id,
                       '_fromFamily', t.from_family, 'addedBy', t.added_by,
                       'createdAt', pocket_iso(t.client_created_at),
                       'splits', (select jsonb_agg(jsonb_build_object('accountId', p.account_id,
                                    'categoryId', p.category_id, 'amount', p.amount, 'acctMinor', p.acct_minor)
                                    order by p.position)
                                  from transaction_splits p where p.owner_id = t.owner_id and p.transaction_id = t.id))
                     order by t.position, t.date, t.id), '[]')
                     from transactions t where t.owner_id = owner and t.deleted_at is null),
    'budgets', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'categoryId', b.category_id,
                  'amount', b.amount, 'currency', b.currency, 'period', b.period, 'rollover', b.rollover,
                  'categoryIds', (select jsonb_agg(c.category_id order by c.position) from budget_categories c
                                  where c.owner_id = b.owner_id and c.budget_id = b.id))
                  order by b.position, b.id), '[]') from budgets b where b.owner_id = owner and b.deleted_at is null),
    'debts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'type', type,
                'counterparty', counterparty, 'accountId', account_id, 'currency', currency,
                'principal', principal, 'dateTaken', to_char(date_taken, 'YYYY-MM-DD'),
                'dueDate', to_char(due_date, 'YYYY-MM-DD'), 'status', status, 'note', note,
                'initialTxId', initial_tx_id) order by position, id), '[]')
                from debts where owner_id = owner and deleted_at is null),
    'regularItems', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name,
                       'accountId', account_id, 'categoryId', category_id, 'color', color, 'icon', icon,
                       'currency', currency, 'defaultAmount', default_amount, 'frequency', frequency,
                       'sharedOwnerId', shared_owner_id) order by position, id), '[]')
                       from regular_items where owner_id = owner and deleted_at is null),
    'family', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'email', m.email, 'name', m.name,
                 'initials', m.initials, 'color', m.color, 'spaceName', m.space_name,
                 'permissions', (select coalesce(jsonb_agg(jsonb_build_object('accountId', p.account_id,
                                   'access', p.access) order by p.position), '[]')
                                 from member_account_permissions p where p.owner_id = m.owner_id and p.member_id = m.id),
                 'budgetPermissions', (select coalesce(jsonb_agg(jsonb_build_object('budgetId', p.budget_id,
                                         'access', p.access) order by p.position), '[]')
                                       from member_budget_permissions p where p.owner_id = m.owner_id and p.member_id = m.id))
                 order by m.position, m.id), '[]') from family_members m where m.owner_id = owner and m.deleted_at is null),
    'spaces', (select coalesce(jsonb_agg(jsonb_build_object('id', sp.id, 'name', sp.name,
                 'accountIds', (select coalesce(jsonb_agg(a.account_id order by a.position), '[]')
                                from space_accounts a where a.owner_id = sp.owner_id and a.space_id = sp.id),
                 'budgetIds', (select coalesce(jsonb_agg(b.budget_id order by b.position), '[]')
                               from space_budgets b where b.owner_id = sp.owner_id and b.space_id = sp.id),
                 'members', (select coalesce(jsonb_agg(jsonb_build_object('memberId', x.member_id,
                               'access', x.access, 'budgetAccess', x.budget_access) order by x.position), '[]')
                             from space_members x where x.owner_id = sp.owner_id and x.space_id = sp.id))
                 order by sp.position, sp.id), '[]') from spaces sp where sp.owner_id = owner and sp.deleted_at is null)
  ))
  from book_settings s left join book_secrets k on k.owner_id = s.owner_id
  where s.owner_id = owner
$$;

-- ── verify ─────────────────────────────────────────────────────────────────────────────
-- Normalises a record for comparison: drops nulls, empty `splits`, empty top-level
-- lists (a book with no spaces may have [] or no key at all), and turns
-- timestamps into one format. Everything else must match exactly.
create or replace function public.pocket_normalise(d jsonb) returns jsonb
language sql immutable as $$
  select jsonb_strip_nulls(
    (select coalesce(jsonb_object_agg(k, v), '{}') from jsonb_each(d) e(k, v)
     where v not in ('[]'::jsonb, '{}'::jsonb))
    - 'transactions' - 'fxRatesUpdatedAt'
    || jsonb_build_object('fxRatesUpdatedAt', pocket_iso((d->>'fxRatesUpdatedAt')::timestamptz))
    || jsonb_build_object('transactions', coalesce((
         select jsonb_agg(
           (jsonb_strip_nulls(t) - 'createdAt' - 'splits')
           || case when t->>'createdAt' is null then '{}'::jsonb
                   else jsonb_build_object('createdAt', pocket_iso((t->>'createdAt')::timestamptz)) end
           || case when jsonb_typeof(t->'splits') = 'array' and jsonb_array_length(t->'splits') > 0
                   then jsonb_build_object('splits', jsonb_strip_nulls(t->'splits')) else '{}'::jsonb end
           order by o)
         from jsonb_array_elements(coalesce(d->'transactions', '[]')) with ordinality x(t, o)), '[]'::jsonb)))
$$;

create or replace function public.pocket_verify_book(owner uuid) returns boolean
language sql stable as $$
  select pocket_normalise(u.data) = pocket_normalise(pocket_export_book(owner))
  from user_data u where u.id = owner
$$;

revoke all on function public.pocket_import_book(uuid), public.pocket_export_book(uuid),
  public.pocket_verify_book(uuid) from public, anon, authenticated;
