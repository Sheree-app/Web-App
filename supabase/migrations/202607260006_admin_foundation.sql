-- Week 1 admin foundation: RBAC, active membership checks, and append-only audit logs.
create table public.admin_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 2 and 80),
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  description text,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.admin_permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z]+(?:\.[a-z]+)*$'),
  name text not null,
  description text,
  created_at timestamptz not null default now()
);
create table public.admin_role_permissions (
  role_id uuid not null references public.admin_roles(id) on delete cascade,
  permission_id uuid not null references public.admin_permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role_id uuid not null references public.admin_roles(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 1 and 120),
  job_title text,
  avatar_url text,
  is_active boolean not null default true,
  invited_by uuid references public.admin_users(user_id) on delete set null,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.admin_audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.admin_users(user_id) on delete set null,
  action text not null check (action ~ '^[a-z]+(?:\.[a-z_]+)*$'),
  resource_type text not null check (resource_type ~ '^[a-z_]+$'),
  resource_id text,
  summary text not null,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index admin_users_role_idx on public.admin_users(role_id) where is_active;
create index admin_audit_logs_actor_idx on public.admin_audit_logs(actor_id, created_at desc);
create index admin_audit_logs_resource_idx on public.admin_audit_logs(resource_type, resource_id, created_at desc);
create index admin_audit_logs_created_idx on public.admin_audit_logs(created_at desc);
create trigger admin_roles_set_updated_at before update on public.admin_roles
for each row execute function public.set_updated_at();
create trigger admin_users_set_updated_at before update on public.admin_users
for each row execute function public.set_updated_at();
alter table public.admin_roles enable row level security;
alter table public.admin_permissions enable row level security;
alter table public.admin_role_permissions enable row level security;
alter table public.admin_users enable row level security;
alter table public.admin_audit_logs enable row level security;
create or replace function public.is_active_admin(check_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.admin_users au
    where au.user_id=check_user_id and au.is_active
  );
$$;
create or replace function public.admin_has_permission(permission_key text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1
    from public.admin_users au
    join public.admin_role_permissions arp on arp.role_id=au.role_id
    join public.admin_permissions ap on ap.id=arp.permission_id
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
      from public.admin_role_permissions arp
      join public.admin_permissions ap on ap.id=arp.permission_id
      where arp.role_id=au.role_id
    ), '[]'::jsonb)
  )
  from public.admin_users au
  join public.admin_roles ar on ar.id=au.role_id
  where au.user_id=(select auth.uid()) and au.is_active;
$$;
create policy "active admins read roles" on public.admin_roles for select to authenticated
using (public.is_active_admin());
create policy "role managers manage roles" on public.admin_roles for all to authenticated
using (public.admin_has_permission('settings.roles')) with check (public.admin_has_permission('settings.roles'));
create policy "active admins read permissions" on public.admin_permissions for select to authenticated
using (public.is_active_admin());
create policy "active admins read role grants" on public.admin_role_permissions for select to authenticated
using (public.is_active_admin());
create policy "role managers manage grants" on public.admin_role_permissions for all to authenticated
using (public.admin_has_permission('settings.roles')) with check (public.admin_has_permission('settings.roles'));
create policy "admins read own membership" on public.admin_users for select to authenticated
using (user_id=(select auth.uid()));
create policy "role managers read admin memberships" on public.admin_users for select to authenticated
using (public.admin_has_permission('settings.roles'));
create policy "role managers create admin memberships" on public.admin_users for insert to authenticated
with check (public.admin_has_permission('settings.roles'));
create policy "role managers update admin memberships" on public.admin_users for update to authenticated
using (public.admin_has_permission('settings.roles')) with check (public.admin_has_permission('settings.roles'));
create policy "active admins create audit entries" on public.admin_audit_logs for insert to authenticated
with check (public.is_active_admin() and actor_id=(select auth.uid()));
create policy "audit viewers read audit entries" on public.admin_audit_logs for select to authenticated
using (public.admin_has_permission('settings.audit'));
revoke all on public.admin_roles, public.admin_permissions, public.admin_role_permissions,
  public.admin_users, public.admin_audit_logs from anon, authenticated;
