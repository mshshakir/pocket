-- 0067 · Shared spaces show the owner's regulars properly (19 Nov 2026).
--
-- The snapshot a family member receives (pocket_share_head) left out the
-- `extra` fields of regular items, accounts and categories. A delivery's
-- "pay later", schedule and vendor live there, so in a shared space the
-- owner's deliveries showed as plain shortcuts (or not at all), and cards lost
-- their statement/due days. Same signature and grants; create or replace only.

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
                   'groupId', a.group_id)) || coalesce(a.extra, '{}'::jsonb) order by a.position, a.id), '[]')
                 from accounts a where a.owner_id = p_owner and a.deleted_at is null and p_perm ? a.id),
    'categories', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', c.id, 'name', c.name,
                     'type', c.type, 'color', c.color, 'icon', c.icon, 'parentId', c.parent_id,
                     'budgetLimit', c.budget_limit)) || coalesce(c.extra, '{}'::jsonb) order by c.position, c.id), '[]')
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
                       'sharedOwnerId', r.shared_owner_id)) || coalesce(r.extra, '{}'::jsonb) order by r.position, r.id), '[]')
                     from regular_items r where r.owner_id = p_owner and r.deleted_at is null and p_perm ? r.account_id),
    'budgets', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', b.id,
                  'categoryId', b.category_id, 'amount', b.amount, 'currency', b.currency,
                  'period', b.period, 'rollover', b.rollover,
                  -- set-dates budgets keep their dates in extra
                  'startDate', b.extra->>'startDate', 'endDate', b.extra->>'endDate',
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
