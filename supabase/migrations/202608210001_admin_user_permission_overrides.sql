-- admin_user_permission_overrides
--
-- Restored from the remote migration history (version 202608210001). This
-- migration was applied to the remote database before the file existed
-- locally, so it is written back verbatim to keep local and remote in sync.
-- Comments from the original file are not preserved by migration history.

-- Per-user tool access: roles become templates, each admin gets their own
-- permission list that an admin holding settings.roles can grant/revoke
-- directly, at creation or later. See docs/RBAC-Implementation-Plan.md.

create table public.admin_user_permissions (
  user_id uuid not null references public.admin_users(user_id) on delete cascade,
  permission_id uuid not null references public.admin_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, permission_id)
);

create index admin_user_permissions_user_idx on public.admin_user_permissions(user_id);

alter table public.admin_user_permissions enable row level security;

create policy "admins read own tool access" on public.admin_user_permissions for select to authenticated
using (user_id = (select auth.uid()));

create policy "role managers read all tool access" on public.admin_user_permissions for select to authenticated
using (public.admin_has_permission('settings.roles'));

-- An admin can only grant a tool they hold themselves, enforced at the row level
-- so this can never be bypassed by calling the table directly instead of the RPC.
create policy "role managers grant only tools they hold" on public.admin_user_permissions for insert to authenticated
with check (
  public.admin_has_permission('settings.roles')
  and public.admin_has_permission((select key from public.admin_permissions where id = permission_id))
);

create policy "role managers revoke tool access" on public.admin_user_permissions for delete to authenticated
using (public.admin_has_permission('settings.roles'));

revoke all on public.admin_user_permissions from anon, authenticated;

grant select, insert, delete on public.admin_user_permissions to authenticated;

-- Any new admin_users row (invite flow, or a manual bootstrap insert like the
-- one at the bottom of 202607260006_admin_foundation.sql) auto-seeds tools
-- from its role template, so nobody ends up locked out with zero permissions.
create or replace function public.seed_admin_user_permissions()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.admin_user_permissions(user_id, permission_id)
  select new.user_id, arp.permission_id
  from public.admin_role_permissions arp
  where arp.role_id = new.role_id
  on conflict do nothing;
  return new;
end
$$;

create trigger admin_users_seed_permissions after insert on public.admin_users
for each row execute function public.seed_admin_user_permissions();

-- Disputes currently shares support.manage with the Support ticket queue.
-- Give it its own key so it can be granted (or withheld) independently,
-- while refund approval stays behind payments.manage as it already is.
insert into public.admin_permissions(key, name, description) values
  ('disputes.manage', 'Manage disputes', 'Review and resolve booking disputes');

-- Anyone whose role currently carries support.manage keeps Disputes access
-- once it moves to its own key, so this migration is not a silent regression.
insert into public.admin_role_permissions(role_id, permission_id)
select arp.role_id, dp.id
from public.admin_role_permissions arp
join public.admin_permissions sp on sp.id = arp.permission_id and sp.key = 'support.manage'
cross join (select id from public.admin_permissions where key = 'disputes.manage') dp
on conflict do nothing;

insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r cross join public.admin_permissions p
where r.slug = 'super-admin' and p.key = 'disputes.manage'
on conflict do nothing;

-- Backfill every existing admin's own tool list from their current role, so
-- nobody loses access the moment admin_has_permission() stops reading roles.
insert into public.admin_user_permissions(user_id, permission_id)
select au.user_id, arp.permission_id
from public.admin_users au
join public.admin_role_permissions arp on arp.role_id = au.role_id
on conflict do nothing;

create or replace function public.admin_has_permission(permission_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.admin_users au
    join public.admin_user_permissions aup on aup.user_id=au.user_id
    join public.admin_permissions ap on ap.id=aup.permission_id
    where au.user_id=(select auth.uid())
      and au.is_active
      and ap.key=permission_key
  );
$$;

