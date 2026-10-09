-- Return bookable start times using the same constraints enforced by reserve_booking.
create or replace function public.get_booking_slots(profile_id uuid, service_id uuid, booking_date date)
returns table(slot_time text) language sql stable security definer set search_path='' as $$
with settings as (
  select s.professional_id,s.duration_minutes,coalesce(pref.buffer_minutes,15) buffer_minutes,coalesce(pref.max_appointments_per_day,8) max_per_day,h.opens_at,h.closes_at,h.is_closed
  from public.professional_services s
  left join public.professional_schedule_preferences pref on pref.professional_id=s.professional_id
  left join public.professional_working_hours h on h.professional_id=s.professional_id and h.day_of_week=extract(dow from booking_date)
  where s.id=service_id and s.professional_id=profile_id and s.is_active
), candidates as (
  select candidate local_start, candidate+make_interval(mins=>settings.duration_minutes) local_finish,settings.*
  from settings cross join lateral generate_series(booking_date+settings.opens_at,booking_date+settings.closes_at-make_interval(mins=>settings.duration_minutes),interval '30 minutes') candidate
  where not coalesce(settings.is_closed,true)
), instants as (
  select *,local_start at time zone 'Africa/Accra' starts_at,local_finish at time zone 'Africa/Accra' ends_at from candidates
)
select to_char(i.local_start,'HH24:MI')
from instants i
where i.starts_at>now()
and not exists(select 1 from public.professional_schedule_blocks b where b.professional_id=i.professional_id and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(i.starts_at,i.ends_at,'[)'))
and not exists(select 1 from public.professional_schedule_breaks b where b.professional_id=i.professional_id and b.day_of_week=extract(dow from booking_date) and tsrange(i.local_start,i.local_finish,'[)')&&tsrange(booking_date+b.starts_at,booking_date+b.ends_at,'[)'))
and (select count(*) from public.bookings b where b.professional_id=i.professional_id and b.status in('requested','confirmed') and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes') and timezone('Africa/Accra',b.starts_at)::date=booking_date)<i.max_per_day
and not exists(select 1 from public.bookings b where b.professional_id=i.professional_id and b.status in('requested','confirmed') and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(i.starts_at-make_interval(mins=>i.buffer_minutes),i.ends_at+make_interval(mins=>i.buffer_minutes),'[)'))
order by i.local_start;
$$;
revoke all on function public.get_booking_slots(uuid,uuid,date) from public;
grant execute on function public.get_booking_slots(uuid,uuid,date) to authenticated;

create or replace function public.reserve_booking(service_id uuid,starts_at timestamptz,notes text default null) returns uuid
language plpgsql security definer set search_path='' as $$
declare svc record; pref record; hours record; booking_id uuid; finish timestamptz; buffered_start timestamptz; buffered_finish timestamptz; customer uuid:=(select auth.uid()); local_start timestamp; local_finish timestamp;
begin
 if customer is null then raise exception 'Authentication required'; end if;
 select s.*,p.cancellation_policy into svc from public.professional_services s join public.professional_profiles p on p.id=s.professional_id where s.id=$1 and s.is_active;
 if not found then raise exception 'Service unavailable'; end if;
 finish:=$2+make_interval(mins=>svc.duration_minutes); local_start:=timezone('Africa/Accra',$2); local_finish:=timezone('Africa/Accra',finish);
 select b.id into booking_id from public.bookings b where b.customer_id=customer and b.service_id=$1 and b.starts_at=$2 and b.payment_status='pending' and b.created_at>now()-interval '15 minutes' order by b.created_at desc limit 1;
 if booking_id is not null then return booking_id; end if;
 select * into pref from public.professional_schedule_preferences where professional_id=svc.professional_id;
 select * into hours from public.professional_working_hours where professional_id=svc.professional_id and day_of_week=extract(dow from local_start);
 if $2<now() then raise exception 'Choose a future time'; end if;
 if hours.id is null or hours.is_closed or local_start::date<>local_finish::date or local_start::time<hours.opens_at or local_finish::time>hours.closes_at then raise exception 'That time is outside the professional''s working hours'; end if;
 if exists(select 1 from public.professional_schedule_blocks b where b.professional_id=svc.professional_id and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange($2,finish,'[)')) then raise exception 'The professional is away at that time'; end if;
 if exists(select 1 from public.professional_schedule_breaks b where b.professional_id=svc.professional_id and b.day_of_week=extract(dow from local_start) and tsrange(local_start,local_finish,'[)')&&tsrange(local_start::date+b.starts_at,local_start::date+b.ends_at,'[)')) then raise exception 'That time overlaps a scheduled break'; end if;
 if (select count(*) from public.bookings b where b.professional_id=svc.professional_id and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes') and timezone('Africa/Accra',b.starts_at)::date=local_start::date and b.status in('requested','confirmed'))>=coalesce(pref.max_appointments_per_day,8) then raise exception 'That day is fully booked'; end if;
 buffered_start:=$2-make_interval(mins=>coalesce(pref.buffer_minutes,15)); buffered_finish:=finish+make_interval(mins=>coalesce(pref.buffer_minutes,15));
 if exists(select 1 from public.bookings b where b.professional_id=svc.professional_id and b.status in('requested','confirmed') and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(buffered_start,buffered_finish,'[)')) then raise exception 'That time was just booked'; end if;
 insert into public.bookings(customer_id,professional_id,service_id,starts_at,ends_at,status,service_name,price,deposit_amount,balance_amount,notes,cancellation_policy)
 values(customer,svc.professional_id,svc.id,$2,finish,case when coalesce(pref.approval_mode,'automatic')='manual' then 'requested'::public.booking_status else 'confirmed'::public.booking_status end,svc.name,svc.price,round(svc.price*svc.deposit_percentage/100,2),round(svc.price-(svc.price*svc.deposit_percentage/100),2),nullif(trim($3),''),svc.cancellation_policy) returning id into booking_id;
 return booking_id;
end;$$;
revoke all on function public.reserve_booking(uuid,timestamptz,text) from public;
grant execute on function public.reserve_booking(uuid,timestamptz,text) to authenticated;
