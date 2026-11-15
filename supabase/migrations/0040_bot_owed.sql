-- 0040 · Loans and reimbursements on Telegram
--
-- The bot can record a loan given or taken, a repayment, an expense someone
-- will pay back, and money paid back. For that it reads — for the person's
-- OWN book only, and nothing else:
--   • open debts (status not 'paid'), with what has been repaid so far
--     (the sum of that debt's payment entries in the debt's currency)
--   • open reimbursement items: expenses marked "someone will pay me back"
--     (extra.reimbBy) that aren't closed, with what was paid back so far
--   • paybacks whose extra was kept as credit (to use that credit)
-- Rows come back in app shape (pocket_tx_json and the debts shape of
-- pocket_get_shared), so the bot can write them back whole with
-- pocket_apply_changes. The owner approved this narrow read on 15 Nov 2026.
--
-- Service key only.

create or replace function public.pocket_bot_owed(owner uuid) returns jsonb
language sql stable set search_path = public as $$
  with pays as (
    select p.id, coalesce(p.extra->'reimbAlloc', '[]'::jsonb) as alloc
      from transactions p
     where p.owner_id = owner and p.deleted_at is null and 'reimbursement' = any(coalesce(p.tags, '{}'))
  ),
  paid as (
    select a->>'txId' as tx_id, sum(greatest(0, round((a->>'amount')::numeric)))::bigint as amt
      from pays cross join lateral jsonb_array_elements(pays.alloc) a
     group by 1
  ),
  items as (
    select t.*
      from transactions t
     where t.owner_id = owner and t.deleted_at is null and t.type = 'expense'
       and coalesce(trim(t.extra->>'reimbBy'), '') <> ''
       and coalesce((t.extra->>'reimbClosed')::boolean, false) = false
  )
  select jsonb_build_object(
    'debts', (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', d.id, 'type', d.type,
                'counterparty', d.counterparty, 'accountId', d.account_id, 'currency', d.currency,
                'principal', d.principal, 'dateTaken', to_char(d.date_taken, 'YYYY-MM-DD'),
                'dueDate', to_char(d.due_date, 'YYYY-MM-DD'), 'status', d.status, 'note', d.note,
                'initialTxId', d.initial_tx_id, 'settledExternally', d.settled_externally,
                'settledAt', to_char(d.settled_at, 'YYYY-MM-DD')) || coalesce(d.extra, '{}'::jsonb))
                || jsonb_build_object('_paid', coalesce((select sum(x.amount) from transactions x
                     where x.owner_id = owner and x.deleted_at is null and x.debt_id = d.id
                       and x.id is distinct from d.initial_tx_id and x.currency = d.currency), 0))
                order by d.date_taken, d.id), '[]')
              from debts d where d.owner_id = owner and d.deleted_at is null and coalesce(d.status, 'active') <> 'paid'),
    'items', (select coalesce(jsonb_agg(pocket_tx_json(i) || jsonb_build_object('_paid',
                coalesce((select amt from paid where paid.tx_id = i.id), 0)) order by i.date, i.id), '[]')
              from items i),
    'credits', (select coalesce(jsonb_agg(pocket_tx_json(c) order by c.date, c.id), '[]')
                from transactions c
               where c.owner_id = owner and c.deleted_at is null and 'reimbursement' = any(coalesce(c.tags, '{}'))
                 and c.extra->>'reimbExtraAs' = 'keep'),
    'claims', (select coalesce(s.book_extra->'claims', '[]'::jsonb) from book_settings s where s.owner_id = owner)
  )
$$;

revoke all on function public.pocket_bot_owed(uuid) from public, anon, authenticated;
grant execute on function public.pocket_bot_owed(uuid) to service_role;

-- One loan, payback or reimbursement-marked entry, to change it from a button
-- (Oldest first, Close the rest, Delete reopening what it closed …).
create or replace function public.pocket_bot_tx(owner uuid, tx_id text) returns jsonb
language sql stable set search_path = public as $$
  select pocket_tx_json(t) from transactions t
   where t.owner_id = owner and t.id = tx_id and t.deleted_at is null
     and (coalesce(t.tags, '{}') && array['reimbursement', 'debt', 'debt-payment']
          or coalesce(trim(t.extra->>'reimbBy'), '') <> '')
$$;
revoke all on function public.pocket_bot_tx(uuid, text) from public, anon, authenticated;
grant execute on function public.pocket_bot_tx(uuid, text) to service_role;

-- One debt (open or paid), to undo a repayment from 🗑 Delete.
create or replace function public.pocket_bot_debt(owner uuid, debt_id text) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object('id', d.id, 'type', d.type,
      'counterparty', d.counterparty, 'accountId', d.account_id, 'currency', d.currency,
      'principal', d.principal, 'dateTaken', to_char(d.date_taken, 'YYYY-MM-DD'),
      'dueDate', to_char(d.due_date, 'YYYY-MM-DD'), 'status', d.status, 'note', d.note,
      'initialTxId', d.initial_tx_id, 'settledExternally', d.settled_externally,
      'settledAt', to_char(d.settled_at, 'YYYY-MM-DD')) || coalesce(d.extra, '{}'::jsonb))
    || jsonb_build_object('_paid', coalesce((select sum(x.amount) from transactions x
         where x.owner_id = owner and x.deleted_at is null and x.debt_id = d.id
           and x.id is distinct from d.initial_tx_id and x.currency = d.currency), 0))
    from debts d where d.owner_id = owner and d.id = debt_id and d.deleted_at is null
$$;
revoke all on function public.pocket_bot_debt(uuid, text) from public, anon, authenticated;
grant execute on function public.pocket_bot_debt(uuid, text) to service_role;
