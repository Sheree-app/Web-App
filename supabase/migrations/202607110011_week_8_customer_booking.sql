-- Week 8: customer booking records and collision-safe reservation RPCs.
create type public.booking_status as enum('requested','confirmed','cancelled','completed');
create type public.payment_status as enum('pending','paid','failed','refunded');
create table public.bookings(
 id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.users(id) on delete restrict,
 professional_id uuid not null references public.professional_profiles(id) on delete restrict,service_id uuid not null references public.professional_services(id) on delete restrict,
 starts_at timestamptz not null,ends_at timestamptz not null,status public.booking_status not null,
 service_name text not null,price numeric(10,2) not null,deposit_amount numeric(10,2) not null,balance_amount numeric(10,2) not null,payment_status public.payment_status not null default 'pending',
 notes text,cancellation_policy text,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),check(starts_at<ends_at)
);
create index bookings_professional_time_idx on public.bookings(professional_id,starts_at,ends_at) where status in('requested','confirmed');create index bookings_customer_idx on public.bookings(customer_id,starts_at desc);
alter table public.bookings enable row level security;
create policy "customers read own bookings" on public.bookings for select to authenticated using(customer_id=(select auth.uid()));
create policy "professionals read their bookings" on public.bookings for select to authenticated using(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
grant select on public.bookings to authenticated;create trigger bookings_set_updated_at before update on public.bookings for each row execute function public.set_updated_at();

create or replace function public.get_booking_availability(profile_id uuid,service_id uuid,from_date date,day_count integer default 35) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('date',d::date,'state',case when h.is_closed or h.id is null or exists(select 1 from public.professional_schedule_blocks b where b.professional_id=profile_id and d::date>=b.starts_at::date and d::date<b.ends_at::date) then 'closed' when (select count(*) from public.bookings bk where bk.professional_id=profile_id and bk.starts_at::date=d::date and bk.status in('requested','confirmed'))>=coalesce(pref.max_appointments_per_day,8) then 'full' when (select count(*) from public.bookings bk where bk.professional_id=profile_id and bk.starts_at::date=d::date and bk.status in('requested','confirmed'))>=greatest(coalesce(pref.max_appointments_per_day,8)-2,1) then 'limited' else 'available' end) order by d),'[]'::jsonb) into result
 from generate_series(from_date,from_date+least(greatest(day_count,1),62)-1,interval '1 day') d
 left join public.professional_working_hours h on h.professional_id=profile_id and h.day_of_week=extract(dow from d)
 left join public.professional_schedule_preferences pref on pref.professional_id=profile_id;
 return result;
end;$$;

create or replace function public.reserve_booking(service_id uuid,starts_at timestamptz,notes text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare svc record; pref record; booking_id uuid; finish timestamptz; customer uuid:=(select auth.uid());
begin
 if customer is null then raise exception 'Authentication required';end if;select s.*,p.cancellation_policy into svc from public.professional_services s join public.professional_profiles p on p.id=s.professional_id where s.id=service_id and s.is_active;if not found then raise exception 'Service unavailable';end if;
 finish:=starts_at+make_interval(mins=>svc.duration_minutes);select * into pref from public.professional_schedule_preferences where professional_id=svc.professional_id;
 if starts_at<now() then raise exception 'Choose a future time';end if;if exists(select 1 from public.bookings b where b.professional_id=svc.professional_id and b.status in('requested','confirmed') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(starts_at,finish,'[)')) then raise exception 'That time was just booked';end if;
 insert into public.bookings(customer_id,professional_id,service_id,starts_at,ends_at,status,service_name,price,deposit_amount,balance_amount,notes,cancellation_policy)
 values(customer,svc.professional_id,svc.id,starts_at,finish,case when coalesce(pref.approval_mode,'automatic')='manual' then 'requested' else 'confirmed' end,svc.name,svc.price,round(svc.price*svc.deposit_percentage/100,2),round(svc.price-(svc.price*svc.deposit_percentage/100),2),nullif(trim(notes),''),svc.cancellation_policy) returning id into booking_id;return booking_id;
end;$$;
revoke all on function public.get_booking_availability(uuid,uuid,date,integer) from public;revoke all on function public.reserve_booking(uuid,timestamptz,text) from public;grant execute on function public.get_booking_availability(uuid,uuid,date,integer) to authenticated;grant execute on function public.reserve_booking(uuid,timestamptz,text) to authenticated;
