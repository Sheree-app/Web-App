create table public.notification_segments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  rules jsonb not null default '{}'::jsonb,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.notification_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  title text not null,
  body text not null,
  channels text[] not null check (
    cardinality(channels) > 0 and
    channels <@ array['push','email','sms','in_app']::text[]
  ),
  audience text not null check (audience in ('everyone','customers','professionals','segment')),
  segment_id uuid references public.notification_segments(id) on delete set null,
  promotion_id uuid references public.promotion_campaigns(id) on delete set null,
  destination_url text,
  banner_image_url text,
  status text not null default 'draft' check (status in ('draft','scheduled','processing','sent','cancelled','failed')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  recipient_count integer not null default 0,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (audience <> 'segment' or segment_id is not null)
);
create index notification_campaigns_schedule_idx on public.notification_campaigns(status,scheduled_at);
create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.notification_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  channel text not null check (channel in ('push','email','sms','in_app')),
  status text not null default 'queued' check (status in ('queued','sending','delivered','failed','skipped')),
  provider_id text,
  error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  unique(campaign_id,user_id,channel)
);
create index notification_deliveries_queue_idx on public.notification_deliveries(status,channel,created_at);
alter table public.notification_segments enable row level security;
alter table public.notification_campaigns enable row level security;
alter table public.notification_deliveries enable row level security;
create policy "notification admins manage segments" on public.notification_segments for all to authenticated
  using (public.admin_has_permission('notifications.manage'))
  with check (public.admin_has_permission('notifications.manage'));
create policy "notification admins manage campaigns" on public.notification_campaigns for all to authenticated
  using (public.admin_has_permission('notifications.manage'))
  with check (public.admin_has_permission('notifications.manage'));
create policy "notification admins read deliveries" on public.notification_deliveries for select to authenticated
  using (public.admin_has_permission('notifications.manage'));
create or replace function public.notification_campaign_users(target_audience text, target_segment uuid default null)
returns table(user_id uuid, role public.user_role)
language plpgsql stable security definer set search_path = ''
as $$
declare segment_rules jsonb;
begin
  if not public.admin_has_permission('notifications.manage')
     and current_setting('role',true) <> 'service_role' then
    raise exception 'Notifications access required' using errcode='42501';
  end if;
  if target_audience='segment' then
    select rules into segment_rules from public.notification_segments where id=target_segment;
  end if;
  return query
  select u.id,u.role
  from public.users u
  left join public.professional_profiles p on p.user_id=u.id
  where
    (target_audience='everyone')
    or (target_audience='customers' and u.role='customer')
    or (target_audience='professionals' and u.role='professional')
    or (
      target_audience='segment'
      and (not (segment_rules ? 'role') or u.role::text=segment_rules->>'role')
      and (not (segment_rules ? 'verified') or coalesce(p.is_verified,false)=(segment_rules->>'verified')::boolean)
      and (not (segment_rules ? 'location') or coalesce(p.location,'') ilike '%'||(segment_rules->>'location')||'%')
      and (
        not (segment_rules ? 'inactive_days')
        or greatest(
          coalesce((select max(b.created_at) from public.bookings b where b.customer_id=u.id),u.created_at),
          coalesce((select max(n.created_at) from public.notifications n where n.user_id=u.id),u.created_at)
        ) < now()-make_interval(days=>(segment_rules->>'inactive_days')::integer)
      )
    );
end;
$$;
create or replace function public.get_admin_notification_center()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.admin_has_permission('notifications.manage') then
    raise exception 'Notifications access required' using errcode='42501';
  end if;
  select jsonb_build_object(
    'campaigns',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',c.id,'name',c.name,'title',c.title,'body',c.body,'channels',c.channels,
        'audience',c.audience,'segment',s.name,'promotion',p.name,'status',c.status,
        'scheduled_at',c.scheduled_at,'sent_at',c.sent_at,'recipients',c.recipient_count,
        'delivered',c.delivered_count,'failed',c.failed_count,'created_at',c.created_at
      ) order by c.created_at desc)
      from public.notification_campaigns c
      left join public.notification_segments s on s.id=c.segment_id
      left join public.promotion_campaigns p on p.id=c.promotion_id
    ),'[]'::jsonb),
    'segments',coalesce((
      select jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'rules',s.rules) order by s.name)
      from public.notification_segments s
    ),'[]'::jsonb),
    'promotions',coalesce((
      select jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.name)
      from public.promotion_campaigns p where p.status in ('draft','scheduled','active')
    ),'[]'::jsonb),
    'summary',jsonb_build_object(
      'scheduled',(select count(*) from public.notification_campaigns where status='scheduled'),
      'sent',(select count(*) from public.notification_campaigns where status='sent'),
      'delivered',(select coalesce(sum(delivered_count),0) from public.notification_campaigns),
      'failed',(select coalesce(sum(failed_count),0) from public.notification_campaigns)
    )
  ) into result;
  return result;
