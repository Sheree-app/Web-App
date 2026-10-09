-- Submit reviews through a trusted function so customer_id and professional_id
-- always come from the authenticated customer's completed booking.
create or replace function public.submit_review(
  review_booking_id uuid,
  review_rating smallint,
  review_body text
) returns public.reviews
language plpgsql
security definer
set search_path=''
as $$
declare
  booking public.bookings;
  created_review public.reviews;
begin
  if (select auth.uid()) is null then
    raise exception using errcode='42501', message='Sign in to leave a review.';
  end if;

  select * into booking
  from public.bookings
  where id=review_booking_id
    and customer_id=(select auth.uid());

  if not found then
    raise exception using errcode='42501', message='You can only review your own appointment.';
  end if;
  if booking.status<>'completed' then
    raise exception using errcode='23514', message='You can review this appointment after it is completed.';
  end if;
  if review_rating not between 1 and 5 then
    raise exception using errcode='23514', message='Choose a rating from 1 to 5.';
  end if;
  if char_length(trim(review_body)) not between 10 and 1000 then
    raise exception using errcode='23514', message='Write between 10 and 1000 characters.';
  end if;

  insert into public.reviews(booking_id,customer_id,professional_id,rating,body)
  values(booking.id,booking.customer_id,booking.professional_id,review_rating,trim(review_body))
  returning * into created_review;

  return created_review;
end
$$;

revoke all on function public.submit_review(uuid,smallint,text) from public,anon;
grant execute on function public.submit_review(uuid,smallint,text) to authenticated;

-- Direct inserts are no longer needed; all review ownership fields are derived
-- inside submit_review.
revoke insert on public.reviews from authenticated;
