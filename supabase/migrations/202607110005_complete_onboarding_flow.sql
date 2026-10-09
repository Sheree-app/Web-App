-- Atomically finish onboarding so routing never observes a half-created profile.
create or replace function public.complete_customer_onboarding(interest_slugs text[])
returns void language plpgsql security definer set search_path='' as $$
declare auth_user_id uuid := (select auth.uid());
begin
  if auth_user_id is null then raise exception 'Authentication required'; end if;
  if coalesce(array_length(interest_slugs,1),0)=0 then raise exception 'Choose at least one interest'; end if;
  delete from public.user_interests where user_id=auth_user_id;
  insert into public.user_interests(user_id,interest_id)
    select auth_user_id,i.id from public.interests i where i.slug=any(interest_slugs) and i.is_active;
  if not found then raise exception 'No valid interests selected'; end if;
  update public.users set role='customer',onboarding_step='complete',onboarding_completed_at=now() where id=auth_user_id;
end; $$;

create or replace function public.complete_professional_onboarding(category_slug text,business_name_value text,display_name_value text,bio_value text,years_experience_value integer,business_address_value text,travel_radius_value numeric,offers_mobile_value boolean,deposit_value numeric,cancellation_policy_value text,open_day_numbers integer[],instagram_url_value text default null)
returns void language plpgsql security definer set search_path='' as $$
declare auth_user_id uuid := (select auth.uid()); profile_id uuid; category_id uuid;
begin
  if auth_user_id is null then raise exception 'Authentication required'; end if;
  if char_length(trim(business_name_value))<1 or char_length(trim(display_name_value))<1 then raise exception 'Business and display names are required'; end if;
  select id into category_id from public.interests where slug=category_slug and is_active;
  if category_id is null then raise exception 'Choose a valid category'; end if;
  insert into public.professional_profiles(user_id,business_name,display_name,bio,years_experience,business_address,location,travel_radius_km,offers_mobile_service,deposit_percentage,cancellation_policy,onboarding_completed_at)
  values(auth_user_id,trim(business_name_value),trim(display_name_value),nullif(trim(bio_value),''),years_experience_value,nullif(trim(business_address_value),''),nullif(trim(business_address_value),''),case when offers_mobile_value then travel_radius_value else null end,offers_mobile_value,deposit_value,nullif(trim(cancellation_policy_value),''),now())
  on conflict(user_id) do update set business_name=excluded.business_name,display_name=excluded.display_name,bio=excluded.bio,years_experience=excluded.years_experience,business_address=excluded.business_address,location=excluded.location,travel_radius_km=excluded.travel_radius_km,offers_mobile_service=excluded.offers_mobile_service,deposit_percentage=excluded.deposit_percentage,cancellation_policy=excluded.cancellation_policy,onboarding_completed_at=now()
  returning id into profile_id;
  delete from public.professional_categories where professional_id=profile_id;
  insert into public.professional_categories(professional_id,interest_id,is_primary) values(profile_id,category_id,true);
  delete from public.professional_working_hours where professional_id=profile_id;
  insert into public.professional_working_hours(professional_id,day_of_week,opens_at,closes_at,is_closed)
    select profile_id,d,case when d=any(open_day_numbers) then '09:00'::time end,case when d=any(open_day_numbers) then '18:00'::time end,not(d=any(open_day_numbers)) from generate_series(0,6) d;
  delete from public.professional_social_links where professional_id=profile_id and platform='instagram';
  if instagram_url_value is not null then insert into public.professional_social_links(professional_id,platform,url) values(profile_id,'instagram',instagram_url_value); end if;
  update public.users set role='professional',onboarding_step='complete',onboarding_completed_at=now() where id=auth_user_id;
end; $$;
revoke all on function public.complete_customer_onboarding(text[]) from public;
revoke all on function public.complete_professional_onboarding(text,text,text,text,integer,text,numeric,boolean,numeric,text,integer[],text) from public;
grant execute on function public.complete_customer_onboarding(text[]) to authenticated;
grant execute on function public.complete_professional_onboarding(text,text,text,text,integer,text,numeric,boolean,numeric,text,integer[],text) to authenticated;
