-- Enforce this invariant for every booking write path, including trusted RPCs.
create or replace function public.prevent_self_booking()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  if exists (
    select 1
    from public.professional_profiles p
    where p.id=new.professional_id
      and p.user_id=new.customer_id
  ) then
    raise exception using
      errcode='23514',
      message='You cannot book your own service.';
  end if;
  return new;
end
$$;

drop trigger if exists prevent_self_booking on public.bookings;
create trigger prevent_self_booking
before insert or update of customer_id,professional_id on public.bookings
for each row execute function public.prevent_self_booking();
