-- 0041 · Programme batches: application dates, and what the public pages show
--
-- Each batch gets the days applications open and close, and a "closed now"
-- switch. The programme page and the homepage read pocket_programme_next()
-- (no sign-in needed) and show, from the dates alone:
--   upcoming  "Next batch starts 1 Dec · applications open 20 Nov"
--   open      "Batch 3 is open · starts 1 Dec · 4 of 10 places left"
--   full      "Batch 3 is full"           (no places left)
--   closed    "Applications are closed"   (after the close date, or closed now)
--   running   during its 6 weeks
-- Places left = places − (confirmed + offered). Only the batch name, dates,
-- places and price are public; nothing about who applied.

alter table public.programme_batches add column if not exists opens_on date;
alter table public.programme_batches add column if not exists closes_on date;
alter table public.programme_batches add column if not exists closed_now boolean not null default false;

-- What state a batch is in today (Asia/Kolkata).
create or replace function public.pocket_programme_state(
  p_status text, p_starts date, p_opens date, p_closes date, p_closed boolean, p_capacity int, p_taken int
) returns text language sql stable as $$
  with t as (select (now() at time zone 'Asia/Kolkata')::date as today)
  select case
    when p_status = 'done' then 'done'
    when p_starts is not null and t.today >= p_starts + 42 then 'done'
    when p_starts is not null and t.today >= p_starts then 'running'
    when p_opens is null or t.today < p_opens then 'upcoming'
    when p_closed or t.today > coalesce(p_closes, p_starts - 1, 'infinity'::date) then 'closed'
    when p_taken >= p_capacity then 'full'
    else 'open'
  end from t
$$;

-- The public view: every batch not finished, soonest first.
create or replace function public.pocket_programme_next() returns jsonb
language sql stable security definer set search_path = public as $$
  with b as (
    select pb.*, (select count(*)::int from programme_applications a
                   where a.batch_id = pb.id and a.status in ('offered', 'confirmed', 'completed')) as taken
      from programme_batches pb
  ), s as (
    select b.*, pocket_programme_state(b.status, b.starts_on, b.opens_on, b.closes_on, b.closed_now, b.capacity, b.taken) as state from b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
      'name', name, 'startsOn', starts_on, 'opensOn', opens_on, 'closesOn', closes_on,
      'capacity', capacity, 'placesLeft', greatest(0, capacity - taken), 'pricePaise', price_paise, 'state', state)
      order by starts_on nulls last, id), '[]')
    from s where state <> 'done'
$$;

revoke all on function public.pocket_programme_next() from public;
grant execute on function public.pocket_programme_next() to anon, authenticated;

-- Admin: save the dates and the switch too.
create or replace function public.pocket_adm_save_batch(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare bid bigint := nullif(p->>'id', '')::bigint;
begin
  perform pocket_require_admin();
  if bid is null then
    insert into programme_batches (name, starts_on, capacity, price_paise, status, notes, opens_on, closes_on, closed_now)
    values (p->>'name', nullif(p->>'starts_on', '')::date, coalesce(nullif(p->>'capacity', '')::int, 10),
            coalesce(nullif(p->>'price_paise', '')::int, 500000), coalesce(nullif(p->>'status', ''), 'planned'), nullif(p->>'notes', ''),
            nullif(p->>'opens_on', '')::date, nullif(p->>'closes_on', '')::date, coalesce((p->>'closed_now')::boolean, false))
    returning id into bid;
  else
    update programme_batches set
      name = coalesce(p->>'name', name),
      starts_on = case when p ? 'starts_on' then nullif(p->>'starts_on', '')::date else starts_on end,
      opens_on = case when p ? 'opens_on' then nullif(p->>'opens_on', '')::date else opens_on end,
      closes_on = case when p ? 'closes_on' then nullif(p->>'closes_on', '')::date else closes_on end,
      closed_now = case when p ? 'closed_now' then coalesce((p->>'closed_now')::boolean, false) else closed_now end,
      capacity = coalesce(nullif(p->>'capacity', '')::int, capacity),
      price_paise = coalesce(nullif(p->>'price_paise', '')::int, price_paise),
      status = coalesce(nullif(p->>'status', ''), status),
      notes = case when p ? 'notes' then nullif(p->>'notes', '') else notes end
    where id = bid;
    if not found then raise exception 'Unknown batch %', bid; end if;
  end if;
  perform pocket_adm_log('save_batch', bid::text, p);
  return pocket_adm_programme();
end $$;
