'use strict';
const { planById, planFromRecurring } = require('./plans');
const db = require('./supabase');
const { stripe } = require('./stripe');

const LIVE = ['active', 'trialing', 'past_due'];
const isLive = s => LIVE.includes(s);

const iso = sec => (sec ? new Date(sec * 1000).toISOString() : null);
const idOf = x => (x && typeof x === 'object' ? x.id : x) || null;

// Turn a Stripe subscription object into our database row.
function rowFromSubscription(sub, userId) {
  const item = sub.items && sub.items.data && sub.items.data[0] || null;
  const metaPlan = sub.metadata && sub.metadata.plan;
  const plan = planById(metaPlan) ? metaPlan : planFromRecurring(item && item.price && item.price.recurring);
  // Newer Stripe versions keep the billing period on the item, older ones on the subscription.
  const periodEnd = sub.current_period_end || (item && item.current_period_end) || null;
  return {
    user_id: userId,
    stripe_customer_id: idOf(sub.customer),
    stripe_subscription_id: sub.id,
    plan,
    status: sub.status,
    current_period_end: iso(periodEnd),
    cancel_at_period_end: !!(sub.cancel_at_period_end || sub.cancel_at),
    updated_at: new Date().toISOString()
  };
}

// What the browser is told about a membership.
function summary(row) {
  if (!row) return { plus: false, plan: null, status: null, current_period_end: null, cancel_at_period_end: false, has_customer: false };
  const live = isLive(row.status) && (!row.current_period_end || new Date(row.current_period_end).getTime() > Date.now() - 2 * 864e5);
  return {
    plus: live,
    plan: row.plan || null,
    status: row.status || null,
    current_period_end: row.current_period_end || null,
    cancel_at_period_end: !!row.cancel_at_period_end,
    has_customer: !!row.stripe_customer_id
  };
}

// Save a Stripe subscription against the right user. Safe to run many times, in any order.
async function applySubscription(sub, userHint) {
  const customer = idOf(sub.customer);
  let userId = userHint || (sub.metadata && sub.metadata.user_id) || null;
  if (!userId && customer) userId = await db.findUserByCustomer(customer);
  if (!userId) return null; // not one of ours

  const existing = await db.getSubscriptionRow(userId);
  // A late "cancelled" message for an old subscription must not wipe out a newer live one.
  if (existing && existing.stripe_subscription_id && existing.stripe_subscription_id !== sub.id &&
      isLive(existing.status) && !isLive(sub.status)) {
    return summary(existing);
  }
  const row = rowFromSubscription(sub, userId);
  await db.upsertSubscriptionRow(row);
  return summary(row);
}

// Ask Stripe what the customer's membership looks like right now and save it.
async function syncFromStripe(userId) {
  const row = await db.getSubscriptionRow(userId);
  if (!row || !row.stripe_customer_id) return summary(row);
  let list;
  try {
    list = await stripe('GET', '/subscriptions', { customer: row.stripe_customer_id, status: 'all', limit: 10 });
  } catch (e) {
    if (e.code === 'resource_missing') { // customer belongs to another Stripe mode or was deleted
      const cleared = { user_id: userId, stripe_customer_id: null, stripe_subscription_id: null, plan: null, status: null, current_period_end: null, cancel_at_period_end: false, updated_at: new Date().toISOString() };
      await db.upsertSubscriptionRow(cleared);
      return summary(cleared);
    }
    throw e;
  }
  const subs = (list.data || []).slice().sort((a, b) => (b.created || 0) - (a.created || 0));
  const pick = subs.find(s => isLive(s.status)) || subs.find(s => s.status !== 'incomplete' && s.status !== 'incomplete_expired') || null;
  if (!pick) {
    const cleared = Object.assign({}, row, { stripe_subscription_id: null, plan: null, status: 'none', current_period_end: null, cancel_at_period_end: false, updated_at: new Date().toISOString() });
    await db.upsertSubscriptionRow(cleared);
    return summary(cleared);
  }
  return applySubscription(pick, userId);
}

module.exports = { isLive, rowFromSubscription, summary, applySubscription, syncFromStripe };
