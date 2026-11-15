-- 0031 — pay-later regular items shared in a space, Telegram check-ins, and
-- recurring bills that ask before they count.
--
-- Pay-later items (milk, newspaper) keep their pattern and changes in
-- regular_items.extra (payLater, usualQty, usualDays, trackFrom, marks,
-- pauses, prices, paidTo, checkin*). Until now only the owner's app could
-- change them. pocket_delivery_change lets the owner — or a family member with
-- add access (or better) to the item's account — change one day, the pauses,
-- or how far it is paid; days already paid can't change. The app calls it as
-- the signed-in user; the bot calls pocket_delivery_apply with the person it
-- verified (service key only).
--
-- delivery_checkins / delivery_checkin_messages: one morning check-in per
-- owner, day and slot (a time and who gets it), and the Telegram messages it
-- went out as, so the first answer can update every copy.
--
-- Bills: a recurring entry marked askFirst is not copied automatically; each
-- occurrence waits until it is paid (a copy with id "<template>__<date>") or
-- skipped (recurring.skipped). pocket_bill_templates returns only those marked
-- entries, for reminders, and bill_reminders makes each reminder go once.

create or replace function public.pocket_member_access(p_actor uuid, p_owner uuid, p_account text) returns int
language sql stable security definer set search_path = public as $$
  select case
    when p_actor = p_owner then 4
    else coalesce((
      select max(access_rank(p.access))
        from family_members m
        join member_account_permissions p on p.owner_id = m.owner_id and p.member_id = m.id
        join auth.users u on u.id = p_actor
       where m.owner_id = p_owner and m.deleted_at is null
         and lower(m.email) = lower(u.email) and p.account_id = p_account), -1)
  end
$$;

-- One change to a pay-later item. p_change is one of:
--   { "set":   { "date": "YYYY-MM-DD", "qty": 2 } }   that day was different
--   { "clear": "YYYY-MM-DD" }                        back to the usual
--   { "pauses": [ { "from": …, "to": … }, … ] }      the whole list of pauses
--   { "paidTo": "YYYY-MM-DD" }                       paid up to that day (never moves back)
-- Returns { marks, pauses, paidTo } after the change.
create or replace function public.pocket_delivery_apply(p_actor uuid, p_owner uuid, p_item text, p_change jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r regular_items; x jsonb; d text; paid text; q numeric;
begin
  select * into r from regular_items where owner_id = p_owner and id = p_item and deleted_at is null for update;
  if r.id is null then raise exception 'That item no longer exists' using errcode = 'P0002'; end if;
  x := coalesce(r.extra, '{}'::jsonb);
  if coalesce((x->>'payLater')::boolean, false) is not true then
    raise exception 'That item isn''t paid to a vendor later' using errcode = '22023';
  end if;
  if pocket_member_access(p_actor, p_owner, r.account_id) < 1 then
    raise exception 'You don''t have permission to change that item' using errcode = '42501';
  end if;
  paid := x->>'paidTo';

  if p_change ? 'set' then
    d := p_change->'set'->>'date';
    q := (p_change->'set'->>'qty')::numeric;
    if d !~ '^\d{4}-\d{2}-\d{2}$' or q is null or q < 0 or q > 1000 then raise exception 'Bad day or quantity' using errcode = '22023'; end if;
    if paid is not null and d <= paid then raise exception 'That day is already paid' using errcode = '22023'; end if;
    x := jsonb_set(x, '{marks}', coalesce(x->'marks', '{}'::jsonb) || jsonb_build_object(d, q));
  elsif p_change ? 'clear' then
    d := p_change->>'clear';
    if paid is not null and d <= paid then raise exception 'That day is already paid' using errcode = '22023'; end if;
    x := jsonb_set(x, '{marks}', coalesce(x->'marks', '{}'::jsonb) - d);
  elsif p_change ? 'pauses' then
    if jsonb_typeof(p_change->'pauses') <> 'array' or jsonb_array_length(p_change->'pauses') > 50
       or exists (select 1 from jsonb_array_elements(p_change->'pauses') e
                  where jsonb_typeof(e) <> 'object' or (e->>'from') !~ '^\d{4}-\d{2}-\d{2}$' or (e->>'to') !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'Bad pauses' using errcode = '22023';
    end if;
    x := jsonb_set(x, '{pauses}', p_change->'pauses');
  elsif p_change ? 'paidTo' then
    d := p_change->>'paidTo';
    if d !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Bad day' using errcode = '22023'; end if;
    if paid is null or d > paid then x := jsonb_set(x, '{paidTo}', to_jsonb(d)); end if;
  else
    raise exception 'Unknown change' using errcode = '22023';
  end if;

  update regular_items set extra = x where owner_id = p_owner and id = p_item;
  return jsonb_build_object('marks', coalesce(x->'marks', '{}'::jsonb), 'pauses', coalesce(x->'pauses', '[]'::jsonb), 'paidTo', x->'paidTo');
end $$;

-- The app's door: the signed-in user changes an item in their own or a shared book.
create or replace function public.pocket_delivery_change(p_owner uuid, p_item text, p_change jsonb) returns jsonb
language sql security definer set search_path = public as $$
  select pocket_delivery_apply(auth.uid(), p_owner, p_item, p_change)
$$;

-- Every pay-later item that has a Telegram check-in, with what the scheduler needs.
create or replace function public.pocket_delivery_items() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'ownerId', r.owner_id, 'id', r.id, 'name', r.name, 'accountId', r.account_id, 'currency', r.currency,
      'defaultAmount', r.default_amount) || coalesce(r.extra, '{}'::jsonb) order by r.owner_id, r.position, r.id), '[]')
    from regular_items r
   where r.deleted_at is null and coalesce((r.extra->>'payLater')::boolean, false)
     and coalesce(r.extra->>'checkinTo', 'all') <> 'off'
