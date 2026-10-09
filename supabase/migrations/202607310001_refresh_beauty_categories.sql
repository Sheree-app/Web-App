-- Keep the public taxonomy focused on the categories offered at launch while
-- preserving IDs (and therefore existing services/posts) wherever possible.
update public.interests set name='Wig installs', slug='wig-installs', sort_order=1, is_active=true where slug='hair';
update public.interests set name='Barbering', sort_order=2, is_active=true where slug='barbering';
update public.interests set name='Braids', sort_order=3, is_active=true where slug='braids';
update public.interests set name='Manicures', slug='manicures', sort_order=4, is_active=true where slug='nails';
update public.interests set name='Pedicures', slug='pedicures', sort_order=5, is_active=true where slug='pedicure';
update public.interests set name='Makeup', sort_order=6, is_active=true where slug='makeup';
update public.interests set name='Spa (massage)', sort_order=7, is_active=true where slug='spa';
update public.interests set name='Facials', slug='facials', sort_order=8, is_active=true where slug='skincare';
update public.interests set name='Lashes', sort_order=9, is_active=true where slug='lashes';
update public.interests set name='Tattoos', sort_order=11, is_active=true where slug='tattoos';
update public.interests set name='Piercings', sort_order=12, is_active=true where slug='piercings';
update public.interests set name='Photography', sort_order=14, is_active=true where slug='photography';

insert into public.interests(name,slug,sort_order,is_active) values
  ('Eyebrows','eyebrows',10,true),
  ('Locs','locs',13,true)
on conflict (slug) do update set
  name=excluded.name,
  sort_order=excluded.sort_order,
  is_active=true;

-- Massage is now represented by Spa (massage). Move linked content before
-- retiring the duplicate category, avoiding duplicate many-to-many rows.
delete from public.user_interests old_link
using public.interests old_interest, public.interests spa_interest
where old_interest.slug='massage'
  and spa_interest.slug='spa'
  and old_link.interest_id=old_interest.id
  and exists (
    select 1 from public.user_interests spa_link
    where spa_link.user_id=old_link.user_id and spa_link.interest_id=spa_interest.id
  );

delete from public.professional_categories old_link
using public.interests old_interest, public.interests spa_interest
where old_interest.slug='massage'
  and spa_interest.slug='spa'
  and old_link.interest_id=old_interest.id
  and exists (
    select 1 from public.professional_categories spa_link
    where spa_link.professional_id=old_link.professional_id and spa_link.interest_id=spa_interest.id
  );

update public.user_interests set interest_id=(select id from public.interests where slug='spa')
where interest_id=(select id from public.interests where slug='massage');
update public.professional_categories set interest_id=(select id from public.interests where slug='spa')
where interest_id=(select id from public.interests where slug='massage');
update public.professional_services set interest_id=(select id from public.interests where slug='spa')
where interest_id=(select id from public.interests where slug='massage');
update public.feed_posts set interest_id=(select id from public.interests where slug='spa')
where interest_id=(select id from public.interests where slug='massage');

update public.interests
set is_active=false
where slug not in (
  'wig-installs','barbering','braids','manicures','pedicures','makeup','spa',
  'facials','lashes','eyebrows','tattoos','piercings','locs','photography'
);
