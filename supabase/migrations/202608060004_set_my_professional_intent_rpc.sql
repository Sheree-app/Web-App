-- Direct UPDATE on public.users is not granted to authenticated, so the opt-in
-- from Settings ("Start a professional account") goes through a security
-- definer RPC scoped to the caller, mirroring the onboarding RPCs.
create or replace function public.set_my_professional_intent(value boolean)
returns void language plpgsql security definer set search_path='' as $$
declare auth_user_id uuid := (select auth.uid());
begin
  if auth_user_id is null then raise exception 'Authentication required'; end if;
  update public.users set wants_professional_account=coalesce(value,false) where id=auth_user_id;
end; $$;
revoke all on function public.set_my_professional_intent(boolean) from public;
grant execute on function public.set_my_professional_intent(boolean) to authenticated;
