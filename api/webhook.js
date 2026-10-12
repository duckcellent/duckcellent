'use strict';
// Stripe calls this whenever a subscription changes (new, renewed, cancelled, payment failed).
const { route, send, readRaw, HttpError } = require('../lib/http');
const db = require('../lib/supabase');
const { stripe, verifyWebhook } = require('../lib/stripe');
const { applySubscription } = require('../lib/billing');

module.exports = route(['POST'], async (req, res) => {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'webhook_not_configured', 'Webhook secret is missing.');
  const raw = await readRaw(req);
  verifyWebhook(raw, req.headers['stripe-signature'], secret);
  let event;
  try { event = JSON.parse(raw.toString('utf8')); }
  catch (e) { throw new HttpError(400, 'bad_json', 'Invalid event.'); }

  const obj = event.data && event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
      if (obj && obj.mode === 'subscription' && obj.subscription) {
        const subId = typeof obj.subscription === 'object' ? obj.subscription.id : obj.subscription;
        const sub = await stripe('GET', '/subscriptions/' + subId);
        await applySubscription(sub, obj.client_reference_id || null);
      }
      break;
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      if (obj) await applySubscription(obj, null);
      break;
    default:
      break; // ignore everything else
  }
  send(res, 200, { received: true });
});
