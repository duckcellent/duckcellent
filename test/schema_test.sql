\set ON_ERROR_STOP on
\set VERBOSITY terse
create or replace function t_expect(q text, want text) returns void language plpgsql as $$
begin
  begin execute q;
  exception when others then
    if sqlerrm like '%'||want||'%' then raise notice 'PASS  blocked [%]: %', want, left(q,70); return; end if;
    raise exception 'WRONG ERROR for %: got [%] wanted [%]', q, sqlerrm, want;
  end;
  raise exception 'EXPECTED ERROR [%] BUT IT WORKED: %', want, q;
end $$;
create or replace function t_ok(q text) returns void language plpgsql as $$
begin execute q; raise notice 'PASS  allowed: %', left(q,70); end $$;
create or replace function t_eq(label text, got text, want text) returns void language plpgsql as $$
begin if got is distinct from want then raise exception 'FAIL %: got [%] wanted [%]', label, got, want; end if; raise notice 'PASS  % = %', label, want; end $$;
create or replace function t_visited(n int) returns jsonb language sql as $$
  select jsonb_build_object('visited', coalesce((select jsonb_object_agg('C'||i, jsonb_build_object('s','been')) from generate_series(1,n) i),'{}'::jsonb)) $$;

insert into auth.users(id,email) values ('aaaaaaaa-0000-0000-0000-000000000001','a@x.com'),('bbbbbbbb-0000-0000-0000-000000000002','b@x.com');

