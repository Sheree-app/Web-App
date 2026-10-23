alter table public.feed_posts add column if not exists service_id uuid references public.professional_services(id) on delete set null;
create index if not exists feed_posts_service_id_idx on public.feed_posts(service_id) where service_id is not null;
