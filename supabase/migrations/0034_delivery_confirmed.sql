-- 0034 — deliveries are confirmed day by day: { "confirm": "YYYY-MM-DD" },
-- { "unconfirm": "YYYY-MM-DD" }, or { "confirmDays": [...] } (Telegram's
-- "That's right" for every item in a check-in). Kept in extra.confirmed as
-- { "YYYY-MM-DD": true }. Unconfirmed days still count in what's owed.
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
  elsif p_change ? 'confirm' then
    -- "it came": a day recorded as delivered (shown red until paid, green after)
    d := p_change->>'confirm';
    if d !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Bad day' using errcode = '22023'; end if;
    x := jsonb_set(x, '{confirmed}', coalesce(x->'confirmed', '{}'::jsonb) || jsonb_build_object(d, true));
  elsif p_change ? 'confirmDays' then
    if jsonb_typeof(p_change->'confirmDays') <> 'array' or jsonb_array_length(p_change->'confirmDays') > 62
       or exists (select 1 from jsonb_array_elements_text(p_change->'confirmDays') e where e !~ '^\d{4}-\d{2}-\d{2}$') then
      raise exception 'Bad days' using errcode = '22023';
    end if;
    x := jsonb_set(x, '{confirmed}', coalesce(x->'confirmed', '{}'::jsonb)
         || (select coalesce(jsonb_object_agg(e, true), '{}'::jsonb) from jsonb_array_elements_text(p_change->'confirmDays') e));
  elsif p_change ? 'unconfirm' then
    d := p_change->>'unconfirm';
    if d !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'Bad day' using errcode = '22023'; end if;
    x := jsonb_set(x, '{confirmed}', coalesce(x->'confirmed', '{}'::jsonb) - d);
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
    if p_change ? 'tx' and jsonb_typeof(x->'adjustments') = 'array' then
      x := jsonb_set(x, '{adjustments}', (
        select coalesce(jsonb_agg(case when coalesce(a->>'settledIn', '') = '' then a || jsonb_build_object('settledIn', p_change->>'tx') else a end), '[]')
          from jsonb_array_elements(x->'adjustments') a));
    end if;
  else
    raise exception 'Unknown change' using errcode = '22023';
  end if;

  update regular_items set extra = x where owner_id = p_owner and id = p_item;
  return jsonb_build_object('marks', coalesce(x->'marks', '{}'::jsonb), 'pauses', coalesce(x->'pauses', '[]'::jsonb), 'paidTo', x->'paidTo',
                            'confirmed', coalesce(x->'confirmed', '{}'::jsonb));
end $$;