create or replace function public.get_admin_context()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'user_id', au.user_id,
    'display_name', au.display_name,
    'job_title', au.job_title,
    'avatar_url', au.avatar_url,
    'role', ar.slug,
    'role_name', ar.name,
    'permissions', coalesce((
      select jsonb_agg(ap.key order by ap.key)
      from public.admin_user_permissions aup
      join public.admin_permissions ap on ap.id=aup.permission_id
      where aup.user_id=au.user_id
    ), '[]'::jsonb)
  )
  from public.admin_users au
  join public.admin_roles ar on ar.id=au.role_id
  where au.user_id=(select auth.uid()) and au.is_active;
$$;

-- Move Disputes access from support.manage onto disputes.manage.
drop policy "support admins read disputes" on public.disputes;

drop policy "support admins read notes" on public.dispute_notes;

drop policy "support admins read dispute refunds" on public.dispute_refunds;

create policy "dispute admins read disputes" on public.disputes for select to authenticated
using (public.admin_has_permission('disputes.manage'));

create policy "dispute admins read notes" on public.dispute_notes for select to authenticated
using (public.admin_has_permission('disputes.manage'));

create policy "dispute admins read dispute refunds" on public.dispute_refunds for select to authenticated
using (public.admin_has_permission('disputes.manage'));

create or replace function public.get_admin_disputes(search_query text default'',status_filter text default'all',page_number integer default 1,page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));requested text:=lower(coalesce(status_filter,'all'));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),100);
begin
 if not public.admin_has_permission('disputes.manage') then raise exception 'Disputes access required' using errcode='42501';end if;
 return(with directory as(select d.id,d.subject,d.category,d.status,d.created_at,d.updated_at,b.id booking_id,b.booking_reference,b.service_name,b.starts_at,
  cu.full_name customer_name,coalesce(pp.display_name,pp.business_name) professional_name,
  coalesce((select sum(dr.amount) from public.dispute_refunds dr where dr.dispute_id=d.id and dr.status not in('denied','failed')),0) refund_amount,
  (select count(*) from public.dispute_notes n where n.dispute_id=d.id) note_count
  from public.disputes d join public.bookings b on b.id=d.booking_id join public.users cu on cu.id=b.customer_id join public.professional_profiles pp on pp.id=b.professional_id),
 filtered as(select*from directory x where(requested='all'or x.status=requested)and(query=''or x.subject ilike'%'||query||'%'or coalesce(x.booking_reference,'')ilike'%'||query||'%'or x.customer_name ilike'%'||query||'%'or x.professional_name ilike'%'||query||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select*from filtered order by created_at desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size,
 'counts',jsonb_build_object('open',(select count(*)from directory where status='open'),'investigating',(select count(*)from directory where status='investigating'),'resolved',(select count(*)from directory where status='resolved'))) );
end $$;

create or replace function public.get_admin_dispute(dispute_id uuid)returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.admin_has_permission('disputes.manage') then raise exception 'Disputes access required' using errcode='42501';end if;
 return(select jsonb_build_object('id',d.id,'subject',d.subject,'description',d.description,'category',d.category,'status',d.status,'resolution',d.resolution,'created_at',d.created_at,'updated_at',d.updated_at,
 'booking',jsonb_build_object('id',b.id,'reference',b.booking_reference,'service_name',b.service_name,'starts_at',b.starts_at,'ends_at',b.ends_at,'status',b.status,'payment_status',b.payment_status,'price',b.price,'deposit_amount',b.deposit_amount),
 'customer',jsonb_build_object('id',cu.id,'name',cu.full_name,'phone',cu.phone,'avatar_url',cu.avatar_url),
 'professional',jsonb_build_object('id',pp.id,'name',coalesce(pp.display_name,pp.business_name),'phone',pu.phone,'avatar_url',pp.profile_photo_url),
 'payments',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select p.id,p.provider_reference,p.amount,p.currency,p.status,p.channel,p.created_at from public.payments p where p.booking_id=b.id order by p.created_at desc)x),'[]'::jsonb),
 'notes',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at)from(select n.id,n.body,n.created_at,au.display_name author_name from public.dispute_notes n join public.admin_users au on au.user_id=n.author_id where n.dispute_id=d.id order by n.created_at)x),'[]'::jsonb),
 'refunds',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select r.id,r.payment_id,r.amount,r.currency,r.status,r.reason,r.provider_refund_id,r.created_at,r.decided_at,au.display_name decided_by_name from public.dispute_refunds r left join public.admin_users au on au.user_id=r.decided_by where r.dispute_id=d.id order by r.created_at desc)x),'[]'::jsonb)
 )from public.disputes d join public.bookings b on b.id=d.booking_id join public.users cu on cu.id=b.customer_id join public.professional_profiles pp on pp.id=b.professional_id join public.users pu on pu.id=pp.user_id where d.id=dispute_id);
