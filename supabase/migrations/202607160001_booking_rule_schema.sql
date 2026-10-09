-- Schema required by the mobile-aware reserve_booking function.
alter table public.professional_schedule_preferences
  add column if not exists minimum_notice_hours integer not null default 2
    check (minimum_notice_hours between 0 and 720),
  add column if not exists booking_window_days integer not null default 60
    check (booking_window_days between 1 and 730);

create table if not exists public.professional_time_off (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  label text not null default 'Time off',
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

create index if not exists professional_time_off_range_idx
  on public.professional_time_off(professional_id,starts_at,ends_at);

alter table public.professional_time_off enable row level security;

drop policy if exists "time off is public" on public.professional_time_off;
create policy "time off is public" on public.professional_time_off
  for select to anon,authenticated using (true);

drop policy if exists "professionals manage own time off" on public.professional_time_off;
create policy "professionals manage own time off" on public.professional_time_off
  for all to authenticated
  using (exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())))
  with check (exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));

grant select on public.professional_time_off to anon,authenticated;
grant insert,update,delete on public.professional_time_off to authenticated;
