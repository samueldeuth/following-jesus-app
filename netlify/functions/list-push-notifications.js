// netlify/functions/list-push-notifications.js
//
// Feeds the "Scheduled" and "Sent Log" sections under the push composer on
// admin-dashboard.html. Reads our own push_campaigns table (previously
// OneSignal's notification history). Output shape is unchanged.
//
//   Scheduled  = no completedAt yet and not canceled
//   Sent log   = completedAt set
// Only pushes composed on that page are listed (source = admin_composer);
// the automated daily reminders and chat alerts are not.
//
// Super-admin only.

const store = require('./lib/push-store');
const { getCallerInfo, to12Hour } = require('./lib/push-admin');

const epoch = (iso) => (iso ? Math.floor(new Date(iso).getTime() / 1000) : null);

exports.handler = async function (event) {
  const { role } = await getCallerInfo(event);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }
  try {
    const rows = await store.select('push_campaigns?source=eq.admin_composer&order=created_at.desc&limit=50&select=*');
    const notifications = (rows || []).map((c) => ({
      id: c.id,
      title: c.title,
      message: c.message,
      url: c.url || null,
      queuedAt: epoch(c.created_at),
      sendAfter: epoch(c.window_start),
      completedAt: c.status === 'sent' ? epoch(c.completed_at) : null,
      canceled: c.status === 'canceled',
      successful: c.successful,
      failed: c.failed,
      remaining: null,
      deliveryTimeOfDay: c.local_time ? to12Hour(c.local_time) : null,
    }));
    return { statusCode: 200, body: JSON.stringify({ notifications }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
