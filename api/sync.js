'use strict';
// Re-reads the member's subscription from Stripe. Used after checkout and on sign-in,
// so the app is right even if a webhook is late.
const { route, send, bearer } = require('../lib/http');
const db = require('../lib/supabase');
const { configured } = require('../lib/stripe');
const { syncFromStripe, summary } = require('../lib/billing');

module.exports = route(['POST'], async (req, res) => {
  const user = await db.authUser(bearer(req));
  if (!configured() || !db.serverConfigured()) return send(res, 200, { membership: summary(null) });
  send(res, 200, { membership: await syncFromStripe(user.id) });
});
