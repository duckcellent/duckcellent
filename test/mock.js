'use strict';
// A small stand-in for Supabase (sign-in + database) and Stripe, so the whole app can be tested without internet.
// Behaviour mirrors the real services for the calls Duckcellent makes. The database rules copy supabase/schema.sql,
// which is separately tested on a real Postgres (test/run_schema_test.sh).
const http = require('http');
const crypto = require('crypto');

const PORT = +process.env.MOCK_PORT || 4010;
const BASE = 'http://localhost:' + PORT;
const SERVICE_KEY = 'service-role-key-for-tests';
const ANON_KEY = 'anon-key-for-tests';
const STRIPE_KEY = 'sk_test_mock';
const WHSEC = 'whsec_mock_secret';

const S = {};
function reset() {
  Object.assign(S, {
    users: new Map(), tokens: new Map(), refresh: new Map(),
    profiles: [], trips: [], subs: [],
    products: new Map(), customers: new Map(), sessions: new Map(), stripeSubs: new Map(),
    emails: [], log: [],
    flags: { confirmEmails: false, expiresIn: 3600, portalConfigured: true, declineCards: false, shape: 'new', webhooks: true, appBase: 'http://localhost:3000' }
  });
}
reset();

const rand = n => crypto.randomBytes(n).toString('hex');
const nowSec = () => Math.floor(Date.now() / 1000);

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'apikey, authorization, content-type, prefer, x-client-info');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
}
function send(res, status, body, extra) {
  cors(res);
  const text = body === undefined ? '' : (typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, Object.assign({ 'Content-Type': typeof body === 'string' ? 'text/html' : 'application/json' }, extra || {}));
  res.end(text);
}
function readBody(req) { return new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); }); }

/* ---------------------------------------------------------------- Supabase: sign-in */
function newSession(user) {
  const at = 'at_' + user.id + '_' + rand(6);
  const exp = nowSec() + S.flags.expiresIn;
  S.tokens.set(at, { uid: user.id, exp });
  const rt = 'rt_' + rand(10);
  S.refresh.set(rt, user.id);
  return { access_token: at, token_type: 'bearer', expires_in: S.flags.expiresIn, expires_at: exp, refresh_token: rt, user: { id: user.id, email: user.email } };
}
function userFromToken(req) {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  if (!m) return null;
  const t = S.tokens.get(m[1]);
  if (!t || t.exp < nowSec()) return null;
  return S.users.get(t.uid) || null;
}
const authErr = (res, status, code, msg) => send(res, status, { code: status, error_code: code, msg });

