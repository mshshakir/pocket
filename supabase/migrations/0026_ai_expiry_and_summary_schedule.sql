-- 0026 · AI pack credits expire after a year; each group chooses its own
-- summary time and weekly day.
--
-- AI credits: purchased credits last billing_settings.ai_credit_days (365).
-- Uses spend the oldest credits first, so only what is left of a pack a year
-- after buying it expires. An expiry is written to the ledger as a negative
-- 'grant' row (note 'Expired…', ref 'exp:<purchase row id>'), so the balance
-- stays the plain sum of the ledger and each pack expires once. Granted
-- credits (admin) don't expire. pocket_ai_expire_all() runs every hour.
--
-- Group summaries: post_minute (minutes after midnight, local; 21:00 = 1260)
-- and weekly_day (0 = Sunday … 6 = Saturday). The summaries job now runs
-- every 10 minutes so a chosen time like 8:30 pm is kept to within minutes.

alter table public.billing_settings add column if not exists ai_credit_days int not null default 365 check (ai_credit_days > 0);

-- Expires what is left of each of the user's packs that are older than ai_credit_days.
-- Returns the number of credits expired.
create or replace function public.pocket_ai_expire(p_user uuid) returns int
language plpgsql security definer set search_path = public as $$
declare
  days int := (select ai_credit_days from billing_settings where id);
  lot record; spent bigint; earlier bigint; left_ int; total int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('pocket_ai:' || p_user::text));
  for lot in
    select l.id, l.delta, l.at from ai_credit_ledger l
     where l.user_id = p_user and l.reason = 'purchase' and l.delta > 0
       and l.at <= now() - make_interval(days => days)
       and not exists (select 1 from ai_credit_ledger x where x.user_id = p_user and x.reason = 'grant' and x.ref = 'exp:' || l.id)
     order by l.at, l.id
  loop
    -- Everything that has gone out (uses net of refunds, earlier expiries, removals) …
    select coalesce(-sum(delta), 0) into spent from ai_credit_ledger
     where user_id = p_user and not (delta > 0 and reason in ('purchase', 'grant'));
    -- … is taken from the oldest credits first.
    select coalesce(sum(delta), 0) into earlier from ai_credit_ledger
     where user_id = p_user and delta > 0 and reason in ('purchase', 'grant') and (at, id) < (lot.at, lot.id);
    left_ := lot.delta - greatest(0, least(lot.delta, spent - earlier));
    if left_ > 0 then
      insert into ai_credit_ledger (user_id, delta, reason, ref, note)
      values (p_user, -left_, 'grant', 'exp:' || lot.id, 'Expired: AI pack bought ' || to_char(lot.at, 'DD Mon YYYY'))
      on conflict (user_id, reason, ref) do nothing;
      total := total + left_;
    end if;
  end loop;
  return total;
end $$;

create or replace function public.pocket_ai_expire_all() returns int
language plpgsql security definer set search_path = public as $$
declare u uuid; total int := 0;
begin
  for u in
    select distinct l.user_id from ai_credit_ledger l
     where l.reason = 'purchase' and l.delta > 0
       and l.at <= now() - make_interval(days => (select ai_credit_days from billing_settings where id))
       and not exists (select 1 from ai_credit_ledger x where x.user_id = l.user_id and x.reason = 'grant' and x.ref = 'exp:' || l.id)
  loop
    total := total + pocket_ai_expire(u);
  end loop;
  return total;
end $$;

revoke execute on function public.pocket_ai_expire(uuid), public.pocket_ai_expire_all() from public, anon, authenticated;
grant execute on function public.pocket_ai_expire(uuid), public.pocket_ai_expire_all() to service_role;

select cron.unschedule('ai-credit-expiry') where exists (select 1 from cron.job where jobname = 'ai-credit-expiry');
select cron.schedule('ai-credit-expiry', '23 * * * *', $cron$ select public.pocket_ai_expire_all() $cron$);

-- ── Group summary time and weekly day ─────────────────────────────────────
alter table public.telegram_groups
  add column if not exists post_minute int not null default 1260 check (post_minute between 0 and 1439),
  add column if not exists weekly_day int not null default 0 check (weekly_day between 0 and 6);

select cron.unschedule('telegram-summaries') where exists (select 1 from cron.job where jobname = 'telegram-summaries');
select cron.schedule('telegram-summaries', '*/10 * * * *', $cron$
  select net.http_post(
    url := 'https://nvsfxdnnakzfzsrsfftp.supabase.co/functions/v1/telegram-summaries',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cron$);
