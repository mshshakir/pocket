-- Admin: delete an offer (sale or coupon code).
-- Past payments keep the code they were bought with (payment_orders.coupon_code),
-- so deleting an offer never changes what anyone paid. A payment still in
-- progress that used it simply doesn't count a use.
create or replace function public.pocket_adm_delete_offer(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o offers;
begin
  perform pocket_require_admin();
  select * into o from offers where id = p_id;
  if o.id is null then raise exception 'Unknown offer %', p_id; end if;
  delete from offers where id = p_id;
  perform pocket_adm_log('delete_offer', p_id::text,
    jsonb_build_object('kind', o.kind, 'code', o.code, 'name', o.name, 'uses', o.uses));
  return pocket_adm_pricing();
end $$;

revoke execute on function public.pocket_adm_delete_offer(bigint) from public, anon;
grant execute on function public.pocket_adm_delete_offer(bigint) to authenticated;