async function auth(req, res, url, body) {
  const p = url.pathname.replace('/supabase/auth/v1', '');
  if (p === '/health') return send(res, 200, { name: 'GoTrue' });
  if (p === '/signup' && req.method === 'POST') {
    const { email, password } = body;
    if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) return authErr(res, 422, 'validation_failed', 'Unable to validate email address: invalid format');
    if (!password || password.length < 6) return authErr(res, 422, 'weak_password', 'Password should be at least 6 characters.');
    const existing = [...S.users.values()].find(u => u.email === email);
    if (existing) {
      if (S.flags.confirmEmails) return send(res, 200, { id: crypto.randomUUID(), email, identities: [] });
      return authErr(res, 422, 'user_already_exists', 'User already registered');
    }
    const user = { id: crypto.randomUUID(), email, password, confirmed: !S.flags.confirmEmails };
    S.users.set(user.id, user);
    if (!S.flags.confirmEmails) return send(res, 200, newSession(user));
    const s = newSession(user);
    const redirect = url.searchParams.get('redirect_to') || '';
    S.emails.push({ to: email, type: 'signup', link: redirect + '#access_token=' + s.access_token + '&expires_at=' + s.expires_at + '&expires_in=' + s.expires_in + '&refresh_token=' + s.refresh_token + '&token_type=bearer&type=signup' });
    return send(res, 200, { id: user.id, email, confirmation_sent_at: new Date().toISOString() });
  }
  if (p === '/token' && req.method === 'POST') {
    const gt = url.searchParams.get('grant_type');
    if (gt === 'password') {
      const u = [...S.users.values()].find(x => x.email === body.email);
      if (!u || u.password !== body.password) return authErr(res, 400, 'invalid_credentials', 'Invalid login credentials');
      if (!u.confirmed) return authErr(res, 400, 'email_not_confirmed', 'Email not confirmed');
      return send(res, 200, newSession(u));
    }
    if (gt === 'refresh_token') {
      const uid = S.refresh.get(body.refresh_token);
      if (!uid || !S.users.has(uid)) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid Refresh Token: Refresh Token Not Found' });
      S.refresh.delete(body.refresh_token);
      S.log.push('refresh');
      return send(res, 200, newSession(S.users.get(uid)));
    }
  }
  if (p === '/recover' && req.method === 'POST') {
    const u = [...S.users.values()].find(x => x.email === body.email);
    if (u) {
      const s = newSession(u);
      const redirect = url.searchParams.get('redirect_to') || '';
      S.emails.push({ to: u.email, type: 'recovery', link: redirect + '#access_token=' + s.access_token + '&expires_at=' + s.expires_at + '&expires_in=' + s.expires_in + '&refresh_token=' + s.refresh_token + '&token_type=bearer&type=recovery' });
    }
    return send(res, 200, {});
  }
  if (p === '/user') {
    const u = userFromToken(req);
    if (!u) return authErr(res, 401, 'bad_jwt', 'invalid JWT: token is expired or malformed');
    if (req.method === 'GET') return send(res, 200, { id: u.id, email: u.email });
    if (req.method === 'PUT') {
      if (body.password) {
        if (body.password.length < 6) return authErr(res, 422, 'weak_password', 'Password should be at least 6 characters.');
        if (body.password === u.password) return authErr(res, 422, 'same_password', 'New password should be different from the old password.');
        u.password = body.password;
      }
      return send(res, 200, { id: u.id, email: u.email });
    }
  }
  if (p === '/logout' && req.method === 'POST') {
    const m = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
    if (m) S.tokens.delete(m[1]);
    S.log.push('logout');
    return send(res, 204);
  }
  const del = /^\/admin\/users\/([^/]+)$/.exec(p);
  if (del && req.method === 'DELETE') {
    if (req.headers.apikey !== SERVICE_KEY) return authErr(res, 403, 'not_admin', 'User not allowed');
    const id = del[1];
    if (!S.users.has(id)) return authErr(res, 404, 'user_not_found', 'User not found');
    S.users.delete(id);
    S.profiles = S.profiles.filter(r => r.user_id !== id);
    S.trips = S.trips.filter(r => r.user_id !== id);
    S.subs = S.subs.filter(r => r.user_id !== id);
    for (const [t, v] of S.tokens) if (v.uid === id) S.tokens.delete(t);
    return send(res, 200, {});
  }
  return send(res, 404, { msg: 'not found ' + p });
}

/* ---------------------------------------------------------------- Supabase: database (PostgREST) */
const isPlus = uid => {
  const s = S.subs.find(r => r.user_id === uid);
  if (!s) return false;
  if (!['active', 'trialing', 'past_due'].includes(s.status)) return false;
  return !s.current_period_end || new Date(s.current_period_end).getTime() > Date.now() - 2 * 864e5;
};
const marked = d => Object.values((d && d.visited && typeof d.visited === 'object') ? d.visited : {}).filter(v => v && (v.s === 'been' || v.s === 'lived')).length;
const pgErr = (res, status, message, code) => send(res, status, { code: code || 'P0001', details: null, hint: null, message });

