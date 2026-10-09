-- Availability must be enforced where a booking is reserved, not only in the UI.
insert into public.professional_schedule_preferences(professional_id)
select id from public.professional_profiles on conflict(professional_id) do nothing;

insert into public.professional_working_hours(professional_id,day_of_week,opens_at,closes_at,is_closed)
select p.id,d.day,case when d.day=0 then null else '09:00'::time end,case when d.day=0 then null else '18:00'::time end,d.day=0
from public.professional_profiles p cross join generate_series(0,6) d(day)
on conflict(professional_id,day_of_week) do nothing;

create or replace function public.reserve_booking(service_id uuid,starts_at timestamptz,notes text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare svc record; pref record; hours record; booking_id uuid; finish timestamptz; buffered_start timestamptz; buffered_finish timestamptz; customer uuid:=(select auth.uid()); local_start timestamp; local_finish timestamp;
begin
 if customer is null then raise exception 'Authentication required'; end if;
 select s.*,p.cancellation_policy into svc from public.professional_services s join public.professional_profiles p on p.id=s.professional_id where s.id=$1 and s.is_active;
 if not found then raise exception 'Service unavailable'; end if;
 finish:=$2+make_interval(mins=>svc.duration_minutes); local_start:=timezone('Africa/Accra',$2); local_finish:=timezone('Africa/Accra',finish);
 select * into pref from public.professional_schedule_preferences where professional_id=svc.professional_id;
 select * into hours from public.professional_working_hours where professional_id=svc.professional_id and day_of_week=extract(dow from local_start);
 if $2<now() then raise exception 'Choose a future time'; end if;
 if hours.id is null or hours.is_closed or local_start::date<>local_finish::date or local_start::time<hours.opens_at or local_finish::time>hours.closes_at then raise exception 'That time is outside the professional''s working hours'; end if;
 if exists(select 1 from public.professional_schedule_blocks b where b.professional_id=svc.professional_id and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange($2,finish,'[)')) then raise exception 'The professional is away at that time'; end if;
 if exists(select 1 from public.professional_schedule_breaks b where b.professional_id=svc.professional_id and b.day_of_week=extract(dow from local_start) and tsrange(local_start,local_finish,'[)')&&tsrange(local_start::date+b.starts_at,local_start::date+b.ends_at,'[)')) then raise exception 'That time overlaps a scheduled break'; end if;
 if (select count(*) from public.bookings b where b.professional_id=svc.professional_id and timezone('Africa/Accra',b.starts_at)::date=local_start::date and b.status in('requested','confirmed'))>=coalesce(pref.max_appointments_per_day,8) then raise exception 'That day is fully booked'; end if;
 buffered_start:=$2-make_interval(mins=>coalesce(pref.buffer_minutes,15)); buffered_finish:=finish+make_interval(mins=>coalesce(pref.buffer_minutes,15));
 if exists(select 1 from public.bookings b where b.professional_id=svc.professional_id and b.status in('requested','confirmed') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(buffered_start,buffered_finish,'[)')) then raise exception 'That time is too close to another appointment'; end if;
 insert into public.bookings(customer_id,professional_id,service_id,starts_at,ends_at,status,service_name,price,deposit_amount,balance_amount,notes,cancellation_policy)
 values(customer,svc.professional_id,svc.id,$2,finish,case when coalesce(pref.approval_mode,'automatic')='manual' then 'requested'::public.booking_status else 'confirmed'::public.booking_status end,svc.name,svc.price,round(svc.price*svc.deposit_percentage/100,2),round(svc.price-(svc.price*svc.deposit_percentage/100),2),nullif(trim($3),''),svc.cancellation_policy) returning id into booking_id;
 return booking_id;
end;$$;

revoke all on function public.reserve_booking(uuid,timestamptz,text) from public;
grant execute on function public.reserve_booking(uuid,timestamptz,text) to authenticated;