$$;

-- One owner's pay-later items (for a check-in being answered, /dues, typed changes).
create or replace function public.pocket_delivery_items_of(p_owner uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'ownerId', r.owner_id, 'id', r.id, 'name', r.name, 'accountId', r.account_id, 'currency', r.currency,
      'defaultAmount', r.default_amount, 'categoryId', r.category_id) || coalesce(r.extra, '{}'::jsonb) order by r.position, r.id), '[]')
    from regular_items r
   where r.owner_id = p_owner and r.deleted_at is null and coalesce((r.extra->>'payLater')::boolean, false)
$$;

-- Who can be told about an owner's item on Telegram: the owner and family members with
-- add access to the account, each with their linked private chats and a name to show.
create or replace function public.pocket_notify_people(p_owner uuid, p_account text) returns jsonb
language sql stable security definer set search_path = public as $$
  with people as (
    select u.id as user_id, lower(u.email) as email,
           coalesce(nullif(s.extra->>'name', ''), split_part(u.email, '@', 1)) as name, 4 as rank
      from auth.users u left join book_settings s on s.owner_id = u.id
     where u.id = p_owner
    union all
    select null, lower(m.email), coalesce(nullif(m.name, ''), split_part(m.email, '@', 1)), max(access_rank(p.access))
      from family_members m
      join member_account_permissions p on p.owner_id = m.owner_id and p.member_id = m.id and p.account_id = p_account
     where m.owner_id = p_owner and m.deleted_at is null
     group by m.email, m.name
  )
  select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'name', p.name,
           'chats', (select coalesce(jsonb_agg(l.chat_id), '[]') from telegram_links l where lower(l.email) = p.email))), '[]')
    from people p where p.rank >= 1
$$;

