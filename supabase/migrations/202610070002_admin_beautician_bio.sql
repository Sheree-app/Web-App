-- Lets administrators correct a beautician's public bio (for example a typo or
-- unwanted copy). Permission-gated and recorded in the admin audit log.

create or replace function public.set_admin_beautician_bio(
  beautician_id uuid,
  bio text,
  reason text
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  target record;
  clean_bio text := nullif(trim(coalesce(bio, '')), '');
  clean_reason text := trim(coalesce(reason, ''));
begin
  if not public.admin_has_permission('users.manage') then
    raise exception 'User management access required' using errcode='42501';
  end if;
  if char_length(clean_reason) < 5 then
    raise exception 'A reason of at least 5 characters is required';
  end if;
  -- Mirrors the professional_profiles_bio_length constraint.
  if clean_bio is not null and char_length(clean_bio) > 100 then
    raise exception 'A bio can be at most 100 characters';
  end if;

  select p.id, coalesce(nullif(p.display_name, ''), p.business_name) name, p.bio previous_bio
    into target
  from public.professional_profiles p
  where p.id=beautician_id for update;
  if not found then raise exception 'Beautician not found' using errcode='P0002'; end if;

  update public.professional_profiles
  set bio=clean_bio, updated_at=now()
  where id=beautician_id;

  insert into public.admin_audit_logs(actor_id, action, resource_type, resource_id, summary, metadata)
  values (
    (select auth.uid()),
    'beautician.bio_updated',
    'beautician',
    beautician_id,
    'Updated bio for ' || target.name,
    jsonb_build_object('reason', clean_reason, 'previous_bio', target.previous_bio, 'new_bio', clean_bio)
  );

  return jsonb_build_object('id', beautician_id, 'bio', clean_bio);
end;
$$;

revoke all on function public.set_admin_beautician_bio(uuid, text, text) from public, anon;

grant execute on function public.set_admin_beautician_bio(uuid, text, text) to authenticated;
