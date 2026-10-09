-- Accounts that existed before persisted onboarding was introduced were being
-- treated as brand-new accounts on every login. Admit those legacy accounts.
update public.users
set onboarding_step='complete',onboarding_completed_at=coalesce(onboarding_completed_at,now())
where onboarding_completed_at is null;

-- New registrations explicitly opt into onboarding through auth metadata.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare requested_role public.user_role;
declare needs_onboarding boolean;
begin
  requested_role := case when new.raw_user_meta_data->>'role'='professional' then 'professional'::public.user_role else 'customer'::public.user_role end;
  needs_onboarding := coalesce((new.raw_user_meta_data->>'requires_onboarding')::boolean,false);
  insert into public.users(id,role,full_name,onboarding_step,onboarding_completed_at)
  values(
    new.id,
    requested_role,
    coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(coalesce(new.email,'Sheree member'),'@',1)),
    case when needs_onboarding then 'role_selection' else 'complete' end,
    case when needs_onboarding then null else now() end
  ) on conflict(id) do nothing;
  return new;
end;
$$;
