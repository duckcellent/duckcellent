# Duckcellent: accounts, database and billing setup

This project is Duckcellent with real accounts, cloud saving and paid subscriptions.
You need three free accounts to run it. Setup takes about 45 minutes the first time.

| What | Service | Does what |
|---|---|---|
| The website and server functions | **Vercel** (you already have this) | Hosts the app and runs the small billing functions in `api/` |
| Accounts and data | **Supabase** | Sign-up, sign-in, password reset, and the database holding each person's atlas and trips |
| Payments | **Stripe** | Card payments, renewals, invoices, cancellation page |

How the pieces talk: the browser signs people in with Supabase and saves their atlas straight to Supabase (each person can only ever see their own rows). When someone subscribes, the browser asks `api/checkout` for a Stripe payment page. Stripe tells `api/webhook` when a payment succeeds, renews or is cancelled, and that writes the membership into Supabase. The database itself enforces the free-plan limits, so they cannot be bypassed from the browser.

Do everything in **test mode** first. No real money moves until you switch Stripe to live.

---

## Step 1. Put these files on GitHub

Unzip the download and upload everything over the files in your existing GitHub repository (replace the old ones). Keep the folder structure: `index.html`, `sw.js`, `api/`, `lib/`, `supabase/`, and so on. Vercel redeploys by itself. The site will still work as before until the next steps are done.

## Step 2. Supabase (accounts and database)

1. Go to **supabase.com**, sign up, and create a **New project**. Pick a region close to your customers (for Australia, "Sydney"). Save the database password somewhere safe. You will not need it for this app.
2. Open **SQL Editor > New query**. Open `supabase/schema.sql` from this project, paste the whole file in, and press **Run**. It should say "Success". (Running it again later is harmless.)
3. Open **Authentication** and find the URL settings (**URL Configuration**):
   - **Site URL**: your site address, for example `https://duckcellent.vercel.app`
   - **Redirect URLs**: add `https://duckcellent.vercel.app/**` (and your own domain later). Email links will not work without this.
4. In the Authentication email settings:
   - Leave **Confirm email** switched **on** (recommended).
   - Set the minimum password length to **8**.
   - **Important before real customers:** Supabase's built-in email sender only sends a few emails an hour and only to your own team members. Set up your own sender under **Authentication > SMTP Settings** using a service such as Resend, Postmark or SendGrid. Until then, sign-up confirmation emails will not reach strangers. For private testing you can switch "Confirm email" off.
5. Find your keys under **Project Settings > API** (newer projects call this **API Keys**). You need three values:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - **anon key** (also called the *publishable* key). Safe to be public.
   - **service_role key** (also called the *secret* key). **Private. Never put this in the website or GitHub.**

## Step 3. Stripe (payments)

1. Go to **stripe.com**, create an account, and stay in **Test mode** (the toggle at the top of the dashboard).
2. **Developers > API keys**: copy the **Secret key** (starts `sk_test_`).
3. Switch on the billing page where customers update cards, see invoices and cancel: search the dashboard for **Customer portal** (under Settings > Billing), turn it on and press **Save**. Without this, the "Manage billing" button shows an error.
4. **Developers > Webhooks > Add endpoint**:
   - Endpoint URL: `https://YOUR-SITE/api/webhook` (for example `https://duckcellent.vercel.app/api/webhook`)
   - Select these four events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`
   - After saving, open the endpoint and copy its **Signing secret** (starts `whsec_`).

You do not create products or prices in Stripe. The app creates one product ("Duckcellent Plus") by itself the first time someone subscribes, and the prices come from `lib/plans.js`.

## Step 4. Vercel (connect everything)

In your Vercel project open **Settings > Environment Variables** and add these (tick Production, Preview and Development):

| Name | Value |
|---|---|
| `SUPABASE_URL` | the Project URL from Step 2 |
| `SUPABASE_ANON_KEY` | the anon / publishable key |
| `SUPABASE_SERVICE_ROLE_KEY` | the service_role / secret key |
| `STRIPE_SECRET_KEY` | `sk_test_...` from Step 3 |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` from Step 3 |
| `SITE_URL` | your site address, with `https://` and no trailing slash |

Then **Deployments > the latest one > Redeploy** (new variables only apply to new deployments).

## Step 5. Check the connections

Open `https://YOUR-SITE/api/health`. Everything should read `true`, and `stripe_mode` should say `test`:

```
"env":    all six true
"checks": supabase_auth true, database_tables true, stripe_key_works true
```

- `database_tables` false: the SQL in Step 2 did not run, or the service key is wrong.
- `stripe_key_works` false: the Stripe key is wrong or from a different account.
- `supabase_auth` false: the URL or anon key is wrong.

(This page shows only yes/no. It never shows your keys.)

## Step 6. Try it like a customer

