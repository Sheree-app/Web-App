alter table public.reviews
  add column if not exists moderation_status text not null default 'published'
    check (moderation_status in ('published','flagged','removed')),
  add column if not exists flag_reason text,
  add column if not exists professional_response text,
  add column if not exists responded_at timestamptz,
  add column if not exists moderated_at timestamptz,
  add column if not exists moderated_by uuid references auth.users(id);
create table public.review_flags (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null references public.reviews(id) on delete cascade,
  reporter_id uuid references public.users(id) on delete set null,
  reason text not null,
  source text not null default 'user' check (source in ('user','automated','admin')),
  status text not null default 'open' check (status in ('open','dismissed','actioned')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id)
);
create index review_flags_queue_idx on public.review_flags(status,created_at desc);
create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_number bigint generated always as identity unique,
  requester_id uuid not null references public.users(id) on delete restrict,
  booking_id uuid references public.bookings(id) on delete set null,
  kind text not null default 'support' check (kind in ('support','complaint','report')),
  subject text not null,
  description text not null,
  status text not null default 'open' check (status in ('open','in_progress','waiting','resolved','closed')),
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  assigned_to uuid references auth.users(id),
  escalated_at timestamptz,
  escalation_reason text,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_queue_idx on public.support_tickets(status,priority,created_at desc);
create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (char_length(trim(body)) between 1 and 4000),
  internal boolean not null default false,
  created_at timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages(ticket_id,created_at);
