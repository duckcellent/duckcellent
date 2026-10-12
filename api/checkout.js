'use strict';
// Start a subscription (opens Stripe Checkout) or, for current members, switch / resume their plan.
const { route, send, readJson, bearer, siteUrl, HttpError } = require('../lib/http');
const db = require('../lib/supabase');
const { stripe, ensureProduct, priceData, configured } = require('../lib/stripe');
const { planById } = require('../lib/plans');
const { isLive, applySubscription, summary } = require('../lib/billing');

async function newCustomer(user) {
  const c = await stripe('POST', '/customers', { email: user.email || undefined, metadata: { user_id: user.id } });
  await db.upsertSubscriptionRow({ user_id: user.id, stripe_customer_id: c.id, updated_at: new Date().toISOString() });
  return c.id;
}

async function changeOrResume(user, row, plan) {
  const sub = await stripe('GET', '/subscriptions/' + row.stripe_subscription_id);
  if (!isLive(sub.status)) { await applySubscription(sub, user.id); return null; } // out of date: start fresh instead
  const item = sub.items.data[0];
  const rec = item.price && item.price.recurring || {};
  const same = rec.interval === plan.interval && (rec.interval_count || 1) === plan.interval_count;
  const ending = !!(sub.cancel_at_period_end || sub.cancel_at);
  if (same) {
    if (!ending) throw new HttpError(409, 'already_on_plan', 'You are already on this plan.');
    const resumed = await stripe('POST', '/subscriptions/' + sub.id, { cancel_at_period_end: false });
    return { changed: true, resumed: true, membership: await applySubscription(resumed, user.id) };
  }
  const product = await ensureProduct();
  let updated;
  try {
    updated = await stripe('POST', '/subscriptions/' + sub.id, {
      items: [{ id: item.id, price_data: priceData(plan, product) }],
      proration_behavior: 'create_prorations',
      payment_behavior: 'error_if_incomplete',
      cancel_at_period_end: false,
      metadata: { user_id: user.id, plan: plan.id }
    });
  } catch (e) {
    if (e.stripe && e.stripe.type === 'card_error') { e.status = 402; e.code = 'payment_failed'; }
    throw e;
  }
  return { changed: true, membership: await applySubscription(updated, user.id) };
}

module.exports = route(['POST'], async (req, res) => {
  if (!configured() || !db.serverConfigured()) throw new HttpError(503, 'billing_not_configured', 'Payments are not switched on yet.');
  const user = await db.authUser(bearer(req));
  const body = await readJson(req);
  const plan = planById(body.plan);
  if (!plan) throw new HttpError(400, 'bad_plan', 'That plan does not exist.');

  const row = await db.getSubscriptionRow(user.id);
  if (row && row.stripe_subscription_id && isLive(row.status)) {
    const done = await changeOrResume(user, row, plan);
    if (done) return send(res, 200, done);
  }

  const product = await ensureProduct();
  let customer = row && row.stripe_customer_id || await newCustomer(user);
  const origin = siteUrl(req);
  const make = cus => stripe('POST', '/checkout/sessions', {
    mode: 'subscription',
    customer: cus,
    client_reference_id: user.id,
    line_items: [{ quantity: 1, price_data: priceData(plan, product) }],
    subscription_data: { metadata: { user_id: user.id, plan: plan.id } },
    success_url: origin + '/?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    cancel_url: origin + '/?checkout=cancel',
    allow_promotion_codes: true,
    billing_address_collection: 'auto'
  });
  let session;
  try { session = await make(customer); }
  catch (e) {
    // The saved customer came from a different Stripe mode (test vs live) or was deleted.
    if (e.code === 'resource_missing' && /customer/i.test((e.stripe && e.stripe.param) || e.message)) {
      customer = await newCustomer(user);
      session = await make(customer);
    } else throw e;
  }
  send(res, 200, { url: session.url });
});
