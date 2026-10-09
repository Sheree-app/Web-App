-- Week 4: customer directory, reports, warnings, and audited account controls.
alter table public.users
  add column if not exists blocked_at timestamptz,
  add column if not exists block_reason text;
create table public.customer_reports (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users(id) on delete cascade,
  reporter_id uuid references public.users(id) on delete set null,
  booking_id uuid references public.bookings(id) on delete set null,
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  status text not null default 'open' check (status in ('open','reviewing','resolved','dismissed')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create table public.customer_warnings (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.users(id) on delete cascade,
  issued_by uuid not null references public.admin_users(user_id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 5 and 1000),
  created_at timestamptz not null default now()
);
create index users_customer_account_status_idx on public.users(account_status, created_at desc) where role='customer';
create index customer_reports_customer_idx on public.customer_reports(customer_id, created_at desc);
create index customer_warnings_customer_idx on public.customer_warnings(customer_id, created_at desc);
alter table public.customer_reports enable row level security;
alter table public.customer_warnings enable row level security;
create policy "user managers read customer reports" on public.customer_reports for select to authenticated using (public.admin_has_permission('users.read'));
create policy "user managers read customer warnings" on public.customer_warnings for select to authenticated using (public.admin_has_permission('users.read'));
revoke all on public.customer_reports, public.customer_warnings from anon, authenticated;
grant select on public.customer_reports, public.customer_warnings to authenticated;
create or replace function public.get_admin_customers(
  search_query text default '', status_filter text default 'all',
  activity_filter text default 'all', page_number integer default 1, page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  query text:=trim(coalesce(search_query,'')); requested_status text:=lower(coalesce(status_filter,'all'));
  requested_activity text:=lower(coalesce(activity_filter,'all')); page integer:=greatest(coalesce(page_number,1),1);
  size integer:=least(greatest(coalesce(page_size,20),1),5000);
begin
  if not public.admin_has_permission('users.read') then raise exception 'User directory access required' using errcode='42501'; end if;
  return (
    with directory as (
      select u.id,u.full_name name,u.avatar_url,u.phone,u.account_status::text status,u.created_at,
        u.onboarding_completed_at,coalesce(b.booking_count,0) booking_count,coalesce(b.completed_count,0) completed_count,
        coalesce(p.total_spend,0) total_spend,coalesce(p.refunded,0) refunded,
        coalesce(r.report_count,0) report_count,coalesce(w.warning_count,0) warning_count,
        greatest(coalesce(b.last_booking_at,u.created_at),coalesce(p.last_payment_at,u.created_at)) last_active_at
      from public.users u
      left join lateral (select count(*) booking_count,count(*) filter(where status='completed') completed_count,max(created_at) last_booking_at from public.bookings where customer_id=u.id) b on true
      left join lateral (select coalesce(sum(amount) filter(where status='paid'),0) total_spend,coalesce(sum(amount) filter(where status='refunded'),0) refunded,max(created_at) last_payment_at from public.payments where customer_id=u.id) p on true
      left join lateral (select count(*) report_count from public.customer_reports where customer_id=u.id) r on true
      left join lateral (select count(*) warning_count from public.customer_warnings where customer_id=u.id) w on true
      where u.role='customer'
    ), filtered as (
      select * from directory d where
        (query='' or d.name ilike '%'||query||'%' or coalesce(d.phone,'') ilike '%'||query||'%' or d.id::text ilike query||'%')
        and (requested_status='all' or d.status=requested_status)
        and (requested_activity='all' or (requested_activity='booked' and d.booking_count>0)
          or (requested_activity='never_booked' and d.booking_count=0) or (requested_activity='reported' and d.report_count>0))
    )
    select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from
      (select * from filtered order by created_at desc limit size offset (page-1)*size)x),'[]'::jsonb),
      'total',(select count(*) from filtered),'page',page,'page_size',size)
  );
