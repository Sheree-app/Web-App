-- Weeks 9-10: content moderation and professional verification.
alter table public.feed_posts add column if not exists moderation_status text not null default'clean'check(moderation_status in('clean','flagged','removed')),
 add column if not exists moderation_reason text,add column if not exists moderated_at timestamptz,add column if not exists moderated_by uuid references public.admin_users(user_id)on delete set null;
alter table public.professional_profiles add column if not exists is_featured boolean not null default false,add column if not exists featured_at timestamptz;
alter table public.professional_verification_documents add column if not exists reviewed_by uuid references public.admin_users(user_id)on delete set null,add column if not exists review_notes text;
create table public.content_reports(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.feed_posts(id)on delete cascade,reporter_id uuid references public.users(id)on delete set null,reason text not null check(char_length(trim(reason))between 3 and 1000),status text not null default'open'check(status in('open','actioned','dismissed')),created_at timestamptz not null default now(),reviewed_at timestamptz,reviewed_by uuid references public.admin_users(user_id)on delete set null);
create table public.moderation_flags(id uuid primary key default gen_random_uuid(),post_id uuid not null references public.feed_posts(id)on delete cascade,source text not null check(source in('automated','manual','provider')),category text not null,confidence numeric(5,4)check(confidence between 0 and 1),details jsonb not null default'{}',status text not null default'open'check(status in('open','actioned','dismissed')),created_at timestamptz not null default now(),reviewed_at timestamptz,reviewed_by uuid references public.admin_users(user_id)on delete set null);
create index content_reports_status_idx on public.content_reports(status,created_at desc);
create index moderation_flags_status_idx on public.moderation_flags(status,created_at desc);
create index verification_admin_status_idx on public.professional_verification_documents(status,submitted_at);
alter table public.content_reports enable row level security;
alter table public.moderation_flags enable row level security;
create policy"users report content"on public.content_reports for insert to authenticated with check(reporter_id=(select auth.uid()));
create policy"moderators read reports"on public.content_reports for select to authenticated using(public.admin_has_permission('moderation.manage'));
create policy"moderators read flags"on public.moderation_flags for select to authenticated using(public.admin_has_permission('moderation.manage'));
revoke all on public.content_reports,public.moderation_flags from anon,authenticated;
grant insert on public.content_reports to authenticated;
grant select on public.content_reports,public.moderation_flags to authenticated;
create or replace function public.get_admin_moderation(
  queue_filter text default 'reported',
  search_query text default '',
  page_number integer default 1,
  page_size integer default 24
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  queue text := lower(coalesce(queue_filter, 'reported'));
  query text := trim(coalesce(search_query, ''));
  page integer := greatest(page_number, 1);
  size integer := least(greatest(page_size, 1), 100);
  result jsonb;
begin
  if not public.admin_has_permission('moderation.manage') then
    raise exception 'Moderation access required' using errcode='42501';
  end if;

  with posts as (
    select fp.id, fp.image_url, fp.caption, fp.is_published, fp.moderation_status,
      fp.moderation_reason, fp.created_at, pp.id professional_id,
      coalesce(pp.display_name, pp.business_name) professional_name,
      pp.profile_photo_url, pp.is_featured,
      (select count(*) from public.content_reports r where r.post_id=fp.id and r.status='open') report_count,
      (select count(*) from public.moderation_flags f where f.post_id=fp.id and f.status='open') flag_count,
      (select max(f.confidence) from public.moderation_flags f where f.post_id=fp.id and f.status='open') max_confidence,
      coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'reason',r.reason,'created_at',r.created_at) order by r.created_at desc)
        from public.content_reports r where r.post_id=fp.id and r.status='open'), '[]'::jsonb) reports,
      coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'source',f.source,'category',f.category,'confidence',f.confidence,'details',f.details,'created_at',f.created_at) order by f.created_at desc)
        from public.moderation_flags f where f.post_id=fp.id and f.status='open'), '[]'::jsonb) flags,
      coalesce((select jsonb_agg(i.image_url order by i.sort_order) from public.feed_post_images i where i.post_id=fp.id),
        jsonb_build_array(fp.image_url)) images
    from public.feed_posts fp
    join public.professional_profiles pp on pp.id=fp.professional_id
  ),
  filtered as (
    select * from posts p
    where (
      (queue='reported' and p.report_count>0) or
      (queue='automated' and p.flag_count>0) or
      (queue='removed' and p.moderation_status='removed') or
      (queue='featured' and p.is_featured) or queue='all'
    ) and (query='' or p.caption ilike '%'||query||'%' or p.professional_name ilike '%'||query||'%')
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc)
      from (select * from filtered order by created_at desc limit size offset (page-1)*size) x), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', page,
    'page_size', size,
    'counts', jsonb_build_object(
      'reported', (select count(*) from posts where report_count>0),
      'automated', (select count(*) from posts where flag_count>0),
      'removed', (select count(*) from posts where moderation_status='removed'),
      'featured', (select count(*) from posts where is_featured)
    )
  ) into result;

  return result;
