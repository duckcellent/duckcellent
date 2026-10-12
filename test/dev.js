'use strict';
// Local stand-in for Vercel: serves the site and runs api/*.js, wired to the mock services (test/mock.js).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { server: mock, SERVICE_KEY, ANON_KEY, STRIPE_KEY, WHSEC, BASE } = require('./mock');

const MOCK_PORT = +process.env.MOCK_PORT || 4010;
const PORT = +process.env.PORT || 3000;
const ROOT = path.join(__dirname, '..');
Object.assign(process.env, {
  SUPABASE_URL: BASE + '/supabase', SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY,
  STRIPE_SECRET_KEY: STRIPE_KEY, STRIPE_WEBHOOK_SECRET: WHSEC, STRIPE_API_BASE: BASE + '/stripe/v1',
  SITE_URL: 'http://localhost:' + PORT
});
if (process.env.NO_BILLING) { delete process.env.STRIPE_SECRET_KEY; }
if (process.env.NO_ACCOUNTS) { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY; delete process.env.SUPABASE_SERVICE_ROLE_KEY; }

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };
const STATIC_OK = new Set(['index.html', 'sw.js', 'manifest.webmanifest', 'favicon.png', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'logo.png', 'logo.svg', 'logo-512.png']);

const app = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const m = /^\/api\/([a-z-]+)$/.exec(url.pathname);
  if (m) {
    const file = path.join(ROOT, 'api', m[1] + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{"error":"no such function"}'); }
    return require(file)(req, res);
  }
  let name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  if (!STATIC_OK.has(name)) { res.statusCode = 404; return res.end('Not found'); }
  const buf = fs.readFileSync(path.join(ROOT, name));
  res.setHeader('Content-Type', MIME[path.extname(name)] || 'application/octet-stream');
  if (name === 'sw.js') res.setHeader('Cache-Control', 'no-cache');
  res.end(buf);
});

mock.listen(MOCK_PORT, () => app.listen(PORT, () => console.log('dev site on http://localhost:' + PORT + '  mock on ' + BASE)));
