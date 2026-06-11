-- 0003: seed the global fx_rates table (units per 1 USD) so clients have
-- rates to sync. A live refresher (edge function / scheduled job) can update
-- these later; the app merges them over its built-in seed snapshot.

insert into fx_rates (code, rate) values
  ('USD', 1.0),
  ('EUR', 0.9),
  ('GBP', 0.78),
  ('INR', 83.0),
  ('KES', 130.0),
  ('AED', 3.67),
  ('SAR', 3.75),
  ('PKR', 278.0),
  ('LKR', 300.0),
  ('TZS', 2600.0),
  ('UGX', 3700.0),
  ('JPY', 155.0),
  ('CAD', 1.36),
  ('AUD', 1.5)
on conflict (code) do update set rate = excluded.rate, updated_at = now();