end $$;
create or replace function public.get_admin_customer(customer_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.admin_has_permission('users.read') then raise exception 'User directory access required' using errcode='42501'; end if;
  return (select jsonb_build_object(
    'id',u.id,'name',u.full_name,'avatar_url',u.avatar_url,'phone',u.phone,'status',u.account_status,
    'joined_at',u.created_at,'last_active_at',greatest(coalesce((select max(created_at) from public.bookings where customer_id=u.id),u.created_at),coalesce((select max(created_at) from public.payments where customer_id=u.id),u.created_at)),
    'blocked_at',u.blocked_at,'block_reason',u.block_reason,
    'booking_count',(select count(*) from public.bookings where customer_id=u.id),
    'completed_bookings',(select count(*) from public.bookings where customer_id=u.id and status='completed'),
    'cancelled_bookings',(select count(*) from public.bookings where customer_id=u.id and status='cancelled'),
    'total_spend',coalesce((select sum(amount) from public.payments where customer_id=u.id and status='paid'),0),
    'refunded',coalesce((select sum(amount) from public.payments where customer_id=u.id and status='refunded'),0),
    'bookings',coalesce((select jsonb_agg(to_jsonb(x) order by x.starts_at desc) from (
      select b.id,b.booking_reference,b.service_name,b.starts_at,b.status,b.payment_status,b.price,
        coalesce(pp.display_name,pp.business_name) beautician_name
      from public.bookings b join public.professional_profiles pp on pp.id=b.professional_id
      where b.customer_id=u.id order by b.starts_at desc limit 20)x),'[]'::jsonb),
    'payments',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select p.id,p.provider_reference,p.amount,p.currency,p.status,p.channel,p.created_at,b.service_name
      from public.payments p join public.bookings b on b.id=p.booking_id where p.customer_id=u.id order by p.created_at desc limit 20)x),'[]'::jsonb),
    'reports',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select r.id,r.reason,r.status,r.created_at,reporter.full_name reporter_name
      from public.customer_reports r left join public.users reporter on reporter.id=r.reporter_id
      where r.customer_id=u.id order by r.created_at desc)x),'[]'::jsonb),
    'warnings',coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
      select w.id,w.reason,w.created_at,au.display_name issued_by_name from public.customer_warnings w
      join public.admin_users au on au.user_id=w.issued_by where w.customer_id=u.id order by w.created_at desc)x),'[]'::jsonb)
  ) from public.users u where u.id=customer_id and u.role='customer');
end $$;
create or replace function public.admin_customer_action(customer_id uuid, action_name text, reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target record; clean_reason text:=trim(coalesce(reason,'')); action text:=lower(trim(action_name));
begin
  if not public.admin_has_permission('users.manage') then raise exception 'User management access required' using errcode='42501'; end if;
  if char_length(clean_reason)<5 then raise exception 'A reason of at least 5 characters is required'; end if;
  if action not in ('block','unblock','warn') then raise exception 'Unsupported customer action'; end if;
  select id,full_name,account_status::text old_status into target from public.users where id=customer_id and role='customer' for update;
  if not found then raise exception 'Customer not found' using errcode='P0002'; end if;
  if action='block' then
    if target.old_status='blocked' then raise exception 'Customer is already blocked'; end if;
    update public.users set account_status='blocked'::public.account_status,blocked_at=now(),block_reason=clean_reason where id=customer_id;
  elsif action='unblock' then
    if target.old_status<>'blocked' then raise exception 'Customer is not blocked'; end if;
    update public.users set account_status='active'::public.account_status,blocked_at=null,block_reason=null where id=customer_id;
  else
    insert into public.customer_warnings(customer_id,issued_by,reason) values(customer_id,(select auth.uid()),clean_reason);
    perform public.notify_user(customer_id,'message','A message from Sheree','Your account has received a warning: '||clean_reason,'/notifications',jsonb_build_object('event','admin_warning'),'customer');
  end if;
  insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)
  values((select auth.uid()),'customer.'||action,'customer',customer_id,initcap(action)||' customer '||target.full_name,
    jsonb_build_object('reason',clean_reason,'previous_status',target.old_status));
  return jsonb_build_object('id',customer_id,'action',action);
end $$;
revoke all on function public.get_admin_customers(text,text,text,integer,integer),
  public.get_admin_customer(uuid),public.admin_customer_action(uuid,text,text) from public,anon;
grant execute on function public.get_admin_customers(text,text,text,integer,integer),
  public.get_admin_customer(uuid),public.admin_customer_action(uuid,text,text) to authenticated;
