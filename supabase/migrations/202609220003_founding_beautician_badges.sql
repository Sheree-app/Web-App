-- Founding Beautician badges.
--
-- Sheree's early-adopter status: the first 60 *qualifying* professionals in each
-- beauty category earn a pink "Founding Beautician" badge. This is deliberately
-- NOT the blue "Verified Professional" badge (`professional_profiles.is_verified`,
-- driven by `professional_verification_documents`) and it renames nothing that
-- already exists. A professional can hold both.
--
-- What the existing application already defines, and what this migration reuses
-- instead of inventing a parallel system:
--
--   * active/approved professional = `users.role='professional'` AND
--     `users.account_status='active'` (the existing account-status enum added in
--     202607260008_admin_beauticians.sql) AND `professional_profiles.deleted_at is null`
--     AND onboarding finished (`professional_profiles.onboarding_completed_at is not null`).
--   * category        = `professional_categories` -> `interests` (never hard-coded).
--   * service         = `professional_services` where `is_active`.
--   * portfolio media = `professional_portfolio_items` or a published `feed_posts` row.
--
-- QUALIFICATION IS PER CATEGORY. A professional qualifies in a category when they
-- are an approved professional AND the category is one they selected AND they have
-- at least one active service in that category AND they have at least one portfolio
-- image/post. This is why merely adding a second category does not hand somebody a
-- founding position in it: they must actually build a service for it. Services
-- with no category (`interest_id is null`) count for the professional's *primary*
-- category, so an early profile that never tagged a service is not punished.
-- Portfolio items carry no category column, so any portfolio image satisfies the
-- media requirement; a published post additionally satisfies it per category.
--
-- ASSUMPTION (the brief asks that ambiguity in existing data not be silently
-- invented): there is no historical "qualified_at" column, so the moment a
-- professional qualified *in a category* is reconstructed as the last requirement
-- they satisfied for it:
--
--   qualifying_at = greatest(onboarding_completed_at, first_service_at, first_media_at)
--
-- Ties (identical timestamps) are broken by `professional_profiles.id`, so the
-- backfill is deterministic and re-runnable. `qualifying_at` is stored on every row
-- so administrators can audit *why* a professional holds a given position;
-- `awarded_at` records when the row was actually written.
--
-- ATOMICITY: allocation happens server-side inside `award_founding_badges`, which
-- takes a per-category transaction advisory lock before computing the next
-- position. Two professionals finishing at the same instant can therefore never
-- receive the same position, and a category can never exceed its allocation. The
-- limit is additionally enforced by a CHECK constraint and two unique constraints,
-- so no code path (trigger, backfill or a future caller) can violate it. The client
-- is never asked whether a badge was earned.

-- The single tunable for the feature. Categories are discovered from the database,
-- so a category added later gets the same 60-position allocation automatically.
create or replace function public.founding_limit_per_category()
returns smallint language sql immutable set search_path='' as $$
  select 60::smallint
$$;

-- `if not exists` throughout this migration's DDL keeps it safe to re-run against a
-- database where it has already been applied (see scripts/run-sql.mjs).
create table if not exists public.professional_founding_badges (
  id uuid primary key default gen_random_uuid(),
  professional_id uuid not null references public.professional_profiles(id) on delete cascade,
  category_id uuid not null references public.interests(id) on delete restrict,
  -- 1..60. The upper bound must stay equal to founding_limit_per_category(); it is
  -- the last line of defence against a category ever exceeding its allocation
  -- (supabase/tests/founding_beautician.sql asserts that the two agree).
  founding_position smallint not null check (founding_position between 1 and 60),
  -- When the professional actually qualified in this category (see the assumption above).
  qualifying_at timestamptz not null,
  awarded_at timestamptz not null default now(),
  -- One founding achievement per professional per category...
  unique (professional_id, category_id),
  -- ...and one professional per position, forever. Positions are never recycled:
  -- the allocator always moves forward, even if an earlier holder is removed.
  unique (category_id, founding_position)
);

