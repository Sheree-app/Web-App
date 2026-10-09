-- Keep these categories and their assets available, but hide them from all
-- database-backed category pickers until their service flows are ready.
update public.interests
set is_active = false
where slug in ('fitness','tutoring','pet-grooming','home-services');
