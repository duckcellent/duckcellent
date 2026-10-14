'use strict';
// The single source of truth for what Duckcellent Plus costs.
// Change a price here and both the website and Stripe checkout follow.
// Amounts are in whole currency units (4.99 = A$4.99). Use a two-decimal currency (aud, usd, eur, gbp, cad, nzd, sgd).

const CURRENCY = (process.env.PLAN_CURRENCY || 'aud').toLowerCase();

const FREE = { countries: 10, trips: 1 };

const PLANS = [
  { id: 'monthly',   label: 'Monthly',        months: 1,  price: 4.99,  unit: 'month',    interval: 'month', interval_count: 1 },
  { id: 'quarterly', label: 'Every 3 months', months: 3,  price: 12.99, unit: '3 months', interval: 'month', interval_count: 3 },
  { id: 'biannual',  label: 'Every 6 months', months: 6,  price: 23.99, unit: '6 months', interval: 'month', interval_count: 6 },
  { id: 'yearly',    label: 'Yearly',         months: 12, price: 39.99, unit: 'year',     interval: 'year',  interval_count: 1 }
];

const planById = id => PLANS.find(p => p.id === id) || null;
const cents = p => Math.round(p.price * 100);

// Work out which plan a Stripe subscription is, from its billing interval.
function planFromRecurring(r) {
  if (!r) return null;
  const hit = PLANS.find(p => p.interval === r.interval && p.interval_count === (r.interval_count || 1));
  return hit ? hit.id : null;
}

module.exports = { CURRENCY, FREE, PLANS, planById, cents, planFromRecurring };
