-- 0064 · Pocket Pro includes the ₹30 promise (150 AI credits every month), and AI on Telegram
-- (owner, 18 Nov 2026).
--
--   · Anyone on an active Pocket Pro (plan 'family', including the ₹149
--     introductory months) or Pocket Pro Group (the organiser, plan 'group',
--     and each member, who reads as 'family' through the organiser) gets
--     pro_credits (150) once each calendar month (India time).
--   · Pocket Pro family members get nothing of their own: the family shares
--     the owner's pool, so a family has 150 a month in all, not 150 each.
--     Group members each get their own, because Group credits are separate.
--   · Like promise credits they lapse promise_credit_days (30) after they are
--     given, and are spent before packs.
--   · Granted by an hourly job, so a new plan gets its credits within the hour.
--
-- Additive: new columns, functions and one scheduled job; pocket_ai_cost is
-- replaced with the same signature. No DROP or DELETE.

alter table public.billing_settings
  add column if not exists pro_credits int not null default 150 check (pro_credits >= 0);

-- This month's credits for one person, if their plan includes them. Safe to
-- call any number of times: the ref is the month, so it gives once.
create or replace function public.pocket_pro_credits(p_user uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare cfg billing_settings; eff record; month text;
begin
  select * into cfg from billing_settings where id;
  if p_user is null or coalesce(cfg.pro_credits, 0) <= 0 then return false; end if;
  select * into eff from pocket_effective_plan(p_user);
  if eff.plan is null or eff.state <> 'active' or eff.plan not in ('family', 'group') then return false; end if;
  month := to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM');
  perform pocket_ai_welcome(p_user);
  insert into ai_credit_ledger (user_id, delta, reason, ref, note, expires_at)
  values (p_user, cfg.pro_credits, 'grant', 'pro:' || month, 'Pocket Pro: this month''s AI credits',
          now() + make_interval(days => cfg.promise_credit_days))
  on conflict (user_id, reason, ref) do nothing;
  return found;
end $$;

-- Everyone who might be due. Returns how many were given credits this run.
create or replace function public.pocket_pro_credits_all() returns int
language plpgsql security definer set search_path = public as $$
declare u uuid; n int := 0;
begin
  for u in
    select s.user_id from subscriptions s where s.plan in ('family', 'group')
    union
    select coalesce(gm.user_id, au.id)
      from group_members gm
      left join auth.users au on gm.user_id is null and lower(au.email) = gm.email
     where gm.removed_at is null
  loop
    if u is not null and pocket_pro_credits(u) then n := n + 1; end if;
  end loop;
  return n;
end $$;

revoke execute on function public.pocket_pro_credits(uuid), public.pocket_pro_credits_all() from public, anon, authenticated;
grant execute on function public.pocket_pro_credits(uuid), public.pocket_pro_credits_all() to service_role;

select cron.schedule('pro-credits', '23 * * * *', $cron$ select public.pocket_pro_credits_all() $cron$);

-- ── Telegram AI (owner, 18 Nov 2026) ─────────────────────────────────────
-- Voice notes and receipt photos sent to the bot cost what they cost in the
-- app. Working out a typed message the bot couldn't read is free. Answering a
-- question about your own money costs ai_question_credits (1).
alter table public.billing_settings
  add column if not exists ai_question_credits int not null default 1 check (ai_question_credits > 0);

create or replace function public.pocket_ai_cost(p_kind text, p_seconds int) returns int
language sql stable security definer set search_path = public as $$
  select case when p_kind = 'voice'
              then b.ai_voice_credits * greatest(1, ceil(greatest(coalesce(p_seconds, 0), 1)::numeric / b.ai_voice_block_secs)::int)
              when p_kind = 'question' then b.ai_question_credits
              else b.ai_scan_credits end
    from billing_settings b where b.id
$$;

-- Questions send totals (never entries) to the AI only after the person says
-- yes, once per chat.
alter table public.telegram_links
  add column if not exists ai_questions boolean not null default false;

-- What a question is answered from: the person's OWN book only, as totals.
-- Counted like the app and the group summaries (0036): loans and repayments
-- are neither spending nor income; a paid-back expense counts what wasn't
-- paid back. Amounts are home-currency minor units.
create or replace function public.pocket_bot_period(p_owner uuid, p_from date, p_to date) returns jsonb
language sql stable security definer set search_path = public as $$
  with paid as (
    select a->>'txId' as tx_id, sum(greatest(0, coalesce(round((a->>'amount')::numeric)::bigint, 0))) as amt
      from transactions p
      cross join lateral jsonb_array_elements(coalesce(p.extra->'reimbAlloc', '[]'::jsonb)) a
     where p.owner_id = p_owner and p.deleted_at is null and 'reimbursement' = any(p.tags)
     group by 1
  ),
  raw as (
    select t.id, t.type, coalesce(t.ref_amount, t.amount) as ref0, t.amount as amount0, t.category_id,
           case when 'reimbursement' = any(coalesce(t.tags, '{}'))
                  then case when t.extra->>'reimbExtraAs' = 'income'
                            then least(t.amount, greatest(0, coalesce(round((t.extra->>'reimbExtra')::numeric)::bigint, 0))) else 0 end
                when t.type = 'expense' and coalesce(trim(t.extra->>'reimbBy'), '') <> ''
                  then greatest(0, t.amount - coalesce((select amt from paid where paid.tx_id = t.id), 0))
                else t.amount end as counted
      from transactions t
     where t.owner_id = p_owner and t.deleted_at is null
       and t.type in ('expense', 'income')
       and t.debt_role is null
       and not (coalesce(t.tags, '{}') && array['debt', 'debt-payment'])
       and t.date between p_from and p_to
  ),
  tx as (
    select id, type, category_id, amount0 as amount,
           case when amount0 = counted then ref0 when amount0 = 0 then 0
                else round(ref0::numeric * counted / amount0)::bigint end as ref
      from raw where counted > 0
  ),
  parts as (
    select tx.type, coalesce(s.category_id, tx.category_id) as category_id,
           case when s.transaction_id is null then tx.ref when tx.amount = 0 then 0
                else round(tx.ref::numeric * s.amount / tx.amount)::bigint end as amt
      from tx left join transaction_splits s on s.owner_id = p_owner and s.transaction_id = tx.id
  ),
  cats as (
    select parts.type, coalesce(main.name, c.name, 'Uncategorised') as main,
           case when main.id is null then null else c.name end as sub, sum(parts.amt) as amt
      from parts
      left join categories c    on c.owner_id = p_owner and c.id = parts.category_id
      left join categories main on main.owner_id = p_owner and main.id = c.parent_id
     group by 1, 2, 3
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'spent',    coalesce((select sum(ref) from tx where type = 'expense'), 0),
    'received', coalesce((select sum(ref) from tx where type = 'income'), 0),
    'entries',  (select count(*) from tx),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('type', type, 'main', main, 'sub', sub, 'amount', amt)
                                             order by type, amt desc) from cats where amt <> 0), '[]'))
$$;

-- This month so far, last month, and each budget's totals as the app last
-- saved them (alertStatus, 0039). p_today is the person's local date.
create or replace function public.pocket_bot_insights(p_owner uuid, p_today date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'currency', coalesce((select home_currency from book_settings where owner_id = p_owner), 'INR'),
    'today', p_today,
    'thisMonth', pocket_bot_period(p_owner, date_trunc('month', p_today)::date, p_today),
    'lastMonth', pocket_bot_period(p_owner, (date_trunc('month', p_today) - interval '1 month')::date,
                                   (date_trunc('month', p_today) - interval '1 day')::date),
    'budgets', coalesce((select jsonb_agg(b.extra->'alertStatus') from budgets b
                          where b.owner_id = p_owner and b.deleted_at is null
                            and jsonb_typeof(b.extra->'alertStatus') = 'object'), '[]'))
$$;

revoke execute on function public.pocket_bot_period(uuid, date, date), public.pocket_bot_insights(uuid, date)
  from public, anon, authenticated;
grant execute on function public.pocket_bot_period(uuid, date, date), public.pocket_bot_insights(uuid, date)
  to service_role;
