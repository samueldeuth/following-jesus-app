// netlify/functions/push-dispatch-background.js
//
// Netlify "background" function (the -background suffix is what makes it
// one): returns 202 to the caller immediately and keeps running for up to
// 15 minutes. That's what lets a single run walk through 100,000+ devices.
//
// Called by:
//   * send-daily-notifications.js  (every 15 minutes)      -> body {}
//   * admin-send-push-notification.js (send-now broadcasts) -> body {campaignId}
// Protected by the x-push-dispatch-secret header (same REMINDER_FUNCTION_SECRET
// the other scheduled/admin triggers already use).
//
// REQUIRES env vars: FIREBASE_SERVICE_ACCOUNT_JSON, SUPABASE_SERVICE_ROLE_KEY,
// REMINDER_FUNCTION_SECRET.

const crypto = require('crypto');
const fcm = require('./lib/fcm');
const store = require('./lib/push-store');
const { runSlot, runCampaignNow } = require('./lib/push-dispatch');

function secretOk(headers, expected) {
  if (!expected) return false;
  const got = (headers && (headers['x-push-dispatch-secret'] || headers['X-Push-Dispatch-Secret'])) || '';
  const a = Buffer.from(String(got)); const b = Buffer.from(String(expected));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };
  if (!secretOk(event.headers, process.env.REMINDER_FUNCTION_SECRET)) return { statusCode: 401, body: 'Invalid secret' };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) { /* treat as empty */ }

  try {
    const result = body.campaignId
      ? await runCampaignNow({ campaignId: body.campaignId, store, fcm })
      : await runSlot({ store, fcm });
    console.log('[push-dispatch]', JSON.stringify(result));
  } catch (e) {
    console.error('[push-dispatch] failed:', e);
  }
  return { statusCode: 202, body: 'accepted' };
};

module.exports.secretOk = secretOk;
