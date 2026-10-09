insert into public.interests(name,slug,sort_order,is_active)
values ('Pedicure','pedicure',4,true)
on conflict (slug) do update
set name=excluded.name,sort_order=excluded.sort_order,is_active=true;
