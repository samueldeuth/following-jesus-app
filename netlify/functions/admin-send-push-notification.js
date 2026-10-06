// netlify/functions/admin-send-push-notification.js
//
// Called from the "Send Push Notification" card on admin-dashboard.html.
// Now backed by Firebase Cloud Messaging + our own push_campaigns table
// (previously OneSignal). The request and response shapes are unchanged, so
// admin-dashboard.html needs no edits.
//
// Modes (same as before):
//   * default            -> broadcast to every device, immediately
//   * deliveryTime 'HH:MM' -> delivered at that clock time in EACH person's
//                            own timezone (their next occurrence of it,
//                            within 24 hours)
//   * testOnly           -> only the caller's own device(s)
//   * reviewReminder     -> everyone who hasn't tapped a rate/review reminder
//                            in the last 7 days
//
// Authorization: caller must be a currently signed-in super_admin.
// REQUIRES env vars: SUPABASE_SERVICE_ROLE_KEY, REMINDER_FUNCTION_SECRET,
// FIREBASE_SERVICE_ACCOUNT_JSON (the last one is used by the background
// sender this function starts).

const store = require('./lib/push-store');
const { getCallerInfo, triggerBackground } = require('./lib/push-admin');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const { role, userId } = await getCallerInfo(event);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) }; }

  const { title, message, url, deliveryTime, testOnly, reviewReminder } = body;
  if (!title || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing title or message.' }) };
  }
  if (deliveryTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(deliveryTime)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid delivery time.' }) };
  }

  const audience = testOnly ? 'user' : (reviewReminder ? 'rate_review' : 'all');

  try {
    const recipients = await store.rpc('push_audience_count', { p_audience: audience, p_user: audience === 'user' ? userId : null });

    if (testOnly && !recipients) {
      return { statusCode: 200, body: JSON.stringify({ id: null, recipients: 0, testOnly: true, note: "No test device found for your account -- this only works if you've personally opened the Following Jesus app on your own phone with push notifications enabled." }) };
    }
    if (!recipients) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, recipients: 0, error: 'No one currently matches this send -- nothing was actually scheduled.' }) };
    }

    const now = new Date();
    const campaign = await store.insert('push_campaigns', {
      title, message, url: url || null,
      source: 'admin_composer',
      audience, audience_user: audience === 'user' ? userId : null,
      local_time: deliveryTime || null,
      window_start: now.toISOString(),
      window_end: deliveryTime ? new Date(now.getTime() + 24 * 3600 * 1000).toISOString() : null,
      status: deliveryTime ? 'scheduled' : 'sending',
      created_by: userId,
    });

    if (!deliveryTime) {
      try {
        await triggerBackground({ campaignId: campaign.id });
      } catch (e) {
        // Don't leave a "sending" campaign that nothing is working on.
        await store.patch(`push_campaigns?id=eq.${campaign.id}`, { status: 'canceled' }).catch(() => {});
        return { statusCode: 502, body: JSON.stringify({ error: 'Could not start the send: ' + e.message }) };
      }
    }

    return { statusCode: 200, body: JSON.stringify({ id: campaign.id, recipients, scheduled: !!deliveryTime, testOnly: !!testOnly }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
