-- Lets administrators correct the categories attached to a beautician's profile,
-- e.g. a professional who mistakenly selected "Pedicures" instead of "Manicures".
-- Both reads and writes are permission-gated, and every change is audited.

create or replace function public.get_admin_beautician_categories(beautician_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
begin
  if not public.admin_has_permission('users.read') then
    raise exception 'User directory access required' using errcode='42501';
  end if;
  if not exists (select 1 from public.professional_profiles p where p.id=beautician_id) then
    raise exception 'Beautician not found' using errcode='P0002';
  end if;

  return jsonb_build_object(
    -- Offer every launched category, plus any category the professional already
    -- holds (even if it was retired later) so nothing is silently dropped.
    'available', coalesce((
      select jsonb_agg(jsonb_build_object(
          'id', i.id, 'name', i.name, 'slug', i.slug, 'is_active', i.is_active)
        order by i.sort_order, i.name)
      from public.interests i
      where i.is_active
        or exists (
          select 1 from public.professional_categories pc
          where pc.professional_id=beautician_id and pc.interest_id=i.id
        )
    ), '[]'::jsonb),
    'selected', coalesce((
      select jsonb_agg(pc.interest_id)
      from public.professional_categories pc
      where pc.professional_id=beautician_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.set_admin_beautician_categories(
  beautician_id uuid,
  category_ids uuid[],
  reason text
)
returns jsonb
language plpgsql security definer set search_path=''
as $$
declare
  target record;
  clean_reason text := trim(coalesce(reason, ''));
  requested uuid[];
  unavailable uuid[];
  previous_names text[];
  new_names text[];
  kept_primary uuid;
begin
  if not public.admin_has_permission('users.manage') then
    raise exception 'User management access required' using errcode='42501';
  end if;
  if char_length(clean_reason) < 5 then
    raise exception 'A reason of at least 5 characters is required';
  end if;

  select array_agg(distinct x) into requested from unnest(coalesce(category_ids, array[]::uuid[])) x;
  if requested is null or array_length(requested, 1) is null then
    raise exception 'Select at least one category';
  end if;

  select p.id, coalesce(nullif(p.display_name, ''), p.business_name) name into target
  from public.professional_profiles p where p.id=beautician_id;
  if not found then raise exception 'Beautician not found' using errcode='P0002'; end if;

  -- A category is acceptable when it is launched, or already attached (so an
  -- inactive-but-existing category can be kept without being force-removed).
  select array_agg(x) into unavailable
  from unnest(requested) x
  where not exists (
    select 1 from public.interests i
    where i.id=x and (i.is_active or exists (
      select 1 from public.professional_categories pc
      where pc.professional_id=beautician_id and pc.interest_id=x
    ))
  );
  if unavailable is not null then
    raise exception 'One or more selected categories are unavailable';
  end if;

  select coalesce(array_agg(i.name order by i.name), array[]::text[]) into previous_names
  from public.professional_categories pc
  join public.interests i on i.id=pc.interest_id
  where pc.professional_id=beautician_id;

  -- Preserve the existing primary category when it survives the edit.
  select pc.interest_id into kept_primary
  from public.professional_categories pc
  where pc.professional_id=beautician_id and pc.is_primary
    and pc.interest_id = any(requested);

  delete from public.professional_categories pc
  where pc.professional_id=beautician_id
    and not (pc.interest_id = any(requested));

  if kept_primary is null then
    update public.professional_categories set is_primary=false
    where professional_id=beautician_id and is_primary;
  end if;

  insert into public.professional_categories(professional_id, interest_id, is_primary)
  select beautician_id, x, false from unnest(requested) x
  on conflict (professional_id, interest_id) do nothing;

  -- Exactly one primary category is required per professional.
  if not exists (
    select 1 from public.professional_categories pc
    where pc.professional_id=beautician_id and pc.is_primary
  ) then
    update public.professional_categories pc
    set is_primary=true
    where pc.professional_id=beautician_id
      and pc.interest_id = (
        select pc2.interest_id
        from public.professional_categories pc2
        join public.interests i on i.id=pc2.interest_id
        where pc2.professional_id=beautician_id
        order by i.sort_order, i.name
        limit 1
      );
  end if;

  select coalesce(array_agg(i.name order by i.name), array[]::text[]) into new_names
  from public.professional_categories pc
  join public.interests i on i.id=pc.interest_id
  where pc.professional_id=beautician_id;

  insert into public.admin_audit_logs(actor_id, action, resource_type, resource_id, summary, metadata)
  values (
    (select auth.uid()),
    'beautician.categories_updated',
    'beautician',
    beautician_id,
    'Updated categories for ' || target.name,
    jsonb_build_object('reason', clean_reason, 'previous_categories', previous_names, 'new_categories', new_names)
  );

  return jsonb_build_object(
    'id', beautician_id,
    'categories', new_names,
    'category_ids', to_jsonb(requested)
  );
end;
$$;

revoke all on function public.get_admin_beautician_categories(uuid),
  public.set_admin_beautician_categories(uuid, uuid[], text)
  from public, anon;

grant execute on function public.get_admin_beautician_categories(uuid),
  public.set_admin_beautician_categories(uuid, uuid[], text)
  to authenticated;
