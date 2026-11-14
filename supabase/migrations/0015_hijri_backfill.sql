-- 0015 — store the Hijri date of every entry that lacked one (applied 2026-11-14).
--
-- 5,517 of 5,677 live entries had no stored Hijri date. The web app fills it
-- in on start-up from the Gregorian date (HijriCalendarService.toHijriRaw,
-- offset 0) but only in its local copy; when a tab had closed with an unsaved
-- edit, the next start-up treated every filled-in date as an edit and saved
-- the whole book back — rewriting who last changed each entry, and able to
-- overwrite a newer edit made from Telegram or by a family member.
--
-- pocket_hijri_raw is that same conversion in SQL. Before writing, it was
-- checked against the app's own function: identical results for all 5,517
-- dates (one fingerprint over every value) and for the 160 entries that
-- already had one. Each group of rows was updated as its own last editor, so
-- the stamp trigger left updated_by exactly as it was (checked by
-- fingerprint), and the daily-total refresh was skipped (a Hijri date changes
-- no total).
--
-- Re-running is harmless: it only touches rows still without a Hijri date.

create or replace function public.pocket_hijri_raw(d date) returns int[]
language plpgsql immutable set search_path = public as $$
-- The app's HijriCalendarService.toHijriRaw (offset 0, noon local time):
-- Gregorian → astronomical Julian day → tabular Hijri. Returns {year, month, day}
-- exactly as the app stores them (month 0-based).
declare
  in30   int[] := array[354,708,1063,1417,1771,2126,2480,2834,3189,3543,3898,4252,4606,4961,
                        5315,5669,6024,6378,6732,7087,7441,7796,8150,8504,8859,9213,9567,9922,10276,10631];
  inyear int[] := array[30,59,89,118,148,177,207,236,266,295,325];
  y int := extract(year from d);
  m int := extract(month from d);
  a int; b int; ajd numeric; rest numeric; y30 int; i int := 0; yr int; mo int; dy int;
begin
  if m < 3 then y := y - 1; m := m + 12; end if;
  a := floor(y / 100.0);
  b := 2 - a + floor(a / 4.0);
  ajd := floor(365.25 * (y + 4716)) + floor(30.6001 * (m + 1)) + (extract(day from d) + 0.5) + b - 1524.5;
  rest := floor(ajd - 1948083.5);
  y30 := floor(rest / 10631);
  rest := rest - y30 * 10631;
  while i < 30 and rest > in30[i + 1] loop i := i + 1; end loop;
  yr := y30 * 30 + i;
  if i > 0 then rest := rest - in30[i]; end if;
  i := 0;
  while i < 11 and rest > inyear[i + 1] loop i := i + 1; end loop;
  mo := i;
  dy := case when i > 0 then rest - inyear[i] else rest end;
  return array[yr, mo, dy];
end $$;
revoke all on function public.pocket_hijri_raw(date) from public, anon, authenticated;

do $$
declare u uuid;
begin
  perform set_config('pocket.bulk_import', 'on', true);
  for u in select distinct t.updated_by from public.transactions t
           where t.deleted_at is null and t.date is not null and t.hijri_year is null loop
    perform set_config('request.jwt.claims',
      case when u is null then '{}' else json_build_object('sub', u)::text end, true);
    update public.transactions t
       set hijri_year = x.h[1], hijri_month = x.h[2], hijri_day = x.h[3], hijri_offset = 0
      from (select s.owner_id, s.id, public.pocket_hijri_raw(s.date) h from public.transactions s
            where s.deleted_at is null and s.date is not null and s.hijri_year is null
              and s.updated_by is not distinct from u) x
     where t.owner_id = x.owner_id and t.id = x.id;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end $$;
