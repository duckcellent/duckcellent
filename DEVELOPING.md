# Working on the code

`index.html` is generated. Edit `src/template_saas.html` (plus `src/countries.js`, `mapdata.js`, `airports.js`) and rebuild:

    python3 tools/build.py
    powershell -ExecutionPolicy Bypass -File tools/build.ps1      # same thing on Windows without Python

States and cities for the atlas live in `places-v1.json` (built from GeoNames data, CC BY 4.0). To rebuild it, see the
instructions at the top of `tools/build_places.ps1`. If you change its contents, rename it (`places-v2.json`) in the script
and in `src/template_saas.html`, because the service worker keeps the old file cached.

The tests need no internet and no real accounts. They use stand-ins for Supabase and Stripe (`test/mock.js`):

    node test/dev.js                 # site on :3000, stand-ins on :4010 (leave running)
    node test/api_test.js            # server functions: signatures, checkout, plan changes, webhook, delete
    python3 test/e2e.py              # real browser: sign-up, saving, limits, subscribe, offline, reset, delete
    python3 test/e2e_modes.py        # app when accounts/billing are not configured (needs 2 extra dev servers, see file)
    test/run_schema_test.sh          # database rules on a real local Postgres (needs Postgres installed)

The stand-ins copy how Supabase and Stripe behave for the calls this app makes. They are not the real services, so always finish with the test-mode walkthrough in `SETUP.md`.
