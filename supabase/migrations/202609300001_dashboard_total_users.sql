-- dashboard_total_users
--
-- Restored from the remote migration history (version 202609300001). This
-- migration was applied to the remote database before the file existed
-- locally, so it is written back verbatim to keep local and remote in sync.
-- Comments from the original file are not preserved by migration history.

-- Add an explicit all-time user count to the admin dashboard signup metrics.
create or replace function public.get_admin_signup_metrics(period_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  days integer := least(greatest(period_days,7),90);
  period_start timestamptz := date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),90)-1);
  previous_start timestamptz := date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),90)*2-1);
  previous_end timestamptz := date_trunc('day',now())-make_interval(days=>least(greatest(period_days,7),90));
begin
  if not public.admin_has_permission('dashboard.view') then
    raise exception 'Administrator dashboard access required' using errcode='42501';
  end if;
  return jsonb_build_object(
    'total_users',(select count(*) from public.users),
    'total_signups',(select count(*) from public.users),
    'period_signups',(select count(*) from public.users where created_at>=period_start),
    'previous_period_signups',(select count(*) from public.users where created_at>=previous_start and created_at<previous_end),
    'customer_signups',(select count(*) from public.users where role='customer' and created_at>=period_start),
    'beautician_signups',(select count(*) from public.users where role='professional' and created_at>=period_start)
  );
end;
$$;

revoke all on function public.get_admin_signup_metrics(integer) from public,anon;

grant execute on function public.get_admin_signup_metrics(integer) to authenticated;
