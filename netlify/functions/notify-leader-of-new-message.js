// netlify/functions/notify-leader-of-new-message.js
//
// Fired (fire-and-forget, never awaited) from app.html's
// sendGroupMessage() immediately after a disciple posts a new message.
// Sends a single push targeted at exactly one leader, using the
// leader_user_id tag their own device backfills on every app load (see
// renderDiscipleshipHub in app.html) -- the first place this project
// has needed to target one specific person rather than a broadcast
// group sharing a tag value.
//
// Never called when the sender IS the leader (guarded in app.html
// before this is even invoked) -- no self-notification.
//
// REQUIRES: ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY (both already set)

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!appId || !apiKey) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY not set' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }
  const { leaderId, groupLabel, senderId } = body;
  if (!leaderId || !senderId) {
    return { statusCode: 400, body: 'Missing leaderId or senderId.' };
  }

  // Sender's display name for the notification body -- looked up here
  // rather than trusted from the client, same reasoning as every other
  // server-side function in this project never trusting client-supplied
  // identity details for anything that ends up in an outbound message.
  const senderRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${senderId}&select=full_name`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  const senderRows = await senderRes.json().catch(() => []);
  const senderName = senderRows[0]?.full_name || 'Someone in your group';

  try {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Basic ${apiKey}` },
      body: JSON.stringify({
        app_id: appId,
        filters: [{ field: 'tag', key: 'leader_user_id', relation: '=', value: leaderId }],
        headings: { en: groupLabel ? `New message in ${groupLabel}` : 'New message in your group' },
        contents: { en: `${senderName} sent a message` },
        data: { targetUrl: 'https://followingjesus.com/app' }
      })
    });
    const data = await res.json().catch(() => ({}));
    return { statusCode: 200, body: JSON.stringify({ ok: res.ok, data }) };
  } catch (err) {
    console.error('Failed to notify leader of new message:', err);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
