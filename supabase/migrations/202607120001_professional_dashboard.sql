create or replace function public.get_professional_dashboard() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pid uuid; result jsonb;
begin
  select id into pid from public.professional_profiles where user_id=(select auth.uid());
  if pid is null then raise exception 'Professional profile required'; end if;
  select jsonb_build_object(
    'profile',(select jsonb_build_object('name',coalesce(p.display_name,p.business_name),'business_name',p.business_name,'avatar_url',p.profile_photo_url) from public.professional_profiles p where p.id=pid),
    'today_count',(select count(*) from public.bookings b where b.professional_id=pid and b.starts_at::date=current_date and b.status in('requested','confirmed')),
    'upcoming_count',(select count(*) from public.bookings b where b.professional_id=pid and b.starts_at>=now() and b.status in('requested','confirmed')),
    'pending_count',(select count(*) from public.bookings b where b.professional_id=pid and b.status='requested'),
    'month_revenue',(select coalesce(sum(b.price),0) from public.bookings b where b.professional_id=pid and b.status='completed' and date_trunc('month',b.ends_at)=date_trunc('month',now())),
    'today',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'customer_name',u.full_name,'customer_avatar',u.avatar_url,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'price',b.price) order by b.starts_at) from public.bookings b join public.users u on u.id=b.customer_id where b.professional_id=pid and b.starts_at::date=current_date and b.status in('requested','confirmed')),'[]'::jsonb),
    'next_booking',(select jsonb_build_object('id',b.id,'customer_name',u.full_name,'customer_avatar',u.avatar_url,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'price',b.price) from public.bookings b join public.users u on u.id=b.customer_id where b.professional_id=pid and b.starts_at>=now() and b.status in('requested','confirmed') order by b.starts_at limit 1)
  ) into result;
  return result;
end;$$;
revoke all on function public.get_professional_dashboard() from public;
grant execute on function public.get_professional_dashboard() to authenticated;
