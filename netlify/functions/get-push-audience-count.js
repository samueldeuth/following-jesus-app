// netlify/functions/get-push-audience-count.js
//
// Returns how many people would currently receive a push -- called
// from the Push Notifications composer so Samuel can see the real
// number before sending or scheduling anything.
//
// messageable_players (not the broader players count) is used
// deliberately -- it's OneSignal's own count of subscriptions actually
// eligible to receive a message right now, not just everyone who's
// ever subscribed (some of whom may have since revoked permission,
// uninstalled, etc.).
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
    const res = await fetch(`https://onesignal.com/api/v1/apps/${ONESIGNAL_APP_ID}`, {
      headers: { Authorization: `Basic ${restApiKey}` }
    });
    const result = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: result.errors ? JSON.stringify(result.errors) : 'OneSignal rejected the request.' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ messageable: result.messageable_players, total: result.players }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