create index if not exists professional_founding_badges_professional_idx
  on public.professional_founding_badges(professional_id);
create index if not exists professional_founding_badges_category_idx
  on public.professional_founding_badges(category_id, founding_position);

-- Cheap read path for profile/feed/discovery queries: they already batch-load
-- `professional_profiles`, so they can select this flag instead of re-deriving
-- eligibility on every render. The badge table above remains the source of truth
-- (positions, categories, dates); this is a denormalised "has any badge" hint.
alter table public.professional_profiles
  add column if not exists is_founding_beautician boolean not null default false;
create index if not exists professional_profiles_founding_idx
  on public.professional_profiles(is_founding_beautician) where is_founding_beautician;

-- Badges are public identity, so they are world-readable like the rest of the
-- public profile surface, and completely unwritable from the client: assignment is
-- server-authoritative (see the access-control note at the bottom).
alter table public.professional_founding_badges enable row level security;
drop policy if exists "founding badges are public" on public.professional_founding_badges;
create policy "founding badges are public" on public.professional_founding_badges
  for select to anon, authenticated using (true);
revoke all on public.professional_founding_badges from anon, authenticated;
grant select on public.professional_founding_badges to anon, authenticated;

-- Award the badge for every qualifying category of one professional.
--
-- Idempotent and monotonic: it only ever inserts, never updates a position and
-- never removes a badge. Permanence is therefore structural — later edits to
-- services, prices, bio, portfolio, categories or a temporary suspension cannot
-- take a badge away. Deletion follows the existing account rules: the cascade on
-- `professional_profiles.id` (itself cascaded from `users`) removes the rows.
create or replace function public.award_founding_badges(p_professional_id uuid)
returns smallint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_limit smallint := public.founding_limit_per_category();
  v_profile record;
  v_category record;
  v_service_at timestamptz;
  v_media_at timestamptz;
  v_qualifying_at timestamptz;
  v_position smallint;
  v_total smallint;
