-- 0035 — Feedback and feature requests from the app, read in the admin dashboard.
--
-- Signed-in people send a message (pocket_feedback_send); nobody reads the
-- table directly (RLS on, no policies). Admins list and triage them
-- (pocket_adm_feedback / pocket_adm_feedback_set), and status changes go in
-- the admin audit log. No book contents are involved: only what the person
-- typed, the page they were on, and their email.

create table if not exists public.feedback (
  id          bigint generated always as identity primary key,
  user_id     uuid not null,
  email       text,
  kind        text not null check (kind in ('feedback', 'feature')),
  message     text not null check (char_length(message) between 1 and 2000),
  page        text,
  app_version text,
  status      text not null default 'new' check (status in ('new', 'read', 'planned', 'done', 'wontdo')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.feedback enable row level security;
create index if not exists feedback_created_idx on public.feedback (created_at desc);
create index if not exists feedback_user_idx on public.feedback (user_id, created_at desc);

-- Send: signed in only; up to 20 a day; message 1–2000 characters.
create or replace function public.pocket_feedback_send(p_kind text, p_message text, p_page text default null, p_version text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); msg text := btrim(coalesce(p_message, '')); mail text; new_id bigint;
begin
  if uid is null then raise exception 'Sign in to send feedback' using errcode = '42501'; end if;
  if p_kind not in ('feedback', 'feature') then raise exception 'Unknown kind' using errcode = '22023'; end if;
  if char_length(msg) = 0 then raise exception 'Write a message first' using errcode = '22023'; end if;
  if char_length(msg) > 2000 then raise exception 'Keep it under 2000 characters' using errcode = '22023'; end if;
  if (select count(*) from feedback where user_id = uid and created_at > now() - interval '1 day') >= 20 then
    raise exception 'You''ve sent a lot today — please try again tomorrow' using errcode = '54000';
  end if;
  select u.email into mail from auth.users u where u.id = uid;
  insert into feedback (user_id, email, kind, message, page, app_version)
  values (uid, mail, p_kind, msg, left(nullif(btrim(coalesce(p_page, '')), ''), 60), left(nullif(btrim(coalesce(p_version, '')), ''), 40))
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

revoke execute on function public.pocket_feedback_send(text, text, text, text) from public, anon;
grant execute on function public.pocket_feedback_send(text, text, text, text) to authenticated;

-- Admin: the list (newest first) and how many in each status.
create or replace function public.pocket_adm_feedback(p_status text default null, p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform pocket_require_admin();
  return jsonb_build_object(
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                 from (select status, count(*) n from feedback group by status) c),
    'items', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', f.id, 'kind', f.kind, 'message', f.message, 'email', f.email, 'page', f.page,
                 'version', f.app_version, 'status', f.status, 'note', f.note,
                 'at', f.created_at) order by f.created_at desc), '[]'::jsonb)
                from (select * from feedback
                       where p_status is null or status = p_status
                       order by created_at desc
                       limit greatest(1, least(coalesce(p_limit, 300), 1000))) f));
end $$;

revoke execute on function public.pocket_adm_feedback(text, int) from public, anon;
grant execute on function public.pocket_adm_feedback(text, int) to authenticated;

-- Admin: set a message's status (and an optional private note).
create or replace function public.pocket_adm_feedback_set(p_id bigint, p_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f feedback;
begin
  perform pocket_require_admin();
  if p_status not in ('new', 'read', 'planned', 'done', 'wontdo') then raise exception 'Unknown status' using errcode = '22023'; end if;
  update feedback set status = p_status, note = coalesce(p_note, note), updated_at = now()
   where id = p_id returning * into f;
  if f.id is null then raise exception 'Unknown message %', p_id; end if;
  perform pocket_adm_log('feedback_status', p_id::text, jsonb_build_object('status', p_status, 'kind', f.kind));
  return jsonb_build_object('id', f.id, 'status', f.status, 'note', f.note);
end $$;

revoke execute on function public.pocket_adm_feedback_set(bigint, text, text) from public, anon;
grant execute on function public.pocket_adm_feedback_set(bigint, text, text) to authenticated;
