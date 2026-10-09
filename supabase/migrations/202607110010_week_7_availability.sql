-- Week 7: professional availability rules, breaks and blocked periods.
create table public.professional_schedule_preferences (
  professional_id uuid primary key references public.professional_profiles(id) on delete cascade,
  max_appointments_per_day integer not null default 8 check(max_appointments_per_day between 1 and 40),
  buffer_minutes integer not null default 15 check(buffer_minutes between 0 and 180),
  default_duration_minutes integer not null default 60 check(default_duration_minutes between 5 and 1440),
  approval_mode text not null default 'automatic' check(approval_mode in ('automatic','manual')),
  updated_at timestamptz not null default now()
);
create table public.professional_schedule_breaks (
  id uuid primary key default gen_random_uuid(),professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  day_of_week smallint not null check(day_of_week between 0 and 6),starts_at time not null,ends_at time not null,label text not null default 'Break',
  check(starts_at<ends_at),unique(professional_id,day_of_week,starts_at)
);
create table public.professional_schedule_blocks (
  id uuid primary key default gen_random_uuid(),professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  starts_at timestamptz not null,ends_at timestamptz not null,label text not null default 'Unavailable',created_at timestamptz not null default now(),check(starts_at<ends_at)
);
alter table public.professional_schedule_preferences enable row level security;alter table public.professional_schedule_breaks enable row level security;alter table public.professional_schedule_blocks enable row level security;
create policy "schedule preferences are public" on public.professional_schedule_preferences for select to anon,authenticated using(true);
create policy "breaks are public" on public.professional_schedule_breaks for select to anon,authenticated using(true);
create policy "blocks are public" on public.professional_schedule_blocks for select to anon,authenticated using(true);
create policy "professionals manage schedule preferences" on public.professional_schedule_preferences for all to authenticated using(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid()))) with check(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "professionals manage breaks" on public.professional_schedule_breaks for all to authenticated using(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid()))) with check(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
create policy "professionals manage blocks" on public.professional_schedule_blocks for all to authenticated using(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid()))) with check(exists(select 1 from public.professional_profiles p where p.id=professional_id and p.user_id=(select auth.uid())));
grant select on public.professional_schedule_preferences,public.professional_schedule_breaks,public.professional_schedule_blocks to anon,authenticated;grant insert,update,delete on public.professional_schedule_preferences,public.professional_schedule_breaks,public.professional_schedule_blocks to authenticated;

create or replace function public.get_my_schedule() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare pid uuid; result jsonb;
begin
 select id into pid from public.professional_profiles where user_id=(select auth.uid());if pid is null then raise exception 'Professional profile required';end if;
 select jsonb_build_object('profile_id',pid,'preferences',coalesce((select to_jsonb(x) from (select max_appointments_per_day,buffer_minutes,default_duration_minutes,approval_mode from public.professional_schedule_preferences where professional_id=pid)x),'{"max_appointments_per_day":8,"buffer_minutes":15,"default_duration_minutes":60,"approval_mode":"automatic"}'::jsonb),'hours',coalesce((select jsonb_agg(to_jsonb(h) order by day_of_week) from public.professional_working_hours h where professional_id=pid),'[]'::jsonb),'breaks',coalesce((select jsonb_agg(to_jsonb(b) order by day_of_week,starts_at) from public.professional_schedule_breaks b where professional_id=pid),'[]'::jsonb),'blocks',coalesce((select jsonb_agg(to_jsonb(v) order by starts_at) from public.professional_schedule_blocks v where professional_id=pid and ends_at>now()),'[]'::jsonb)) into result;return result;
end;$$;

create or replace function public.save_my_schedule(payload jsonb) returns void language plpgsql security definer set search_path='' as $$
declare pid uuid; pref jsonb:=payload->'preferences';
begin
 select id into pid from public.professional_profiles where user_id=(select auth.uid());if pid is null then raise exception 'Professional profile required';end if;
 insert into public.professional_schedule_preferences(professional_id,max_appointments_per_day,buffer_minutes,default_duration_minutes,approval_mode) values(pid,(pref->>'max_appointments_per_day')::int,(pref->>'buffer_minutes')::int,(pref->>'default_duration_minutes')::int,pref->>'approval_mode') on conflict(professional_id) do update set max_appointments_per_day=excluded.max_appointments_per_day,buffer_minutes=excluded.buffer_minutes,default_duration_minutes=excluded.default_duration_minutes,approval_mode=excluded.approval_mode,updated_at=now();
 delete from public.professional_working_hours where professional_id=pid;
 insert into public.professional_working_hours(professional_id,day_of_week,opens_at,closes_at,is_closed) select pid,x.day_of_week,case when x.is_closed then null else x.opens_at::time end,case when x.is_closed then null else x.closes_at::time end,x.is_closed from jsonb_to_recordset(payload->'hours') as x(day_of_week smallint,opens_at text,closes_at text,is_closed boolean);
 delete from public.professional_schedule_breaks where professional_id=pid;
 insert into public.professional_schedule_breaks(professional_id,day_of_week,starts_at,ends_at,label) select pid,x.day_of_week,x.starts_at::time,x.ends_at::time,coalesce(x.label,'Break') from jsonb_to_recordset(payload->'breaks') as x(day_of_week smallint,starts_at text,ends_at text,label text);
 delete from public.professional_schedule_blocks where professional_id=pid;
 insert into public.professional_schedule_blocks(professional_id,starts_at,ends_at,label) select pid,x.starts_at::timestamptz,x.ends_at::timestamptz,coalesce(x.label,'Unavailable') from jsonb_to_recordset(payload->'blocks') as x(starts_at text,ends_at text,label text);
end;$$;
revoke all on function public.get_my_schedule() from public;revoke all on function public.save_my_schedule(jsonb) from public;grant execute on function public.get_my_schedule() to authenticated;grant execute on function public.save_my_schedule(jsonb) to authenticated;