begin
  if p_professional_id is null then return 0; end if;

  select p.id, p.onboarding_completed_at,
    (u.role='professional' and u.account_status='active' and p.deleted_at is null) as approved
  into v_profile
  from public.professional_profiles p
  join public.users u on u.id=p.user_id
  where p.id=p_professional_id;

  -- Not an approved professional (or onboarding unfinished): nothing to award.
  -- Existing badges are left untouched, which is what makes a suspension safe.
  if not found or not v_profile.approved or v_profile.onboarding_completed_at is null then
    return 0;
  end if;

  -- Fast exit on the hot write path (every portfolio upload / service edit / post):
  -- once every category holds a badge and the cached flag is set there is no work
  -- left, even if the professional later adds categories they already cover.
  if (select is_founding_beautician from public.professional_profiles where id=p_professional_id)
    and not exists (
      select 1 from public.professional_categories pc
      where pc.professional_id=p_professional_id
        and not exists (
          select 1 from public.professional_founding_badges b
          where b.professional_id=pc.professional_id and b.category_id=pc.interest_id
        )
    )
  then
    return (select count(*)::smallint from public.professional_founding_badges where professional_id=p_professional_id);
  end if;

  -- Categories ordered by id so concurrent transactions always take the
  -- per-category locks in the same order and cannot deadlock each other.
  for v_category in
    select pc.interest_id as category_id, pc.is_primary
    from public.professional_categories pc
    join public.interests i on i.id=pc.interest_id and i.is_active
    where pc.professional_id=p_professional_id
      and not exists (
        select 1 from public.professional_founding_badges b
        where b.professional_id=pc.professional_id and b.category_id=pc.interest_id
      )
    order by pc.interest_id
  loop
    -- A service in this category. A service with no category counts for the
    -- professional's primary category (legacy onboarding profiles).
    select min(s.created_at) into v_service_at
    from public.professional_services s
    where s.professional_id=p_professional_id
      and s.is_active
      and (
        s.interest_id=v_category.category_id
        or (s.interest_id is null and v_category.is_primary)
      );

    -- Media: a published post in this category, or any portfolio image.
    select min(m.created_at) into v_media_at
    from (
      select fp.created_at
      from public.feed_posts fp
      where fp.professional_id=p_professional_id
        and fp.is_published
        and fp.interest_id=v_category.category_id
      union all
      select pi.created_at
      from public.professional_portfolio_items pi
      where pi.professional_id=p_professional_id
    ) m;

    -- Not built out in this category yet: no badge here. A badge already earned in
    -- another category (or for this one on an earlier pass) is never touched.
    if v_service_at is null or v_media_at is null then continue; end if;

    v_qualifying_at := greatest(v_profile.onboarding_completed_at, v_service_at, v_media_at);

    -- Atomically reserve the next position for THIS category. Held until the
    -- transaction ends, so a concurrent award for the same category waits here
    -- rather than reading the same count and handing out the same position.
    perform pg_advisory_xact_lock(hashtextextended('sheree:founding:'||v_category.category_id::text, 0));

    -- Monotonic, never recycled: max+1 rather than count+1, so removing an earlier
    -- holder can never hand their position to somebody else.
    select coalesce(max(b.founding_position),0)+1 into v_position
    from public.professional_founding_badges b
    where b.category_id=v_category.category_id;

    -- Category allocation exhausted; it stays closed.
    if v_position > v_limit then continue; end if;

    insert into public.professional_founding_badges(
      professional_id, category_id, founding_position, qualifying_at
    ) values (p_professional_id, v_category.category_id, v_position, v_qualifying_at)
    on conflict do nothing;
  end loop;

  select count(*)::smallint into v_total
  from public.professional_founding_badges where professional_id=p_professional_id;

  -- Only touch the profile row when the professional actually holds a badge AND the
  -- cached flag is out of date. Checking v_total first is what stops an approved
  -- professional who is merely not yet qualified (no service, or a full category)
  -- from being flagged; the WHERE clause makes a repeat call a no-op, which is what
  -- keeps the trigger path recursion-free.
  if v_total > 0 then
    update public.professional_profiles
    set is_founding_beautician=true
    where id=p_professional_id and not is_founding_beautician;
  end if;

  return v_total;
end;
$$;

-- Trigger entry point for every qualifying signal. One function handles all the
-- tables so the award path has exactly one implementation.
create or replace function public.founding_badges_sync()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_profile uuid;
  v_user uuid;
begin
  -- TG_OP rather than coalesce(NEW, OLD): on a DELETE trigger NEW is not the row,
  -- so reading it would be meaningless rather than merely null.
  if tg_table_name = 'users' then
    v_user := case when tg_op = 'DELETE' then old.id else new.id end;
    for v_profile in select id from public.professional_profiles where user_id=v_user loop
      perform public.award_founding_badges(v_profile);
    end loop;
    return null;
  end if;

  if tg_table_name = 'professional_profiles' then
    v_profile := case when tg_op = 'DELETE' then old.id else new.id end;
  else
    v_profile := case when tg_op = 'DELETE' then old.professional_id else new.professional_id end;
  end if;

  perform public.award_founding_badges(v_profile);
  return null;
end;
$$;

-- Every write that can complete a professional's eligibility runs the same
-- idempotent award function.
create or replace trigger professional_profiles_founding_badges
  after insert or update of onboarding_completed_at, deleted_at, user_id
  on public.professional_profiles
  for each row execute function public.founding_badges_sync();

create or replace trigger professional_categories_founding_badges
  after insert or delete on public.professional_categories
  for each row execute function public.founding_badges_sync();

create or replace trigger professional_services_founding_badges
  after insert or delete or update of is_active, professional_id, interest_id
  on public.professional_services
  for each row execute function public.founding_badges_sync();