-- ===== signed in as A (free) =====
set role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select t_ok($$insert into profiles(user_id,data) values ('aaaaaaaa-0000-0000-0000-000000000001', t_visited(10))$$);
select t_expect($$update profiles set data = t_visited(11) where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'country_limit');
select t_ok($$update profiles set data = t_visited(10) || '{"example":false}' where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
select t_ok($$insert into profiles(user_id,data) values ('aaaaaaaa-0000-0000-0000-000000000001', t_visited(10) || '{"note":"upsert edit"}') on conflict (user_id) do update set data=excluded.data$$);
select t_expect($$insert into profiles(user_id,data) values ('aaaaaaaa-0000-0000-0000-000000000001', t_visited(11)) on conflict (user_id) do update set data=excluded.data$$, 'country_limit');
select t_ok($$insert into trips(user_id,id,data) values ('aaaaaaaa-0000-0000-0000-000000000001','t1','{"name":"One"}')$$);
select t_expect($$insert into trips(user_id,id,data) values ('aaaaaaaa-0000-0000-0000-000000000001','t2','{"name":"Two"}')$$, 'trip_limit');
select t_ok($$update trips set data='{"name":"One, renamed"}' where id='t1'$$);           -- editing is never blocked
-- upsert path used by the app (insert ... on conflict do update) must also work for the existing trip
select t_ok($$insert into trips(user_id,id,data) values ('aaaaaaaa-0000-0000-0000-000000000001','t1','{"name":"One again"}') on conflict (user_id,id) do update set data=excluded.data$$);
select t_eq('A sees only own trips', (select count(*)::text from trips), '1');

-- A cannot write as B, and cannot touch membership
select t_expect($$insert into profiles(user_id,data) values ('bbbbbbbb-0000-0000-0000-000000000002','{}')$$, 'row-level security');
select t_expect($$insert into trips(user_id,id,data) values ('bbbbbbbb-0000-0000-0000-000000000002','x','{}')$$, 'row-level security');
select t_expect($$insert into subscriptions(user_id,status) values ('aaaaaaaa-0000-0000-0000-000000000001','active')$$, 'permission denied');
select t_expect($$update subscriptions set status='active'$$, 'permission denied');
select t_eq('A cannot read subscriptions of others', (select count(*)::text from subscriptions), '0');

-- ===== signed in as B =====
select set_config('request.jwt.claim.sub','bbbbbbbb-0000-0000-0000-000000000002',false);
select t_eq('B sees none of A''s profile', (select count(*)::text from profiles), '0');
select t_eq('B sees none of A''s trips',   (select count(*)::text from trips), '0');
delete from trips where id='t1' and user_id='aaaaaaaa-0000-0000-0000-000000000001';   -- B tries to delete A's trip
select t_ok($$insert into trips(user_id,id,data) values ('bbbbbbbb-0000-0000-0000-000000000002','t1','{"name":"B trip, same id as A"}')$$);  -- same id, different user: fine

-- ===== anonymous visitor =====
reset role; set role anon; select set_config('request.jwt.claim.sub','',false);
select t_expect($$select * from profiles$$, 'permission denied');
select t_expect($$select * from trips$$, 'permission denied');
select t_expect($$select * from subscriptions$$, 'permission denied');
select t_expect($$select is_plus('aaaaaaaa-0000-0000-0000-000000000001')$$, 'permission denied');

-- ===== the server grants A a membership =====
reset role; set role service_role;
select t_eq('A trip survived B delete attempt', (select count(*)::text from trips where user_id='aaaaaaaa-0000-0000-0000-000000000001' and id='t1'), '1');
select t_ok($$insert into subscriptions(user_id,stripe_customer_id,stripe_subscription_id,plan,status,current_period_end) values ('aaaaaaaa-0000-0000-0000-000000000001','cus_1','sub_1','monthly','active', now()+interval '20 days')$$);
reset role; set role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select t_eq('A is plus', is_plus('aaaaaaaa-0000-0000-0000-000000000001')::text, 'true');
select t_ok($$update profiles set data = t_visited(25) where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
select t_ok($$insert into trips(user_id,id,data) values ('aaaaaaaa-0000-0000-0000-000000000001','t2','{"name":"Two"}')$$);
select t_eq('A can read own subscription', (select plan from subscriptions), 'monthly');

-- ===== membership ends: nothing is deleted, only growth is blocked =====
reset role; set role service_role;
select t_ok($$update subscriptions set status='canceled' where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$);
reset role; set role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select t_eq('A no longer plus', is_plus('aaaaaaaa-0000-0000-0000-000000000001')::text, 'false');
select t_eq('A keeps all countries', (select jsonb_object_keys_count from (select count(*)::text as jsonb_object_keys_count from jsonb_object_keys((select data->'visited' from profiles))) q), '25');
select t_ok($$update profiles set data = t_visited(25) || '{"note":"edited"}' where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$);   -- same count, allowed
select t_ok($$insert into profiles(user_id,data) values ('aaaaaaaa-0000-0000-0000-000000000001', t_visited(25) || '{"note":"edited via upsert"}') on conflict (user_id) do update set data=excluded.data$$);  -- the app's save path
select t_expect($$insert into profiles(user_id,data) values ('aaaaaaaa-0000-0000-0000-000000000001', t_visited(26)) on conflict (user_id) do update set data=excluded.data$$, 'country_limit');
select t_ok($$insert into trips(user_id,id,data) values ('aaaaaaaa-0000-0000-0000-000000000001','t2','{"name":"edit after lapse"}') on conflict (user_id,id) do update set data=excluded.data$$);   -- editing an existing trip after lapse
select t_ok($$update profiles set data = t_visited(20) where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$);                       -- shrinking allowed
select t_expect($$update profiles set data = t_visited(21) where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'country_limit');   -- growing blocked
select t_expect($$insert into trips(user_id,id,data) values ('aaaaaaaa-0000-0000-0000-000000000001','t3','{}')$$, 'trip_limit');
select t_ok($$update trips set data='{"name":"Still editable"}' where id='t2'$$);
select t_ok($$delete from trips where id='t2'$$);

-- ===== webhook-lateness grace period (2 days) =====
reset role; set role service_role;
update subscriptions set status='active', current_period_end = now() - interval '1 day' where user_id='aaaaaaaa-0000-0000-0000-000000000001';
select t_eq('active, ended 1 day ago: still plus (grace)', is_plus('aaaaaaaa-0000-0000-0000-000000000001')::text, 'true');
update subscriptions set current_period_end = now() - interval '3 days' where user_id='aaaaaaaa-0000-0000-0000-000000000001';
select t_eq('active, ended 3 days ago: not plus', is_plus('aaaaaaaa-0000-0000-0000-000000000001')::text, 'false');
update subscriptions set status='past_due', current_period_end = now() + interval '5 days' where user_id='aaaaaaaa-0000-0000-0000-000000000001';
select t_eq('past_due keeps plus while retrying', is_plus('aaaaaaaa-0000-0000-0000-000000000001')::text, 'true');
update subscriptions set status='trialing', current_period_end = null where user_id='aaaaaaaa-0000-0000-0000-000000000001';
select t_eq('trialing with no end date is plus', is_plus('aaaaaaaa-0000-0000-0000-000000000001')::text, 'true');
select t_expect($$update subscriptions set plan='weekly' where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'violates check constraint');

-- ===== hard caps =====
reset role; set role authenticated; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-0000-0000-000000000001',false);
select t_ok($$insert into trips(user_id,id,data) select 'aaaaaaaa-0000-0000-0000-000000000001','bulk'||i,'{}' from generate_series(1,499) i$$);
select t_eq('A has 500 trips', (select count(*)::text from trips), '500');
select t_expect($$insert into trips(user_id,id,data) values ('aaaaaaaa-0000-0000-0000-000000000001','one-too-many','{}')$$, 'trip_cap');
select t_expect($$update profiles set data = jsonb_build_object('blob', repeat('x', 450000)) where user_id='aaaaaaaa-0000-0000-0000-000000000001'$$, 'profiles_size');

-- ===== deleting the account removes everything =====
reset role;
delete from auth.users where id='aaaaaaaa-0000-0000-0000-000000000001';
select t_eq('A rows gone: profiles', (select count(*)::text from profiles where user_id='aaaaaaaa-0000-0000-0000-000000000001'), '0');
select t_eq('A rows gone: trips', (select count(*)::text from trips where user_id='aaaaaaaa-0000-0000-0000-000000000001'), '0');
select t_eq('A rows gone: subscriptions', (select count(*)::text from subscriptions where user_id='aaaaaaaa-0000-0000-0000-000000000001'), '0');
select t_eq('B untouched', (select count(*)::text from trips where user_id='bbbbbbbb-0000-0000-0000-000000000002'), '1');
select 'ALL SCHEMA TESTS PASSED' as result;
