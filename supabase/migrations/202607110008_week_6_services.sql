-- Week 6: professional services and service photos.
create table public.professional_services (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  interest_id uuid references public.interests(id) on delete set null,
  name text not null check (char_length(name) between 2 and 120),
  description text not null check (char_length(description) between 1 and 1200),
  price numeric(10,2) not null check (price > 0),
  duration_minutes integer not null check (duration_minutes between 5 and 1440),
  deposit_percentage numeric(5,2) not null check (deposit_percentage between 0 and 100),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.service_photos (
  id uuid primary key default gen_random_uuid(),
  service_id uuid not null references public.professional_services(id) on delete cascade,
  storage_path text not null,
  alt_text text check (char_length(alt_text) <= 300),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index professional_services_profile_idx on public.professional_services(professional_id,is_active,sort_order);
create index service_photos_service_idx on public.service_photos(service_id,sort_order);
alter table public.professional_services enable row level security;
alter table public.service_photos enable row level security;
create policy "active services are public" on public.professional_services for select to anon,authenticated
  using (is_active or exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "professionals manage own services" on public.professional_services for all to authenticated
  using (exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())))
  with check (exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "service photos follow service visibility" on public.service_photos for select to anon,authenticated
  using (exists(select 1 from public.professional_services s where s.id=service_id and (s.is_active or exists(select 1 from public.professional_profiles p where p.id=s.professional_id and p.user_id=(select auth.uid())))));
create policy "professionals manage own service photos" on public.service_photos for all to authenticated
  using (exists(select 1 from public.professional_services s join public.professional_profiles p on p.id=s.professional_id where s.id=service_id and p.user_id=(select auth.uid())))
  with check (exists(select 1 from public.professional_services s join public.professional_profiles p on p.id=s.professional_id where s.id=service_id and p.user_id=(select auth.uid())));
grant select on public.professional_services,public.service_photos to anon,authenticated;
grant insert,update,delete on public.professional_services,public.service_photos to authenticated;
create trigger professional_services_set_updated_at before update on public.professional_services for each row execute function public.set_updated_at();

create or replace function public.get_professional_services(profile_id uuid)
returns table(id uuid,name text,description text,price numeric,duration_minutes integer,deposit_percentage numeric,category text,photos jsonb)
language sql stable security invoker set search_path='' as $$
  select s.id,s.name,s.description,s.price,s.duration_minutes,s.deposit_percentage,i.name,
    coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'storage_path',p.storage_path,'alt_text',p.alt_text) order by p.sort_order,p.created_at) from public.service_photos p where p.service_id=s.id),'[]'::jsonb)
  from public.professional_services s left join public.interests i on i.id=s.interest_id
  where s.professional_id=profile_id and s.is_active order by s.sort_order,s.created_at;
$$;
grant execute on function public.get_professional_services(uuid) to anon,authenticated;