async function rest(req, res, url, body) {
  const table = url.pathname.replace('/supabase/rest/v1/', '');
  if (!['profiles', 'trips', 'subscriptions'].includes(table)) return send(res, 404, { message: 'no such table' });
  const bearer = (/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1];
  const isService = req.headers.apikey === SERVICE_KEY && (!bearer || bearer === SERVICE_KEY);
  const user = isService ? null : userFromToken(req);
  if (!isService && !user) return send(res, 401, { code: '42501', message: 'permission denied for table ' + table });
  const store = { profiles: S.profiles, trips: S.trips, subscriptions: S.subs }[table];
  const filters = [];
  for (const [k, v] of url.searchParams) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue;
    const m = /^eq\.(.*)$/.exec(v);
    if (m) filters.push([k, m[1]]);
  }
  const visible = r => isService || r.user_id === user.id;
  const matches = r => visible(r) && filters.every(([k, v]) => String(r[k]) === v);
  S.log.push(req.method + ' ' + table);

  if (req.method === 'GET') {
    let rows = store.filter(matches);
    const sel = url.searchParams.get('select') || '*';
    if (sel !== '*') { const cols = sel.split(','); rows = rows.map(r => Object.fromEntries(cols.map(c => [c, r[c]]))); }
    const lim = +url.searchParams.get('limit'); if (lim) rows = rows.slice(0, lim);
    return send(res, 200, rows);
  }
  if (req.method === 'DELETE') {
    const gone = store.filter(matches);
    for (const g of gone) store.splice(store.indexOf(g), 1);
    return send(res, 204);
  }
  if (req.method === 'POST') {
    if (table === 'subscriptions' && !isService) return send(res, 403, { code: '42501', message: 'permission denied for table subscriptions' });
    const merge = /merge-duplicates/.test(req.headers.prefer || '');
    const rows = Array.isArray(body) ? body : [body];
    for (const row of rows) {
      if (!isService && row.user_id !== user.id) return send(res, 403, { code: '42501', message: 'new row violates row-level security policy for table "' + table + '"' });
      const keyOf = r => table === 'trips' ? r.user_id + '|' + r.id : r.user_id;
      const existing = store.find(r => keyOf(r) === keyOf(row));
      const uid = row.user_id;
      if (table === 'profiles') {
        const oldN = existing ? marked(existing.data) : 0;
        if (marked(row.data) > 10 && marked(row.data) > oldN && !isPlus(uid)) return pgErr(res, 400, 'country_limit');
        if (JSON.stringify(row.data || {}).length >= 400000) return pgErr(res, 400, 'violates check constraint "profiles_size"', '23514');
      }
      if (table === 'trips' && !existing) {
        const n = store.filter(r => r.user_id === uid).length;
        if (n >= 500) return pgErr(res, 400, 'trip_cap');
        if (n >= 1 && !isPlus(uid)) return pgErr(res, 400, 'trip_limit');
      }
      if (table === 'subscriptions' && row.plan && !['monthly', 'quarterly', 'biannual', 'yearly'].includes(row.plan)) return pgErr(res, 400, 'violates check constraint', '23514');
      if (existing) {
        if (!merge) return pgErr(res, 409, 'duplicate key value violates unique constraint', '23505');
        Object.assign(existing, row, { updated_at: new Date().toISOString() });
      } else store.push(Object.assign({ created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, row));
    }
    return send(res, 201);
  }
  return send(res, 405, { message: 'method not allowed' });
}

