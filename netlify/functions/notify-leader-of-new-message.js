// netlify/functions/notify-leader-of-new-message.js
//
// Fired (fire-and-forget, never awaited) from app.html's
// sendGroupMessage() immediately after a disciple posts a new message.
// Sends a single push to exactly one leader, by their Supabase user id
// (every device registers itself against that id at app start -- see
// register_push_device). Note: the old OneSignal version targeted a
// `leader_user_id` tag that the app never actually set, so these never
// reached anyone; targeting by user id fixes that.
//
// Never called when the sender IS the leader (guarded in app.html
// before this is even invoked) -- no self-notification.
//
// REQUIRES: FIREBASE_SERVICE_ACCOUNT_JSON, SUPABASE_SERVICE_ROLE_KEY

const fcm = require('./lib/fcm');
const store = require('./lib/push-store');
const { sendToUsers } = require('./lib/push-send-users');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'FIREBASE_SERVICE_ACCOUNT_JSON / SUPABASE_SERVICE_ROLE_KEY not set' }) };
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
    const summary = await sendToUsers(
      [leaderId],
      {
        title: groupLabel ? `New message in ${groupLabel}` : 'New message in your group',
        body: `${senderName} sent a message`,
        data: { targetUrl: 'https://followingjesus.com/app', source: 'leader_message' },
      },
      { store, fcm }
    );
    return { statusCode: 200, body: JSON.stringify({ ok: true, ...summary }) };
  } catch (err) {
    console.error('Failed to notify leader of new message:', err);
    return { statusCode: 200, body: JSON.stringify({ ok: false, error: err.message }) };
  }
};
