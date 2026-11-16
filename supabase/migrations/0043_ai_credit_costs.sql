-- 0043 · AI credits: different costs for a scan and a voice entry, and free
-- credits to try it. (0042 is the Telegram self-link migration.)
--
-- Decided by the owner on 16 Nov 2026:
--   · a pack is ₹100 for 500 credits (ai_credit_paise 10 → 20);
--   · a receipt scan costs 5 credits;
--   · a voice entry costs 1 credit for each 30 seconds (or part) of recording;
--   · every signed-in account gets 20 free credits once, to try it;
--   · balances already held stay as they are;
--   · a use that fails because the AI service failed is still given back
--     (pocket_ai_refund, unchanged); a recording the AI misheard is not.
--
-- pocket_ai_charge() replaces pocket_ai_spend() as what the `ai` function
-- calls: it works out the cost from the kind of request, so prices live in
-- billing_settings and nowhere else. pocket_ai_spend() stays (one credit) so
-- nothing that still calls it breaks.
--
-- Create-or-replace and additive changes only: nothing is dropped or deleted.

alter table public.billing_settings
  add column if not exists ai_scan_credits     int not null default 5  check (ai_scan_credits > 0),
  add column if not exists ai_voice_credits    int not null default 1  check (ai_voice_credits > 0),
  add column if not exists ai_voice_block_secs int not null default 30 check (ai_voice_block_secs > 0),
  add column if not exists ai_welcome_credits  int not null default 20 check (ai_welcome_credits >= 0);

update public.billing_settings set ai_credit_paise = 20 where id and ai_credit_paise = 10;

-- ── What a request costs ──────────────────────────────────────────────────
-- p_kind: 'receipt' | 'voice'. p_seconds: length of the recording (voice only).
create or replace function public.pocket_ai_cost(p_kind text, p_seconds int) returns int
language sql stable security definer set search_path = public as $$
  select case when p_kind = 'voice'
              then b.ai_voice_credits * greatest(1, ceil(greatest(coalesce(p_seconds, 0), 1)::numeric / b.ai_voice_block_secs)::int)
              else b.ai_scan_credits end
    from billing_settings b where b.id
$$;

-- ── Free credits to try AI, once per account ──────────────────────────────
-- Written to the ledger like an admin grant (they don't expire). Returns
-- whether they were given now.
create or replace function public.pocket_ai_welcome(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare amount int := (select ai_welcome_credits from billing_settings where id);
begin
  if p_user is null or coalesce(amount, 0) <= 0 then return false; end if;
  insert into ai_credit_ledger (user_id, delta, reason, ref, note)
  values (p_user, amount, 'grant', 'welcome', 'Free credits to try AI')
  on conflict (user_id, reason, ref) do nothing;
  return found;
end $$;

-- ── Charging (server only) ────────────────────────────────────────────────
-- Charge p_user for one AI request going into p_book's book. The cost comes
-- from pocket_ai_cost. Returns {ok, cost, chargedTo: 'unlimited'|'own'|'family',
-- ownerEmail?, remaining?} or {ok: false, reason: 'no_credits'|'no_access',
-- cost, remaining}. Safe to call twice with the same ref.
create or replace function public.pocket_ai_charge(p_user uuid, p_book uuid, p_ref text, p_kind text, p_seconds int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare prior ai_credit_ledger; left_ int; shared boolean; owner_email text; cost int;
begin
  if p_user is null or p_book is null or coalesce(p_ref, '') = '' then
    raise exception 'user, book and ref are required';
  end if;
  cost := pocket_ai_cost(p_kind, p_seconds);

  select * into prior from ai_credit_ledger where reason = 'use' and ref = p_ref and used_by = p_user;
  if prior.id is not null then
    return jsonb_build_object('ok', true, 'repeat', true, 'cost', -prior.delta,
      'chargedTo', case when prior.delta = 0 then 'unlimited' when prior.user_id = p_user then 'own' else 'family' end);
  end if;

  shared := p_book <> p_user;
  if shared and not pocket_ai_in_pool(p_user, p_book) then
    return jsonb_build_object('ok', false, 'reason', 'no_access');
  end if;

  -- Unlimited: the space owner's in a shared space, your own in your book.
  if pocket_ai_unlimited(p_book) or pocket_ai_unlimited(p_user) then
    insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_book, 0, 'use', p_ref, p_user);
    return jsonb_build_object('ok', true, 'chargedTo', 'unlimited', 'cost', 0);
  end if;

  -- The family pool pays first in a shared space. One spender at a time per
  -- balance, so two uses at once can't overdraw it.
  if shared then
    perform pg_advisory_xact_lock(hashtextextended('ai:' || p_book::text, 0));
    left_ := pocket_ai_balance(p_book);
    if left_ >= cost then
      select lower(email) into owner_email from auth.users where id = p_book;
      insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_book, -cost, 'use', p_ref, p_user);
      return jsonb_build_object('ok', true, 'chargedTo', 'family', 'ownerEmail', owner_email, 'cost', cost, 'remaining', left_ - cost);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text, 0));
  perform pocket_ai_welcome(p_user);
  left_ := pocket_ai_balance(p_user);
  if left_ >= cost then
    insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_user, -cost, 'use', p_ref, p_user);
    return jsonb_build_object('ok', true, 'chargedTo', 'own', 'cost', cost, 'remaining', left_ - cost);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'no_credits', 'cost', cost, 'remaining', greatest(left_, 0));
