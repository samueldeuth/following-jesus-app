// netlify/functions/lib/fcm.js
//
// Sends push notifications through Firebase Cloud Messaging (HTTP v1 API).
// Replaces every direct call to OneSignal. No npm dependencies -- the
// Google OAuth token is minted with Node's built-in crypto.
//
// REQUIRES one Netlify environment variable:
//   FIREBASE_SERVICE_ACCOUNT_JSON  -- the whole JSON file downloaded from
//     Firebase Console -> Project settings -> Service accounts ->
//     "Generate new private key". Paste the file's contents straight into
//     Netlify (never into chat).
//
// Design notes (this has to keep working at 100,000+ devices):
//   * One OAuth access token is cached and reused for ~55 minutes.
//   * sendMany() runs a bounded worker pool and retries transient errors
//     (429 / 5xx) with backoff; a 401 forces one token refresh.
//   * Dead tokens (app uninstalled / token rotated) are reported back to the
//     caller as `dead` so they can be deleted -- sending to them forever
//     wastes time and hurts Firebase's view of the sender.

const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

function b64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function loadServiceAccount(env = process.env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('Missing environment variable: FIREBASE_SERVICE_ACCOUNT_JSON');
  let sa;
  try { sa = JSON.parse(raw); } catch (e) { throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON'); }
  if (!sa.project_id || !sa.client_email || !sa.private_key) {
    throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON is missing project_id / client_email / private_key');
  }
  return sa;
}

let tokenCache = { token: null, expiresAt: 0, forEmail: null };

async function getAccessToken({ fetchImpl, force = false, nowMs = Date.now(), sa } = {}) {
  const account = sa || loadServiceAccount();
  if (!force && tokenCache.token && tokenCache.forEmail === account.client_email && nowMs < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const iat = Math.floor(nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({ iss: account.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = b64url(signer.sign(account.private_key));
  const assertion = `${header}.${claim}.${signature}`;

  const doFetch = fetchImpl || fetch;
  const res = await doFetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`,
  });
  const text = await res.text();
  let json = {};
  try { json = JSON.parse(text); } catch (e) { /* handled below */ }
  if (!res.ok || !json.access_token) {
    throw new Error(`Google OAuth failed (${res.status}): ${text.slice(0, 300)}`);
  }
  tokenCache = { token: json.access_token, expiresAt: nowMs + (json.expires_in || 3600) * 1000, forEmail: account.client_email };
  return json.access_token;
}

function resetTokenCache() { tokenCache = { token: null, expiresAt: 0, forEmail: null }; }

// FCM requires every value in `data` to be a string.
function stringifyData(data) {
  const out = {};
  for (const [k, v] of Object.entries(data || {})) {
    if (v === undefined || v === null) continue;
    out[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  return out;
}

function buildMessage({ token, title, body, data }) {
  return {
    message: {
      token,
      notification: { title: title || '', body: body || '' },
      data: stringifyData(data),
      android: { priority: 'HIGH', notification: { sound: 'default' } },
      apns: { headers: { 'apns-priority': '10' }, payload: { aps: { sound: 'default' } } },
    },
  };
}

// Turns an FCM error response into { dead, retryable, code }.
function classifyError(status, bodyText) {
  let code = '';
  let message = '';
  try {
    const j = JSON.parse(bodyText);
    message = (j.error && j.error.message) || '';
    const details = (j.error && j.error.details) || [];
    const fcmDetail = details.find((d) => d.errorCode);
    code = (fcmDetail && fcmDetail.errorCode) || (j.error && j.error.status) || '';
  } catch (e) { /* non-JSON body */ }

  const dead =
    code === 'UNREGISTERED' ||
    code === 'SENDER_ID_MISMATCH' ||
    status === 404 ||
    (status === 400 && /registration token|not a valid FCM/i.test(message));
  const retryable =
    !dead && (status === 429 || status >= 500 || ['UNAVAILABLE', 'INTERNAL', 'QUOTA_EXCEEDED', 'RESOURCE_EXHAUSTED'].includes(code));
  return { dead, retryable, code: code || String(status), message };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Sends one message. Never throws for per-device problems -- returns a result
// object so a bad token can't abort a 100,000-device run.
async function sendOne({ token, title, body, data }, { fetchImpl, sleepImpl = sleep, maxAttempts = 4, sa } = {}) {
  const account = sa || loadServiceAccount();
  const doFetch = fetchImpl || fetch;
  const url = `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`;
  const payload = JSON.stringify(buildMessage({ token, title, body, data }));

  let lastErr = null;
  let refreshed = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res, text;
    try {
      const accessToken = await getAccessToken({ fetchImpl, sa: account });
      res = await doFetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: payload,
      });
      text = await res.text();
    } catch (e) {
      lastErr = { ok: false, dead: false, code: 'NETWORK', message: e.message };
      if (attempt < maxAttempts) { await sleepImpl(200 * 2 ** (attempt - 1)); continue; }
      return lastErr;
    }
    if (res.ok) return { ok: true };

    if (res.status === 401 && !refreshed) {
      refreshed = true;
      resetTokenCache();
      continue;
    }
    const c = classifyError(res.status, text);
    lastErr = { ok: false, dead: c.dead, code: c.code, message: c.message || text.slice(0, 200) };
    if (c.retryable && attempt < maxAttempts) {
      const retryAfter = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
      await sleepImpl(retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 300 * 2 ** (attempt - 1));
      continue;
    }
    return lastErr;
  }
  return lastErr || { ok: false, dead: false, code: 'UNKNOWN', message: 'send failed' };
}

// items: [{ token, title, body, data, ref }]   (ref is passed through untouched)
// Returns { sent, failed, dead: [token...], okRefs: [...], failedRefs: [...] }
async function sendMany(items, { concurrency = 40, fetchImpl, sleepImpl, sa, deadlineMs } = {}) {
  const out = { sent: 0, failed: 0, dead: [], okRefs: [], failedRefs: [], skipped: 0, errors: {} };
  let i = 0;
  async function worker() {
    for (;;) {
      if (deadlineMs && Date.now() > deadlineMs) { out.skipped += items.length - i; i = items.length; return; }
      const idx = i++;
      if (idx >= items.length) return;
      const item = items[idx];
      const r = await sendOne(item, { fetchImpl, sleepImpl, sa });
      if (r.ok) { out.sent++; out.okRefs.push(item.ref); }
      else {
        out.failed++;
        out.failedRefs.push(item.ref);
        if (r.dead) out.dead.push(item.token);
        out.errors[r.code] = (out.errors[r.code] || 0) + 1;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, worker));
  return out;
}

module.exports = { sendOne, sendMany, getAccessToken, resetTokenCache, classifyError, buildMessage, stringifyData, loadServiceAccount };
