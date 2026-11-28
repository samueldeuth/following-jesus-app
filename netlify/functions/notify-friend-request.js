// netlify/functions/notify-friend-request.js
//
// Sends a push notification when someone sends you a friend request, or accepts yours.
// The app calls this right after the action succeeds, with the signed-in person's token.
//
// Safety: the caller's token is verified, and the push only goes out if the matching friendship row
// really exists in the database (pending request from caller -> recipient, or accepted by caller),
// and only once per request (notified_at / accepted_notified_at columns).
//
// Uses env vars that already exist: FIREBASE_SERVICE_ACCOUNT_JSON (project_id, private_key, client_email)
// and SUPABASE_SERVICE_ROLE_KEY. No new secrets.

const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://onflrmiifjjjboeimnva.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const OPEN_URL = 'https://followingjesus.com/app#friends';

const json = (code, body) => ({ statusCode: code, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const b64u = b => Buffer.from(b).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

async function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, Object.assign({}, opts, {
    headers: Object.assign({ apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, opts.headers || {})
  }));
  const t = await r.text();
  if (!r.ok) throw new Error('db ' + r.status + ' ' + t.slice(0, 200));
  return t ? JSON.parse(t) : null;
}

async function callerFromToken(token) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: ANON_KEY, Authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const u = await r.json();
  return u && u.id ? u.id : null;
}

async function fcmAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 }));
  const sig = crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') + '&assertion=' + head + '.' + claim + '.' + b64u(sig)
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('fcm auth failed');
  return j.access_token;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  try {
    const auth = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
    const caller = auth ? await callerFromToken(auth) : null;
    if (!caller) return json(401, { error: 'Sign in first' });
    let body = {}; try { body = JSON.parse(event.body || '{}'); } catch (e) {}
    const other = String(body.user || ''), type = body.type;
    if (!/^[0-9a-f-]{36}$/i.test(other) || (type !== 'request' && type !== 'accepted')) return json(400, { error: 'Bad request' });

    // 1) the friendship row must really exist, and not have been announced yet
    let rows;
    if (type === 'request') {
      rows = await sb('friendships?requester_id=eq.' + caller + '&addressee_id=eq.' + other + '&status=eq.pending&notified_at=is.null',
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ notified_at: new Date().toISOString() }) });
    } else {
      rows = await sb('friendships?requester_id=eq.' + other + '&addressee_id=eq.' + caller + '&status=eq.accepted&accepted_notified_at=is.null',
        { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ accepted_notified_at: new Date().toISOString() }) });
    }
    if (!rows || !rows.length) return json(200, { sent: 0, reason: 'nothing to announce' });

    // 2) who is it from, and where should it go
    const prof = await sb('profiles?id=eq.' + caller + '&select=full_name');
    const name = (prof && prof[0] && prof[0].full_name) || 'Someone';
    const devices = await sb('push_devices?user_id=eq.' + other + '&enabled=eq.true&select=token');
    if (!devices || !devices.length) return json(200, { sent: 0, reason: 'no devices' });

    const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON || '{}');
    if (!sa.private_key) return json(500, { error: 'Push is not configured' });
    const access = await fcmAccessToken(sa);
    const title = type === 'request' ? 'New friend request' : 'Friend request accepted';
    const text = type === 'request' ? name + ' wants to be your friend.' : name + ' accepted your friend request.';
    let sent = 0;
    for (const d of devices) {
      const r = await fetch('https://fcm.googleapis.com/v1/projects/' + sa.project_id + '/messages:send', {
        method: 'POST', headers: { Authorization: 'Bearer ' + access, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: { token: d.token, notification: { title, body: text }, data: { targetUrl: OPEN_URL },
          apns: { payload: { aps: { sound: 'default' } } }, android: { priority: 'HIGH' } } })
      });
      if (r.ok) sent++;
    }
    return json(200, { sent });
  } catch (e) {
    console.error('notify-friend-request', e);
    return json(500, { error: 'Could not send' });
  }
};
