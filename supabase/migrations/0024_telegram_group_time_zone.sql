-- 0024 · Each group's own time zone for its 9 pm summary (asked when it is
-- turned on; India until chosen). The job now runs every half hour, at :07
-- and :37, so half-hour time zones (India) also get theirs just after 9.
alter table public.telegram_groups add column if not exists time_zone text not null default 'Asia/Kolkata';

select cron.unschedule('telegram-summaries') where exists (select 1 from cron.job where jobname = 'telegram-summaries');
select cron.schedule('telegram-summaries', '7,37 * * * *', $cron$
  select net.http_post(
    url := 'https://nvsfxdnnakzfzsrsfftp.supabase.co/functions/v1/telegram-summaries',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$cron$);
