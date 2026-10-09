create or replace function public.get_professional_booking_requests() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'booking_reference',b.booking_reference,'customer_name',u.full_name,'service_name',b.service_name,'starts_at',b.starts_at,'deposit_amount',b.deposit_amount,'payment_status',b.payment_status) order by b.starts_at),'[]'::jsonb)
from public.bookings b join public.users u on u.id=b.customer_id join public.professional_profiles p on p.id=b.professional_id
where p.user_id=auth.uid() and b.status='requested' and b.starts_at>=now();
$$;
revoke all on function public.get_professional_booking_requests() from public;
grant execute on function public.get_professional_booking_requests() to authenticated;

create or replace function public.get_professional_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pid uuid; result jsonb;
begin
 select id into pid from public.professional_profiles where user_id=auth.uid(); if pid is null then raise exception 'Professional profile required'; end if;
 select jsonb_build_object(
  'profile',(select jsonb_build_object('name',coalesce(p.display_name,p.business_name),'business_name',p.business_name,'avatar_url',p.profile_photo_url) from public.professional_profiles p where p.id=pid),
  'today_count',(select count(*) from public.bookings b where b.professional_id=pid and b.starts_at::date=current_date and b.status in('requested','confirmed')),
  'upcoming_count',(select count(*) from public.bookings b where b.professional_id=pid and b.starts_at>=now() and b.status in('requested','confirmed')),
  'pending_count',(select count(*) from public.bookings b where b.professional_id=pid and b.status='requested'),
  'month_revenue',(select coalesce(sum(b.price),0) from public.bookings b where b.professional_id=pid and b.status='completed' and date_trunc('month',b.ends_at)=date_trunc('month',now())),
  'today',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'booking_reference',b.booking_reference,'customer_name',u.full_name,'customer_avatar',u.avatar_url,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'payment_status',b.payment_status,'price',b.price,'deposit_amount',b.deposit_amount) order by b.starts_at) from public.bookings b join public.users u on u.id=b.customer_id where b.professional_id=pid and b.starts_at::date=current_date and b.status in('requested','confirmed')),'[]'::jsonb),
  'next_booking',(select jsonb_build_object('id',b.id,'booking_reference',b.booking_reference,'customer_name',u.full_name,'customer_avatar',u.avatar_url,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'payment_status',b.payment_status,'price',b.price,'deposit_amount',b.deposit_amount) from public.bookings b join public.users u on u.id=b.customer_id where b.professional_id=pid and b.starts_at>=now() and b.status in('requested','confirmed') order by b.starts_at limit 1)
 ) into result; return result;
end;$$;
revoke all on function public.get_professional_dashboard() from public;
grant execute on function public.get_professional_dashboard() to authenticated;
