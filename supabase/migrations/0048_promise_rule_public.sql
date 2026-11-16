-- 0048 · Whether adding entries needs the ₹30 promise, readable without
-- signing in, so the app can ask someone who isn't signed in to sign in first.
-- Returns only the switch and the price; nothing about any person.

create or replace function public.pocket_promise_rule() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('required', b.promise_required, 'promisePaise', b.promise_paise,
                            'promiseCredits', b.promise_credits, 'promiseCreditDays', b.promise_credit_days)
    from billing_settings b where b.id
$$;

revoke execute on function public.pocket_promise_rule() from public;
grant execute on function public.pocket_promise_rule() to anon, authenticated;
