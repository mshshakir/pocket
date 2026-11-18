-- 0065 · Typed messages the bot couldn't read: free up to a daily limit
-- (owner, 18 Nov 2026).
--
-- Working out a typed message with no amount ("gave Ali five thousand") was
-- free without limit, so anyone could use the AI for nothing. Now each person
-- gets ai_text_free_per_day (20) a day free (India date); after that each one
-- costs ai_text_credits (1), charged like any other AI use (unlimited
-- accounts are never charged). Safe to repeat with the same ref.
--
-- Additive: two columns, one table, one function; pocket_ai_cost is replaced
-- with the same signature. No DROP or DELETE.

alter table public.billing_settings
  add column if not exists ai_text_free_per_day int not null default 20 check (ai_text_free_per_day >= 0),
  add column if not exists ai_text_credits      int not null default 1  check (ai_text_credits > 0);

create or replace function public.pocket_ai_cost(p_kind text, p_seconds int) returns int
language sql stable security definer set search_path = public as $$
  select case when p_kind = 'voice'
              then b.ai_voice_credits * greatest(1, ceil(greatest(coalesce(p_seconds, 0), 1)::numeric / b.ai_voice_block_secs)::int)
              when p_kind = 'question' then b.ai_question_credits
              when p_kind = 'text' then b.ai_text_credits
              else b.ai_scan_credits end
    from billing_settings b where b.id
$$;

-- The free uses, one row per message (ref), dated in India time.
create table if not exists public.ai_text_uses (
  user_id uuid not null,
  ref     text not null,
  day     date not null,
  at      timestamptz not null default now(),
  primary key (user_id, ref)
);
create index if not exists ai_text_uses_day on public.ai_text_uses (user_id, day);
alter table public.ai_text_uses enable row level security;
revoke all on public.ai_text_uses from anon, authenticated;

-- Free while today's count is under the limit, else charged. Returns the same
-- shape as pocket_ai_charge, plus free: true and freeLeft for free uses.
create or replace function public.pocket_ai_text(p_user uuid, p_ref text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare cfg billing_settings; today date := (now() at time zone 'Asia/Kolkata')::date; used int;
begin
  if p_user is null or coalesce(p_ref, '') = '' then raise exception 'user and ref are required'; end if;
  select * into cfg from billing_settings where id;
  if exists (select 1 from ai_text_uses where user_id = p_user and ref = p_ref) then
    return jsonb_build_object('ok', true, 'free', true, 'repeat', true);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('aitext:' || p_user::text, 0));
  select count(*) into used from ai_text_uses where user_id = p_user and day = today;
  if used < cfg.ai_text_free_per_day then
    insert into ai_text_uses (user_id, ref, day) values (p_user, p_ref, today) on conflict do nothing;
    return jsonb_build_object('ok', true, 'free', true, 'freeLeft', cfg.ai_text_free_per_day - used - 1);
  end if;
  return pocket_ai_charge(p_user, p_user, p_ref, 'text', 0);
end $$;

revoke execute on function public.pocket_ai_text(uuid, text) from public, anon, authenticated;
grant execute on function public.pocket_ai_text(uuid, text) to service_role;
