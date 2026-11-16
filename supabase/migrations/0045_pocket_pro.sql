-- 0045 · One paid plan, Pocket Pro; the backup add-on is Pocket Plus.
--
-- Decided by the owner on 16 Nov 2026:
--   · Sync and Family are combined into one plan, "Pocket Pro": sync, Telegram
--     and sharing with up to 5 people, ₹99 a month or ₹999 a year.
--   · Introductory offer instead of the ₹50 / 14-day trial: the first 3 months
--     (90 days) for ₹149, once per account, for people without a current plan.
--   · Scheduled Google Drive backups (₹199 once) are called "Pocket Plus".
--   · The one account that had paid for Sync moves to Pocket Pro with the same
--     end date (it gains sharing and loses nothing).
--
-- The plan keeps its code 'family' so every existing reference (subscriptions,
-- orders, the bot, coverage) keeps working; only its name and prices change.
-- 'sync' is switched off (active = false), not deleted.
--
-- Updates only: nothing is dropped or deleted.

update public.plans set name = 'Pocket Pro', monthly_paise = 9900, yearly_paise = 99900,
       trial_days = 90, trial_paise = 14900
 where code = 'family';

update public.plans set active = false where code = 'sync';

update public.subscriptions
   set plan = 'family', note = coalesce(note || ' · ', '') || 'Moved from Sync to Pocket Pro (16 Nov 2026)'
 where plan = 'sync';

-- Product names: the introductory offer and Pocket Plus.
create or replace function public.pocket_payment_products() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x || (pocket_offer_price(x->>'product', (x->>'amountPaise')::int, null) - 'offerIds')
                  order by (x->>'sort')::int, x->>'product'), '[]') from (
    select jsonb_build_object('product', p.code || '_month', 'name', p.name || ' · 1 month', 'plan', p.code,
                              'term', 'month', 'amountPaise', p.monthly_paise, 'sort', p.sort * 10 + 1) x
      from plans p where p.active and p.monthly_paise > 0
    union all
    select jsonb_build_object('product', p.code || '_year', 'name', p.name || ' · 1 year', 'plan', p.code,
                              'term', 'year', 'amountPaise', p.yearly_paise, 'sort', p.sort * 10 + 2)
      from plans p where p.active and p.yearly_paise > 0
    union all
    select jsonb_build_object('product', p.code || '_trial',
                              'name', p.name || ' · first ' || case when p.trial_days % 30 = 0
                                                                     then (p.trial_days / 30) || ' months'
                                                                     else p.trial_days || ' days' end,
                              'plan', p.code, 'term', 'trial', 'amountPaise', p.trial_paise, 'sort', p.sort * 10)
      from plans p where p.active and p.trial_paise > 0 and p.trial_days > 0
    union all
    select jsonb_build_object('product', 'drive_backup', 'name', 'Pocket Plus · scheduled Google Drive backups', 'addon', 'drive_backup',
                              'amountPaise', b.backup_paise, 'sort', 998)
      from billing_settings b where b.id
    union all
    select jsonb_build_object('product', 'ai_pack', 'name', 'AI pack · ' || (b.ai_pack_paise / b.ai_credit_paise) || ' credits',
                              'aiCredits', b.ai_pack_paise / b.ai_credit_paise, 'amountPaise', b.ai_pack_paise, 'sort', 999)
      from billing_settings b where b.id
  ) s
$$;

revoke execute on function public.pocket_payment_products() from public, anon, authenticated;
grant execute on function public.pocket_payment_products() to service_role;