end $$;

create or replace function public.admin_update_dispute(dispute_id uuid,new_status text,resolution_text text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare old_status text;clean_status text:=lower(trim(new_status));
begin
 if not public.admin_has_permission('disputes.manage')then raise exception'Disputes access required'using errcode='42501';end if;
 if clean_status not in('open','investigating','resolved')then raise exception'Invalid dispute status';end if;
 select status into old_status from public.disputes where id=dispute_id for update;if not found then raise exception'Dispute not found';end if;
 if clean_status='resolved'and char_length(trim(coalesce(resolution_text,'')))<5 then raise exception'A resolution is required';end if;
 update public.disputes set status=clean_status,resolution=case when clean_status='resolved'then trim(resolution_text)else resolution end,resolved_at=case when clean_status='resolved'then now()else null end,assigned_to=coalesce(assigned_to,(select auth.uid()))where id=dispute_id;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'dispute.status','dispute',dispute_id,'Updated dispute to '||clean_status,jsonb_build_object('previous_status',old_status,'new_status',clean_status,'resolution',resolution_text));
 return jsonb_build_object('id',dispute_id,'status',clean_status);
end $$;

create or replace function public.admin_add_dispute_note(dispute_id uuid,note_body text)returns jsonb language plpgsql security definer set search_path='' as $$
declare note_id uuid;clean text:=trim(coalesce(note_body,''));
begin
 if not public.admin_has_permission('disputes.manage')then raise exception'Disputes access required'using errcode='42501';end if;
 if char_length(clean)<2 then raise exception'Note is too short';end if;
 insert into public.dispute_notes(dispute_id,author_id,body)values(dispute_id,(select auth.uid()),clean)returning id into note_id;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'dispute.note','dispute',dispute_id,'Added internal dispute note',jsonb_build_object('note_id',note_id));
 return jsonb_build_object('id',note_id);
end $$;

-- admin_deny_dispute_refund already checks payments.manage separately and is untouched.

create or replace function public.admin_apply_user_permissions(target_user uuid, permission_keys text[])
returns jsonb language plpgsql security definer set search_path='' as $$
declare target_role text; unknown_keys text[]; ungranted_keys text[];
begin
  if not public.admin_has_permission('settings.roles') then
    raise exception 'Role management required' using errcode='42501';
  end if;
  select r.slug into target_role from public.admin_users au join public.admin_roles r on r.id=au.role_id where au.user_id=target_user;
  if not found then raise exception 'Administrator not found'; end if;
  -- Only guard against editing an already-provisioned super administrator's
  -- tools; the very first grant right after an invite must still go through.
  if target_role='super-admin' and target_user<>(select auth.uid())
     and exists(select 1 from public.admin_user_permissions where user_id=target_user) then
    raise exception 'Another super administrator cannot be modified';
  end if;

  select array_agg(k) into unknown_keys from unnest(coalesce(permission_keys,'{}')) k
  where k not in (select key from public.admin_permissions);
  if unknown_keys is not null then
    raise exception 'Unknown tool key: %', array_to_string(unknown_keys, ', ');
  end if;

  select array_agg(k) into ungranted_keys from unnest(coalesce(permission_keys,'{}')) k
  where not public.admin_has_permission(k);
  if ungranted_keys is not null then
    raise exception 'You cannot grant access you do not hold: %', array_to_string(ungranted_keys, ', ');
  end if;

  delete from public.admin_user_permissions where user_id=target_user;
  insert into public.admin_user_permissions(user_id, permission_id)
  select target_user, ap.id from public.admin_permissions ap where ap.key=any(permission_keys);

  insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)
  values((select auth.uid()),'admins.permissions_updated','admin_user',target_user,'Updated tool access for administrator',jsonb_build_object('permissions',coalesce(permission_keys,'{}')));

  return jsonb_build_object('user_id',target_user,'permissions',coalesce(permission_keys,'{}'));
