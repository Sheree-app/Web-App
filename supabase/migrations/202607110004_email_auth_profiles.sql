-- Create the app profile at auth sign-up, including email-confirmation flows.
create or replace function public.handle_new_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
declare requested_role public.user_role;
begin
  requested_role := case when new.raw_user_meta_data->>'role'='professional' then 'professional'::public.user_role else 'customer'::public.user_role end;
  insert into public.users(id,role,full_name)
  values(new.id,requested_role,coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'),''),split_part(coalesce(new.email,'Sheree member'),'@',1)))
  on conflict(id) do nothing;
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

-- Repair accounts created before this trigger existed.
insert into public.users(id,role,full_name)
select au.id,
  case when au.raw_user_meta_data->>'role'='professional' then 'professional'::public.user_role else 'customer'::public.user_role end,
  coalesce(nullif(trim(au.raw_user_meta_data->>'full_name'),''),split_part(coalesce(au.email,'Sheree member'),'@',1))
from auth.users au
on conflict(id) do nothing;
