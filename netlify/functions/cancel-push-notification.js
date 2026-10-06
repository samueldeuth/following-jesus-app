// netlify/functions/cancel-push-notification.js
//
// Cancels a scheduled push from the admin dashboard (also used by "Edit",
// which cancels then pre-fills the composer). Anyone who hasn't received it
// yet won't. Returns non-2xx when it already went out, which the dashboard
// shows as "it may have already gone out".
//
// Super-admin only.

const store = require('./lib/push-store');
const { getCallerInfo } = require('./lib/push-admin');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  const { role } = await getCallerInfo(event);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) }; }
  const { notificationId } = body;
  if (!notificationId || !UUID_RE.test(notificationId)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid notificationId.' }) };
  }

  try {
    const rows = await store.patch(
      `push_campaigns?id=eq.${notificationId}&status=in.(scheduled,sending)`,
      { status: 'canceled', completed_at: new Date().toISOString() }
    );
    if (!rows || rows.length === 0) {
      return { statusCode: 409, body: JSON.stringify({ error: 'Already sent or not found.' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
