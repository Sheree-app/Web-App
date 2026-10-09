-- Week 15: platform configuration, API credentials, RBAC, and launch readiness.
create table public.platform_settings(
 key text primary key check(key~'^[a-z_]+$'),value jsonb not null,description text,
 updated_by uuid references public.admin_users(user_id)on delete set null,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.admin_api_keys(
 id uuid primary key default gen_random_uuid(),name text not null check(char_length(trim(name))between 2 and 80),
 key_prefix text not null,key_hash text not null unique,created_by uuid not null references public.admin_users(user_id)on delete restrict,
 scopes text[]not null default'{}',last_used_at timestamptz,expires_at timestamptz,revoked_at timestamptz,created_at timestamptz not null default now()
);
create trigger platform_settings_set_updated_at before update on public.platform_settings for each row execute function public.set_updated_at();
alter table public.platform_settings enable row level security;
alter table public.admin_api_keys enable row level security;
create policy"settings managers read platform settings"on public.platform_settings for select to authenticated using(public.admin_has_permission('settings.general'));
create policy"settings managers read api keys"on public.admin_api_keys for select to authenticated using(public.admin_has_permission('settings.general'));
revoke all on public.platform_settings,public.admin_api_keys from anon,authenticated;
grant select on public.platform_settings,public.admin_api_keys to authenticated;
insert into public.platform_settings(key,value,description)values
('general','{"platform_name":"Sheree","support_email":"support@sheree.com","default_currency":"GHS","timezone":"Africa/Accra","country":"GH"}','Marketplace identity and regional defaults'),
('payments','{"provider":"paystack","commission_percentage":10,"payout_schedule":"instant_split","minimum_payout":1,"tax_enabled":false,"tax_percentage":0,"tax_label":"VAT"}','Payments, commission, payouts, and taxes'),
('booking_rules','{"minimum_notice_hours":2,"booking_window_days":60,"default_duration_minutes":60,"approval_mode":"automatic","allow_mobile_service":true,"max_appointments_per_day":8}','Default marketplace booking constraints'),
('cancellation','{"customer_free_window_hours":24,"customer_refund_percentage":90,"professional_cancellation_refund_percentage":100,"no_show_refund_percentage":0,"policy_text":"Cancel at least 24 hours before your appointment for the applicable refund."}','Cancellation and refund defaults'),
('notifications','{"email_enabled":true,"push_enabled":true,"booking_reminders_enabled":true,"reminder_hours":[24,2],"payment_updates_enabled":true,"marketing_enabled":true}','Platform notification defaults'),
('brand','{"logo_url":"","mark_url":"","favicon_url":"","primary_color":"#668060","accent_color":"#EACBD3"}','Brand assets and visual tokens'),
('security','{"mfa_required":true,"session_timeout_minutes":60,"api_keys_enabled":true,"audit_retention_days":2555,"allowed_admin_domains":[]}','Administrator security policy'),
('maintenance','{"enabled":false,"message":"Sheree is receiving a little care. Please check back shortly.","allow_admin_access":true,"scheduled_end":null}','Maintenance-mode controls'),
('launch_checklist','{"items":[{"id":"payments","label":"Paystack production credentials configured","complete":false},{"id":"webhooks","label":"Webhook delivery verified","complete":false},{"id":"mfa","label":"All administrators enrolled in MFA","complete":false},{"id":"roles","label":"Production roles reviewed","complete":false},{"id":"policies","label":"Cancellation and privacy policies approved","complete":false},{"id":"backups","label":"Database backups and recovery tested","complete":false},{"id":"monitoring","label":"Error monitoring and alerts configured","complete":false},{"id":"qa","label":"Cross-module production QA complete","complete":false}]}','Operational launch gate')
on conflict(key)do nothing;
create or replace function public.get_admin_settings() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_active_admin()then raise exception'Administrator access required'using errcode='42501';end if;
 return jsonb_build_object(
 'settings',coalesce((select jsonb_object_agg(key,value)from public.platform_settings),'{}'::jsonb),
 'can_manage_settings',public.admin_has_permission('settings.general'),'can_manage_roles',public.admin_has_permission('settings.roles'),'can_view_audit',public.admin_has_permission('settings.audit'),
 'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'slug',r.slug,'description',r.description,'is_system',r.is_system,'member_count',(select count(*)from public.admin_users au where au.role_id=r.id),'permissions',coalesce((select jsonb_agg(p.key order by p.key)from public.admin_role_permissions rp join public.admin_permissions p on p.id=rp.permission_id where rp.role_id=r.id),'[]'::jsonb))order by r.is_system desc,r.name)from public.admin_roles r),'[]'::jsonb),
 'permissions',coalesce((select jsonb_agg(jsonb_build_object('key',key,'name',name,'description',description)order by key)from public.admin_permissions),'[]'::jsonb),
 'admins',coalesce((select jsonb_agg(jsonb_build_object('user_id',au.user_id,'display_name',au.display_name,'job_title',au.job_title,'avatar_url',au.avatar_url,'is_active',au.is_active,'last_seen_at',au.last_seen_at,'created_at',au.created_at,'role_id',r.id,'role_name',r.name,'role_slug',r.slug)order by au.created_at)from public.admin_users au join public.admin_roles r on r.id=au.role_id),'[]'::jsonb),
 'api_keys',case when public.admin_has_permission('settings.general')then coalesce((select jsonb_agg(jsonb_build_object('id',k.id,'name',k.name,'prefix',k.key_prefix,'scopes',k.scopes,'last_used_at',k.last_used_at,'expires_at',k.expires_at,'revoked_at',k.revoked_at,'created_at',k.created_at,'created_by',au.display_name)order by k.created_at desc)from public.admin_api_keys k join public.admin_users au on au.user_id=k.created_by),'[]'::jsonb)else'[]'::jsonb end);
end
$$;
create or replace function public.admin_update_setting(setting_key text,setting_value jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.admin_has_permission('settings.general')then raise exception'Settings management required'using errcode='42501';end if;
 if setting_key not in('general','payments','booking_rules','cancellation','notifications','brand','security','maintenance','launch_checklist')then raise exception'Unknown setting section';end if;
 update public.platform_settings set value=setting_value,updated_by=(select auth.uid())where key=setting_key;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'settings.updated','platform_setting',setting_key,'Updated '||replace(setting_key,'_',' ')||' settings',jsonb_build_object('value',setting_value));
 return jsonb_build_object('key',setting_key,'value',setting_value);
end
$$;
create or replace function public.admin_save_role(role_id uuid,role_name text,role_description text,permission_keys text[]) returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid:=role_id;slug_value text;system_slug text;
begin
 if not public.admin_has_permission('settings.roles')then raise exception'Role management required'using errcode='42501';end if;
 if char_length(trim(role_name))<2 then raise exception'Role name is required';end if;
 if target is null then slug_value:=trim(both'-'from regexp_replace(lower(trim(role_name)),'[^a-z0-9]+','-','g'))||'-'||substr(replace(gen_random_uuid()::text,'-',''),1,6);insert into public.admin_roles(name,slug,description,is_system)values(trim(role_name),slug_value,trim(role_description),false)returning id into target;
 else select slug into system_slug from public.admin_roles where id=target;if system_slug='super-admin'then raise exception'The super administrator role cannot be changed';end if;update public.admin_roles set name=trim(role_name),description=trim(role_description)where id=target;delete from public.admin_role_permissions where admin_role_permissions.role_id=target;end if;
 insert into public.admin_role_permissions(role_id,permission_id)select target,p.id from public.admin_permissions p where p.key=any(permission_keys)on conflict do nothing;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'roles.saved','admin_role',target,'Saved administrator role '||trim(role_name),jsonb_build_object('permissions',permission_keys));
 return jsonb_build_object('id',target);
