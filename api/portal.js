'use strict';
// Opens Stripe's hosted page where members update their card, see invoices or cancel.
const { route, send, bearer, siteUrl, HttpError } = require('../lib/http');
const db = require('../lib/supabase');
const { stripe, configured } = require('../lib/stripe');

module.exports = route(['POST'], async (req, res) => {
  if (!configured() || !db.serverConfigured()) throw new HttpError(503, 'billing_not_configured', 'Payments are not switched on yet.');
  const user = await db.authUser(bearer(req));
  const row = await db.getSubscriptionRow(user.id);
  if (!row || !row.stripe_customer_id) throw new HttpError(404, 'no_customer', 'There is no billing to manage yet.');
  try {
    const s = await stripe('POST', '/billing_portal/sessions', { customer: row.stripe_customer_id, return_url: siteUrl(req) + '/?portal=return' });
    send(res, 200, { url: s.url });
  } catch (e) {
    if (/configuration/i.test(e.message)) throw new HttpError(503, 'portal_not_configured', 'The billing page has not been switched on in Stripe yet.');
    throw e;
  }
});
