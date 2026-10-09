create table public.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  push_enabled boolean not null default true,
  bookings boolean not null default true,
  messages boolean not null default true,
  activity boolean not null default true,
  offers boolean not null default false,
  quiet_hours_enabled boolean not null default false,
  quiet_from time not null default '21:00',
  quiet_until time not null default '08:00',
  updated_at timestamptz not null default now()
);
alter table public.notification_preferences enable row level security;
create policy "users manage own notification preferences" on public.notification_preferences for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
grant select,insert,update on public.notification_preferences to authenticated;

create or replace function public.notification_push_allowed(target_user uuid, notification_kind public.notification_kind)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((
    select push_enabled
      and case
        when notification_kind in ('appointment_reminder','booking','payment') then bookings
        when notification_kind='message' then messages
        when notification_kind in ('review','social') then activity
        when notification_kind='promotion' then offers
        else true
      end
      and not (
        quiet_hours_enabled and case
          when quiet_from < quiet_until then localtime >= quiet_from and localtime < quiet_until
          else localtime >= quiet_from or localtime < quiet_until
        end
      )
    from public.notification_preferences where user_id=target_user
  ),true)
$$;
revoke all on function public.notification_push_allowed(uuid,public.notification_kind) from public,anon,authenticated;

create or replace function public.notify_user(target_user uuid,notification_kind public.notification_kind,notification_title text,notification_body text,notification_url text,notification_data jsonb,notification_audience public.notification_audience)
returns uuid language plpgsql security definer set search_path='' as $$
declare new_id uuid;token record;push_data jsonb:=notification_data||jsonb_build_object('url',notification_url,'audience',notification_audience);
begin
  insert into public.notifications(user_id,kind,title,body,url,data,audience) values(target_user,notification_kind,notification_title,notification_body,notification_url,push_data,notification_audience) returning id into new_id;
  if public.notification_push_allowed(target_user,notification_kind) then
    for token in select expo_push_token from public.push_tokens where user_id=target_user and enabled loop
      perform net.http_post(url:='https://exp.host/--/api/v2/push/send',headers:='{"Content-Type":"application/json","Accept":"application/json"}'::jsonb,body:=jsonb_build_object('to',token.expo_push_token,'sound','default','channelId','sheree-updates','title',notification_title,'body',notification_body,'data',push_data||jsonb_build_object('notificationId',new_id)));
    end loop;
    update public.notifications set push_sent_at=case when exists(select 1 from public.push_tokens where user_id=target_user and enabled) then now() else null end where id=new_id;
  end if;
  return new_id;
end $$;
revoke all on function public.notify_user(uuid,public.notification_kind,text,text,text,jsonb,public.notification_audience) from public,anon,authenticated;
