'use strict';
// Public settings the website needs to start. Nothing secret lives here.
const { route, send } = require('../lib/http');
const db = require('../lib/supabase');
const stripe = require('../lib/stripe');
const { PLANS, FREE, CURRENCY } = require('../lib/plans');

module.exports = route(['GET'], async (req, res) => {
  send(res, 200, {
    accounts: db.configured(),
    billing: db.configured() && db.serverConfigured() && stripe.configured(),
    supabaseUrl: db.configured() ? db.url() : null,
    supabaseAnonKey: db.configured() ? db.anon() : null,
    currency: CURRENCY.toUpperCase(),
    free: FREE,
    plans: PLANS.map(p => ({ id: p.id, label: p.label, months: p.months, price: p.price, unit: p.unit }))
  }, { 'Cache-Control': 'no-cache' });
});