create table public.promotion_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  campaign_type text not null check (campaign_type in ('coupon','referral','banner','sponsored')),
  status text not null default 'draft' check (status in ('draft','scheduled','active','paused','ended')),
  audience text not null default 'everyone',
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references public.promotion_campaigns(id) on delete cascade,
  code text not null unique check (code = upper(code)),
  discount_type text not null check (discount_type in ('percent','fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  minimum_spend numeric(12,2) not null default 0,
  usage_limit integer check (usage_limit is null or usage_limit > 0),
  per_user_limit integer not null default 1 check (per_user_limit > 0),
  usage_count integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.referral_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null unique references public.promotion_campaigns(id) on delete cascade,
  advocate_reward numeric(12,2) not null default 0,
  friend_reward numeric(12,2) not null default 0,
  successful_referrals integer not null default 0,
  reward_cap numeric(12,2)
);
create table public.sponsored_listings (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns(id) on delete cascade,
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  placement text not null default 'featured_salons',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(campaign_id,professional_id,placement)
);
create table public.promotion_banners (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.promotion_campaigns(id) on delete cascade,
  title text not null,
  subtitle text,
  image_url text not null,
  destination_url text,
  placement text not null default 'home',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
alter table public.review_flags enable row level security;
alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
alter table public.promotion_campaigns enable row level security;
alter table public.coupons enable row level security;
alter table public.referral_campaigns enable row level security;
alter table public.sponsored_listings enable row level security;
alter table public.promotion_banners enable row level security;
drop policy if exists "reviews are publicly readable" on public.reviews;
create policy "published reviews are publicly readable" on public.reviews for select to anon,authenticated
  using (
    moderation_status = 'published'
    or public.admin_has_permission('reviews.manage')
    or customer_id = (select auth.uid())
  );
create policy "review admins manage flags" on public.review_flags for all to authenticated
  using (public.admin_has_permission('reviews.manage'))
  with check (public.admin_has_permission('reviews.manage'));
create policy "users flag reviews" on public.review_flags for insert to authenticated
  with check (reporter_id = (select auth.uid()) and source = 'user' and status = 'open');
create policy "support admins manage tickets" on public.support_tickets for all to authenticated
  using (public.admin_has_permission('support.manage'))
  with check (public.admin_has_permission('support.manage'));
create policy "requesters read tickets" on public.support_tickets for select to authenticated
  using (requester_id = (select auth.uid()));
create policy "requesters create tickets" on public.support_tickets for insert to authenticated
  with check (requester_id = (select auth.uid()));
create policy "support participants read messages" on public.support_messages for select to authenticated
  using (
    public.admin_has_permission('support.manage')
    or exists (
      select 1 from public.support_tickets t
      where t.id = ticket_id and t.requester_id = (select auth.uid()) and not internal
    )
  );
create policy "support participants create messages" on public.support_messages for insert to authenticated
  with check (
    author_id = (select auth.uid()) and (
      public.admin_has_permission('support.manage')
      or exists (select 1 from public.support_tickets t where t.id = ticket_id and t.requester_id = (select auth.uid()) and not internal)
    )
  );
create policy "promotion admins manage campaigns" on public.promotion_campaigns for all to authenticated
  using (public.admin_has_permission('promotions.manage'))
  with check (public.admin_has_permission('promotions.manage'));
create policy "promotion admins manage coupons" on public.coupons for all to authenticated
  using (public.admin_has_permission('promotions.manage'))
  with check (public.admin_has_permission('promotions.manage'));
create policy "promotion admins manage referrals" on public.referral_campaigns for all to authenticated
  using (public.admin_has_permission('promotions.manage'))
  with check (public.admin_has_permission('promotions.manage'));
create policy "promotion admins manage sponsors" on public.sponsored_listings for all to authenticated
  using (public.admin_has_permission('promotions.manage'))
  with check (public.admin_has_permission('promotions.manage'));
create policy "promotion admins manage banners" on public.promotion_banners for all to authenticated
  using (public.admin_has_permission('promotions.manage'))
  with check (public.admin_has_permission('promotions.manage'));
create or replace function public.get_admin_reviews(queue_filter text default 'flagged')
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.admin_has_permission('reviews.manage') then
    raise exception 'Reviews access required' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'reviews', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',r.id,'rating',r.rating,'body',r.body,'status',r.moderation_status,
        'flag_reason',r.flag_reason,'response',r.professional_response,'created_at',r.created_at,
        'customer',u.full_name,'professional',coalesce(p.display_name,p.business_name),
        'professional_id',p.id,'flags',(select count(*) from public.review_flags f where f.review_id=r.id and f.status='open')
      ) order by r.created_at desc)
      from public.reviews r
      join public.users u on u.id=r.customer_id
      join public.professional_profiles p on p.id=r.professional_id
      where queue_filter='all'
         or (queue_filter='flagged' and (r.moderation_status='flagged' or exists(select 1 from public.review_flags f where f.review_id=r.id and f.status='open')))
         or (queue_filter='removed' and r.moderation_status='removed')
         or (queue_filter='responses' and r.professional_response is not null)
    ),'[]'::jsonb),
    'low_rated', coalesce((
      select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'rating',x.rating,'reviews',x.reviews))
      from (
        select p.id,coalesce(p.display_name,p.business_name) name,round(avg(r.rating),2) rating,count(*) reviews
        from public.reviews r join public.professional_profiles p on p.id=r.professional_id
        where r.moderation_status='published'
        group by p.id,p.display_name,p.business_name having count(*) >= 2 and avg(r.rating) < 3.5
        order by avg(r.rating),count(*) desc limit 20
      ) x
    ),'[]'::jsonb),
    'average_rating',(select coalesce(round(avg(rating),2),0) from public.reviews where moderation_status='published'),
    'flagged_count',(select count(*) from public.reviews r where r.moderation_status='flagged' or exists(select 1 from public.review_flags f where f.review_id=r.id and f.status='open'))
  ) into result;
  return result;