revoke all on function public.is_active_admin(uuid), public.admin_has_permission(text),
  public.get_admin_context() from public, anon;
grant select on public.admin_roles, public.admin_permissions, public.admin_role_permissions,
  public.admin_users, public.admin_audit_logs to authenticated;
grant insert on public.admin_roles, public.admin_users, public.admin_role_permissions,
  public.admin_audit_logs to authenticated;
grant update on public.admin_roles, public.admin_users, public.admin_role_permissions to authenticated;
grant delete on public.admin_roles, public.admin_role_permissions to authenticated;
grant execute on function public.is_active_admin(uuid), public.admin_has_permission(text),
  public.get_admin_context() to authenticated;
insert into public.admin_permissions(key, name, description) values
  ('dashboard.view', 'View dashboard', 'View marketplace health and overview analytics'),
  ('users.read', 'View users', 'View customer and beautician records'),
  ('users.manage', 'Manage users', 'Suspend, reinstate, warn, and edit users'),
  ('bookings.read', 'View bookings', 'View booking records and calendars'),
  ('bookings.manage', 'Manage bookings', 'Update and intervene in bookings'),
  ('payments.read', 'View payments', 'View transactions, balances, and payouts'),
  ('payments.manage', 'Manage payments', 'Approve payouts and process financial actions'),
  ('verification.manage', 'Manage verification', 'Review professional verification submissions'),
  ('reviews.manage', 'Manage reviews', 'Moderate customer reviews and responses'),
  ('moderation.manage', 'Manage moderation', 'Review and remove marketplace content'),
  ('promotions.manage', 'Manage promotions', 'Create and manage marketplace campaigns'),
  ('support.manage', 'Manage support', 'View and resolve support tickets'),
  ('notifications.manage', 'Manage notifications', 'Compose and schedule notifications'),
  ('analytics.view', 'View analytics', 'View detailed marketplace analytics'),
  ('settings.general', 'Manage settings', 'Update general marketplace settings'),
  ('settings.roles', 'Manage roles', 'Manage administrators, roles, and permissions'),
  ('settings.audit', 'View audit log', 'View the immutable administrator audit trail');
insert into public.admin_roles(name, slug, description, is_system) values
  ('Super administrator', 'super-admin', 'Full administrative access', true),
  ('Operations manager', 'operations-manager', 'Users, bookings, trust, and support operations', true),
  ('Finance manager', 'finance-manager', 'Payments, payouts, and financial analytics', true),
  ('Trust and safety', 'trust-safety', 'Verification, reviews, and content moderation', true),
  ('Analyst', 'analyst', 'Read-only marketplace analytics', true);
insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r cross join public.admin_permissions p
where r.slug='super-admin';
insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','users.read','users.manage','bookings.read','bookings.manage',
    'verification.manage','reviews.manage','moderation.manage','support.manage','analytics.view')
where r.slug='operations-manager';
insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','bookings.read','payments.read','payments.manage','analytics.view')
where r.slug='finance-manager';
insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','users.read','verification.manage','reviews.manage',
    'moderation.manage','support.manage')
where r.slug='trust-safety';
insert into public.admin_role_permissions(role_id, permission_id)
select r.id, p.id from public.admin_roles r join public.admin_permissions p
  on p.key in ('dashboard.view','users.read','bookings.read','payments.read','analytics.view')
where r.slug='analyst';
-- Bootstrap the first administrator after creating their Supabase Auth user:
-- insert into public.admin_users(user_id, role_id, display_name, job_title)
-- select '<auth-user-uuid>', id, 'Sheree', 'Founder' from public.admin_roles where slug='super-admin';;
