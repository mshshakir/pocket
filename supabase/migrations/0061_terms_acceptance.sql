-- 0061 · Agreeing to the Terms and Privacy Policy (owner, 17 Nov 2026).
--
-- The sign-in window says "By continuing, you agree to Pocket's Terms and
-- Privacy Policy"; after signing in, the app records it here. People who
-- signed up before, or after a version change, are asked once in the app.
-- billing_settings.terms_version is the current version; bump it when the
-- Terms or Privacy Policy change in a way that matters, and everyone is asked
-- again. Each acceptance is kept (who, which version, when, how).

alter table public.billing_settings
  add column if not exists terms_version text not null default '2026-11-17';

create table if not exists public.terms_acceptances (
  user_id     uuid not null,  -- no foreign key: the record of agreeing outlives a deleted account
  version     text not null,
  accepted_at timestamptz not null default now(),
  via         text not null default 'prompt' check (via in ('sign_in', 'prompt')),
  primary key (user_id, version)
);
alter table public.terms_acceptances enable row level security;
-- No direct access: only the functions below read or write it.

-- The signed-in person: the current version and whether they have accepted it.
create or replace function public.pocket_terms_state() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', b.terms_version,
    'accepted', exists (select 1 from terms_acceptances t where t.user_id = auth.uid() and t.version = b.terms_version),
    'acceptedAt', (select t.accepted_at from terms_acceptances t where t.user_id = auth.uid() and t.version = b.terms_version))
  from billing_settings b where b.id
$$;

-- Records that the signed-in person accepted a version (only the current one). Safe to repeat.
create or replace function public.pocket_terms_accept(p_version text, p_via text default 'prompt') returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); cur text := (select terms_version from billing_settings where id);
begin
  if uid is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_version is distinct from cur then raise exception 'The Terms have changed. Please read them again.' using errcode = 'PG001'; end if;
  insert into terms_acceptances (user_id, version, via)
  values (uid, cur, case when p_via = 'sign_in' then 'sign_in' else 'prompt' end)
  on conflict (user_id, version) do nothing;
  return pocket_terms_state();
end $$;

revoke all on function public.pocket_terms_state() from public, anon;
revoke all on function public.pocket_terms_accept(text, text) from public, anon;
grant execute on function public.pocket_terms_state() to authenticated;
grant execute on function public.pocket_terms_accept(text, text) to authenticated;