1. Open the site, press **Sign in > Create an account**, and sign up.
2. Mark some countries, create a trip, refresh the page: it is still there. Open the site in a private window and sign in: same data. (Anything saved on a device before signing in moves into the account.)
3. Try to add an 11th country or a second trip: the free limit appears.
4. **Membership > Subscribe**. On the Stripe page use the test card `4242 4242 4242 4242`, any future date, any 3 digits, any postcode. You come back as a Plus member and the limits are gone.
5. Switch plan, then **Manage billing** and cancel. The page shows "Ends on ..." and you keep Plus until then.
6. Other test cards: `4000 0000 0000 0002` (declined), `4000 0000 0000 9995` (not enough funds).
7. In Stripe **Developers > Webhooks** you can see every message Stripe sent and whether the app answered "200".

## Going live (checklist)

- [ ] Stripe: complete **Activate account** (business details, bank account for payouts).
- [ ] Add a **Privacy Policy** and **Terms of Service** page and link them (Stripe and the app stores expect these). Have someone qualified check them, and check your tax obligations (for example GST) for selling a subscription.
- [ ] Switch Stripe to **Live mode**, copy the live secret key, and create a **new webhook endpoint in live mode** (same URL and four events) to get a live `whsec_`. Update `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` in Vercel and redeploy. Turn on the Customer portal in live mode too.
- [ ] In Supabase **SQL Editor**, run `delete from subscriptions;` once, so leftover test customers do not carry over into live mode.
- [ ] Custom email sender in Supabase (Step 2.4).
- [ ] Your own domain: add it in Vercel, then update `SITE_URL`, the Supabase Site URL and Redirect URLs, and the Stripe webhook URL.
- [ ] Plans: Vercel's free Hobby plan is meant for personal, non-commercial projects, so a paid app belongs on their Pro plan. Supabase's free projects pause after a week of no use and have no backups, so use their Pro plan for a live product.
- [ ] Make a real small purchase with your own card, check it, then refund it in Stripe.

## Changing prices and limits

- **Prices and plan names**: edit `lib/plans.js`. The website and Stripe checkout both read it. Existing members keep the price they pay until they switch plans.
- **Currency**: prices are in Australian dollars (AUD) unless the `PLAN_CURRENCY` environment variable says otherwise (for example `usd`). Members who already subscribed in another currency keep paying in it, including when they switch plans, because Stripe cannot change a running subscription's currency.
- **Free limits (10 countries, 1 trip)**: change `FREE` in `lib/plans.js` **and** the numbers `10` and `1` inside `enforce_profile_limit` and `enforce_trip_limit` in `supabase/schema.sql`, then run the changed functions again in the SQL Editor. The first controls what people see, the second is what really enforces it.

## What is where

```
index.html            the whole app (built from src/, see DEVELOPING.md)
sw.js, manifest...    lets people install it like an app and use it offline
api/config.js         tells the browser the public settings and plan prices
api/checkout.js       starts a subscription, or switches / resumes a plan
api/portal.js         opens Stripe's billing page
api/sync.js           re-reads a member's status from Stripe (safety net)
api/webhook.js        receives Stripe's payment messages (checks the signature)
api/delete-account.js deletes an account, its data, and cancels billing
api/health.js         yes/no connection check
lib/                  shared server code
supabase/schema.sql   database tables, security rules and free-plan limits
```

## Good to know

- **Two devices at once**: each save replaces that country list or trip with the newest copy. The app refreshes when you return to it, but if the same trip is edited on two devices at the same moment, the last save wins.
- **Offline**: signed-in changes are kept on the device and sent when the connection returns.
- **Privacy**: people can download their data and delete their account from the **Account** button. Deleting cancels any active subscription straight away.
- **Not included yet**: sign in with Google or Apple, App Store / Google Play in-app purchases (stores require their own billing for subscriptions sold inside an app), email receipts beyond what Stripe sends, and an admin screen (use the Supabase and Stripe dashboards).

## If something goes wrong

| Symptom | Cause |
|---|---|
| No "Sign in" button on the site | `SUPABASE_URL` or `SUPABASE_ANON_KEY` missing, or not redeployed after adding |
| Subscribe button says "Payments are not switched on yet" | `STRIPE_SECRET_KEY` or `SUPABASE_SERVICE_ROLE_KEY` missing |
| Paid but still Free | Look at the webhook in Stripe (should answer 200). The app also re-checks with Stripe after checkout and on sign-in, so it should correct itself within seconds. |
| "The billing page has not been switched on in Stripe yet" | Step 3.3 (Customer portal) not saved, in this mode (test or live) |
| Confirmation or reset emails never arrive | Step 2.4 (custom email sender) |
| "That link has expired" | Email links work once and for a short time. Request a new one. |