end
$$;

create or replace function public.get_admin_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_admin()then raise exception'Administrator access required'using errcode='42501';end if;
 return jsonb_build_object(
 'settings',coalesce((select jsonb_object_agg(key,value)from public.platform_settings),'{}'::jsonb),
 'can_manage_settings',public.admin_has_permission('settings.general'),'can_manage_roles',public.admin_has_permission('settings.roles'),'can_view_audit',public.admin_has_permission('settings.audit'),
 'viewer_permissions',coalesce((select jsonb_agg(ap.key order by ap.key)from public.admin_user_permissions aup join public.admin_permissions ap on ap.id=aup.permission_id where aup.user_id=(select auth.uid())),'[]'::jsonb),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug,'description',r.description,'is_system',r.is_system,'member_count',(select count(*)from public.admin_users au where au.role_id=r.id),'permissions',coalesce((select jsonb_agg(p.key order by p.key)from public.admin_role_permissions rp join public.admin_permissions p on p.id=rp.permission_id where rp.role_id=r.id),'[]'::jsonb))order by r.is_system desc,r.name)from public.admin_roles r),'[]'::jsonb),
 'permissions',coalesce((select jsonb_agg(jsonb_build_object('key',key,'name',name,'description',description)order by key)from public.admin_permissions),'[]'::jsonb),
 'admins',coalesce((select jsonb_agg(jsonb_build_object('user_id',au.user_id,'display_name',au.display_name,'job_title',au.job_title,'avatar_url',au.avatar_url,'is_active',au.is_active,'last_seen_at',au.last_seen_at,'created_at',au.created_at,'role_id',r.id,'role_name',r.name,'role_slug',r.slug,'permissions',coalesce((select jsonb_agg(ap.key order by ap.key)from public.admin_user_permissions aup join public.admin_permissions ap on ap.id=aup.permission_id where aup.user_id=au.user_id),'[]'::jsonb))order by au.created_at)from public.admin_users au join public.admin_roles r on r.id=au.role_id),'[]'::jsonb),
 'api_keys',case when public.admin_has_permission('settings.general')then coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'prefix',k.key_prefix,'scopes',k.scopes,'last_used_at',k.last_used_at,'expires_at',k.expires_at,'revoked_at',k.revoked_at,'created_at',k.created_at,'created_by',au.display_name)order by k.created_at desc)from public.admin_api_keys k join public.admin_users au on au.user_id=k.created_by),'[]'::jsonb)else'[]'::jsonb end);
end
$$;

revoke all on function public.admin_apply_user_permissions(uuid, text[]) from public, anon;

grant execute on function public.admin_apply_user_permissions(uuid, text[]) to authenticated;

-- New role templates from docs/Roles.md. These only seed the picker's
-- pre-fill — actual access is granted per user via admin_apply_user_permissions.
insert into public.admin_roles(name, slug, description, is_system) values
  ('Marketing', 'marketing', 'Promotions, notifications, and marketing analytics', false),
  ('Customer Service', 'customer-service', 'Support, disputes, users, and bookings on a customer''s behalf', false),
  ('Accountant', 'accountant', 'Financial visibility and payment analytics', false),
  ('Developer', 'developer', 'Audit log access for debugging and monitoring', false),
  ('Content Moderation', 'content-moderation', 'Review and remove reported marketplace content', false);

insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','promotions.manage','notifications.manage','analytics.view')
where r.slug='marketing';

insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','support.manage','disputes.manage','users.read','users.manage','bookings.read','bookings.manage','reviews.manage')
where r.slug='customer-service';

insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','payments.read','analytics.view')
where r.slug='accountant';

insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','settings.audit')
where r.slug='developer';

insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','moderation.manage')
where r.slug='content-moderation';
