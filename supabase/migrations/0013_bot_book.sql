-- 0013 — a slim book for the Telegram bot.
--
-- The bot used pocket_export_book, which returns the whole book: every
-- transaction (2+ MB for a book of 5,500 entries, ~1 s to build), and it did
-- so for every line of a message. All it needs from the transactions is how
-- often each category is used (to order the category buttons), so this
-- returns the settings, accounts, categories, family permissions and FX rates
-- it reads, plus those counts — and nothing else.
--
-- Service key only: the bot applies the sharing rules itself (PocketStore).

create index if not exists transactions_owner_category_live
  on public.transactions (owner_id, type, category_id) where deleted_at is null;

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
                   'currency', currency, 'archived', archived) order by position, id), '[]')
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

revoke all on function public.pocket_bot_book(uuid) from public, anon, authenticated;
grant execute on function public.pocket_bot_book(uuid) to service_role;