end $$;

-- The old one-credit charge, kept for anything that still calls it.
create or replace function public.pocket_ai_spend(p_user uuid, p_book uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare prior ai_credit_ledger; left_ int; shared boolean; owner_email text;
begin
  if p_user is null or p_book is null or coalesce(p_ref, '') = '' then
    raise exception 'user, book and ref are required';
  end if;

  select * into prior from ai_credit_ledger where reason = 'use' and ref = p_ref and used_by = p_user;
  if prior.id is not null then
    return jsonb_build_object('ok', true, 'repeat', true,
      'chargedTo', case when prior.delta = 0 then 'unlimited' when prior.user_id = p_user then 'own' else 'family' end);
  end if;

  shared := p_book <> p_user;
  if shared and not pocket_ai_in_pool(p_user, p_book) then
    return jsonb_build_object('ok', false, 'reason', 'no_access');
  end if;

  if pocket_ai_unlimited(p_book) or pocket_ai_unlimited(p_user) then
    insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_book, 0, 'use', p_ref, p_user);
    return jsonb_build_object('ok', true, 'chargedTo', 'unlimited');
  end if;

  if shared then
    perform pg_advisory_xact_lock(hashtextextended('ai:' || p_book::text, 0));
    left_ := pocket_ai_balance(p_book);
    if left_ >= 1 then
      select lower(email) into owner_email from auth.users where id = p_book;
      insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_book, -1, 'use', p_ref, p_user);
      return jsonb_build_object('ok', true, 'chargedTo', 'family', 'ownerEmail', owner_email, 'remaining', left_ - 1);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ai:' || p_user::text, 0));
  perform pocket_ai_welcome(p_user);
  left_ := pocket_ai_balance(p_user);
  if left_ >= 1 then
    insert into ai_credit_ledger (user_id, delta, reason, ref, used_by) values (p_user, -1, 'use', p_ref, p_user);
    return jsonb_build_object('ok', true, 'chargedTo', 'own', 'remaining', left_ - 1);
  end if;

  return jsonb_build_object('ok', false, 'reason', 'no_credits');
end $$;

-- ── What the app is told ──────────────────────────────────────────────────
-- Gives the free credits the first time an account asks for its plan (so the
-- balance shows them at once), and adds what a scan and a voice entry cost.
create or replace function public.pocket_entitlements() returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare me uuid := auth.uid(); cfg billing_settings;
begin
  select * into cfg from billing_settings where id;
  if me is not null and not exists (select 1 from ai_credit_ledger where user_id = me and reason = 'grant' and ref = 'welcome') then
    perform pocket_ai_welcome(me);
  end if;
  return pocket_entitlements_for(me)
         || jsonb_build_object('paymentsOpen', cfg.payments_enabled,
                               'aiCosts', jsonb_build_object('scan', cfg.ai_scan_credits, 'voice', cfg.ai_voice_credits,
                                                             'voiceSeconds', cfg.ai_voice_block_secs));
end $$;

-- The pack is named by its credits (it was "uses" when every use cost one).
create or replace function public.pocket_payment_products() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x || (pocket_offer_price(x->>'product', (x->>'amountPaise')::int, null) - 'offerIds')
                  order by (x->>'sort')::int, x->>'product'), '[]') from (
    select jsonb_build_object('product', p.code || '_month', 'name', p.name || ' · 1 month', 'plan', p.code,
                              'term', 'month', 'amountPaise', p.monthly_paise, 'sort', p.sort * 10 + 1) x
      from plans p where p.active and p.monthly_paise > 0
    union all
    select jsonb_build_object('product', p.code || '_year', 'name', p.name || ' · 1 year', 'plan', p.code,
                              'term', 'year', 'amountPaise', p.yearly_paise, 'sort', p.sort * 10 + 2)
      from plans p where p.active and p.yearly_paise > 0
    union all
    select jsonb_build_object('product', p.code || '_trial', 'name', p.name || ' · ' || p.trial_days || '-day trial', 'plan', p.code,
                              'term', 'trial', 'amountPaise', p.trial_paise, 'sort', p.sort * 10)
      from plans p where p.active and p.trial_paise > 0 and p.trial_days > 0
    union all
    select jsonb_build_object('product', 'ai_pack', 'name', 'AI pack · ' || (b.ai_pack_paise / b.ai_credit_paise) || ' credits',
                              'aiCredits', b.ai_pack_paise / b.ai_credit_paise, 'amountPaise', b.ai_pack_paise, 'sort', 999)
      from billing_settings b where b.id
  ) s
$$;

revoke execute on function public.pocket_ai_cost(text, int), public.pocket_ai_welcome(uuid),
  public.pocket_ai_charge(uuid, uuid, text, text, int) from public, anon, authenticated;
grant execute on function public.pocket_ai_cost(text, int), public.pocket_ai_welcome(uuid),
  public.pocket_ai_charge(uuid, uuid, text, text, int) to service_role;
revoke execute on function public.pocket_entitlements() from public, anon;
grant execute on function public.pocket_entitlements() to authenticated;
