-- 0016 — delta loading for shared books (the family member's side).
--
-- A member's app downloaded every share in full (pocket_get_shared) after each
-- change in the owner's shared accounts and at the end of every load of their
-- own book: 1.1 MB / 2,300 entries for one share today.
--
-- pocket_get_shared_changes(since) returns each share's head in full (accounts,
-- categories, budgets, permissions … — small) and, under `_delta`, only the
-- entries changed since the cursor: `put` for ones the member can see, and
-- `remove` for ones deleted or no longer visible to them (moved to an account
-- they can't see). `count` is how many entries they can see, so the app can
-- check its copy; a permission change (which shows or hides old entries
-- without changing them) fails that check and the app reloads that share in
-- full. With `since` null every visible entry is sent.
--
-- pocket_get_shared is rebuilt from the same pieces; its output is unchanged
-- (fingerprint-checked for every member before and after).

-- Who shares what with the caller: one row per (owner, space).
create or replace function public.pocket_my_grants()
returns table (owner_id uuid, member_id text, space_name text, space_id text, perm jsonb, bperm jsonb)
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
  select g.owner_id, g.member_id, g.space_name, g.space_id, g.perm, g.bperm
  from grants g
  where g.perm <> '{}' or g.bperm <> '{}'
$$;

-- Whether a member with these account grants can see this entry.
create or replace function public.pocket_share_sees(t public.transactions, p_perm jsonb) returns boolean
language sql stable set search_path = public as $$
  select p_perm ? t.account_id
      or exists (select 1 from transaction_splits sp where sp.owner_id = t.owner_id
                 and sp.transaction_id = t.id and p_perm ? sp.account_id)
$$;

-- One share without its entries.
create or replace function public.pocket_share_head(p_owner uuid, p_space text, p_space_name text,
                                                    p_perm jsonb, p_bperm jsonb) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_build_object(
    '_ownerId', p_owner,
    '_spaceId', p_space,
    'sharedBy', coalesce(nullif(p_space_name, ''), nullif(s_extra->>'name', ''), u_email),
    'ownerName', coalesce(nullif(s_extra->>'name', ''), u_email),
    'homeCurrency', s_home,
    'permission', p_perm,
    'budgetPermission', p_bperm,
    'accounts', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', a.id, 'name', a.name,
                   'type', a.type, 'currency', a.currency, 'color', a.color, 'icon', a.icon,
                   'archived', a.archived, 'balance', a.balance, 'openingBalance', a.opening_balance,
                   'groupId', a.group_id)) order by a.position, a.id), '[]')
                 from accounts a where a.owner_id = p_owner and a.deleted_at is null and p_perm ? a.id),
    'categories', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
                     'type', c.type, 'color', c.color, 'icon', c.icon, 'parentId', c.parent_id,
                     'budgetLimit', c.budget_limit)) order by c.position, c.id), '[]')
                   from categories c where c.owner_id = p_owner and c.deleted_at is null),
    'debts', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', d.id, 'type', d.type,
                'counterparty', d.counterparty, 'accountId', d.account_id, 'currency', d.currency,
                'principal', d.principal, 'dateTaken', to_char(d.date_taken, 'YYYY-MM-DD'),
                'dueDate', to_char(d.due_date, 'YYYY-MM-DD'), 'status', d.status, 'note', d.note,
                'initialTxId', d.initial_tx_id, 'settledExternally', d.settled_externally,
                'settledAt', to_char(d.settled_at, 'YYYY-MM-DD')) || coalesce(d.extra, '{}'::jsonb))
                order by d.position, d.id), '[]')
              from debts d where d.owner_id = p_owner and d.deleted_at is null and p_perm ? d.account_id),
    'regularItems', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', r.id, 'name', r.name,
                       'accountId', r.account_id, 'categoryId', r.category_id, 'color', r.color, 'icon', r.icon,
                       'currency', r.currency, 'defaultAmount', r.default_amount, 'frequency', r.frequency,
                       'sharedOwnerId', r.shared_owner_id)) order by r.position, r.id), '[]')
                     from regular_items r where r.owner_id = p_owner and r.deleted_at is null and p_perm ? r.account_id),
    'budgets', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', b.id,
                  'categoryId', b.category_id, 'amount', b.amount, 'currency', b.currency,
                  'period', b.period, 'rollover', b.rollover,
                  'categoryIds', (select jsonb_agg(bc.category_id order by bc.position) from budget_categories bc
                                  where bc.owner_id = b.owner_id and bc.budget_id = b.id),
                  -- spend over ALL the owner's accounts, recorded by their app
                  'spent', coalesce((b.extra->>'sharedSpend')::numeric, 0))) order by b.position, b.id), '[]')
                from budgets b where b.owner_id = p_owner and b.deleted_at is null and p_bperm ? b.id)
  )
  from auth.users u0
  left join book_settings s0 on s0.owner_id = u0.id
  cross join lateral (select s0.extra as s_extra, s0.home_currency as s_home, u0.email as u_email) v
  where u0.id = p_owner
$$;

-- Unchanged output: every share, every visible entry.
create or replace function public.pocket_get_shared() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(pocket_share_head(g.owner_id, g.space_id, g.space_name, g.perm, g.bperm)
    || jsonb_build_object(
      'transactions', (select coalesce(jsonb_agg(pocket_tx_json(t) order by t.date desc, t.position desc), '[]')
                       from transactions t
                       where t.owner_id = g.owner_id and t.deleted_at is null and pocket_share_sees(t, g.perm)),
      'updatedAt', pocket_iso(now()))
    order by g.owner_id, g.space_id), '[]')
  from pocket_my_grants() g
$$;

-- The shares as change sets since a cursor:
--   { cursor, shares: [ { …head…, _delta: { full, count, put: [tx…], remove: [id…] } } ] }
-- Rows are re-sent from a few minutes before `since` (see pocket_get_changes).
create or replace function public.pocket_get_shared_changes(since timestamptz default null) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'cursor', pocket_iso(now()),
    'shares', coalesce(jsonb_agg(pocket_share_head(g.owner_id, g.space_id, g.space_name, g.perm, g.bperm)
      || jsonb_build_object('updatedAt', pocket_iso(now()), '_delta', jsonb_build_object(
        'full', since is null,
        'count', (select count(*) from transactions t
                  where t.owner_id = g.owner_id and t.deleted_at is null and pocket_share_sees(t, g.perm)),
        'put', (select coalesce(jsonb_agg(pocket_tx_json(t) order by t.date desc, t.position desc), '[]')
                from transactions t
                where t.owner_id = g.owner_id and t.deleted_at is null and pocket_share_sees(t, g.perm)
                  and (since is null or t.updated_at > since - interval '5 minutes')),
        'remove', case when since is null then '[]'::jsonb else
                  (select coalesce(jsonb_agg(t.id), '[]') from transactions t
                   where t.owner_id = g.owner_id and t.updated_at > since - interval '5 minutes'
                     and (t.deleted_at is not null or not pocket_share_sees(t, g.perm))) end))
      order by g.owner_id, g.space_id), '[]'))
  from pocket_my_grants() g
$$;

revoke all on function public.pocket_my_grants() from public, anon, authenticated;
revoke all on function public.pocket_share_sees(public.transactions, jsonb) from public, anon, authenticated;
revoke all on function public.pocket_share_head(uuid, text, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.pocket_get_shared() from public, anon;
grant execute on function public.pocket_get_shared() to authenticated, service_role;
revoke all on function public.pocket_get_shared_changes(timestamptz) from public, anon;
grant execute on function public.pocket_get_shared_changes(timestamptz) to authenticated, service_role;
