// netlify/functions/list-push-notifications.js
//
// Lists recent pushes created via the API (this admin panel) so
// admin-dashboard.html can show a "Scheduled" section (still pending)
// and a "Sent Log" (already delivered) below the composer.
//
// kind=1 filters to API-created notifications only, excluding anything
// sent directly from OneSignal's own dashboard or their separate
// Automated Messages product -- keeps this list scoped to things this
// admin panel actually created.
//
// completed_at is populated once delivery has finished, null/absent
// while still scheduled -- that's what the client uses to split the
// list into "Scheduled" vs "Sent". canceled marks anything stopped
// before it went out.
//
// Same super_admin-only authorization pattern as the other push
// functions.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const ONESIGNAL_APP_ID = '35033fa8-5eb5-45b0-aa14-0d7d7a6c6443';

async function getCallerRole(userAccessToken) {
  if (!userAccessToken) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userAccessToken}` }
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userAccessToken}` }
  });
  if (!profileRes.ok) return null;
  const rows = await profileRes.json();
  return rows[0]?.role || null;
}

exports.handler = async function (event) {
  const restApiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!restApiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: ONESIGNAL_REST_API_KEY' }) };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const userAccessToken = authHeader.replace(/^Bearer\s+/i, '');
  const role = await getCallerRole(userAccessToken);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }

  try {
    const res = await fetch(`https://onesignal.com/api/v1/notifications?app_id=${ONESIGNAL_APP_ID}&limit=50&kind=1`, {
      headers: { Authorization: `Basic ${restApiKey}` }
    });
    const result = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: result.errors ? JSON.stringify(result.errors) : 'OneSignal rejected the request.' }) };
    }
    const notifications = (result.notifications || []).map(n => ({
      id: n.id,
      title: n.headings?.en || '',
      message: n.contents?.en || '',
      url: n.url || null,
      queuedAt: n.queued_at,
      sendAfter: n.send_after,
      completedAt: n.completed_at,
      canceled: !!n.canceled,
      successful: n.successful,
      failed: n.failed,
      remaining: n.remaining,
      deliveryTimeOfDay: n.delivery_time_of_day || null
    }));
    return { statusCode: 200, body: JSON.stringify({ notifications }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
