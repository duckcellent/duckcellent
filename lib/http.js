'use strict';

class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

function send(res, status, body, headers) {
  const h = Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, headers || {});
  res.statusCode = status;
  for (const k of Object.keys(h)) res.setHeader(k, h[k]);
  res.end(JSON.stringify(body));
}

// Read the raw request body. (Needed as-is for Stripe's signature check.)
function readRaw(req, limit) {
  limit = limit || 1e6;
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > limit) { reject(new HttpError(413, 'too_large', 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const raw = await readRaw(req, 20000);
  if (!raw.length) return {};
  try { return JSON.parse(raw.toString('utf8')); }
  catch (e) { throw new HttpError(400, 'bad_json', 'Request body is not valid JSON'); }
}

function bearer(req) {
  const h = req.headers['authorization'] || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

// Wrap a handler so every error becomes a tidy JSON response.
function route(methods, fn) {
  return async (req, res) => {
    try {
      if (!methods.includes(req.method)) {
        res.setHeader('Allow', methods.join(', '));
        throw new HttpError(405, 'method_not_allowed', 'Use ' + methods.join(' or '));
      }
      await fn(req, res);
    } catch (e) {
      const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
      if (status >= 500) console.error(req.method, req.url, e && e.stack || e);
      const message = e.stripe && e.stripe.message ? e.stripe.message
        : (status >= 500 && !(e instanceof HttpError) ? 'Something went wrong on our side.' : e.message);
      send(res, status, { error: e.code || 'server_error', message });
    }
  };
}

// The public address of the site, used for Stripe return links.
function siteUrl(req) {
  const env = process.env.SITE_URL;
  if (env) return env.replace(/\/+$/, '');
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  if (prod) return 'https://' + prod.replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(host) ? 'http' : 'https');
  return proto + '://' + host;
}

module.exports = { HttpError, send, readRaw, readJson, bearer, route, siteUrl };
