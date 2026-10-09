-- Week 5: customer-facing professional profiles and follow relationships.
create table public.professional_follows (
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (professional_id,user_id)
);

create index professional_follows_professional_idx on public.professional_follows(professional_id);
alter table public.professional_follows enable row level security;
create policy "follows are publicly countable" on public.professional_follows for select to anon,authenticated using (true);
create policy "customers manage own follows" on public.professional_follows for all to authenticated
  using (user_id=(select auth.uid())) with check (user_id=(select auth.uid()));
grant select on public.professional_follows to anon,authenticated;
grant insert,delete on public.professional_follows to authenticated;

create or replace function public.get_professional_profile(profile_id uuid)
returns table(
  id uuid,business_name text,display_name text,bio text,location text,is_verified boolean,
  profile_photo_url text,cover_image_url text,years_experience smallint,
  follower_count bigint,is_following boolean,portfolio jsonb
) language sql stable security invoker set search_path='' as $$
  select p.id,p.business_name,p.display_name,p.bio,p.location,p.is_verified,
    p.profile_photo_url,p.cover_image_url,p.years_experience,
    (select count(*) from public.professional_follows f where f.professional_id=p.id),
    exists(select 1 from public.professional_follows f where f.professional_id=p.id and f.user_id=(select auth.uid())),
    coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'storage_path',i.storage_path,'caption',i.caption,'sort_order',i.sort_order
    ) order by i.sort_order,i.created_at) from public.professional_portfolio_items i where i.professional_id=p.id),'[]'::jsonb)
  from public.professional_profiles p where p.id=profile_id;
$$;
grant execute on function public.get_professional_profile(uuid) to anon,authenticated;
