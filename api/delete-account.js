'use strict';
// Permanently deletes the signed-in person's account, data and live subscription.
const { route, send, readJson, bearer, HttpError } = require('../lib/http');
const db = require('../lib/supabase');
const { stripe, configured } = require('../lib/stripe');
const { isLive } = require('../lib/billing');

module.exports = route(['POST'], async (req, res) => {
  if (!db.serverConfigured()) throw new HttpError(503, 'not_configured', 'Accounts are not set up yet.');
  const user = await db.authUser(bearer(req));
  const body = await readJson(req);
  if (body.confirm !== true) throw new HttpError(400, 'not_confirmed', 'Please confirm the deletion.');

  const row = await db.getSubscriptionRow(user.id);
  if (row && row.stripe_subscription_id && isLive(row.status) && configured()) {
    try { await stripe('DELETE', '/subscriptions/' + row.stripe_subscription_id); }
    catch (e) { if (e.code !== 'resource_missing') throw e; } // never delete the account while still billing
  }
  await db.deleteAuthUser(user.id); // cascades to profiles, trips and subscriptions
  send(res, 200, { deleted: true });
});