end
$$;
create or replace function public.admin_update_membership(target_user uuid,new_role_id uuid,active boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare target_role text;current_role text;
begin
 if not public.admin_has_permission('settings.roles')then raise exception'Role management required'using errcode='42501';end if;
 select r.slug into target_role from public.admin_roles r where r.id=new_role_id;if not found then raise exception'Role not found';end if;
 select r.slug into current_role from public.admin_users au join public.admin_roles r on r.id=au.role_id where au.user_id=target_user;
 if current_role='super-admin'and target_user<>(select auth.uid())then raise exception'Another super administrator cannot be modified';end if;
 if target_user=(select auth.uid())and not active then raise exception'You cannot deactivate your own account';end if;
 update public.admin_users set role_id=new_role_id,is_active=active where user_id=target_user;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'admins.updated','admin_user',target_user,'Updated administrator membership',jsonb_build_object('role',target_role,'active',active));
 return jsonb_build_object('user_id',target_user,'active',active);
end
$$;
create or replace function public.admin_create_api_key(key_name text,key_scopes text[],expiry timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare secret text:='shr_live_'||encode(gen_random_bytes(24),'hex');new_id uuid;
begin
 if not public.admin_has_permission('settings.general')then raise exception'Settings management required'using errcode='42501';end if;
 if char_length(trim(key_name))<2 then raise exception'Key name is required';end if;
 insert into public.admin_api_keys(name,key_prefix,key_hash,created_by,scopes,expires_at)values(trim(key_name),left(secret,17),encode(digest(secret,'sha256'),'hex'),(select auth.uid()),coalesce(key_scopes,'{}'),expiry)returning id into new_id;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'api_keys.created','api_key',new_id,'Created API key '||trim(key_name),jsonb_build_object('scopes',key_scopes,'prefix',left(secret,17)));
 return jsonb_build_object('id',new_id,'secret',secret,'prefix',left(secret,17));
