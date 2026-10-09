-- The region-deposit migration rebuilt reserve_booking without including the
-- profile-owned cancellation policy in svc, while still reading that field.
create or replace function public.reserve_booking(service_id uuid,starts_at timestamptz,notes text default null,mobile_service boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare svc record; pref record; hours record; booking_id uuid; finish timestamptz; buffered_start timestamptz; buffered_finish timestamptz; customer uuid:=(select auth.uid()); local_start timestamp; local_finish timestamp; selected_travel_fee numeric(10,2):=0; requires_deposit boolean;
begin
 if customer is null then raise exception 'Authentication required';end if;
 select s.*,p.offers_mobile_service,p.mobile_service_fee,p.country_code,p.cancellation_policy into svc from public.professional_services s join public.professional_profiles p on p.id=s.professional_id where s.id=$1 and s.is_active;
 if svc.id is null then raise exception 'Service unavailable';end if;
 if $4 and not svc.offers_mobile_service then raise exception 'Mobile service is unavailable';end if;
 if $4 then selected_travel_fee:=coalesce(svc.mobile_service_fee,0);end if;
 requires_deposit:=coalesce(svc.country_code,'GH')='GH';
 select b.id into booking_id from public.bookings b where b.customer_id=customer and b.service_id=$1 and b.starts_at=$2 and ((requires_deposit and b.payment_status='pending' and b.created_at>now()-interval '15 minutes') or (not requires_deposit and b.payment_status='paid')) order by b.created_at desc limit 1;
 if booking_id is not null then return booking_id;end if;
 select * into pref from public.professional_schedule_preferences p where p.professional_id=svc.professional_id;
 local_start:=timezone('Africa/Accra',$2);finish:=$2+make_interval(mins=>svc.duration_minutes);local_finish:=timezone('Africa/Accra',finish);
 if $2<=now()+make_interval(hours=>coalesce(pref.minimum_notice_hours,2)) then raise exception 'This time is too close to book';end if;
 if $2>now()+make_interval(days=>coalesce(pref.booking_window_days,60)) then raise exception 'This date is outside the booking window';end if;
 select * into hours from public.professional_working_hours h where h.professional_id=svc.professional_id and h.day_of_week=extract(dow from local_start);
 if hours.id is null or hours.is_closed or local_start::time<hours.opens_at or local_finish::time>hours.closes_at then raise exception 'Outside working hours';end if;
 if exists(select 1 from public.professional_time_off t where t.professional_id=svc.professional_id and tstzrange(t.starts_at,t.ends_at,'[)')&&tstzrange($2,finish,'[)')) then raise exception 'Professional is away at that time';end if;
 if exists(select 1 from public.professional_schedule_breaks b where b.professional_id=svc.professional_id and b.day_of_week=extract(dow from local_start) and tsrange(local_start,local_finish,'[)')&&tsrange(local_start::date+b.starts_at,local_start::date+b.ends_at,'[)')) then raise exception 'That time overlaps a scheduled break';end if;
 if (select count(*) from public.bookings b where b.professional_id=svc.professional_id and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes') and timezone('Africa/Accra',b.starts_at)::date=local_start::date and b.status in('requested','confirmed'))>=coalesce(pref.max_appointments_per_day,8) then raise exception 'That day is fully booked';end if;
 buffered_start:=$2-make_interval(mins=>coalesce(pref.buffer_minutes,15));buffered_finish:=finish+make_interval(mins=>coalesce(pref.buffer_minutes,15));
 if exists(select 1 from public.bookings b where b.professional_id=svc.professional_id and b.status in('requested','confirmed') and (b.payment_status='paid' or b.created_at>now()-interval '15 minutes') and tstzrange(b.starts_at,b.ends_at,'[)')&&tstzrange(buffered_start,buffered_finish,'[)')) then raise exception 'That time was just booked';end if;
 insert into public.bookings(customer_id,professional_id,service_id,starts_at,ends_at,status,service_name,price,deposit_amount,balance_amount,payment_status,deposit_paid_at,notes,cancellation_policy,is_mobile_service,travel_fee)
 values(customer,svc.professional_id,svc.id,$2,finish,case when coalesce(pref.approval_mode,'automatic')='manual' then 'requested'::public.booking_status else 'confirmed'::public.booking_status end,svc.name,svc.price,case when requires_deposit then round(svc.price*svc.deposit_percentage/100,2)+selected_travel_fee else 0 end,case when requires_deposit then round(svc.price-(svc.price*svc.deposit_percentage/100),2) else svc.price+selected_travel_fee end,'pending'::public.payment_status,null,nullif(trim($3),''),svc.cancellation_policy,$4,selected_travel_fee) returning id into booking_id;
 if not requires_deposit then
   update public.bookings set payment_status='paid',deposit_paid_at=now() where id=booking_id;
 end if;
 return booking_id;
end $$;

revoke all on function public.reserve_booking(uuid,timestamptz,text,boolean) from public;
grant execute on function public.reserve_booking(uuid,timestamptz,text,boolean) to authenticated;
