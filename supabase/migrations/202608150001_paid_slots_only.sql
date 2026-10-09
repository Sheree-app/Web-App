-- Slot/day availability must only reflect confirmed payments, not temporary
-- reservation holds.
--
-- Previously a booking created by reserve_booking (payment_status='pending')
-- immediately blocked its slot for up to 15 minutes via
-- "created_at > now() - interval '15 minutes'". That meant a slot changed state
-- before the backend knew whether the payment succeeded or failed, and a
-- failed/abandoned payment could keep a slot "Booked" for up to 15 minutes
-- when the app never reached release_unpaid_booking.
--
-- Now the slot flips to Booked only when the backend marks the payment paid
-- (paystack-verify / paystack-webhook set payment_status='paid'), and it is
-- released immediately when a failed payment cancels the booking
-- (release_unpaid_booking sets status='cancelled', payment_status='failed').
--
-- reserve_booking's own conflict checks still guard against double-booking a
-- slot that is mid-payment, so no two customers can both pay for the same slot.

create or replace function public.get_booking_slots(profile_id uuid,service_id uuid,booking_date date)
returns table(slot_time text,is_available boolean,unavailable_reason text)
language sql stable security definer set search_path='' as $$
with settings as (
 select s.professional_id,s.duration_minutes,coalesce(pref.buffer_minutes,15) buffer_minutes,
        coalesce(pref.minimum_notice_hours,1) minimum_notice_hours,
        coalesce(pref.max_appointments_per_day,8) max_per_day,
        h.opens_at,h.closes_at,h.is_closed
 from public.professional_services s
 left join public.professional_schedule_preferences pref on pref.professional_id=s.professional_id
 left join public.professional_working_hours h on h.professional_id=s.professional_id and h.day_of_week=extract(dow from booking_date)
 where s.id=service_id and s.professional_id=profile_id and s.is_active
), candidates as (
 select candidate local_start,candidate+make_interval(mins=>settings.duration_minutes) local_finish,settings.*
 from settings
 cross join lateral generate_series(booking_date+settings.opens_at,booking_date+settings.closes_at-make_interval(mins=>settings.duration_minutes),interval '30 minutes') candidate
 where not coalesce(settings.is_closed,true)
), slots as (
 select i.*,i.local_start at time zone 'Africa/Accra' starts_at,i.local_finish at time zone 'Africa/Accra' ends_at
 from candidates i
), states as (
 select i.*,
  i.starts_at<=now()+make_interval(hours=>i.minimum_notice_hours) notice_short,
  exists(select 1 from public.bookings b where b.professional_id=i.professional_id and b.status in('requested','confirmed') and b.payment_status='paid' and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(i.starts_at-make_interval(mins=>i.buffer_minutes),i.ends_at+make_interval(mins=>i.buffer_minutes),'[)')) booked,
  exists(select 1 from public.professional_schedule_blocks b where b.professional_id=i.professional_id and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(i.starts_at,i.ends_at,'[)')) blocked,
  exists(select 1 from public.professional_schedule_breaks b where b.professional_id=i.professional_id and b.day_of_week=extract(dow from booking_date) and tsrange(i.local_start,i.local_finish,'[)')&&tsrange(booking_date+b.starts_at,booking_date+b.ends_at,'[)')) on_break,
  (select count(*) from public.bookings b where b.professional_id=i.professional_id and b.status in('requested','confirmed') and b.payment_status='paid' and timezone('Africa/Accra',b.starts_at)::date=booking_date)>=i.max_per_day day_full
 from slots i where i.starts_at>now()
)
select to_char(local_start,'HH24:MI'),
       not(notice_short or booked or blocked or on_break or day_full),
       case when notice_short then '1 hour notice' when booked then 'Booked' when day_full then 'Day full' when on_break then 'Break' when blocked then 'Unavailable' else null end
from states order by local_start;
$$;

revoke all on function public.get_booking_slots(uuid,uuid,date) from public;
grant execute on function public.get_booking_slots(uuid,uuid,date) to authenticated;

create or replace function public.get_booking_availability(profile_id uuid,service_id uuid,from_date date,day_count integer default 35) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 select coalesce(jsonb_agg(jsonb_build_object('date',d::date,'state',case when h.is_closed or h.id is null or exists(select 1 from public.professional_schedule_blocks b where b.professional_id=profile_id and d::date>=b.starts_at::date and d::date<b.ends_at::date) then 'closed' when (select count(*) from public.bookings bk where bk.professional_id=profile_id and bk.starts_at::date=d::date and bk.status in('requested','confirmed') and bk.payment_status='paid')>=coalesce(pref.max_appointments_per_day,8) then 'full' when (select count(*) from public.bookings bk where bk.professional_id=profile_id and bk.starts_at::date=d::date and bk.status in('requested','confirmed') and bk.payment_status='paid')>=greatest(coalesce(pref.max_appointments_per_day,8)-2,1) then 'limited' else 'available' end) order by d),'[]'::jsonb) into result
 from generate_series(from_date,from_date+least(greatest(day_count,1),62)-1,interval '1 day') d
 left join public.professional_working_hours h on h.professional_id=profile_id and h.day_of_week=extract(dow from d)
 left join public.professional_schedule_preferences pref on pref.professional_id=profile_id;
 return result;
end;$$;

revoke all on function public.get_booking_availability(uuid,uuid,date,integer) from public;
grant execute on function public.get_booking_availability(uuid,uuid,date,integer) to authenticated;