end
$$;
create or replace function public.admin_revoke_api_key(key_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.admin_has_permission('settings.general')then raise exception'Settings management required'using errcode='42501';end if;update public.admin_api_keys set revoked_at=now()where id=key_id and revoked_at is null;if not found then raise exception'Active key not found';end if;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary)values((select auth.uid()),'api_keys.revoked','api_key',key_id,'Revoked API key');return jsonb_build_object('id',key_id,'revoked',true);
end
$$;
create or replace function public.get_admin_audit(search_query text default '',action_filter text default '',page_number integer default 1,page_size integer default 30) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));action_query text:=trim(coalesce(action_filter,''));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),100);
begin if not public.admin_has_permission('settings.audit')then raise exception'Audit access required'using errcode='42501';end if;
 return(with filtered as(select l.id,l.action,l.resource_type,l.resource_id,l.summary,l.metadata,l.ip_address,l.created_at,coalesce(au.display_name,'System')actor_name from public.admin_audit_logs l left join public.admin_users au on au.user_id=l.actor_id where(action_query=''or l.action ilike action_query||'%')and(query=''or l.summary ilike'%'||query||'%'or coalesce(au.display_name,'System')ilike'%'||query||'%'or coalesce(l.resource_id,'')ilike'%'||query||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select*from filtered order by created_at desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size));
end
$$;
revoke all on function public.get_admin_settings(),public.admin_update_setting(text,jsonb),public.admin_save_role(uuid,text,text,text[]),public.admin_update_membership(uuid,uuid,boolean),public.admin_create_api_key(text,text[],timestamptz),public.admin_revoke_api_key(uuid),public.get_admin_audit(text,text,integer,integer)from public,anon;
grant execute on function public.get_admin_settings(),public.admin_update_setting(text,jsonb),public.admin_save_role(uuid,text,text,text[]),public.admin_update_membership(uuid,uuid,boolean),public.admin_create_api_key(text,text[],timestamptz),public.admin_revoke_api_key(uuid),public.get_admin_audit(text,text,integer,integer)to authenticated;