-- Telegram groups tied to a space of the owner's that holds this account.
create or replace function public.pocket_notify_groups(p_owner uuid, p_account text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('chatId', g.chat_id, 'threadId', g.thread_id)), '[]')
    from telegram_groups g
   where g.owner_id = p_owner
     and exists (select 1 from space_accounts a join spaces s on s.owner_id = a.owner_id and s.id = a.space_id and s.deleted_at is null
                  where a.owner_id = g.owner_id and a.space_id = g.space_id and a.account_id = p_account)
$$;

create table if not exists public.delivery_checkins (
  id          bigint generated always as identity primary key,
  owner_id    uuid not null,
  day         date not null,
  slot        text not null,             -- e.g. "540|Asia/Kolkata|all|"
  items       text[] not null,
  answered_by text,
  answered_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (owner_id, day, slot)
);
create table if not exists public.delivery_checkin_messages (
  checkin_id bigint not null,
  chat_id    bigint not null,
  message_id bigint not null,
  primary key (checkin_id, chat_id)
);
alter table public.delivery_checkins enable row level security;
alter table public.delivery_checkin_messages enable row level security;
revoke all on public.delivery_checkins, public.delivery_checkin_messages from anon, authenticated;

-- Recurring entries marked askFirst (bills), with the occurrences already paid.
create or replace function public.pocket_bill_templates() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'ownerId', t.owner_id, 'id', t.id, 'payee', coalesce(nullif(t.payee, ''), nullif(t.description, ''), 'Bill'),
      'amount', t.amount, 'currency', t.currency, 'date', to_char(t.date, 'YYYY-MM-DD'), 'accountId', t.account_id,
      'categoryId', t.category_id, 'rule', t.recurring_rule, 'interval', t.recurring_interval,
      'until', to_char(t.recurring_until, 'YYYY-MM-DD'), 'skipped', to_jsonb(coalesce(t.recurring_skipped, '{}')),
      'remindTo', coalesce(t.extra->>'remindTo', 'all'), 'remindEmail', t.extra->>'remindEmail',
      'remindDays', coalesce((t.extra->>'remindDays')::int, 2),
      'lastAmount', coalesce((select c.amount from transactions c where c.owner_id = t.owner_id and c.recurring_source_id = t.id
                               and c.deleted_at is null order by c.date desc limit 1), t.amount),
      'paid', (select coalesce(jsonb_agg(split_part(c.id, '__', 2)), '[]') from transactions c
                where c.owner_id = t.owner_id and c.recurring_source_id = t.id and c.deleted_at is null)
    )), '[]')
    from transactions t
   where t.deleted_at is null and t.recurring_rule is not null and t.recurring_source_id is null
     and coalesce((t.extra->>'askFirst')::boolean, false)
     and coalesce(t.extra->>'remindTo', 'all') <> 'off'
$$;

create table if not exists public.bill_reminders (
  owner_id    uuid not null,
  template_id text not null,
  occurrence  date not null,
  kind        text not null check (kind in ('before', 'due')),
  created_at  timestamptz not null default now(),
  primary key (owner_id, template_id, occurrence, kind)
);
alter table public.bill_reminders enable row level security;
revoke all on public.bill_reminders from anon, authenticated;

revoke execute on function public.pocket_member_access(uuid, uuid, text), public.pocket_delivery_apply(uuid, uuid, text, jsonb),
  public.pocket_delivery_items(), public.pocket_delivery_items_of(uuid), public.pocket_notify_people(uuid, text),
  public.pocket_notify_groups(uuid, text), public.pocket_bill_templates()
  from public, anon, authenticated;
grant execute on function public.pocket_member_access(uuid, uuid, text), public.pocket_delivery_apply(uuid, uuid, text, jsonb),
  public.pocket_delivery_items(), public.pocket_delivery_items_of(uuid), public.pocket_notify_people(uuid, text),
  public.pocket_notify_groups(uuid, text), public.pocket_bill_templates()
  to service_role;
revoke execute on function public.pocket_delivery_change(uuid, text, jsonb) from public, anon;
grant execute on function public.pocket_delivery_change(uuid, text, jsonb) to authenticated, service_role;
