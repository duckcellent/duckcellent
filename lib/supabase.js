'use strict';
const { HttpError } = require('./http');

const url = () => (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const anon = () => process.env.SUPABASE_ANON_KEY || '';
const service = () => process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const isJwt = k => /^eyJ/.test(k);

function serviceHeaders(extra) {
  const k = service();
  const h = { apikey: k, 'Content-Type': 'application/json' };
  if (isJwt(k)) h.Authorization = 'Bearer ' + k; // new-style secret keys go in "apikey" only
  return Object.assign(h, extra || {});
}

function configured() {
  return !!(url() && anon());
}
function serverConfigured() {
  return !!(url() && service());
}

// Check a sign-in token with Supabase and return the user it belongs to.
async function authUser(token) {
  if (!token) throw new HttpError(401, 'not_signed_in', 'Please sign in.');
  if (!configured()) throw new HttpError(503, 'not_configured', 'Accounts are not set up yet.');
  let r;
  try {
    r = await fetch(url() + '/auth/v1/user', { headers: { apikey: anon(), Authorization: 'Bearer ' + token } });
  } catch (e) { throw new HttpError(502, 'auth_unreachable', 'Could not reach the sign-in service.'); }
  if (r.status === 401 || r.status === 403) throw new HttpError(401, 'not_signed_in', 'Your sign-in has expired. Please sign in again.');
  if (!r.ok) throw new HttpError(502, 'auth_error', 'Sign-in check failed.');
  const u = await r.json();
  if (!u || !u.id) throw new HttpError(401, 'not_signed_in', 'Please sign in.');
  return { id: u.id, email: u.email || '' };
}

// Database access with full (server) rights. Never expose this to the browser.
async function rest(table, opts) {
  opts = opts || {};
  if (!serverConfigured()) throw new HttpError(503, 'not_configured', 'The database is not set up yet.');
  const q = opts.query ? '?' + opts.query : '';
  const headers = serviceHeaders(opts.prefer ? { Prefer: opts.prefer } : {});
  const r = await fetch(url() + '/rest/v1/' + table + q, {
    method: opts.method || 'GET',
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  const text = await r.text();
  let data = null;
  if (text) { try { data = JSON.parse(text); } catch (e) { data = text; } }
  if (!r.ok) {
    const err = new Error('Database error ' + r.status + ': ' + (data && data.message || text));
    err.status = 502; err.code = 'db_error';
    throw err;
  }
  return data;
}

async function getSubscriptionRow(userId) {
  const rows = await rest('subscriptions', { query: 'select=*&user_id=eq.' + encodeURIComponent(userId) + '&limit=1' });
  return rows && rows[0] || null;
}

async function upsertSubscriptionRow(row) {
  await rest('subscriptions', {
    method: 'POST',
    query: 'on_conflict=user_id',
    prefer: 'resolution=merge-duplicates,return=minimal',
    body: row
  });
}

async function findUserByCustomer(customerId) {
  const rows = await rest('subscriptions', { query: 'select=user_id&stripe_customer_id=eq.' + encodeURIComponent(customerId) + '&limit=1' });
  return rows && rows[0] ? rows[0].user_id : null;
}

async function deleteAuthUser(userId) {
  const r = await fetch(url() + '/auth/v1/admin/users/' + encodeURIComponent(userId), { method: 'DELETE', headers: serviceHeaders() });
  if (!r.ok && r.status !== 404) {
    const err = new Error('Could not delete user: ' + r.status);
    err.status = 502; err.code = 'delete_failed';
    throw err;
  }
}

module.exports = { url, anon, configured, serverConfigured, authUser, rest, getSubscriptionRow, upsertSubscriptionRow, findUserByCustomer, deleteAuthUser };
