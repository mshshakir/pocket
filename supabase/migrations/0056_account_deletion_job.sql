-- 0056 · Deleting accounts whose 7 days have passed (requested in 0055).
--
-- RUN BY THE OWNER in Supabase → SQL Editor (it contains DROP CONSTRAINT and
-- DELETE, which aren't applied with the Supabase tool).
--
-- What goes: the sign-in (auth.users) and, through it, everything that
-- cascades from it — the cloud book, Telegram links, plan and its history,
-- AI credits, programme application; plus, by hand, rows that only hold the
-- person's id: Pocket Plus, bill reminders, budget alerts, delivery
-- check-ins, feedback, requests to use Pocket free, a group they organised,
-- Telegram steps in progress. A group they were in is left (their place
-- freed). Other people's family lists and permissions are theirs and stay.
--
-- What stays: payment records (payment_orders, with the email written onto
-- them, and razorpay_subscriptions), for tax and refunds. To keep them, the
-- two foreign keys that would delete or block them are removed (the columns
-- stay). The admin audit log stays.
--
-- Runs every day at 02:17 IST (job 'account-deletions').

alter table public.payment_orders add column if not exists email text;
alter table public.payment_orders drop constraint if exists payment_orders_user_id_fkey;
alter table public.payment_orders drop constraint if exists payment_orders_application_id_fkey;

create or replace function public.pocket_account_delete_one(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare mail text;
begin
  select lower(email) into mail from auth.users where id = p_user;

  update payment_orders set email = coalesce(email, mail) where user_id = p_user;

  delete from addons                     where user_id  = p_user;
  delete from bill_reminders             where owner_id = p_user;
  delete from budget_alerts              where owner_id = p_user;
  delete from delivery_checkins          where owner_id = p_user;
  delete from feedback                   where user_id  = p_user;
  delete from free_requests              where user_id  = p_user;
  delete from telegram_pending           where owner_id = p_user;
  delete from group_changes              where owner_id = p_user;
  delete from group_members              where owner_id = p_user;
  update group_members set removed_at = now(), removed_by = 'member'
   where removed_at is null and (user_id = p_user or (mail is not null and email = mail));

  -- The plan first: its history trigger writes a row that needs the user to exist.
  delete from subscriptions              where user_id  = p_user;
  delete from auth.users where id = p_user;   -- cascades to the book and the rest

  update account_deletions set done_at = now(), email = null where user_id = p_user;
end $$;

create or replace function public.pocket_account_delete_due() returns int
language plpgsql security definer set search_path = public as $$
declare d record; n int := 0;
begin
  for d in select user_id from account_deletions
            where cancelled_at is null and done_at is null and delete_after <= now()
  loop
    perform pocket_account_delete_one(d.user_id);
    n := n + 1;
  end loop;
  return n;
end $$;

revoke execute on function public.pocket_account_delete_one(uuid), public.pocket_account_delete_due() from public, anon, authenticated;
grant execute on function public.pocket_account_delete_one(uuid), public.pocket_account_delete_due() to service_role;

select cron.unschedule('account-deletions') where exists (select 1 from cron.job where jobname = 'account-deletions');
select cron.schedule('account-deletions', '47 20 * * *', $cron$ select public.pocket_account_delete_due() $cron$);
