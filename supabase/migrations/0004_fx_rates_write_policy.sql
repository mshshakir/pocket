-- 0004: let signed-in clients refresh the global fx_rates table.
-- The app's FxRefreshService (port of legacy ExchangeRateService) upserts
-- USD-based rates from open.er-api.com at most every 6 hours. fx_rates is
-- shared reference data, not user data — at family scale letting any
-- authenticated user refresh it is fine; revisit if the user base grows
-- (move the refresh into a scheduled edge function instead).

alter table fx_rates enable row level security;

drop policy if exists "fx_rates_read_all" on fx_rates;
create policy "fx_rates_read_all"
  on fx_rates for select
  using (true);

drop policy if exists "fx_rates_authenticated_write" on fx_rates;
create policy "fx_rates_authenticated_write"
  on fx_rates for insert
  to authenticated
  with check (true);

drop policy if exists "fx_rates_authenticated_update" on fx_rates;
create policy "fx_rates_authenticated_update"
  on fx_rates for update
  to authenticated
  using (true)
  with check (true);
