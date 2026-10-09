insert into public.interests(name,slug,sort_order,is_active)
values('Piercings','piercings',16,true)
on conflict(slug) do update set name=excluded.name,sort_order=excluded.sort_order,is_active=true;

create or replace function public.complete_customer_onboarding(interest_slugs text[])
returns void language plpgsql security definer set search_path='' as $$
declare auth_user_id uuid := (select auth.uid());
begin
  if auth_user_id is null then raise exception 'Authentication required'; end if;
  delete from public.user_interests where user_id=auth_user_id;
  update public.users
  set role='customer',onboarding_step='complete',onboarding_completed_at=now()
  where id=auth_user_id;
end; $$;

revoke all on function public.complete_customer_onboarding(text[]) from public;
grant execute on function public.complete_customer_onboarding(text[]) to authenticated;