end;
$$;
create or replace function public.admin_moderate_review(target_review_id uuid, moderation_action text, reason text default null)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare new_status text;
begin
  if not public.admin_has_permission('reviews.manage') then raise exception 'Reviews access required' using errcode='42501'; end if;
  if moderation_action not in ('remove','restore','dismiss','remove_response') then raise exception 'Unsupported action'; end if;
  if moderation_action='remove' and char_length(trim(coalesce(reason,''))) < 5 then raise exception 'A removal reason is required'; end if;
  if moderation_action='remove_response' then
    update public.reviews set professional_response=null,responded_at=null,moderated_at=now(),moderated_by=(select auth.uid())
    where id=target_review_id;
    return jsonb_build_object('ok',true,'status','response_removed');
  end if;
  new_status := case when moderation_action='remove' then 'removed' else 'published' end;
  update public.reviews set moderation_status=new_status,flag_reason=case when moderation_action='remove' then reason else null end,
    moderated_at=now(),moderated_by=(select auth.uid()) where id=target_review_id;
  update public.review_flags set status=case when moderation_action='remove' then 'actioned' else 'dismissed' end,
    resolved_at=now(),resolved_by=(select auth.uid()) where review_id=target_review_id and status='open';
  return jsonb_build_object('ok',true,'status',new_status);
end;
$$;
create or replace function public.get_admin_support()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501'; end if;
  select jsonb_build_object(
    'tickets',coalesce((select jsonb_agg(jsonb_build_object(
      'id',t.id,'number',t.ticket_number,'subject',t.subject,'description',t.description,'kind',t.kind,
      'status',t.status,'priority',t.priority,'requester',u.full_name,'escalated_at',t.escalated_at,
      'updated_at',t.updated_at,'message_count',(select count(*) from public.support_messages m where m.ticket_id=t.id)
    ) order by t.updated_at desc) from public.support_tickets t join public.users u on u.id=t.requester_id),'[]'::jsonb),
    'open',(select count(*) from public.support_tickets where status in ('open','in_progress','waiting')),
    'urgent',(select count(*) from public.support_tickets where priority='urgent' and status not in ('resolved','closed')),
    'escalated',(select count(*) from public.support_tickets where escalated_at is not null and status not in ('resolved','closed'))
  ) into result;
  return result;
end;
$$;
create or replace function public.get_admin_support_ticket(target_ticket_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501'; end if;
  select jsonb_build_object(
    'ticket',to_jsonb(t),
    'requester',jsonb_build_object('id',u.id,'name',u.full_name,'phone',u.phone),
    'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'body',m.body,'internal',m.internal,'created_at',m.created_at,'author_id',m.author_id) order by m.created_at) from public.support_messages m where m.ticket_id=t.id),'[]'::jsonb)
  ) into result from public.support_tickets t join public.users u on u.id=t.requester_id where t.id=target_ticket_id;
  return result;
end;
$$;
create or replace function public.admin_update_support_ticket(target_ticket_id uuid, ticket_status text default null, ticket_priority text default null, escalate_reason text default null, message_body text default null, is_internal boolean default false)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501'; end if;
  update public.support_tickets set
    status=coalesce(ticket_status,status),priority=coalesce(ticket_priority,priority),
    escalated_at=case when escalate_reason is not null then now() else escalated_at end,
    escalation_reason=coalesce(escalate_reason,escalation_reason),
    resolved_at=case when ticket_status in ('resolved','closed') then now() when ticket_status is not null then null else resolved_at end,
    assigned_to=coalesce(assigned_to,(select auth.uid())),updated_at=now()
  where id=target_ticket_id;
  if nullif(trim(coalesce(message_body,'')),'') is not null then
    insert into public.support_messages(ticket_id,author_id,body,internal) values(target_ticket_id,(select auth.uid()),trim(message_body),is_internal);
  end if;
  return jsonb_build_object('ok',true);
end;
$$;
create or replace function public.get_admin_promotions()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if not public.admin_has_permission('promotions.manage') then raise exception 'Promotions access required' using errcode='42501'; end if;
  select jsonb_build_object(
    'campaigns',coalesce((select jsonb_agg(jsonb_build_object(
      'id',c.id,'name',c.name,'type',c.campaign_type,'status',c.status,'audience',c.audience,
      'starts_at',c.starts_at,'ends_at',c.ends_at,
      'coupon',(select to_jsonb(x) from public.coupons x where x.campaign_id=c.id limit 1),
      'referral',(select to_jsonb(x) from public.referral_campaigns x where x.campaign_id=c.id limit 1),
      'sponsors',(select count(*) from public.sponsored_listings x where x.campaign_id=c.id),
      'banners',(select count(*) from public.promotion_banners x where x.campaign_id=c.id)
    ) order by c.created_at desc) from public.promotion_campaigns c),'[]'::jsonb),
    'professionals',coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'name',coalesce(p.display_name,p.business_name)) order by coalesce(p.display_name,p.business_name)) from public.professional_profiles p where p.is_verified),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
