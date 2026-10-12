-- Duckcellent database setup.
-- Paste this whole file into Supabase > SQL Editor > New query > Run.
-- It is safe to run more than once.

-- ---------------------------------------------------------------- tables

-- One row per user: their atlas (countries marked as been / lived / want to go).
create table if not exists public.profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_size check (octet_length(data::text) < 400000)
);

-- One row per trip: itinerary, flights and stays live inside "data".
create table if not exists public.trips (
  user_id    uuid not null references auth.users (id) on delete cascade,
  id         text not null check (char_length(id) between 1 and 40),
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  constraint trips_size check (octet_length(data::text) < 400000)
);

-- Membership state. Only the server (Stripe webhook / billing functions) writes here.
create table if not exists public.subscriptions (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  stripe_customer_id   text unique,
  stripe_subscription_id text,
  plan                 text check (plan in ('monthly','quarterly','biannual','yearly')),
  status               text,
  current_period_end   timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at           timestamptz not null default now()
);

-- ---------------------------------------------------------------- helpers

-- Does this user currently have Plus? A small grace period covers webhook delays.
create or replace function public.is_plus(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = uid
      and s.status in ('active', 'trialing', 'past_due')
      and (s.current_period_end is null or s.current_period_end > now() - interval '2 days')
  );
$$;

-- Number of countries marked "been" or "lived" inside a profile document.
create or replace function public.marked_count(d jsonb)
returns integer
language sql
immutable
as $$
  select coalesce((
    select count(*)::int
    from jsonb_each(case when jsonb_typeof(d -> 'visited') = 'object' then d -> 'visited' else '{}'::jsonb end) e
    where e.value ->> 's' in ('been', 'lived')
  ), 0);
$$;

-- Keep updated_at honest.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Free plan: up to 10 countries. A lapsed member keeps what they have (only growth is blocked).
-- The app saves with "insert ... on conflict update", so an insert may really be an edit of an existing row.
create or replace function public.enforce_profile_limit()
returns trigger
language plpgsql
as $$
declare
  old_n integer := 0;
  new_n integer := public.marked_count(new.data);
begin
  if tg_op = 'UPDATE' then
    old_n := public.marked_count(old.data);
  else
    select public.marked_count(p.data) into old_n from public.profiles p where p.user_id = new.user_id;
    if not found then old_n := 0; end if;
  end if;
  if new_n > 10 and new_n > old_n and not public.is_plus(new.user_id) then
    raise exception 'country_limit' using hint = 'The free plan holds 10 countries.';
  end if;
  return new;
end;
$$;

-- Free plan: 1 trip. Everyone: 500 trips at most.
-- Saving an existing trip arrives as "insert ... on conflict update", so rows that already exist are let through.
create or replace function public.enforce_trip_limit()
returns trigger
language plpgsql
as $$
declare
  n integer;
begin
  if exists (select 1 from public.trips t where t.user_id = new.user_id and t.id = new.id) then
    return new;
  end if;
  select count(*) into n from public.trips where user_id = new.user_id;
  if n >= 500 then
    raise exception 'trip_cap' using hint = 'That is the maximum number of trips.';
  end if;
  if n >= 1 and not public.is_plus(new.user_id) then
    raise exception 'trip_limit' using hint = 'The free plan holds 1 trip.';
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- triggers

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trips_touch on public.trips;
create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();

drop trigger if exists profiles_limit on public.profiles;
create trigger profiles_limit before insert or update on public.profiles
  for each row execute function public.enforce_profile_limit();

drop trigger if exists trips_limit on public.trips;
create trigger trips_limit before insert on public.trips
  for each row execute function public.enforce_trip_limit();

-- ---------------------------------------------------------------- row level security

alter table public.profiles      enable row level security;
alter table public.trips         enable row level security;
alter table public.subscriptions enable row level security;

-- People can only ever touch their own rows.
drop policy if exists "profiles own select" on public.profiles;
drop policy if exists "profiles own insert" on public.profiles;
drop policy if exists "profiles own update" on public.profiles;
drop policy if exists "profiles own delete" on public.profiles;
create policy "profiles own select" on public.profiles for select to authenticated using (user_id = (select auth.uid()));
create policy "profiles own insert" on public.profiles for insert to authenticated with check (user_id = (select auth.uid()));
create policy "profiles own update" on public.profiles for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "profiles own delete" on public.profiles for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "trips own select" on public.trips;
drop policy if exists "trips own insert" on public.trips;
drop policy if exists "trips own update" on public.trips;
drop policy if exists "trips own delete" on public.trips;
create policy "trips own select" on public.trips for select to authenticated using (user_id = (select auth.uid()));
create policy "trips own insert" on public.trips for insert to authenticated with check (user_id = (select auth.uid()));
create policy "trips own update" on public.trips for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "trips own delete" on public.trips for delete to authenticated using (user_id = (select auth.uid()));

-- Members can read their own membership, but never write it.
drop policy if exists "subscriptions own select" on public.subscriptions;
create policy "subscriptions own select" on public.subscriptions for select to authenticated using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- privileges

revoke all on public.profiles, public.trips, public.subscriptions from anon;
revoke all on public.profiles, public.trips, public.subscriptions from authenticated;
grant select, insert, update, delete on public.profiles, public.trips to authenticated;
grant select on public.subscriptions to authenticated;

revoke execute on function public.is_plus(uuid) from public, anon;
grant  execute on function public.is_plus(uuid) to authenticated, service_role;
