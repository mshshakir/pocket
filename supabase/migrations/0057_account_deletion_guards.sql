-- 0057 · Guards for account deletion (0055), found on rechecking 0056.
--   · An admin can't ask for their own account to be deleted (the owner's
--     account must never go by accident).
--   · account_deletions.last_error: why a deletion failed, so one failure
--     doesn't hide the others (0056 carries on with the next account).
--   · The admin Payments list shows the email kept on the payment once the
--     account is gone.
-- Additive / create-or-replace only.

alter table public.account_deletions add column if not exists last_error text;
-- The email kept on a payment once its account is gone (filled by 0056).
alter table public.payment_orders add column if not exists email text;

create or replace function public.pocket_account_delete_request() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); days int := (select account_delete_days from billing_settings where id);
begin
  if me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if exists (select 1 from admins where user_id = me) then
    raise exception 'An admin account can''t be deleted from the app.' using errcode = 'PG001';
  end if;
  insert into account_deletions as d (user_id, email, requested_at, delete_after)
  values (me, (select lower(email) from auth.users where id = me), now(), now() + make_interval(days => days))
  on conflict (user_id) do update set
    requested_at = case when d.cancelled_at is null and d.done_at is null then d.requested_at else now() end,
    delete_after = case when d.cancelled_at is null and d.done_at is null then d.delete_after else excluded.delete_after end,
    email = excluded.email, cancelled_at = null, done_at = null, last_error = null;
  update subscriptions set auto_renew = false where user_id = me;
  return pocket_account_deletion();
end $$;

create or replace function public.pocket_adm_payments(p_limit integer default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  perform pocket_require_admin();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', o.id, 'email', lower(coalesce(u.email, o.email)), 'product', o.product, 'status', o.status,
    'amountPaise', o.amount_paise, 'listPaise', o.list_paise, 'coupon', o.coupon_code,
    'paymentId', o.payment_id, 'createdAt', o.created_at, 'paidAt', o.paid_at) order by o.created_at desc), '[]')
  into res from (select * from payment_orders order by created_at desc limit least(greatest(p_limit, 1), 1000)) o
  left join auth.users u on u.id = o.user_id;
  return res;
end $$;