/* ---------------------------------------------------------------- Stripe */
function parseForm(text) {
  const out = {};
  for (const [k, v] of new URLSearchParams(text)) {
    const path = k.replace(/\]/g, '').split('[');
    let o = out;
    path.forEach((seg, i) => {
      if (i === path.length - 1) o[seg] = v;
      else { if (o[seg] === undefined) o[seg] = /^\d+$/.test(path[i + 1]) ? [] : {}; o = o[seg]; }
    });
  }
  return out;
}
const sErr = (res, status, type, code, message, param) => send(res, status, { error: { type, code, message, param } });
const addPeriod = (rec, from) => {
  const d = new Date((from || nowSec()) * 1000);
  if (rec.interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1 * (+rec.interval_count || 1));
  else d.setUTCMonth(d.getUTCMonth() + (+rec.interval_count || 1));
  return Math.floor(d.getTime() / 1000);
};
function subObj(sub) {
  const item = sub.item;
  const o = {
    id: sub.id, object: 'subscription', customer: sub.customer, status: sub.status, created: sub.created,
    cancel_at_period_end: sub.cancel_at_period_end, cancel_at: sub.cancel_at || null, metadata: sub.metadata,
    items: { object: 'list', data: [{ id: item.id, object: 'subscription_item', price: { id: 'price_' + item.id, unit_amount: item.unit_amount, currency: item.currency, recurring: item.recurring, product: item.product }, current_period_end: sub.period_end }] }
  };
  if (S.flags.shape === 'old') { o.current_period_end = sub.period_end; delete o.items.data[0].current_period_end; }
  return o;
}
function itemFromPriceData(pd) {
  return { id: 'si_' + rand(5), unit_amount: +pd.unit_amount, currency: pd.currency, product: pd.product, recurring: { interval: pd.recurring.interval, interval_count: +pd.recurring.interval_count || 1 } };
}
async function emitWebhook(type, object) {
  if (!S.flags.webhooks) return;
  const body = JSON.stringify({ id: 'evt_' + rand(6), object: 'event', type, data: { object } });
  const t = nowSec();
  const sig = crypto.createHmac('sha256', WHSEC).update(t + '.' + body).digest('hex');
  try {
    const r = await fetch(S.flags.appBase + '/api/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Stripe-Signature': 't=' + t + ',v1=' + sig }, body });
    S.log.push('webhook ' + type + ' -> ' + r.status);
  } catch (e) { S.log.push('webhook ' + type + ' failed ' + e.message); }
}

async function stripe(req, res, url, raw) {
  if ((req.headers.authorization || '') !== 'Bearer ' + STRIPE_KEY) return sErr(res, 401, 'invalid_request_error', 'api_key_invalid', 'Invalid API Key provided');
  const p = url.pathname.replace('/stripe/v1', '');
  const f = req.method === 'GET' ? Object.fromEntries(url.searchParams) : parseForm(raw);
  S.log.push('stripe ' + req.method + ' ' + p);
  if (p === '/balance') return send(res, 200, { object: 'balance' });
  let m;
  if ((m = /^\/products\/([^/]+)$/.exec(p)) && req.method === 'GET') {
    const pr = S.products.get(m[1]);
    return pr ? send(res, 200, pr) : sErr(res, 404, 'invalid_request_error', 'resource_missing', 'No such product: ' + m[1], 'id');
  }
  if (p === '/products' && req.method === 'POST') {
    if (S.products.has(f.id)) return sErr(res, 400, 'invalid_request_error', 'resource_already_exists', 'Product already exists.');
    const pr = { id: f.id || 'prod_' + rand(4), object: 'product', name: f.name };
    S.products.set(pr.id, pr); return send(res, 200, pr);
  }
  if (p === '/customers' && req.method === 'POST') {
    const c = { id: 'cus_' + rand(5), object: 'customer', email: f.email || null, metadata: f.metadata || {} };
    S.customers.set(c.id, c); return send(res, 200, c);
  }
  if (p === '/checkout/sessions' && req.method === 'POST') {
    if (f.mode !== 'subscription') return sErr(res, 400, 'invalid_request_error', 'parameter_invalid_enum', 'mode must be subscription', 'mode');
    if (!S.customers.has(f.customer)) return sErr(res, 400, 'invalid_request_error', 'resource_missing', 'No such customer: ' + f.customer, 'customer');
    const li = f.line_items && f.line_items[0];
    if (!li || !li.price_data || !li.price_data.recurring || !/^\d+$/.test(String(li.price_data.unit_amount)) || !li.price_data.currency || !S.products.has(li.price_data.product))
      return sErr(res, 400, 'invalid_request_error', 'parameter_missing', 'line_items[0][price_data] is incomplete', 'line_items');
    if (!/\{CHECKOUT_SESSION_ID\}/.test(f.success_url || '')) return sErr(res, 400, 'invalid_request_error', 'url_invalid', 'success_url must include the session id placeholder', 'success_url');
    const s = { id: 'cs_test_' + rand(6), object: 'checkout.session', mode: 'subscription', customer: f.customer, client_reference_id: f.client_reference_id, params: f, status: 'open' };
    s.url = BASE + '/__pay/' + s.id;
    S.sessions.set(s.id, s);
    return send(res, 200, { id: s.id, url: s.url, mode: 'subscription' });
  }
  if ((m = /^\/subscriptions\/([^/]+)$/.exec(p))) {
    const sub = S.stripeSubs.get(m[1]);
    if (!sub) return sErr(res, 404, 'invalid_request_error', 'resource_missing', 'No such subscription: ' + m[1], 'id');
    if (req.method === 'GET') return send(res, 200, subObj(sub));
    if (req.method === 'DELETE') { sub.status = 'canceled'; return send(res, 200, subObj(sub)); }
    if (req.method === 'POST') {
      if (S.flags.declineCards && f.items) return sErr(res, 402, 'card_error', 'card_declined', 'Your card was declined.');
      if (f.items && f.items[0]) {
        const it = f.items[0];
        if (it.id !== sub.item.id || !it.price_data) return sErr(res, 400, 'invalid_request_error', 'parameter_invalid_empty', 'items[0] needs the existing item id and price_data', 'items');
        sub.item = Object.assign(itemFromPriceData(it.price_data), { id: sub.item.id });
        sub.period_end = addPeriod(sub.item.recurring);
        S.log.push('proration=' + f.proration_behavior + ' payment_behavior=' + f.payment_behavior);
      }
      if (f.cancel_at_period_end !== undefined) { sub.cancel_at_period_end = f.cancel_at_period_end === 'true'; if (!sub.cancel_at_period_end) sub.cancel_at = null; }
      if (f.metadata) sub.metadata = Object.assign(sub.metadata, f.metadata);
      return send(res, 200, subObj(sub));
    }
  }
  if (p === '/subscriptions' && req.method === 'GET') {
    let list = [...S.stripeSubs.values()].filter(s => s.customer === f.customer);
    if (f.status && f.status !== 'all') list = list.filter(s => s.status === f.status);
    if (!S.customers.has(f.customer)) return sErr(res, 404, 'invalid_request_error', 'resource_missing', 'No such customer: ' + f.customer, 'customer');
    return send(res, 200, { object: 'list', data: list.map(subObj) });
  }
  if (p === '/billing_portal/sessions' && req.method === 'POST') {
    if (!S.flags.portalConfigured) return sErr(res, 400, 'invalid_request_error', 'invalid_request_error', 'No configuration provided and your test mode default configuration has not been created.');
    return send(res, 200, { url: BASE + '/__portal/' + f.customer, return_url: f.return_url });
  }
  return sErr(res, 404, 'invalid_request_error', 'resource_missing', 'Unrecognized request URL: ' + p);
}

