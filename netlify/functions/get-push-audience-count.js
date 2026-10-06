// netlify/functions/get-push-audience-count.js
//
// How many phones would receive a push sent from the composer right now.
// `messageable` = devices with notifications currently allowed;
// `total` = every device that has ever registered. Counts come from our own
// push_devices table (previously OneSignal's app stats). Super-admin only.

const store = require('./lib/push-store');
const { getCallerInfo } = require('./lib/push-admin');

exports.handler = async function (event) {
  const { role } = await getCallerInfo(event);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }
  try {
    const messageable = await store.rpc('push_audience_count', { p_audience: 'all', p_user: null });
    const total = await store.count('push_devices');
    return { statusCode: 200, body: JSON.stringify({ messageable, total }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