create or replace trigger professional_portfolio_items_founding_badges
  after insert or delete on public.professional_portfolio_items
  for each row execute function public.founding_badges_sync();

create or replace trigger feed_posts_founding_badges
  after insert or delete or update of is_published, professional_id, interest_id
  on public.feed_posts
  for each row execute function public.founding_badges_sync();

create or replace trigger users_founding_badges
  after update of account_status, role on public.users
  for each row execute function public.founding_badges_sync();

-- Reconstruct the allocation for professionals who already existed when the
-- feature shipped, using the qualifying timestamps described in the header.
-- Idempotent: already-awarded pairs are skipped, so it is safe to re-run.
create or replace function public.backfill_founding_badges()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  v_limit smallint := public.founding_limit_per_category();
  v_inserted integer := 0;
begin
  with eligible as (
    select
      p.id as professional_id,
      pc.interest_id as category_id,
      greatest(
        p.onboarding_completed_at,
        s.first_service_at,
        least(coalesce(fp.first_post_at, 'infinity'::timestamptz), coalesce(pi.first_portfolio_at, 'infinity'::timestamptz))
      ) as qualifying_at
    from public.professional_profiles p
    join public.users u on u.id=p.user_id
      and u.role='professional' and u.account_status='active'
    join public.professional_categories pc on pc.professional_id=p.id
    join public.interests i on i.id=pc.interest_id and i.is_active
    join lateral (
      select min(s.created_at) as first_service_at
      from public.professional_services s
      where s.professional_id=p.id and s.is_active
        and (s.interest_id=pc.interest_id or (s.interest_id is null and pc.is_primary))
    ) s on s.first_service_at is not null
    left join lateral (
      select min(f.created_at) as first_post_at
      from public.feed_posts f
      where f.professional_id=p.id and f.is_published and f.interest_id=pc.interest_id
    ) fp on true
    left join lateral (
      select min(pi.created_at) as first_portfolio_at
      from public.professional_portfolio_items pi
      where pi.professional_id=p.id
    ) pi on true
    where p.deleted_at is null
      and p.onboarding_completed_at is not null
      and coalesce(fp.first_post_at, pi.first_portfolio_at) is not null
      and not exists (
        select 1 from public.professional_founding_badges b
        where b.professional_id=p.id and b.category_id=pc.interest_id
      )
  ),
  ranked as (
    select
      e.professional_id,
      e.category_id,
      e.qualifying_at,
      -- Continue after any positions already handed out in this category.
      (
        select count(*) from public.professional_founding_badges b where b.category_id=e.category_id
      ) + row_number() over (
        partition by e.category_id order by e.qualifying_at, e.professional_id
      ) as position
    from eligible e
  ),
  inserted as (
    insert into public.professional_founding_badges(
      professional_id, category_id, founding_position, qualifying_at, awarded_at
    )
    select professional_id, category_id, position::smallint, qualifying_at, now()
    from ranked
    where position <= v_limit
    on conflict do nothing
    returning professional_id
  )
  select count(*)::integer into v_inserted from inserted;

  -- Refresh the denormalised flag for everyone who holds at least one badge.
  update public.professional_profiles p
  set is_founding_beautician=true
  where not p.is_founding_beautician
    and exists (select 1 from public.professional_founding_badges b where b.professional_id=p.id);

  return v_inserted;
end;
$$;

