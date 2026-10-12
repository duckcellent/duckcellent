# Duckcellent

Travel atlas and trip planner: mark the countries you have been to (by continent and region), plan trips with an
itinerary, flights and stays, and see the membership plans.

This folder is a plain static site. There is nothing to install or build.

## Put it online with Vercel

### Option A: through GitHub (recommended)
1. Create a free account at https://github.com and make a new repository (for example `duckcellent`).
2. Upload everything in this folder to the repository (use "Add file" > "Upload files", or `git push`).
3. Create a free account at https://vercel.com and sign in with GitHub.
4. Click **Add New > Project**, pick the `duckcellent` repository and click **Deploy**.
   Leave the framework as **Other** and leave the build command and output directory empty.
5. Vercel gives you a web address ending in `.vercel.app`. Every time you change the repository it republishes.

### Option B: from your computer
1. Install Node.js from https://nodejs.org.
2. Open a terminal in this folder and run `npx vercel`. Follow the prompts (accept the defaults).
3. Run `npx vercel --prod` to publish to your live address.

### Your own domain
In your Vercel project open **Settings > Domains**, add your domain (for example `duckcellent.com`) and follow the
instructions Vercel shows to point it at the project.

## What this version does and does not do
- Works today: world map, countries by continent and region, trips, itinerary, flights with airport search,
  stays, typed dates, free and Plus plan screens.
- Data is saved in each visitor's own browser (localStorage). It is not shared between devices or customers, and it
  is lost if they clear their browser data.
- The membership screen is a demo. **No payment is taken** and the plan is stored only in that browser.

To make it a real subscription product you still need customer accounts, a database and billing:
1. Accounts and database: Supabase (https://supabase.com) or Firebase.
2. Payments: Stripe (https://stripe.com) with four recurring prices (monthly, 3 months, 6 months, yearly).
3. Privacy policy and terms of service pages.

## Where things are
- `index.html`: the whole app (styles, scripts, country list, map shapes and airport list are inside this file).
- Prices and free-plan limits: search `index.html` for `FREE_COUNTRIES` and `PLANS`.
- Logo and icons: `logo.svg`, `logo.png`, `logo-512.png`, `favicon.png`, `apple-touch-icon.png`.
- `vercel.json`: Vercel settings.

## Credits and data notes
- Country outlines come from the public-domain world.geo.json dataset (simplified, so borders are approximate).
- The airport list is hand-written (about 465 major airports) and may be incomplete. Any 3-letter airport code
  can still be typed in.

## Installing it as an app (PWA)

The site is installable. After it is live on Vercel:
- iPhone: open it in Safari, tap Share, then "Add to Home Screen".
- Android: open it in Chrome, tap the menu, then "Install app".
- Desktop: Chrome or Edge shows an install icon in the address bar.

It opens full screen with the duck icon and works offline after the first visit.
To roll out an update, change the `CACHE` name in `sw.js` (for example `duckcellent-v2`).
