-- 0036 · Telegram group summaries count like the app
--
-- Daily / weekly / monthly group summaries now follow the same rules as the
-- app's Dashboard and Reports:
--   • loans given or taken, and their repayments (Debts), are neither
--     spending nor money received
--   • money paid back for an expense (a reimbursement) is not money received;
--     only an extra the user chose to count as income is
--   • an expense someone paid back counts only what was not paid back
--
-- Reimbursement fields live in transactions.extra (reimbBy, reimbAlloc,
-- reimbExtra, reimbExtraAs) and payments carry the 'reimbursement' tag.
-- Only the function changes: create or replace, same signature and grants.

create or replace function public.pocket_space_summary(p_owner uuid, p_space text, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with space as (
    select s.id, s.name from spaces s
     where s.owner_id = p_owner and s.id = p_space and s.deleted_at is null
  ),
  accts as (
    select distinct sa.account_id
      from space_accounts sa join space on space.id = sa.space_id
      join accounts a on a.owner_id = p_owner and a.id = sa.account_id and a.deleted_at is null
     where sa.owner_id = p_owner
  ),
  -- What has been paid back for each expense (any date), in its own currency.
  paid as (
    select a->>'txId' as tx_id, sum(greatest(0, coalesce(round((a->>'amount')::numeric)::bigint, 0))) as amt
      from transactions p
      cross join lateral jsonb_array_elements(coalesce(p.extra->'reimbAlloc', '[]'::jsonb)) a
     where p.owner_id = p_owner and p.deleted_at is null and 'reimbursement' = any(p.tags)
     group by 1
  ),
  -- Loans and repayments count nothing; money paid back isn't income (only an
  -- extra the user chose to count as income is); a paid-back expense counts
  -- what was not paid back. `ref` and `amount` are scaled alike so split
  -- parts below stay in proportion.
  raw as (
    select t.id, t.type, lower(nullif(trim(t.added_by), '')) as who,
           coalesce(t.ref_amount, t.amount) as ref0, t.amount as amount0, t.category_id,
           case when 'reimbursement' = any(coalesce(t.tags, '{}'))
                  then case when t.extra->>'reimbExtraAs' = 'income'
                            then least(t.amount, greatest(0, coalesce(round((t.extra->>'reimbExtra')::numeric)::bigint, 0))) else 0 end
                when t.type = 'expense' and coalesce(trim(t.extra->>'reimbBy'), '') <> ''
                  then greatest(0, t.amount - coalesce((select amt from paid where paid.tx_id = t.id), 0))
                else t.amount end as counted
      from transactions t
     where t.owner_id = p_owner and t.deleted_at is null
       and t.type in ('expense', 'income')
       and t.debt_role is null
       and not (coalesce(t.tags, '{}') && array['debt', 'debt-payment'])
       and t.date between p_from and p_to
       and t.account_id in (select account_id from accts)
  ),
  tx as (
    select id, type, who, category_id, amount0 as amount,
           case when amount0 = counted then ref0
                when amount0 = 0 then 0
                else round(ref0::numeric * counted / amount0)::bigint end as ref
      from raw
     where counted > 0
  ),
  -- A split entry spreads its home-currency value over its parts by their amounts.
  parts as (
    select tx.type, coalesce(s.category_id, tx.category_id) as category_id,
           case when s.transaction_id is null then tx.ref
                when tx.amount = 0 then 0
                else round(tx.ref::numeric * s.amount / tx.amount)::bigint end as amt
      from tx left join transaction_splits s on s.owner_id = p_owner and s.transaction_id = tx.id
  ),
  cats as (
    select coalesce(main.name, c.name, 'Uncategorised') as name, sum(parts.amt) as amt
      from parts
      left join categories c    on c.owner_id = p_owner and c.id = parts.category_id
      left join categories main on main.owner_id = p_owner and main.id = c.parent_id
     where parts.type = 'expense'
     group by 1
  ),
  owner_email as (select lower(email) as email from auth.users where id = p_owner),
  people as (
    select coalesce(nullif(tx.who, (select email from owner_email)), '') as who, count(*) as n
      from tx group by 1
  ),
  named as (
    select p.n, coalesce(
             nullif(split_part(trim(fm.name), ' ', 1), ''),
             nullif(split_part(trim(u.raw_user_meta_data->>'full_name'), ' ', 1), ''),
             nullif(split_part(p.who, '@', 1), ''),
             'Someone') as name
      from people p
      left join lateral (
        select f.name from family_members f
         where f.owner_id = p_owner and f.deleted_at is null and lower(f.email) = p.who and p.who <> ''
         limit 1) fm on true
      left join auth.users u on (p.who = '' and u.id = p_owner) or (p.who <> '' and lower(u.email) = p.who)
  )
  select case when not exists (select 1 from space) then null else jsonb_build_object(
    'space',      (select name from space),
    'currency',   coalesce((select home_currency from book_settings where owner_id = p_owner), 'INR'),
    'accounts',   (select count(*) from accts),
    'spent',      coalesce((select sum(ref) from tx where type = 'expense'), 0),
    'received',   coalesce((select sum(ref) from tx where type = 'income'), 0),
    'entries',    (select count(*) from tx),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'amount', amt) order by amt desc, name) from cats where amt <> 0), '[]'),
    'people',     coalesce((select jsonb_agg(jsonb_build_object('name', name, 'entries', n) order by n desc, name) from named), '[]')
  ) end
$$;