-- Read model: the badge, its best position and its categories for a set of
-- profiles. Lets any identity surface (profile, discover, feed, reviews,
-- messaging) resolve the same explanation without recalculating eligibility.
create or replace function public.get_founding_badges(profile_ids uuid[])
returns table(
  professional_id uuid,
  is_founding boolean,
  founding_position smallint,
  founding_categories text[],
  awarded_at timestamptz
)
language sql stable security invoker set search_path='' as $$
  with requested as (
    select distinct x as professional_id from unnest(coalesce(profile_ids, array[]::uuid[])) x
  ),
  awarded as (
    select
      b.professional_id,
      count(*) as badge_count,
      min(b.founding_position) as best_position,
      min(b.awarded_at) as first_awarded_at,
      array_agg(i.name order by b.founding_position) as categories
    from public.professional_founding_badges b
    join public.interests i on i.id=b.category_id
    where b.professional_id in (select professional_id from requested)
    group by b.professional_id
  )
  select
    r.professional_id,
    coalesce(a.badge_count,0) > 0,
    a.best_position,
    coalesce(a.categories, array[]::text[]),
    a.first_awarded_at
  from requested r
  left join awarded a on a.professional_id=r.professional_id;
$$;

-- Public capacity, for onboarding copy such as "47 of 60 founding spots claimed".
-- Only published counters leave the backend; no internal ids or rows.
create or replace function public.get_founding_capacity(category_slugs text[] default null)
returns table(slug text, category text, claimed integer, spots smallint, remaining integer)
language sql stable security invoker set search_path='' as $$
  select
    i.slug,
    i.name,
    coalesce(b.claimed, 0)::integer,
    public.founding_limit_per_category(),
    greatest(public.founding_limit_per_category() - coalesce(b.claimed, 0), 0)::integer
  from public.interests i
  left join (
    select category_id, count(*) as claimed
    from public.professional_founding_badges
    group by category_id
  ) b on b.category_id=i.id
  where i.is_active
    and (category_slugs is null or i.slug = any(category_slugs))
  order by i.sort_order, i.name;
$$;

-- What the calling professional should be told: whether they hold the badge, in
-- which categories, and what is still open in the categories they serve.
create or replace function public.get_my_founding_status()
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  v_user uuid := (select auth.uid());
  v_profile uuid;
  v_approved boolean;
begin
  if v_user is null then return null; end if;

  select p.id,
    (u.role='professional' and u.account_status='active' and p.deleted_at is null and p.onboarding_completed_at is not null)
  into v_profile, v_approved
  from public.professional_profiles p
  join public.users u on u.id=p.user_id
  where p.user_id=v_user;

  if v_profile is null then return null; end if;

  return jsonb_build_object(
    'is_founding', (select is_founding_beautician from public.professional_profiles where id=v_profile),
    'approved', coalesce(v_approved, false),
    'badges', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', i.name, 'slug', i.slug,
        'position', b.founding_position,
        'awarded_at', b.awarded_at, 'qualifying_at', b.qualifying_at
      ) order by b.founding_position)
      from public.professional_founding_badges b
      join public.interests i on i.id=b.category_id
      where b.professional_id=v_profile
    ), '[]'::jsonb),
    'opportunities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'category', i.name, 'slug', i.slug,
        'claimed', (select count(*) from public.professional_founding_badges b where b.category_id=i.id),
        'spots', public.founding_limit_per_category(),
        'remaining', greatest(
          public.founding_limit_per_category()
          - (select count(*) from public.professional_founding_badges b where b.category_id=i.id), 0),
        -- Whether this professional has built out the category yet (an active
        -- service in it). Explains "spots are open, add a service to claim one".
        'ready', exists (
          select 1 from public.professional_services s
          where s.professional_id=v_profile and s.is_active
            and (s.interest_id=pc.interest_id or (s.interest_id is null and pc.is_primary))
        )
      ) order by i.sort_order, i.name)
      from public.professional_categories pc
      join public.interests i on i.id=pc.interest_id and i.is_active
      where pc.professional_id=v_profile
        and not exists (
          select 1 from public.professional_founding_badges b
          where b.professional_id=v_profile and b.category_id=pc.interest_id
        )
    ), '[]'::jsonb)
  );
end;
$$;

