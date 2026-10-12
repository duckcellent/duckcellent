'use strict';
// Open /api/health in a browser to see whether everything is connected. Shows yes/no only, never secrets.
const { route, send } = require('../lib/http');
const db = require('../lib/supabase');
const stripeLib = require('../lib/stripe');

async function probe(fn) {
  try { return await fn(); } catch (e) { return false; }
}

module.exports = route(['GET'], async (req, res) => {
  const env = {
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: !!process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    STRIPE_SECRET_KEY: !!process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: !!process.env.STRIPE_WEBHOOK_SECRET,
    SITE_URL: !!process.env.SITE_URL
  };
  const checks = {};
  if (db.configured()) {
    checks.supabase_auth = await probe(async () => (await fetch(db.url() + '/auth/v1/health', { headers: { apikey: db.anon() } })).ok);
  }
  if (db.serverConfigured()) {
    checks.database_tables = await probe(async () => { await db.rest('subscriptions', { query: 'select=user_id&limit=1' }); return true; });
  }
  let stripeMode = null;
  if (stripeLib.configured()) {
    stripeMode = /^(sk|rk)_live_/.test(process.env.STRIPE_SECRET_KEY) ? 'live' : /^(sk|rk)_test_/.test(process.env.STRIPE_SECRET_KEY) ? 'test' : 'unknown';
    checks.stripe_key_works = await probe(async () => { await stripeLib.stripe('GET', '/balance'); return true; });
  }
  send(res, 200, { env, checks, stripe_mode: stripeMode });
});