end
$$;
create or replace function public.admin_moderate_post(target_post_id uuid,moderation_action text,reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare action text:=lower(trim(moderation_action));professional uuid;clean text:=trim(coalesce(reason,''));
begin if not public.admin_has_permission('moderation.manage')then raise exception'Moderation access required'using errcode='42501';end if;if action not in('remove','restore','dismiss','feature','unfeature')then raise exception'Invalid moderation action';end if;if action='remove'and char_length(clean)<5 then raise exception'A removal reason is required';end if;
 select professional_id into professional from public.feed_posts where id=target_post_id for update;if not found then raise exception'Post not found';end if;
 if action='remove'then update public.feed_posts set is_published=false,moderation_status='removed',moderation_reason=clean,moderated_at=now(),moderated_by=(select auth.uid())where id=target_post_id;
 elsif action='restore'then update public.feed_posts set is_published=true,moderation_status='clean',moderation_reason=null,moderated_at=now(),moderated_by=(select auth.uid())where id=target_post_id;
 elsif action='feature'then update public.professional_profiles set is_featured=true,featured_at=now()where id=professional;
 elsif action='unfeature'then update public.professional_profiles set is_featured=false,featured_at=null where id=professional;end if;
 if action in('remove','dismiss')then update public.content_reports set status=case when action='remove'then'actioned'else'dismissed'end,reviewed_at=now(),reviewed_by=(select auth.uid())where content_reports.post_id=target_post_id and status='open';update public.moderation_flags set status=case when action='remove'then'actioned'else'dismissed'end,reviewed_at=now(),reviewed_by=(select auth.uid())where moderation_flags.post_id=target_post_id and status='open';end if;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'moderation.'||action,'feed_post',target_post_id,initcap(action)||' feed post',jsonb_build_object('reason',clean,'professional_id',professional));
 return jsonb_build_object('id',target_post_id,'action',action);
end $$;
create or replace function public.get_admin_verification(
  status_filter text default 'pending',
  search_query text default '',
  page_number integer default 1,
  page_size integer default 20
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  requested text := lower(coalesce(status_filter, 'pending'));
  query text := trim(coalesce(search_query, ''));
  page integer := greatest(page_number, 1);
  size integer := least(greatest(page_size, 1), 100);
  result jsonb;
begin
  if not public.admin_has_permission('verification.manage') then
    raise exception 'Verification access required' using errcode='42501';
  end if;

  with verification_queue as (
    select d.id, d.professional_id, d.document_type::text document_type,
      d.status::text status, d.submitted_at, d.reviewed_at, d.rejection_reason,
      d.review_notes, coalesce(pp.display_name,pp.business_name) professional_name,
      pp.business_name, pp.profile_photo_url, pp.location, pp.years_experience,
      pp.is_verified, u.phone,
      (select count(*) from public.professional_portfolio_items pi where pi.professional_id=pp.id) portfolio_count,
      coalesce((select jsonb_agg(jsonb_build_object('id',pi.id,'path',pi.storage_path,'caption',pi.caption) order by pi.sort_order)
        from public.professional_portfolio_items pi where pi.professional_id=pp.id), '[]'::jsonb) portfolio
    from public.professional_verification_documents d
    join public.professional_profiles pp on pp.id=d.professional_id
    join public.users u on u.id=pp.user_id
  ),
  filtered as (
    select * from verification_queue q
    where (requested='all' or q.status=requested)
      and (query='' or q.professional_name ilike '%'||query||'%' or q.business_name ilike '%'||query||'%')
  )
  select jsonb_build_object(
    'items', coalesce((select jsonb_agg(to_jsonb(x) order by x.submitted_at)
      from (select * from filtered order by submitted_at limit size offset (page-1)*size) x), '[]'::jsonb),
    'total', (select count(*) from filtered),
    'page', page,
    'page_size', size,
    'counts', jsonb_build_object(
      'pending', (select count(*) from verification_queue where status='pending'),
      'under_review', (select count(*) from verification_queue where status='under_review'),
      'approved', (select count(*) from verification_queue where status='approved'),
      'rejected', (select count(*) from verification_queue where status='rejected')
    )
  ) into result;

  return result;
end
$$;
create or replace function public.admin_review_verification(target_document_id uuid,decision text,review_reason text default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare action text:=lower(trim(decision));professional uuid;clean text:=trim(coalesce(review_reason,''));
begin if not public.admin_has_permission('verification.manage')then raise exception'Verification access required'using errcode='42501';end if;if action not in('under_review','approved','rejected')then raise exception'Invalid verification decision';end if;if action='rejected'and char_length(clean)<5 then raise exception'A rejection reason is required';end if;
 update public.professional_verification_documents set status=action::public.verification_status,rejection_reason=case when action='rejected'then clean else null end,review_notes=case when action<>'rejected'then clean else null end,reviewed_at=case when action in('approved','rejected')then now()else null end,reviewed_by=(select auth.uid())where id=target_document_id returning professional_id into professional;if not found then raise exception'Document not found';end if;
 update public.professional_profiles pp set is_verified=exists(select 1 from public.professional_verification_documents d where d.professional_id=professional and d.document_type='identity'and d.status='approved')and not exists(select 1 from public.professional_verification_documents d where d.professional_id=professional and d.status<>'approved')where pp.id=professional;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'verification.'||action,'verification_document',target_document_id,initcap(replace(action,'_',' '))||' verification document',jsonb_build_object('reason',clean,'professional_id',professional));
 return jsonb_build_object('id',target_document_id,'status',action,'professional_id',professional);
end $$;
revoke all on function public.get_admin_moderation(text,text,integer,integer),public.admin_moderate_post(uuid,text,text),public.get_admin_verification(text,text,integer,integer),public.admin_review_verification(uuid,text,text)from public,anon;
grant execute on function public.get_admin_moderation(text,text,integer,integer),public.admin_moderate_post(uuid,text,text),public.get_admin_verification(text,text,integer,integer),public.admin_review_verification(uuid,text,text)to authenticated;