-- Admin/console read model. Mirrors the audit shape of the existing beautician
-- directory (position, category, awarded date, current account status).
create or replace function public.get_admin_founding_badges(
  search_query text default '',
  category_filter text default '',
  page_number integer default 1,
  page_size integer default 25
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $$
declare
  query text := trim(coalesce(search_query, ''));
  requested_category text := trim(coalesce(category_filter, ''));
  page integer := greatest(coalesce(page_number, 1), 1);
  size integer := least(greatest(coalesce(page_size, 25), 1), 500);
begin
  if not public.admin_has_permission('users.read') then
    raise exception 'User directory access required' using errcode='42501';
  end if;

  return (
    with directory as (
      select
        b.id, b.founding_position, b.awarded_at, b.qualifying_at,
        p.id as professional_id, p.is_founding_beautician,
        coalesce(nullif(p.display_name, ''), p.business_name) name,
        p.business_name, i.name as category, i.slug as category_slug,
        u.account_status::text status, p.is_verified
      from public.professional_founding_badges b
      join public.professional_profiles p on p.id=b.professional_id
      join public.users u on u.id=p.user_id
      join public.interests i on i.id=b.category_id
    ),
    filtered as (
      select * from directory d
      where (query='' or d.name ilike '%'||query||'%' or d.business_name ilike '%'||query||'%')
        and (requested_category='' or d.category ilike '%'||requested_category||'%')
    )
    select jsonb_build_object(
      'items', coalesce((
        select jsonb_agg(to_jsonb(x) order by x.category, x.founding_position)
        from (
          select * from filtered
          order by category, founding_position
          limit size offset (page - 1) * size
        ) x
      ), '[]'::jsonb),
      'total', (select count(*) from filtered),
      'page', page,
      'page_size', size,
      'limit_per_category', public.founding_limit_per_category(),
      'facets', jsonb_build_object(
        'categories', coalesce((
          select jsonb_agg(jsonb_build_object('name', c.category, 'slug', c.category_slug, 'claimed', c.claimed)
            order by c.category)
          from (
            select category, category_slug, count(*) claimed from directory group by category, category_slug
          ) c
        ), '[]'::jsonb)
      )
    )
  );
end;
$$;

-- Backfill the professionals who were already on Sheree before this feature.
select public.backfill_founding_badges();

-- Reconcile the denormalised read hint with the source-of-truth table. Badges are
-- permanent, so this only ever *clears* a flag that has no badge behind it; it can
-- never take an earned badge away, because positions live in
-- professional_founding_badges and are never deleted here.
update public.professional_profiles p
set is_founding_beautician = exists (
  select 1 from public.professional_founding_badges b where b.professional_id=p.id
)
where p.is_founding_beautician
  and not exists (
    select 1 from public.professional_founding_badges b where b.professional_id=p.id
  );

revoke all on function public.founding_limit_per_category() from public, anon, authenticated;
revoke all on function public.award_founding_badges(uuid) from public, anon, authenticated;
revoke all on function public.founding_badges_sync() from public, anon, authenticated;
revoke all on function public.backfill_founding_badges() from public, anon, authenticated;
revoke all on function public.get_my_founding_status() from public, anon;
revoke all on function public.get_admin_founding_badges(text,text,integer,integer) from public, anon;

-- Access control: the client may only READ founding status. Assignment happens
-- exclusively through the server-side functions above (`award_founding_badges`
-- runs from triggers inside the database; `backfill_founding_badges` is an
-- operational tool). A client cannot award itself a badge, change a position, or
-- alter a category allocation because it holds no INSERT/UPDATE/DELETE grant on
-- `professional_founding_badges` and no EXECUTE grant on any awarding function.
grant execute on function public.get_founding_badges(uuid[]) to anon, authenticated;
grant execute on function public.get_founding_capacity(text[]) to anon, authenticated;
grant execute on function public.get_my_founding_status() to authenticated;
grant execute on function public.get_admin_founding_badges(text,text,integer,integer) to authenticated;
