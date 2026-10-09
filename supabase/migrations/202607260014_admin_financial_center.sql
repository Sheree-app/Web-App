-- Weeks 7-8: complete administrative financial center.
create index if not exists payments_admin_status_created_idx on public.payments(status,created_at desc);
create index if not exists payouts_admin_status_created_idx on public.payouts(status,created_at desc);
create or replace function public.get_admin_finance_overview(period_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare days integer:=least(greatest(coalesce(period_days,30),7),365);start_at timestamptz:=date_trunc('day',now())-make_interval(days=>least(greatest(coalesce(period_days,30),7),365)-1);
begin
 if not public.admin_has_permission('payments.read')then raise exception'Payment access required'using errcode='42501';end if;
 return jsonb_build_object('period_days',days,'currency','GHS',
  'kpis',jsonb_build_object(
   'gross_volume',coalesce((select sum(amount)from public.payments where status in('paid','refund_pending','refunded')and created_at>=start_at),0),
   'successful_volume',coalesce((select sum(amount)from public.payments where status='paid'and created_at>=start_at),0),
   'refunds',coalesce((select sum(amount)from public.dispute_refunds where status='refunded'and updated_at>=start_at),0)+coalesce((select sum(refund_amount)from public.booking_cancellation_settlements where refund_status='refunded'and updated_at>=start_at),0),
   'platform_fees',coalesce((select sum(platform_fee)from public.payouts where status='paid'and created_at>=start_at),0),
   'processing_fees',coalesce((select sum(coalesce(nullif(provider_payload->'data'->>'fees','')::numeric,0)/100)from public.payments where status in('paid','refund_pending','refunded')and created_at>=start_at),0),
   'pending_payouts',coalesce((select sum(amount)from public.payouts where status in('pending','processing')),0),
   'failed_payouts',(select count(*)from public.payouts where status in('failed','reversed')),
   'net_platform_revenue',coalesce((select sum(platform_fee)from public.payouts where status='paid'and created_at>=start_at),0)-coalesce((select sum(coalesce(nullif(provider_payload->'data'->>'fees','')::numeric,0)/100)from public.payments where status in('paid','refund_pending','refunded')and created_at>=start_at),0)
  ),
  'revenue_series',coalesce((select jsonb_agg(jsonb_build_object('date',day::date,'gross',coalesce(x.gross,0),'fees',coalesce(x.fees,0),'transactions',coalesce(x.transactions,0))order by day)
   from generate_series(start_at,date_trunc('day',now()),interval'1 day')day left join lateral(
    select sum(p.amount)gross,sum(coalesce(nullif(p.provider_payload->'data'->>'fees','')::numeric,0)/100)fees,count(*)transactions from public.payments p where p.status in('paid','refund_pending','refunded')and p.created_at>=day and p.created_at<day+interval'1 day')x on true),'[]'::jsonb),
  'channel_fees',coalesce((select jsonb_agg(to_jsonb(x)order by x.volume desc)from(
   select coalesce(channel,'unknown')channel,count(*)transactions,sum(amount)volume,sum(coalesce(nullif(provider_payload->'data'->>'fees','')::numeric,0)/100)processing_fees
   from public.payments where status in('paid','refund_pending','refunded')and created_at>=start_at group by channel)x),'[]'::jsonb),
  'payout_status',coalesce((select jsonb_agg(jsonb_build_object('status',status,'count',total,'amount',amount)order by total desc)from(
   select status,count(*)total,coalesce(sum(amount),0)amount from public.payouts group by status)x),'[]'::jsonb)
 );
end $$;
create or replace function public.get_admin_transactions(search_query text default'',status_filter text default'all',date_from timestamptz default null,date_to timestamptz default null,page_number integer default 1,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));requested text:=lower(coalesce(status_filter,'all'));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),5000);
begin
 if not public.admin_has_permission('payments.read')then raise exception'Payment access required'using errcode='42501';end if;
 return(with ledger as(select p.id,p.provider_reference,p.amount,p.currency,p.status::text status,p.channel,p.gateway_response,p.created_at,p.paid_at,
  coalesce(nullif(p.provider_payload->'data'->>'fees','')::numeric,0)/100 processing_fee,b.id booking_id,b.booking_reference,b.service_name,
  cu.full_name customer_name,coalesce(pp.display_name,pp.business_name)professional_name
  from public.payments p join public.bookings b on b.id=p.booking_id join public.users cu on cu.id=p.customer_id join public.professional_profiles pp on pp.id=b.professional_id),
 filtered as(select*from ledger x where(requested='all'or x.status=requested)and(date_from is null or x.created_at>=date_from)and(date_to is null or x.created_at<date_to)and(query=''or x.provider_reference ilike'%'||query||'%'or coalesce(x.booking_reference,'')ilike'%'||query||'%'or x.customer_name ilike'%'||query||'%'or x.professional_name ilike'%'||query||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select*from filtered order by created_at desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size));
end $$;
create or replace function public.get_admin_payouts(search_query text default'',status_filter text default'all',page_number integer default 1,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));requested text:=lower(coalesce(status_filter,'all'));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),5000);
begin
 if not public.admin_has_permission('payments.read')then raise exception'Payment access required'using errcode='42501';end if;
 return(with ledger as(select po.id,po.amount,po.currency,po.status,po.provider_reference,po.failure_reason,po.created_at,po.paid_at,po.payout_type,po.deposit_amount,po.platform_fee,po.service_price,
  pp.id professional_id,coalesce(pp.display_name,pp.business_name)professional_name,b.id booking_id,b.booking_reference,b.service_name,
  pa.institution_name,pa.account_name,pa.account_last4,pa.paystack_subaccount_code
  from public.payouts po join public.professional_profiles pp on pp.id=po.professional_id left join public.bookings b on b.id=po.booking_id left join public.professional_payout_accounts pa on pa.professional_id=pp.id),
 filtered as(select*from ledger x where(requested='all'or x.status=requested)and(query=''or coalesce(x.provider_reference,'')ilike'%'||query||'%'or coalesce(x.booking_reference,'')ilike'%'||query||'%'or x.professional_name ilike'%'||query||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select*from filtered order by created_at desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size));
end $$;
create or replace function public.get_admin_refunds(search_query text default'',status_filter text default'all',page_number integer default 1,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));requested text:=lower(coalesce(status_filter,'all'));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),5000);
begin
 if not public.admin_has_permission('payments.read')then raise exception'Payment access required'using errcode='42501';end if;
 return(with ledger as(
  select dr.id,'dispute'::text source,dr.amount,dr.currency,dr.status,dr.reason,dr.provider_refund_id,dr.created_at,dr.updated_at,
   p.provider_reference transaction_reference,b.id booking_id,b.booking_reference,b.service_name,cu.full_name customer_name,d.id dispute_id
  from public.dispute_refunds dr join public.payments p on p.id=dr.payment_id join public.bookings b on b.id=p.booking_id join public.users cu on cu.id=b.customer_id join public.disputes d on d.id=dr.dispute_id
  union all
  select s.booking_id,'cancellation',s.refund_amount,'GHS',s.refund_status,coalesce(b.cancellation_reason,'Booking cancellation'),s.provider_refund_id,s.created_at,s.updated_at,
   p.provider_reference,b.id,b.booking_reference,b.service_name,cu.full_name,null::uuid
  from public.booking_cancellation_settlements s join public.bookings b on b.id=s.booking_id join public.users cu on cu.id=b.customer_id left join lateral(select provider_reference from public.payments where booking_id=b.id order by created_at desc limit 1)p on true),
 filtered as(select*from ledger x where(requested='all'or x.status=requested)and(query=''or coalesce(x.provider_refund_id,'')ilike'%'||query||'%'or coalesce(x.transaction_reference,'')ilike'%'||query||'%'or coalesce(x.booking_reference,'')ilike'%'||query||'%'or x.customer_name ilike'%'||query||'%'))
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.created_at desc)from(select*from filtered order by created_at desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size));
end $$;
create or replace function public.get_admin_professional_balances(search_query text default'',page_number integer default 1,page_size integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare query text:=trim(coalesce(search_query,''));page integer:=greatest(page_number,1);size integer:=least(greatest(page_size,1),5000);
begin
 if not public.admin_has_permission('payments.read')then raise exception'Payment access required'using errcode='42501';end if;
 return(with balances as(select pp.id professional_id,coalesce(pp.display_name,pp.business_name)professional_name,pp.profile_photo_url,
  coalesce(sum(po.amount)filter(where po.status='paid'),0)paid,coalesce(sum(po.amount)filter(where po.status in('pending','processing')),0)pending,
  coalesce(sum(po.amount)filter(where po.status in('failed','reversed')),0)attention,coalesce(sum(po.platform_fee)filter(where po.status='paid'),0)platform_fees,
  count(po.id)filter(where po.status='paid')payout_count,pa.institution_name,pa.account_name,pa.account_last4,(pa.paystack_subaccount_code is not null)account_configured
  from public.professional_profiles pp left join public.payouts po on po.professional_id=pp.id left join public.professional_payout_accounts pa on pa.professional_id=pp.id group by pp.id,pa.institution_name,pa.account_name,pa.account_last4,pa.paystack_subaccount_code),
 filtered as(select*from balances x where query=''or x.professional_name ilike'%'||query||'%')
 select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(x)order by x.paid desc)from(select*from filtered order by paid desc limit size offset(page-1)*size)x),'[]'::jsonb),'total',(select count(*)from filtered),'page',page,'page_size',size));
end $$;
revoke all on function public.get_admin_finance_overview(integer),public.get_admin_transactions(text,text,timestamptz,timestamptz,integer,integer),public.get_admin_payouts(text,text,integer,integer),public.get_admin_refunds(text,text,integer,integer),public.get_admin_professional_balances(text,integer,integer)from public,anon;
grant execute on function public.get_admin_finance_overview(integer),public.get_admin_transactions(text,text,timestamptz,timestamptz,integer,integer),public.get_admin_payouts(text,text,integer,integer),public.get_admin_refunds(text,text,integer,integer),public.get_admin_professional_balances(text,integer,integer)to authenticated;
