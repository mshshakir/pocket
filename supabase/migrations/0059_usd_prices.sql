-- 0059 · Prices in US dollars for people outside India (owner, 17 Nov 2026).
--
-- The app shows rupees in India's time zone and dollars everywhere else (no
-- switch). Rupee prices, offers and rules stay where they are; this table
-- holds one dollar price per product, in cents. The payments function charges
-- the dollar price when the app asks for USD, scaling it by any sale or code
-- the rupee quote carries (e.g. 20% off in rupees is 20% off in dollars).
-- Products missing here aren't sold in dollars. Dollar payments are always
-- one-time: nothing renews by auto-debit, and the promise is paid a month at a
-- time.

create table if not exists public.usd_prices (
  product    text primary key,
  cents      int  not null check (cents >= 50),
  updated_at timestamptz not null default now()
);

alter table public.usd_prices enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'usd_prices' and policyname = 'usd_prices_read') then
    create policy usd_prices_read on public.usd_prices for select using (true);
  end if;
end $$;
grant select on public.usd_prices to anon, authenticated;

insert into public.usd_prices (product, cents) values
  ('family_month',     299),   -- Pocket Pro, 1 month        (₹99)
  ('family_year',     2499),   -- Pocket Pro, 1 year         (₹999)
  ('family_trial',     399),   -- Pocket Pro, first 3 months (₹149)
  ('group_year',      4999),   -- Pocket Pro Group, 1 year   (₹1,999)
  ('drive_backup',     499),   -- Pocket Plus, once          (₹199)
  ('ai_pack',          200),   -- AI pack, 500 credits       (₹100)
  ('promise_month',    100),   -- the promise, 1 month       (₹30)
  ('programme',       9900),   -- habit programme, paid in full (₹4,500)
  ('programme_half',  5900),   -- first half                 (₹2,500)
  ('programme_rest',  5900)    -- second half                (₹2,500)
on conflict (product) do update set cents = excluded.cents, updated_at = now();

-- What was actually charged, in the order's currency's smallest unit (cents
-- for USD). amount_paise keeps the rupee value of the same item, which the
-- plan rules (switching credit, day value) still work from.
alter table public.payment_orders add column if not exists charged_minor int;

-- The admin's payments list shows what was actually charged, and in which currency.
create or replace function public.pocket_adm_payments(p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform pocket_require_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'email', lower(coalesce(u.email, o.email)), 'product', o.product, 'status', o.status,
    'amountPaise', o.amount_paise, 'listPaise', o.list_paise, 'coupon', o.coupon_code,
    'currency', coalesce(o.currency, 'INR'), 'chargedMinor', o.charged_minor,
    'paymentId', o.payment_id, 'createdAt', o.created_at, 'paidAt', o.paid_at) order by o.created_at desc), '[]')
  into res from (select * from payment_orders order by created_at desc limit least(greatest(p_limit, 1), 1000)) o
  left join auth.users u on u.id = o.user_id;
  return res;
end $$;
