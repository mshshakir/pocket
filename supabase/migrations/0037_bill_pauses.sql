-- 0037 · Paused bills aren't reminded
--
-- A repeating entry or bill can be paused (the template's `pauses`
-- [{from, to|null}] in transactions.extra; to = null means until resumed).
-- The bot treats paused days like skipped ones, so pocket_bill_templates now
-- lists them with `skipped` — each day of a pause from 60 days ago to 400
-- days ahead. The bot's code is unchanged. Create or replace only.

create or replace function public.pocket_bill_templates() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'ownerId', t.owner_id, 'id', t.id, 'payee', coalesce(nullif(t.payee, ''), nullif(t.description, ''), 'Bill'),
      'amount', t.amount, 'currency', t.currency, 'date', to_char(t.date, 'YYYY-MM-DD'), 'accountId', t.account_id,
      'categoryId', t.category_id, 'rule', t.recurring_rule, 'interval', t.recurring_interval,
      'until', to_char(t.recurring_until, 'YYYY-MM-DD'),
      'skipped', to_jsonb(coalesce(t.recurring_skipped, '{}')) || coalesce((
        select jsonb_agg(to_char(d, 'YYYY-MM-DD'))
          from jsonb_array_elements(case when jsonb_typeof(t.extra->'pauses') = 'array' then t.extra->'pauses' else '[]'::jsonb end) p
          cross join lateral generate_series(
            greatest((p->>'from')::date, current_date - 60),
            least(coalesce(nullif(p->>'to', '')::date, current_date + 400), current_date + 400),
            interval '1 day') d
         where p->>'from' ~ '^\d{4}-\d{2}-\d{2}$' and (p->>'to' is null or p->>'to' ~ '^\d{4}-\d{2}-\d{2}$')
      ), '[]'::jsonb),
      'remindTo', coalesce(t.extra->>'remindTo', 'all'), 'remindEmail', t.extra->>'remindEmail',
      'remindDays', coalesce((t.extra->>'remindDays')::int, 2),
      'lastAmount', coalesce((select c.amount from transactions c where c.owner_id = t.owner_id and c.recurring_source_id = t.id
                               and c.deleted_at is null order by c.date desc limit 1), t.amount),
      'paid', (select coalesce(jsonb_agg(split_part(c.id, '__', 2)), '[]') from transactions c
                where c.owner_id = t.owner_id and c.recurring_source_id = t.id and c.deleted_at is null)
    )), '[]')
    from transactions t
   where t.deleted_at is null and t.recurring_rule is not null and t.recurring_source_id is null
     and coalesce((t.extra->>'askFirst')::boolean, false)
     and coalesce(t.extra->>'remindTo', 'all') <> 'off'
$$;
