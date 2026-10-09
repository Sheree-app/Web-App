alter type public.payment_status add value if not exists 'refund_pending';

alter table public.bookings
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancellation_reason text;

create or replace function public.get_professional_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pid uuid; profile_row record;
begin
  select p.id,p.business_name,p.display_name,p.profile_photo_url into profile_row from public.professional_profiles p where p.user_id=auth.uid();
  if not found then raise exception 'Professional profile required'; end if; pid:=profile_row.id;
  return jsonb_build_object(
    'profile',jsonb_build_object('name',coalesce(profile_row.display_name,profile_row.business_name),'business_name',profile_row.business_name,'avatar_url',profile_row.profile_photo_url),
    'today_count',(select count(*) from public.bookings b where b.professional_id=pid and b.starts_at::date=current_date and b.status in('requested','confirmed')),
    'upcoming_count',(select count(*) from public.bookings b where b.professional_id=pid and b.starts_at>=now() and b.status in('requested','confirmed')),
    'pending_count',(select count(*) from public.bookings b where b.professional_id=pid and b.status='requested'),
    'month_revenue',(select coalesce(sum(b.price),0) from public.bookings b where b.professional_id=pid and b.status='completed' and date_trunc('month',b.ends_at)=date_trunc('month',now())),
    'today',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'customer_name',u.full_name,'customer_avatar',u.avatar_url,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'price',b.price,'deposit_amount',b.deposit_amount,'payment_status',b.payment_status) order by b.starts_at) from public.bookings b join public.users u on u.id=b.customer_id where b.professional_id=pid and b.starts_at::date=current_date and b.status in('requested','confirmed')),'[]'::jsonb),
    'next_booking',(select jsonb_build_object('id',b.id,'customer_name',u.full_name,'customer_avatar',u.avatar_url,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'price',b.price,'deposit_amount',b.deposit_amount,'payment_status',b.payment_status) from public.bookings b join public.users u on u.id=b.customer_id where b.professional_id=pid and b.starts_at>=now() and b.status in('requested','confirmed') order by b.starts_at limit 1)
  );
end;$$;

do $$ begin
  alter publication supabase_realtime add table public.bookings;
exception when duplicate_object then null;
end $$;
