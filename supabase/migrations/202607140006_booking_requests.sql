create or replace function public.get_professional_booking_requests() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'customer_name',u.full_name,'service_name',b.service_name,'starts_at',b.starts_at,'deposit_amount',b.deposit_amount,'payment_status',b.payment_status) order by b.starts_at),'[]'::jsonb)
from public.bookings b join public.users u on u.id=b.customer_id join public.professional_profiles p on p.id=b.professional_id
where p.user_id=auth.uid() and b.status='requested' and b.starts_at>=now();
$$;
revoke all on function public.get_professional_booking_requests() from public;
grant execute on function public.get_professional_booking_requests() to authenticated;
