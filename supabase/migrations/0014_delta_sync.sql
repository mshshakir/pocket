-- 0014 — load only what changed (delta sync) for the web app.
--
-- Until now the app downloaded the whole book (pocket_get_book) when it
-- opened and again after every change made elsewhere — a Telegram entry, a
-- family member's entry, another device. For a book of 5,500 entries that is
-- 2.25 MB and ~1 s of database time each time.
--
-- pocket_get_changes(since) returns the book's "head" — settings, FX rates,
-- payee categories and every list except transactions, all small and always
-- complete (so their order is exact) — plus only the transactions changed or
-- deleted since `since`, and the live transaction count so the app can check
-- its copy and fall back to a full load if they disagree (e.g. after a
-- re-import, which deletes rows outright). With `since` null it returns every
-- live transaction: a full load.
--
-- pocket_export_book is rebuilt from the same head, unchanged in output
-- (checked by fingerprint against every book before and after).

-- Everything in a book except its transactions.
create or replace function public.pocket_book_head(owner uuid) returns jsonb
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

-- The full book: the head plus every live transaction (output unchanged).
create or replace function public.pocket_export_book(owner uuid) returns jsonb
language sql stable as $$
  select pocket_book_head(owner) || jsonb_build_object('transactions',
    (select coalesce(jsonb_agg(pocket_tx_json(t) order by t.position, t.date, t.id), '[]')
     from transactions t where t.owner_id = owner and t.deleted_at is null))
  where exists (select 1 from book_settings s where s.owner_id = owner)
$$;

-- The caller's own book as a change set since a cursor. Definer, but fixed
-- to the caller's own id, like pocket_get_book. Null before the first save.
--
--   { …head…,
--     _delta: { cursor, full, count,
--               put:    [transactions changed since `since`, live],
--               remove: [ids deleted since `since`] } }
--
-- `cursor` is the time this read started; the app passes it back next time.
-- Rows are re-sent from a few minutes before `since`, so a save still in
-- flight when the cursor was taken is never missed (re-applying is harmless).
create or replace function public.pocket_get_changes(since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  owner uuid := auth.uid();
  head jsonb;
  overlap timestamptz := since - interval '5 minutes';
begin
  if owner is null then return null; end if;
  head := pocket_book_head(owner);
  if head is null then return null; end if;
  return head || jsonb_build_object('_delta', jsonb_build_object(
    'cursor', pocket_iso(now()),
    'full', since is null,
    'count', (select count(*) from transactions where owner_id = owner and deleted_at is null),
    'put', (select coalesce(jsonb_agg(pocket_tx_json(t) order by t.position, t.date, t.id), '[]')
            from transactions t
            where t.owner_id = owner and t.deleted_at is null
              and (since is null or t.updated_at > overlap)),
    'remove', case when since is null then '[]'::jsonb else
              (select coalesce(jsonb_agg(t.id), '[]') from transactions t
               where t.owner_id = owner and t.deleted_at is not null and t.updated_at > overlap) end));
end $$;

revoke all on function public.pocket_book_head(uuid) from public, anon, authenticated;
grant execute on function public.pocket_book_head(uuid) to service_role;
revoke all on function public.pocket_get_changes(timestamptz) from public, anon;
grant execute on function public.pocket_get_changes(timestamptz) to authenticated, service_role;
