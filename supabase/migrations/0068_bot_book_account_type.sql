-- 0068 · Payment type removed from Pocket's screens (owner, 20 Nov 2026).
--
-- New entries take their payment type from the account instead of asking
-- (cash account → cash, credit card → card, anything else → online). The bot
-- needs each account's type for that, so pocket_bot_book now includes it.
-- Old entries keep the payment type they were saved with.
-- Same signature and grants; create or replace only.

create or replace function public.pocket_bot_book(owner uuid) returns jsonb
language sql stable set search_path = public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'user', jsonb_build_object(
      'homeCurrency', s.home_currency, 'hijriOffset', s.hijri_offset,
      'defaultPaymentType', s.default_payment_type,
      'customPaymentTypes', to_jsonb(s.custom_payment_types),
      'hiddenPaymentTypes', to_jsonb(s.hidden_payment_types)),
    'fxRates', (select jsonb_object_agg(currency, rate) from book_fx_rates
                where owner_id = owner and deleted_at is null),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name,
                   'currency', currency, 'archived', archived, 'type', type) order by position, id), '[]')
                 from accounts where owner_id = owner and deleted_at is null),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'type', type,
                     'parentId', parent_id) order by position, id), '[]')
                   from categories where owner_id = owner and deleted_at is null),
    -- { "expense": { "<categoryId>": uses, … }, "income": { … } }
    'categoryUses', (select coalesce(jsonb_object_agg(type, counts), '{}') from (
                       select type, jsonb_object_agg(category_id, n) as counts from (
                         select type, category_id, count(*) as n from transactions
                         where owner_id = owner and deleted_at is null and category_id is not null
                           and type in ('expense', 'income')
                         group by type, category_id) c
                       group by type) t),
    'family', (select coalesce(jsonb_agg(jsonb_build_object('email', m.email,
                 'permissions', (select coalesce(jsonb_agg(jsonb_build_object('accountId', p.account_id,
                                   'access', p.access) order by p.position), '[]')
                                 from member_account_permissions p
                                 where p.owner_id = m.owner_id and p.member_id = m.id))
                 order by m.position, m.id), '[]')
               from family_members m where m.owner_id = owner and m.deleted_at is null)
  ))
  from book_settings s
  where s.owner_id = owner
$$;
