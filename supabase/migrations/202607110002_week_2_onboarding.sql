-- Week 2: normalized onboarding data and storage security.
create type public.verification_document_type as enum ('identity','business_registration','professional_certificate','other');
create type public.verification_status as enum ('pending','under_review','approved','rejected');
create type public.social_platform as enum ('instagram','tiktok','facebook','x','youtube','website','other');

alter table public.users
  add column onboarding_step text not null default 'role_selection',
  add column onboarding_completed_at timestamptz;

alter table public.interests
  add column image_url text,
  add column sort_order integer not null default 0,
  add column is_active boolean not null default true;

alter table public.professional_profiles
  add column display_name text check (char_length(display_name) between 1 and 120),
  add column profile_photo_url text,
  add column cover_image_url text,
  add column years_experience smallint check (years_experience between 0 and 80),
  add column business_address text,
  add column travel_radius_km numeric(6,2) check (travel_radius_km between 0 and 1000),
  add column offers_mobile_service boolean not null default false,
  add column deposit_percentage numeric(5,2) not null default 50 check (deposit_percentage between 0 and 100),
  add column cancellation_policy text check (char_length(cancellation_policy) <= 3000),
  add column onboarding_completed_at timestamptz;

create table public.user_interests (
  user_id uuid not null references public.users(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, interest_id)
);

create table public.professional_categories (
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  interest_id uuid not null references public.interests(id) on delete restrict,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (professional_id, interest_id)
);
create unique index professional_categories_one_primary
  on public.professional_categories(professional_id) where is_primary;

create table public.professional_working_hours (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  opens_at time,
  closes_at time,
  is_closed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (professional_id, day_of_week),
  check ((is_closed and opens_at is null and closes_at is null) or
         (not is_closed and opens_at is not null and closes_at is not null and opens_at < closes_at))
);

create table public.professional_social_links (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  platform public.social_platform not null,
  url text not null check (url ~ '^https?://'),
  created_at timestamptz not null default now(),
  unique (professional_id, platform)
);

create table public.professional_portfolio_items (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  storage_path text not null,
  caption text check (char_length(caption) <= 500),
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table public.professional_verification_documents (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  document_type public.verification_document_type not null,
  storage_path text not null,
  status public.verification_status not null default 'pending',
  rejection_reason text,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (professional_id, document_type)
);

alter table public.user_interests enable row level security;
alter table public.professional_categories enable row level security;
alter table public.professional_working_hours enable row level security;
alter table public.professional_social_links enable row level security;
alter table public.professional_portfolio_items enable row level security;
alter table public.professional_verification_documents enable row level security;

create policy "users manage own interests" on public.user_interests for all to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "professional categories are public" on public.professional_categories for select to anon,authenticated using (true);
create policy "professionals manage own categories" on public.professional_categories for all to authenticated
  using (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())))
  with check (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "working hours are public" on public.professional_working_hours for select to anon,authenticated using (true);
create policy "professionals manage own working hours" on public.professional_working_hours for all to authenticated
  using (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())))
  with check (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "social links are public" on public.professional_social_links for select to anon,authenticated using (true);
create policy "professionals manage own social links" on public.professional_social_links for all to authenticated
  using (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())))
  with check (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "portfolio is public" on public.professional_portfolio_items for select to anon,authenticated using (true);
create policy "professionals manage own portfolio" on public.professional_portfolio_items for all to authenticated
  using (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())))
  with check (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "professionals read own verification documents" on public.professional_verification_documents for select to authenticated
  using (exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "professionals submit own verification documents" on public.professional_verification_documents for insert to authenticated
  with check (status='pending' and exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "professionals delete pending verification documents" on public.professional_verification_documents for delete to authenticated
  using (status='pending' and exists (select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));

create trigger professional_working_hours_set_updated_at before update on public.professional_working_hours
  for each row execute function public.set_updated_at();

revoke all on public.user_interests,public.professional_categories,public.professional_working_hours,public.professional_social_links,public.professional_portfolio_items,public.professional_verification_documents from anon,authenticated;
grant select,insert,update,delete on public.user_interests to authenticated;
grant select on public.professional_categories,public.professional_working_hours,public.professional_social_links,public.professional_portfolio_items to anon,authenticated;
grant insert,update,delete on public.professional_categories,public.professional_working_hours,public.professional_social_links,public.professional_portfolio_items to authenticated;
grant select,insert,delete on public.professional_verification_documents to authenticated;
grant update(onboarding_step,onboarding_completed_at) on public.users to authenticated;
grant update(display_name,profile_photo_url,cover_image_url,years_experience,business_address,travel_radius_km,offers_mobile_service,deposit_percentage,cancellation_policy,onboarding_completed_at) on public.professional_profiles to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('profile-media','profile-media',true,10485760,array['image/jpeg','image/png','image/webp']),
       ('verification-documents','verification-documents',false,10485760,array['image/jpeg','image/png','application/pdf'])
on conflict (id) do nothing;

create policy "profile media is public" on storage.objects for select to public using (bucket_id='profile-media');
create policy "users upload own profile media" on storage.objects for insert to authenticated
  with check (bucket_id='profile-media' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "users update own profile media" on storage.objects for update to authenticated
  using (bucket_id='profile-media' and owner_id=(select auth.uid())::text)
  with check (bucket_id='profile-media' and owner_id=(select auth.uid())::text);
create policy "users delete own profile media" on storage.objects for delete to authenticated
  using (bucket_id='profile-media' and owner_id=(select auth.uid())::text);
create policy "users read own verification files" on storage.objects for select to authenticated
  using (bucket_id='verification-documents' and owner_id=(select auth.uid())::text);
create policy "users upload own verification files" on storage.objects for insert to authenticated
  with check (bucket_id='verification-documents' and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy "users delete own verification files" on storage.objects for delete to authenticated
  using (bucket_id='verification-documents' and owner_id=(select auth.uid())::text);

insert into public.interests(name,slug,sort_order) values
  ('Braids','braids',4),('Lashes','lashes',5),('Massage','massage',7),('Spa','spa',8),
  ('Photography','photography',10),('Fitness','fitness',11),('Tutoring','tutoring',12),
  ('Pet Grooming','pet-grooming',13),('Home Services','home-services',14),('Tattoos','tattoos',15),('Other','other',99)
on conflict (slug) do update set sort_order=excluded.sort_order;