/* ---------------------------------------------------------------- test controls and fake hosted pages */
async function completeCheckout(sessionId) {
  const s = S.sessions.get(sessionId);
  if (!s) return null;
  const li = s.params.line_items[0];
  const item = itemFromPriceData(li.price_data);
  const sub = {
    id: 'sub_' + rand(5), customer: s.customer, status: 'active', created: nowSec(), cancel_at_period_end: false, cancel_at: null,
    metadata: (s.params.subscription_data && s.params.subscription_data.metadata) || {}, item, period_end: addPeriod(item.recurring)
  };
  S.stripeSubs.set(sub.id, sub);
  s.status = 'complete'; s.subscription = sub.id;
  await emitWebhook('customer.subscription.created', subObj(sub));
  await emitWebhook('checkout.session.completed', { id: s.id, object: 'checkout.session', mode: 'subscription', customer: s.customer, subscription: sub.id, client_reference_id: s.client_reference_id });
  return { sub, success: s.params.success_url.replace('{CHECKOUT_SESSION_ID}', s.id) };
}

async function control(req, res, url, raw) {
  const p = url.pathname;
  const body = raw ? JSON.parse(raw) : {};
  if (p === '/__test/reset') { reset(); return send(res, 200, { ok: true }); }
  if (p === '/__test/set') { Object.assign(S.flags, body); return send(res, 200, S.flags); }
  if (p === '/__test/state') {
    return send(res, 200, {
      users: [...S.users.values()].map(u => ({ id: u.id, email: u.email, confirmed: u.confirmed })),
      profiles: S.profiles, trips: S.trips, subs: S.subs, emails: S.emails, log: S.log, flags: S.flags,
      stripeSubs: [...S.stripeSubs.values()].map(subObj), customers: [...S.customers.values()], sessions: [...S.sessions.values()].map(x => ({ id: x.id, status: x.status }))
    });
  }
  if (p === '/__test/pay') { const r = await completeCheckout(body.session); return send(res, 200, r ? { sub: r.sub.id, success: r.success } : { error: 'no session' }); }
  if (p === '/__test/portal-cancel') {
    const sub = S.stripeSubs.get(body.sub); sub.cancel_at_period_end = true; sub.cancel_at = sub.period_end;
    await emitWebhook('customer.subscription.updated', subObj(sub)); return send(res, 200, { ok: true });
  }
  if (p === '/__test/quiet-cancel') { // changes Stripe but sends no webhook (to test the sync safety net)
    const sub = S.stripeSubs.get(body.sub); sub.cancel_at_period_end = true; sub.cancel_at = sub.period_end; return send(res, 200, { ok: true });
  }
  if (p === '/__test/end') {
    const sub = S.stripeSubs.get(body.sub); sub.status = 'canceled';
    await emitWebhook('customer.subscription.deleted', subObj(sub)); return send(res, 200, { ok: true });
  }
  if (p === '/__test/past-due') {
    const sub = S.stripeSubs.get(body.sub); sub.status = 'past_due';
    await emitWebhook('customer.subscription.updated', subObj(sub)); return send(res, 200, { ok: true });
  }
  if (p === '/__test/webhook') { // send an arbitrary body with a chosen signature, to test rejection
    const r = await fetch(S.flags.appBase + '/api/webhook', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, body.headers || {}), body: body.body });
    return send(res, 200, { status: r.status, text: await r.text() });
  }
  return send(res, 404, {});
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); return res.end(); }
    const url = new URL(req.url, BASE);
    const raw = await readBody(req);
    const json = () => { try { return raw ? JSON.parse(raw) : {}; } catch (e) { return {}; } };
    if (url.pathname.startsWith('/supabase/auth/v1')) return auth(req, res, url, json());
    if (url.pathname.startsWith('/supabase/rest/v1/')) return rest(req, res, url, json());
    if (url.pathname.startsWith('/stripe/v1')) return stripe(req, res, url, raw);
    if (url.pathname.startsWith('/__test/')) return control(req, res, url, raw);
    let m;
    if ((m = /^\/__pay\/(.+)$/.exec(url.pathname))) {
      const s = S.sessions.get(m[1]);
      if (!s) return send(res, 404, 'unknown session');
      const cancel = s.params.cancel_url;
      return send(res, 200, `<!doctype html><title>Mock Stripe Checkout</title><h1>Mock Stripe Checkout</h1><p id="amt">${s.params.line_items[0].price_data.unit_amount} ${s.params.line_items[0].price_data.currency} every ${s.params.line_items[0].price_data.recurring.interval_count} ${s.params.line_items[0].price_data.recurring.interval}</p>
        <button id="pay" onclick="fetch('/__test/pay',{method:'POST',body:JSON.stringify({session:'${s.id}'})}).then(r=>r.json()).then(j=>location.href=j.success)">Pay now</button>
        <a id="back" href="${cancel}">Back</a>`);
    }
    if ((m = /^\/__portal\/(.+)$/.exec(url.pathname))) return send(res, 200, '<!doctype html><title>Mock billing portal</title><h1 id="portal">Mock billing portal</h1><p>' + m[1] + '</p>');
    send(res, 404, { error: 'not found', path: url.pathname });
  } catch (e) { console.error(e); send(res, 500, { error: String(e) }); }
});

if (require.main === module) server.listen(PORT, () => console.log('mock services on ' + BASE));
module.exports = { server, S, WHSEC, SERVICE_KEY, ANON_KEY, STRIPE_KEY, BASE };
