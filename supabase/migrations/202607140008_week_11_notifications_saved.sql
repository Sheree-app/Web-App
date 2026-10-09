create type public.notification_kind as enum ('appointment_reminder','message','booking','payment','review','promotion','social');

create table public.push_tokens (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  expo_push_token text not null, platform text not null check (platform in ('ios','android')),
  device_name text, enabled boolean not null default true, last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(), unique(user_id,expo_push_token)
);
create table public.notifications (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  kind public.notification_kind not null, title text not null, body text not null, url text,
  data jsonb not null default '{}'::jsonb, read_at timestamptz, push_sent_at timestamptz,
  push_error text, created_at timestamptz not null default now()
);
create index notifications_user_created_idx on public.notifications(user_id,created_at desc);

create table public.saved_collections (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 40), cover_url text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,name)
);
create table public.saved_collection_items (
  collection_id uuid not null references public.saved_collections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_type text not null check(item_type in ('professional','post','look')),
  item_id uuid not null, created_at timestamptz not null default now(),
  primary key(collection_id,item_type,item_id)
);

alter table public.push_tokens enable row level security;
alter table public.notifications enable row level security;
alter table public.saved_collections enable row level security;
alter table public.saved_collection_items enable row level security;
create policy "users manage own push tokens" on public.push_tokens for all using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy "users read own notifications" on public.notifications for select using(user_id=(select auth.uid()));
create policy "users update own notifications" on public.notifications for update using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy "users manage own collections" on public.saved_collections for all using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create policy "users manage own collection items" on public.saved_collection_items for all using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()) and exists(select 1 from public.saved_collections c where c.id=collection_id and c.user_id=(select auth.uid())));

create or replace function public.notify_user(target_user uuid, notification_kind public.notification_kind, notification_title text, notification_body text, notification_url text default null, notification_data jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path='' as $$ declare new_id uuid; begin
  insert into public.notifications(user_id,kind,title,body,url,data) values(target_user,notification_kind,notification_title,notification_body,notification_url,notification_data) returning id into new_id; return new_id;
end $$;
revoke all on function public.notify_user(uuid,public.notification_kind,text,text,text,jsonb) from public,anon,authenticated;

create or replace function public.week11_booking_notification() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.status is distinct from old.status then
    perform public.notify_user(new.customer_id,'booking',
      case new.status when 'confirmed' then 'You''re booked, lovely! ✨' when 'cancelled' then 'A little booking update' else 'Your booking has an update' end,
      case new.status when 'confirmed' then 'Your beauty appointment is officially in the diary.' when 'cancelled' then 'This appointment was cancelled. Let''s find you another perfect time.' else 'Tap to see the latest details.' end,
      '/bookings',jsonb_build_object('bookingId',new.id));
  end if; return new;
end $$;
create trigger week11_booking_notification after update of status on public.bookings for each row execute function public.week11_booking_notification();

grant select,insert,update,delete on public.push_tokens,public.saved_collections,public.saved_collection_items to authenticated;
grant select,update on public.notifications to authenticated;
