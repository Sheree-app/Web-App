-- A beautician's full booking ledger: everything still ahead and everything in
-- the book. `bookings` is already readable by the professional through RLS, but
-- the client's name and avatar live on `users`, which is only readable for your
-- own row. Resolving the client therefore needs a security-definer function.
--
-- Search and pagination run in the database so a busy studio never downloads its
-- whole history to filter it on the phone.
create index if not exists bookings_professional_history_idx
  on public.bookings(professional_id, starts_at desc);

create or replace function public.get_professional_bookings(
  p_scope text default 'upcoming',
  p_search text default null,
  p_limit integer default 30,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  pid uuid;
  scope_filter text :=
    case when lower(coalesce(p_scope, '')) = 'past' then 'past' else 'upcoming' end;
  -- A pasted reference often arrives as "#SHR-1234"; the stored value has no
  -- hash, so strip the decorative prefix instead of returning no matches.
  search_term text :=
    nullif(trim(both '#' from trim(coalesce(p_search, ''))), '');
  page_limit integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  page_offset integer := greatest(coalesce(p_offset, 0), 0);
  upcoming_count integer;
  past_count integer;
  total_count integer;
  items jsonb;
begin
  select p.id into pid
  from public.professional_profiles p
  where p.user_id = auth.uid();

  -- A beautician who has not finished studio setup still gets a usable ledger
  -- screen with zero counts instead of an error page.
  if pid is null then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'total', 0,
      'counts', jsonb_build_object('upcoming', 0, 'past', 0)
    );
  end if;

  -- Counts are taken with the current search applied, so the tab badges and
  -- the "the other tab has matches" hint always agree with the list below.
  select
    (count(*) filter (
      where b.status in ('requested', 'confirmed') and b.ends_at >= now()
    ))::integer,
    (count(*) filter (
      where b.status in ('completed', 'cancelled') or b.ends_at < now()
    ))::integer
  into upcoming_count, past_count
  from public.bookings b
  join public.users u on u.id = b.customer_id
  where b.professional_id = pid
    and b.customer_id <> auth.uid()
    and (
      search_term is null
      or u.username ilike '%' || search_term || '%'
      or b.service_name ilike '%' || search_term || '%'
      or b.booking_reference ilike '%' || search_term || '%'
      or coalesce(b.notes, '') ilike '%' || search_term || '%'
    );

  total_count := case when scope_filter = 'past' then past_count else upcoming_count end;

  select coalesce(
    jsonb_agg(
      row_data
      order by start_order asc nulls last, past_order desc nulls last, id_order asc
    ),
    '[]'::jsonb
  )
  into items
  from (
    select
      jsonb_build_object(
        'id', b.id,
        'customer_id', b.customer_id,
        'booking_reference', b.booking_reference,
        'customer_name', coalesce(nullif(trim(u.username), ''), 'Client'),
        'customer_avatar', u.avatar_url,
        'service_name', b.service_name,
        'starts_at', b.starts_at,
        'ends_at', b.ends_at,
        'status', b.status,
        'payment_status', b.payment_status,
        'price', b.price,
        'deposit_amount', b.deposit_amount,
        'balance_amount', b.balance_amount,
        'sheree_fee_amount', b.sheree_fee_amount,
        'notes', b.notes,
        'is_mobile_service', b.is_mobile_service,
        'travel_fee', b.travel_fee,
        'cancellation_reason', b.cancellation_reason,
        'cancelled_at', b.cancelled_at
      ) as row_data,
      case when scope_filter = 'upcoming' then b.starts_at end as start_order,
      case when scope_filter = 'past' then b.starts_at end as past_order,
      b.id as id_order
    from public.bookings b
    join public.users u on u.id = b.customer_id
    where b.professional_id = pid
      and b.customer_id <> auth.uid()
      and (
        case when scope_filter = 'upcoming'
          then b.status in ('requested', 'confirmed') and b.ends_at >= now()
          else b.status in ('completed', 'cancelled') or b.ends_at < now()
        end
      )
      and (
        search_term is null
        or u.username ilike '%' || search_term || '%'
        or b.service_name ilike '%' || search_term || '%'
        or b.booking_reference ilike '%' || search_term || '%'
        or coalesce(b.notes, '') ilike '%' || search_term || '%'
      )
    order by
      case when scope_filter = 'upcoming' then b.starts_at end asc nulls last,
      case when scope_filter = 'past' then b.starts_at end desc nulls last,
      b.id asc
    limit page_limit
    offset page_offset
  ) rows;

  return jsonb_build_object(
    'items', items,
    'total', total_count,
    'counts', jsonb_build_object('upcoming', upcoming_count, 'past', past_count)
  );
end;
$$;

revoke all on function public.get_professional_bookings(text, text, integer, integer) from public;
grant execute on function public.get_professional_bookings(text, text, integer, integer) to authenticated;
