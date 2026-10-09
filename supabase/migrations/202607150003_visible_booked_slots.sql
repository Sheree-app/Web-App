drop function if exists public.get_booking_slots(uuid,uuid,date);
create function public.get_booking_slots(profile_id uuid,service_id uuid,booking_date date)
returns table(slot_time text,is_available boolean,unavailable_reason text) language sql stable security definer set search_path='' as $$
with settings as (
 select s.professional_id,s.duration_minutes,coalesce(pref.buffer_minutes,15) buffer_minutes,coalesce(pref.max_appointments_per_day,8) max_per_day,h.opens_at,h.closes_at,h.is_closed
 from public.professional_services s left join public.professional_schedule_preferences pref on pref.professional_id=s.professional_id left join public.professional_working_hours h on h.professional_id=s.professional_id and h.day_of_week=extract(dow from booking_date)
 where s.id=service_id and s.professional_id=profile_id and s.is_active
), candidates as (
 select candidate local_start,candidate+make_interval(mins=>settings.duration_minutes) local_finish,settings.* from settings cross join lateral generate_series(booking_date+settings.opens_at,booking_date+settings.closes_at-make_interval(mins=>settings.duration_minutes),interval '30 minutes') candidate where not coalesce(settings.is_closed,true)
), slots as (
 select i.*,i.local_start at time zone 'Africa/Accra' starts_at,i.local_finish at time zone 'Africa/Accra' ends_at from candidates i
), states as (
 select i.*,
  exists(select 1 from public.bookings b where b.professional_id=i.professional_id and b.status in('requested','confirmed') and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(i.starts_at-make_interval(mins=>i.buffer_minutes),i.ends_at+make_interval(mins=>i.buffer_minutes),'[)')) booked,
  exists(select 1 from public.professional_schedule_blocks b where b.professional_id=i.professional_id and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(i.starts_at,i.ends_at,'[)')) blocked,
  exists(select 1 from public.professional_schedule_breaks b where b.professional_id=i.professional_id and b.day_of_week=extract(dow from booking_date) and tsrange(i.local_start,i.local_finish,'[)')&&tsrange(booking_date+b.starts_at,booking_date+b.ends_at,'[)')) on_break,
  (select count(*) from public.bookings b where b.professional_id=i.professional_id and b.status in('requested','confirmed') and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes') and timezone('Africa/Accra',b.starts_at)::date=booking_date)>=i.max_per_day day_full
 from slots i where i.starts_at>now()
)
select to_char(local_start,'HH24:MI'),not(booked or blocked or on_break or day_full),case when booked then 'Booked' when day_full then 'Day full' when on_break then 'Break' when blocked then 'Unavailable' else null end from states order by local_start;
$$;
revoke all on function public.get_booking_slots(uuid,uuid,date) from public;
grant execute on function public.get_booking_slots(uuid,uuid,date) to authenticated;