create or replace function public.admin_save_promotion(payload jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare campaign_id uuid; campaign_type text; detail jsonb;
begin
  if not public.admin_has_permission('promotions.manage') then raise exception 'Promotions access required' using errcode='42501'; end if;
  campaign_type := payload->>'type';
  insert into public.promotion_campaigns(name,campaign_type,status,audience,starts_at,ends_at,created_by)
  values(payload->>'name',campaign_type,coalesce(payload->>'status','draft'),coalesce(payload->>'audience','everyone'),
    nullif(payload->>'starts_at','')::timestamptz,nullif(payload->>'ends_at','')::timestamptz,(select auth.uid()))
  returning id into campaign_id;
  detail := coalesce(payload->'detail','{}'::jsonb);
  if campaign_type='coupon' then
    insert into public.coupons(campaign_id,code,discount_type,discount_value,minimum_spend,usage_limit,per_user_limit)
    values(campaign_id,upper(detail->>'code'),coalesce(detail->>'discount_type','percent'),(detail->>'discount_value')::numeric,
      coalesce((detail->>'minimum_spend')::numeric,0),nullif(detail->>'usage_limit','')::integer,coalesce((detail->>'per_user_limit')::integer,1));
  elsif campaign_type='referral' then
    insert into public.referral_campaigns(campaign_id,advocate_reward,friend_reward,reward_cap)
    values(campaign_id,coalesce((detail->>'advocate_reward')::numeric,0),coalesce((detail->>'friend_reward')::numeric,0),nullif(detail->>'reward_cap','')::numeric);
  elsif campaign_type='sponsored' then
    insert into public.sponsored_listings(campaign_id,professional_id,placement)
    values(campaign_id,(detail->>'professional_id')::uuid,coalesce(detail->>'placement','featured_salons'));
  elsif campaign_type='banner' then
    insert into public.promotion_banners(campaign_id,title,subtitle,image_url,destination_url,placement)
    values(campaign_id,detail->>'title',detail->>'subtitle',detail->>'image_url',detail->>'destination_url',coalesce(detail->>'placement','home'));
  end if;
  return jsonb_build_object('ok',true,'id',campaign_id);
end;
$$;
create or replace function public.admin_set_promotion_status(target_campaign_id uuid, new_status text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  if not public.admin_has_permission('promotions.manage') then raise exception 'Promotions access required' using errcode='42501'; end if;
  update public.promotion_campaigns set status=new_status,updated_at=now() where id=target_campaign_id;
  return jsonb_build_object('ok',true);
end;
$$;
grant select,insert,update on public.review_flags,public.support_tickets,public.support_messages,
  public.promotion_campaigns,public.coupons,public.referral_campaigns,public.sponsored_listings,public.promotion_banners to authenticated;
grant usage,select on sequence public.support_tickets_ticket_number_seq to authenticated;
grant execute on function public.get_admin_reviews(text),public.admin_moderate_review(uuid,text,text),
  public.get_admin_support(),public.get_admin_support_ticket(uuid),
  public.admin_update_support_ticket(uuid,text,text,text,text,boolean),
  public.get_admin_promotions(),public.admin_save_promotion(jsonb),
  public.admin_set_promotion_status(uuid,text) to authenticated;
