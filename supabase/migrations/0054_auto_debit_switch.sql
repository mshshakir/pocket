-- 0054 · A switch for auto-debit. Razorpay's live account answered "No
-- appropriate payment method found" for a subscription: recurring payments
-- (Subscriptions, UPI AutoPay / card mandates) need their own activation by
-- Razorpay. Until it is on, Pocket Pro and Group are sold as one-time
-- payments again, and the ₹30 promise (auto-debit only) can't be bought.
--
-- Turn on once Razorpay has activated recurring payments:
--   update billing_settings set auto_debit_enabled = true where id;

alter table public.billing_settings add column if not exists auto_debit_enabled boolean not null default false;

create or replace function public.pocket_subscription_quote(p_user uuid, p_product text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare cfg billing_settings; term text; pl plans; amount int; sub subscriptions; eff record;
begin
  select * into cfg from billing_settings where id;
  if p_product !~ '^[a-z]+_(month|year)$' then return jsonb_build_object('ok', false, 'renewing', false); end if;
  term := split_part(p_product, '_', 2);
  select * into pl from plans where plans.code = split_part(p_product, '_', 1);
  if pl.code is null or pl.code = 'free' or not (pl.active or pl.code = 'promise') then
    return jsonb_build_object('ok', false, 'renewing', false);
  end if;
  amount := case term when 'month' then pl.monthly_paise else pl.yearly_paise end;
  if coalesce(amount, 0) <= 0 then return jsonb_build_object('ok', false, 'renewing', false); end if;
  -- Auto-debit off: plans are one-time again; the promise has no one-time form.
  if not cfg.auto_debit_enabled then
    return case when pl.code = 'promise'
                then jsonb_build_object('ok', false, 'renewing', true, 'reason', 'auto_debit_off')
                else jsonb_build_object('ok', false, 'renewing', false) end;
  end if;
  if not cfg.payments_enabled then return jsonb_build_object('ok', false, 'renewing', true, 'reason', 'closed'); end if;

  select * into sub from subscriptions where user_id = p_user;
  if sub.term = 'lifetime' then return jsonb_build_object('ok', false, 'renewing', true, 'reason', 'lifetime'); end if;
  if exists (select 1 from razorpay_subscriptions r where r.user_id = p_user and pocket_sub_live(r.status) and r.product = p_product) then
    return jsonb_build_object('ok', false, 'renewing', true, 'reason', 'has_subscription');
  end if;
  if pl.code = 'promise' then
    select * into eff from pocket_effective_plan(p_user);
    if eff.state = 'active' and eff.plan <> 'promise' then
      return jsonb_build_object('ok', false, 'renewing', true, 'reason', 'has_plan');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'renewing', true, 'product', p_product, 'plan', pl.code, 'term', term,
    'amountPaise', amount, 'name', pl.name || case term when 'month' then ' · monthly' else ' · yearly' end,
    'totalCount', case term when 'month' then 120 else 10 end);
end $$;

-- The app's plan answer says whether auto-debit is available.
create or replace function public.pocket_promise_rule() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('required', b.promise_required, 'promisePaise', b.promise_paise,
                            'promiseCredits', b.promise_credits, 'promiseCreditDays', b.promise_credit_days,
                            'autoDebit', b.auto_debit_enabled)
    from billing_settings b where b.id
$$;
