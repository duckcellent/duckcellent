'use strict';
const crypto = require('crypto');
const { HttpError } = require('./http');
const { CURRENCY } = require('./plans');

const PRODUCT_ID = 'duckcellent_plus';

const base = () => (process.env.STRIPE_API_BASE || 'https://api.stripe.com/v1').replace(/\/+$/, '');
const key = () => process.env.STRIPE_SECRET_KEY || '';
const configured = () => !!key();

// Stripe wants form-encoded bodies with bracketed nesting: a[b][0][c]=1
function encode(obj, prefix, out) {
  out = out || [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    const name = prefix ? prefix + '[' + k + ']' : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') encode(item, name + '[' + i + ']', out);
        else out.push([name + '[' + i + ']', String(item)]);
      });
    } else if (typeof v === 'object') encode(v, name, out);
    else out.push([name, String(v)]);
  }
  return out;
}
const toForm = obj => new URLSearchParams(encode(obj)).toString();

async function stripe(method, path, params) {
  if (!configured()) throw new HttpError(503, 'billing_not_configured', 'Payments are not set up yet.');
  const headers = { Authorization: 'Bearer ' + key() };
  let url = base() + path;
  let body;
  if (method === 'GET') {
    const q = params ? toForm(params) : '';
    if (q) url += '?' + q;
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = params ? toForm(params) : '';
  }
  let r;
  try { r = await fetch(url, { method, headers, body }); }
  catch (e) { throw new HttpError(502, 'stripe_unreachable', 'Could not reach the payment service.'); }
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch (e) { data = {}; }
  if (!r.ok) {
    const se = data && data.error || {};
    const err = new Error('Stripe ' + r.status + ': ' + (se.message || text));
    err.status = r.status >= 500 ? 502 : 400;
    err.code = se.code || 'stripe_error';
    err.stripe = se;
    err.stripeStatus = r.status;
    throw err;
  }
  return data;
}

// The one Stripe product every plan hangs off. Created on first use with a fixed id.
async function ensureProduct() {
  try {
    await stripe('GET', '/products/' + PRODUCT_ID);
  } catch (e) {
    if (e.code !== 'resource_missing') throw e;
    try {
      await stripe('POST', '/products', { id: PRODUCT_ID, name: 'Duckcellent Plus', description: 'Unlimited countries and trips, saved to your account.' });
    } catch (e2) {
      if (e2.code !== 'resource_already_exists') throw e2; // someone else created it a moment ago
    }
  }
  return PRODUCT_ID;
}

// price_data block for a plan (used for both new checkouts and plan changes).
function priceData(plan, product) {
  return {
    currency: CURRENCY,
    product,
    unit_amount: Math.round(plan.price * 100),
    recurring: { interval: plan.interval, interval_count: plan.interval_count }
  };
}

// Check that a webhook really came from Stripe.
function verifyWebhook(raw, header, secret, toleranceSeconds, nowSeconds) {
  if (!header || !secret) throw new HttpError(400, 'bad_signature', 'Missing signature.');
  const parts = String(header).split(',').map(s => s.trim());
  let t = null;
  const sigs = [];
  for (const p of parts) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i), v = p.slice(i + 1);
    if (k === 't') t = v;
    else if (k === 'v1') sigs.push(v);
  }
  if (!t || !sigs.length) throw new HttpError(400, 'bad_signature', 'Malformed signature.');
  const expected = crypto.createHmac('sha256', secret).update(t + '.').update(raw).digest('hex');
  const eb = Buffer.from(expected, 'utf8');
  const ok = sigs.some(s => {
    const sb = Buffer.from(s, 'utf8');
    return sb.length === eb.length && crypto.timingSafeEqual(sb, eb);
  });
  if (!ok) throw new HttpError(400, 'bad_signature', 'Signature does not match.');
  const now = nowSeconds === undefined ? Math.floor(Date.now() / 1000) : nowSeconds;
  if (Math.abs(now - Number(t)) > (toleranceSeconds || 300)) throw new HttpError(400, 'bad_signature', 'Signature is too old.');
}

module.exports = { stripe, configured, ensureProduct, priceData, verifyWebhook, encode, toForm, PRODUCT_ID };
