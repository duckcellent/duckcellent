'use strict';
// Runs against test/dev.js (site on :3000, mocks on :4010). Start it first:  node test/dev.js
const assert = require('assert');
const crypto = require('crypto');
const SITE = 'http://localhost:3000', MOCK = 'http://localhost:4010', SB = MOCK + '/supabase';
const ANON = 'anon-key-for-tests', WHSEC = 'whsec_mock_secret';
let passed = 0;
const ok = (name) => { passed++; console.log('PASS ', name); };
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; } };
const ctl = (p, body) => fetch(MOCK + '/__test/' + p, { method: 'POST', body: JSON.stringify(body || {}) }).then(j);
const state = () => fetch(MOCK + '/__test/state').then(j);
const api = (name, token, body) => fetch(SITE + '/api/' + name, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, token ? { Authorization: 'Bearer ' + token } : {}), body: JSON.stringify(body || {}) });
async function signup(email) {
  const r = await fetch(SB + '/auth/v1/signup', { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'password123' }) });
  return j(r);
}
const sign = (body, t) => { t = t || Math.floor(Date.now() / 1000); return 't=' + t + ',v1=' + crypto.createHmac('sha256', WHSEC).update(t + '.' + body).digest('hex'); };

(async () => {
  await ctl('reset');

  /* ---- unit checks on the library ---- */
  const { encode, toForm, verifyWebhook } = require('../lib/stripe');
  assert.deepStrictEqual(encode({ a: { b: [{ c: 1 }, { c: 2 }], d: 'x y' }, e: true, skip: undefined, nope: null }).map(x => x.join('=')), ['a[b][0][c]=1', 'a[b][1][c]=2', 'a[d]=x y', 'e=true']);
  assert.strictEqual(toForm({ s: '{CHECKOUT_SESSION_ID}' }), 's=%7BCHECKOUT_SESSION_ID%7D'); ok('form encoding matches what Stripe expects');
  const body = '{"x":1}';
  verifyWebhook(Buffer.from(body), sign(body), WHSEC); ok('good webhook signature accepted');
  assert.throws(() => verifyWebhook(Buffer.from(body + ' '), sign(body), WHSEC), /does not match/); ok('tampered body rejected');
  assert.throws(() => verifyWebhook(Buffer.from(body), sign(body), 'whsec_other'), /does not match/); ok('wrong secret rejected');
  assert.throws(() => verifyWebhook(Buffer.from(body), sign(body, Math.floor(Date.now() / 1000) - 3600), WHSEC), /too old/); ok('replayed (old) signature rejected');
  assert.throws(() => verifyWebhook(Buffer.from(body), '', WHSEC), /Missing/); ok('missing signature rejected');
  verifyWebhook(Buffer.from(body), 'v1=deadbeef,' + sign(body), WHSEC); ok('extra signatures in header are fine');

  const { rowFromSubscription, summary } = require('../lib/billing');
  const base = { id: 'sub_1', customer: 'cus_1', status: 'active', metadata: {}, cancel_at_period_end: false };
  const newShape = Object.assign({}, base, { items: { data: [{ id: 'si', price: { recurring: { interval: 'month', interval_count: 6 } }, current_period_end: 1900000000 }] } });
  const oldShape = Object.assign({}, base, { current_period_end: 1900000000, items: { data: [{ id: 'si', price: { recurring: { interval: 'year', interval_count: 1 } } }] } });
  assert.strictEqual(rowFromSubscription(newShape, 'u').plan, 'biannual'); assert.ok(rowFromSubscription(newShape, 'u').current_period_end.startsWith('2030'));
  assert.strictEqual(rowFromSubscription(oldShape, 'u').plan, 'yearly'); assert.ok(rowFromSubscription(oldShape, 'u').current_period_end.startsWith('2030'));
  assert.strictEqual(rowFromSubscription(Object.assign({}, newShape, { cancel_at: 1900000000 }), 'u').cancel_at_period_end, true); ok('subscription parsing: new and old Stripe shapes, scheduled cancel');
  assert.strictEqual(summary({ status: 'canceled', current_period_end: '2099-01-01' }).plus, false);
  assert.strictEqual(summary({ status: 'active', current_period_end: new Date(Date.now() - 3 * 864e5).toISOString() }).plus, false);
  assert.strictEqual(summary({ status: 'past_due', current_period_end: new Date(Date.now() + 864e5).toISOString() }).plus, true); ok('membership status rules');

  /* ---- HTTP: config and health ---- */
  const cfg = await j(await fetch(SITE + '/api/config'));
  assert.ok(cfg.accounts && cfg.billing && cfg.plans.length === 4 && !JSON.stringify(cfg).includes('service-role') && !JSON.stringify(cfg).includes('sk_test')); ok('config is public-only and has plans');
  const health = await j(await fetch(SITE + '/api/health'));
  assert.ok(health.checks.supabase_auth && health.checks.database_tables && health.checks.stripe_key_works && !JSON.stringify(health).includes('sk_test')); ok('health shows yes/no only');
  assert.strictEqual((await fetch(SITE + '/api/checkout')).status, 405); ok('GET on a POST-only endpoint is refused');

  /* ---- auth required ---- */
  for (const n of ['checkout', 'portal', 'sync', 'delete-account']) {
    assert.strictEqual((await api(n, null, {})).status, 401);
    assert.strictEqual((await api(n, 'garbage-token', {})).status, 401);
  } ok('every billing endpoint rejects missing or bad sign-in');

  /* ---- webhook security ---- */
  let r = await api('webhook', null, {}); assert.strictEqual(r.status, 400);
  const evt = JSON.stringify({ type: 'customer.subscription.updated', data: { object: { id: 'sub_zzz', customer: 'cus_unknown', status: 'active', metadata: {}, items: { data: [] } } } });
  r = await fetch(SITE + '/api/webhook', { method: 'POST', body: evt, headers: { 'Stripe-Signature': 't=1,v1=00' } }); assert.strictEqual(r.status, 400);
  r = await fetch(SITE + '/api/webhook', { method: 'POST', body: evt, headers: { 'Stripe-Signature': sign(evt) } }); assert.strictEqual(r.status, 200);
  assert.strictEqual((await state()).subs.length, 0); ok('webhook: unsigned/forged rejected; valid but unknown customer is ignored');

  /* ---- subscribe flow ---- */
  const u = await signup('api@example.com'); const tk = u.access_token, uid = u.user.id;
  r = await api('checkout', tk, { plan: 'daily' }); assert.strictEqual(r.status, 400); assert.strictEqual((await j(r)).error, 'bad_plan'); ok('unknown plan refused');
  r = await api('checkout', tk, { plan: 'quarterly' }); const co = await j(r); assert.ok(co.url.includes('/__pay/')); ok('checkout returns a Stripe page link');
  let st = await state();
  const sess = st.sessions[0]; const sessionRow = st.subs.find(s => s.user_id === uid);
  assert.ok(sessionRow && sessionRow.stripe_customer_id && !sessionRow.status); ok('customer created and linked to the user before checkout');
  const paid = await ctl('pay', { session: sess.id });
  st = await state();
  let row = st.subs.find(s => s.user_id === uid);
  assert.strictEqual(row.status, 'active'); assert.strictEqual(row.plan, 'quarterly'); assert.strictEqual(row.cancel_at_period_end, false);
  assert.ok(new Date(row.current_period_end) > new Date(Date.now() + 80 * 864e5)); ok('webhook activated the membership (plan, status, renewal date)');
  const created = st.stripeSubs[0];
  assert.strictEqual(created.items.data[0].price.unit_amount, 1299); assert.strictEqual(created.items.data[0].price.currency, 'usd');
  assert.deepStrictEqual(created.items.data[0].price.recurring, { interval: 'month', interval_count: 3 }); assert.strictEqual(created.metadata.user_id, uid); ok('Stripe charged the server-side price (1299 usd / 3 months), not anything the browser sent');

  /* ---- change plan, same plan, resume ---- */
  r = await api('checkout', tk, { plan: 'quarterly' }); assert.strictEqual(r.status, 409); ok('choosing your current plan is refused');
  r = await api('checkout', tk, { plan: 'yearly' }); let ch = await j(r);
  assert.ok(ch.changed && ch.membership.plan === 'yearly' && ch.membership.plus); st = await state();
  assert.strictEqual(st.subs.find(s => s.user_id === uid).plan, 'yearly'); assert.strictEqual(st.stripeSubs.length, 1);
  assert.ok(st.log.some(l => /proration=create_prorations payment_behavior=error_if_incomplete/.test(l))); ok('switching plan updates the same subscription with proration (no second subscription)');
  await ctl('portal-cancel', { sub: created.id }); st = await state();
  assert.strictEqual(st.subs.find(s => s.user_id === uid).cancel_at_period_end, true); ok('cancel in the billing portal reaches the app through the webhook');
  r = await api('checkout', tk, { plan: 'yearly' }); ch = await j(r);
  assert.ok(ch.resumed && ch.membership.cancel_at_period_end === false); ok('resume after scheduled cancel');
  await ctl('set', { declineCards: true });
  r = await api('checkout', tk, { plan: 'monthly' }); assert.strictEqual(r.status, 402); assert.strictEqual((await j(r)).error, 'payment_failed');
  st = await state(); assert.strictEqual(st.subs.find(s => s.user_id === uid).plan, 'yearly'); await ctl('set', { declineCards: false }); ok('declined card on plan change: clear error, plan unchanged');

  /* ---- sync safety net (webhook never arrives) ---- */
  await ctl('quiet-cancel', { sub: created.id });
  assert.strictEqual((await state()).subs.find(s => s.user_id === uid).cancel_at_period_end, false);
  const sy = await j(await api('sync', tk)); assert.strictEqual(sy.membership.cancel_at_period_end, true); ok('sync repairs state when a webhook was missed');

  /* ---- portal ---- */
  const po = await j(await api('portal', tk)); assert.ok(po.url.includes('/__portal/')); ok('billing portal link');
  await ctl('set', { portalConfigured: false });
  r = await api('portal', tk); assert.strictEqual(r.status, 503); assert.strictEqual((await j(r)).error, 'portal_not_configured'); await ctl('set', { portalConfigured: true }); ok('portal not switched on in Stripe: friendly error');
  const u2 = await signup('nobilling@example.com'); r = await api('portal', u2.access_token); assert.strictEqual(r.status, 404); ok('portal for someone who never subscribed: 404');

  /* ---- out-of-order cancellation of an old subscription must not remove a live one ---- */
  const old = JSON.stringify({ type: 'customer.subscription.deleted', data: { object: { id: 'sub_OLD', customer: row.stripe_customer_id, status: 'canceled', metadata: { user_id: uid }, items: { data: [{ id: 'x', price: { recurring: { interval: 'month', interval_count: 1 } } }] } } } });
  r = await fetch(SITE + '/api/webhook', { method: 'POST', body: old, headers: { 'Stripe-Signature': sign(old) } }); assert.strictEqual(r.status, 200);
  assert.strictEqual((await state()).subs.find(s => s.user_id === uid).status, 'active'); ok('a late "cancelled" for an older subscription does not cancel the live one');

  /* ---- membership ends ---- */
  await ctl('end', { sub: created.id }); st = await state();
  assert.strictEqual(st.subs.find(s => s.user_id === uid).status, 'canceled'); ok('subscription ended: status canceled');
  await ctl('pay', { session: (await state()).sessions[0].id }); // a second subscription for the same customer

  /* ---- test vs live mode mix-up: stored customer no longer exists in Stripe ---- */
  const u3 = await signup('mode@example.com'); const t3 = u3.access_token;
  await fetch(SB + '/rest/v1/subscriptions?on_conflict=user_id', { method: 'POST', headers: { apikey: 'service-role-key-for-tests', 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u3.user.id, stripe_customer_id: 'cus_FROM_OTHER_MODE' }) });
  r = await api('checkout', t3, { plan: 'monthly' }); const c3 = await j(r); assert.ok(c3.url, JSON.stringify(c3));
  assert.notStrictEqual((await state()).subs.find(s => s.user_id === u3.user.id).stripe_customer_id, 'cus_FROM_OTHER_MODE'); ok('a customer id from the other Stripe mode is replaced automatically');
  const sy3 = await j(await api('sync', t3)); assert.ok(sy3.membership);
  await fetch(SB + '/rest/v1/subscriptions?on_conflict=user_id', { method: 'POST', headers: { apikey: 'service-role-key-for-tests', 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify({ user_id: u3.user.id, stripe_customer_id: 'cus_GONE' }) });
  const sy4 = await j(await api('sync', t3)); assert.strictEqual(sy4.membership.plus, false); assert.strictEqual(sy4.membership.has_customer, false); ok('sync with a missing customer clears the stale link');

  /* ---- delete account ---- */
  r = await api('delete-account', tk, {}); assert.strictEqual(r.status, 400); ok('delete needs explicit confirmation');
  const pre = await state();
  const rowBefore = pre.subs.find(s => s.user_id === uid);
  assert.strictEqual(rowBefore.status, 'active'); // the second subscription, created after the first ended
  assert.strictEqual(pre.stripeSubs.find(s => s.id === rowBefore.stripe_subscription_id).status, 'active');
  r = await api('delete-account', tk, { confirm: true }); assert.strictEqual(r.status, 200);
  st = await state();
  assert.ok(!st.users.find(x => x.id === uid) && !st.subs.find(s => s.user_id === uid) && !st.profiles.find(x => x.user_id === uid));
  assert.strictEqual(st.stripeSubs.find(s => s.id === rowBefore.stripe_subscription_id).status, 'canceled');
  assert.strictEqual((await api('portal', tk)).status, 401); ok('account deleted: user, data and token gone; live subscription cancelled in Stripe');

  console.log('\nALL API TESTS PASSED (' + passed + ' checks)');
})().catch(e => { console.error('FAIL', e); process.exit(1); });
