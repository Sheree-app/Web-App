-- Week 6: disputes, internal notes, and refund decision records.
create table public.disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  opened_by uuid references public.users(id) on delete set null,
  opened_by_role text not null check(opened_by_role in('customer','professional','admin')),
  category text not null check(category in('service_quality','no_show','cancellation','payment','conduct','other')),
  subject text not null check(char_length(trim(subject)) between 3 and 160),
  description text not null check(char_length(trim(description)) between 10 and 3000),
  status text not null default 'open' check(status in('open','investigating','resolved')),
  resolution text check(char_length(resolution)<=3000),
  assigned_to uuid references public.admin_users(user_id) on delete set null,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),resolved_at timestamptz
);
create table public.dispute_notes(
  id uuid primary key default gen_random_uuid(),dispute_id uuid not null references public.disputes(id) on delete cascade,
  author_id uuid not null references public.admin_users(user_id) on delete restrict,
  body text not null check(char_length(trim(body)) between 2 and 3000),created_at timestamptz not null default now()
);
create table public.dispute_refunds(
  id uuid primary key default gen_random_uuid(),dispute_id uuid not null references public.disputes(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,amount numeric(10,2) not null check(amount>0),
  currency text not null default 'GHS',status text not null default 'requested'
    check(status in('requested','approved','denied','processing','needs_attention','refunded','failed')),
  reason text not null check(char_length(trim(reason)) between 5 and 1000),
  decided_by uuid references public.admin_users(user_id) on delete restrict,decided_at timestamptz,
  provider_refund_id text,provider_payload jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index dispute_refunds_active_payment_idx on public.dispute_refunds(payment_id)
  where status in('requested','approved','processing','needs_attention');
create index disputes_status_created_idx on public.disputes(status,created_at desc);
create index dispute_notes_dispute_idx on public.dispute_notes(dispute_id,created_at);
create trigger disputes_set_updated_at before update on public.disputes for each row execute function public.set_updated_at();
create trigger dispute_refunds_set_updated_at before update on public.dispute_refunds for each row execute function public.set_updated_at();
alter table public.disputes enable row level security;
alter table public.dispute_notes enable row level security;
alter table public.dispute_refunds enable row level security;
create policy "support admins read disputes" on public.disputes for select to authenticated using(public.admin_has_permission('support.manage'));
create policy "support admins read notes" on public.dispute_notes for select to authenticated using(public.admin_has_permission('support.manage'));
create policy "support admins read dispute refunds" on public.dispute_refunds for select to authenticated using(public.admin_has_permission('support.manage'));
revoke all on public.disputes,public.dispute_notes,public.dispute_refunds from anon,authenticated;
grant select on public.disputes,public.dispute_notes,public.dispute_refunds to authenticated;
create or replace function public.submit_booking_dispute(
 booking_id uuid,dispute_category text,dispute_subject text,dispute_description text,requested_refund numeric default null
)returns jsonb language plpgsql security definer set search_path='' as $$
declare booking record;new_dispute uuid;paid_payment record;caller_role text;
begin
 select b.id,b.customer_id,p.user_id professional_user into booking from public.bookings b
 join public.professional_profiles p on p.id=b.professional_id where b.id=booking_id;
 if not found or (select auth.uid())not in(booking.customer_id,booking.professional_user)then raise exception'Booking not found'using errcode='P0002';end if;
 caller_role:=case when(select auth.uid())=booking.customer_id then'customer'else'professional'end;
 if dispute_category not in('service_quality','no_show','cancellation','payment','conduct','other')then raise exception'Invalid dispute category';end if;
 if char_length(trim(dispute_subject))<3 or char_length(trim(dispute_description))<10 then raise exception'More dispute detail is required';end if;
 if exists(select 1 from public.disputes d where d.booking_id=booking_id and d.status<>'resolved')then raise exception'An active dispute already exists for this booking';end if;
 insert into public.disputes(booking_id,opened_by,opened_by_role,category,subject,description)
 values(booking_id,(select auth.uid()),caller_role,dispute_category,trim(dispute_subject),trim(dispute_description))returning id into new_dispute;
 if requested_refund is not null and requested_refund>0 then
  if caller_role<>'customer'then raise exception'Only the paying customer can request a refund';end if;
  select id,amount,currency into paid_payment from public.payments where booking_id=booking.id and status in('paid','refund_pending')order by created_at desc limit 1;
  if not found or requested_refund>paid_payment.amount then raise exception'Refund exceeds the paid amount';end if;
  insert into public.dispute_refunds(dispute_id,payment_id,amount,currency,status,reason)
  values(new_dispute,paid_payment.id,requested_refund,paid_payment.currency,'requested','Requested when dispute was filed');
 end if;
 return jsonb_build_object('id',new_dispute,'status','open');
end $$;
create or replace function public.get_admin_disputes(search_query text default'',status_filter text default'all',page_number integer default 1,page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));requested text:=lower(coalesce(status_filter,'all'));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),100);
begin
 if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501';end if;
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
 if not public.admin_has_permission('support.manage') then raise exception 'Support access required' using errcode='42501';end if;
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
 if not public.admin_has_permission('support.manage')then raise exception'Support access required'using errcode='42501';end if;
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
 if not public.admin_has_permission('support.manage')then raise exception'Support access required'using errcode='42501';end if;
 if char_length(clean)<2 then raise exception'Note is too short';end if;
 insert into public.dispute_notes(dispute_id,author_id,body)values(dispute_id,(select auth.uid()),clean)returning id into note_id;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'dispute.note','dispute',dispute_id,'Added internal dispute note',jsonb_build_object('note_id',note_id));
 return jsonb_build_object('id',note_id);
end $$;
create or replace function public.admin_deny_dispute_refund(refund_id uuid,denial_reason text)returns jsonb language plpgsql security definer set search_path='' as $$
declare dispute uuid;clean text:=trim(coalesce(denial_reason,''));
begin
 if not public.admin_has_permission('payments.manage')then raise exception'Payment management access required'using errcode='42501';end if;
 if char_length(clean)<5 then raise exception'A denial reason is required';end if;
 update public.dispute_refunds set status='denied',reason=clean,decided_by=(select auth.uid()),decided_at=now()where id=refund_id and status='requested' returning dispute_id into dispute;
 if not found then raise exception'Refund request is not pending';end if;
 insert into public.admin_audit_logs(actor_id,action,resource_type,resource_id,summary,metadata)values((select auth.uid()),'refund.denied','dispute_refund',refund_id,'Denied dispute refund',jsonb_build_object('reason',clean,'dispute_id',dispute));
 return jsonb_build_object('id',refund_id,'status','denied');
end $$;
revoke all on function public.get_admin_disputes(text,text,integer,integer),public.get_admin_dispute(uuid),public.admin_update_dispute(uuid,text,text),public.admin_add_dispute_note(uuid,text),public.admin_deny_dispute_refund(uuid,text),public.submit_booking_dispute(uuid,text,text,text,numeric)from public,anon;
grant execute on function public.get_admin_disputes(text,text,integer,integer),public.get_admin_dispute(uuid),public.admin_update_dispute(uuid,text,text),public.admin_add_dispute_note(uuid,text),public.admin_deny_dispute_refund(uuid,text)to authenticated;
grant execute on function public.submit_booking_dispute(uuid,text,text,text,numeric)to authenticated;