end;
$$;
create or replace function public.admin_save_notification_segment(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  if not public.admin_has_permission('notifications.manage') then
    raise exception 'Notifications access required' using errcode='42501';
  end if;
  insert into public.notification_segments(name,description,rules,created_by)
  values(trim(payload->>'name'),nullif(trim(payload->>'description'),''),coalesce(payload->'rules','{}'::jsonb),(select auth.uid()))
  returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id);
end;
$$;
create or replace function public.admin_save_notification_campaign(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare new_id uuid; send_at timestamptz; campaign_status text;
begin
  if not public.admin_has_permission('notifications.manage') then
    raise exception 'Notifications access required' using errcode='42501';
  end if;
  send_at := nullif(payload->>'scheduled_at','')::timestamptz;
  campaign_status := case when (payload->>'send_now')::boolean then 'scheduled' when send_at is not null then 'scheduled' else 'draft' end;
  insert into public.notification_campaigns(
    name,title,body,channels,audience,segment_id,promotion_id,destination_url,banner_image_url,
    status,scheduled_at,created_by
  ) values(
    trim(payload->>'name'),trim(payload->>'title'),trim(payload->>'body'),
    array(select jsonb_array_elements_text(payload->'channels')),payload->>'audience',
    nullif(payload->>'segment_id','')::uuid,nullif(payload->>'promotion_id','')::uuid,
    nullif(payload->>'destination_url',''),nullif(payload->>'banner_image_url',''),
    campaign_status,case when (payload->>'send_now')::boolean then now() else send_at end,(select auth.uid())
  ) returning id into new_id;
  return jsonb_build_object('ok',true,'id',new_id,'status',campaign_status);
end;
$$;
create or replace function public.claim_due_notification_campaigns(batch_size integer default 10)
returns setof public.notification_campaigns
language plpgsql security definer set search_path = ''
as $$
begin
  if current_setting('role',true) <> 'service_role' then
    raise exception 'Service role required' using errcode='42501';
  end if;
  return query
  update public.notification_campaigns c set status='processing',updated_at=now()
  where c.id in (
    select x.id from public.notification_campaigns x
    where x.status='scheduled' and x.scheduled_at<=now()
    order by x.scheduled_at for update skip locked limit batch_size
  )
  returning c.*;
end;
$$;
create or replace function public.admin_cancel_notification_campaign(target_campaign_id uuid)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.admin_has_permission('notifications.manage') then
    raise exception 'Notifications access required' using errcode='42501';
  end if;
  update public.notification_campaigns set status='cancelled',updated_at=now()
  where id=target_campaign_id and status in ('draft','scheduled');
  return jsonb_build_object('ok',found);
end;
$$;
grant select,insert,update,delete on public.notification_segments,public.notification_campaigns to authenticated;
grant select on public.notification_deliveries to authenticated;
grant execute on function public.notification_campaign_users(text,uuid),
  public.get_admin_notification_center(),public.admin_save_notification_segment(jsonb),
  public.admin_save_notification_campaign(jsonb),public.admin_cancel_notification_campaign(uuid) to authenticated;
revoke all on function public.claim_due_notification_campaigns(integer) from public,anon,authenticated;
grant execute on function public.claim_due_notification_campaigns(integer),
  public.notification_campaign_users(text,uuid),
  public.notification_push_allowed(uuid,public.notification_kind) to service_role;
grant all on public.notification_campaigns,public.notification_deliveries,
  public.notification_segments to service_role;
