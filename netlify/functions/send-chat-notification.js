// Fires from a Supabase Database Webhook on INSERT into
// discipleship_messages. Set this up in Supabase: Database -> Webhooks ->
// Create a new webhook
//   Table: discipleship_messages
//   Events: Insert
//   Type: HTTP Request
//   URL: https://followingjesus.com/.netlify/functions/send-chat-notification
//   HTTP Headers: add a header named x-chat-webhook-secret, value = the
//   SAME secret used in CHAT_NOTIFICATION_SECRET (Netlify) and hardcoded
//   in get_chat_notification_targets (see add-chat-notifications.sql) --
//   one shared secret used at both hops, same pattern as every other
//   webhook-triggered function in this project.
//
// Looks up who should be notified (group leader + members, or the 1:1
// recipient), excluding the sender and anyone who's turned chat
// notifications off (profiles.chat_notifications_enabled), then sends a
// single push to every enabled device registered to exactly those people
// (push_devices.user_id, set by the app's register_push_device call at
// start). This is deliberately NOT a broad preference-based send like the
// verse/reading reminders -- it needs to reach specific people.
//
// REQUIRES (Netlify env vars):
//   SUPABASE_ANON_KEY        (hardcoded below, same public key already
//                             embedded client-side -- not actually secret)
//   CHAT_NOTIFICATION_SECRET (already set)
//   FIREBASE_SERVICE_ACCOUNT_JSON, SUPABASE_SERVICE_ROLE_KEY (new, push via
//   Firebase Cloud Messaging instead of OneSignal)

const fcm = require('./lib/fcm');
const store = require('./lib/push-store');
const { sendToUsers } = require('./lib/push-send-users');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

function truncateForPush(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secretHeader = event.headers['x-chat-webhook-secret'] || event.headers['X-Chat-Webhook-Secret'];
  if (!secretHeader || secretHeader !== process.env.CHAT_NOTIFICATION_SECRET) {
    return { statusCode: 401, body: 'Invalid secret' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid payload' };
  }

  // Supabase Database Webhook payload shape: { type: 'INSERT', table, record, ... }
  if (payload.type !== 'INSERT' || !payload.record) {
    return { statusCode: 200, body: 'Ignored (not an insert)' };
  }

  const { group_id, sender_id, recipient_id, body, is_action } = payload.record;

  if (!sender_id || (!group_id && !recipient_id)) {
    return { statusCode: 200, body: 'Ignored (missing group_id/recipient_id/sender_id)' };
  }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_chat_notification_targets`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      caller_secret: process.env.CHAT_NOTIFICATION_SECRET,
      p_group_id: group_id || null,
      p_recipient_id: recipient_id || null,
      p_sender_id: sender_id,
    }),
  });

  if (!rpcRes.ok) {
    return { statusCode: 500, body: 'Failed to look up notification targets' };
  }

  const targets = await rpcRes.json();
  if (!Array.isArray(targets) || targets.length === 0) {
    return { statusCode: 200, body: 'No one to notify (opted out, or no other members)' };
  }

  const senderRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${sender_id}&select=full_name`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
  });
  const senderProfiles = senderRes.ok ? await senderRes.json() : [];
  const senderName = senderProfiles[0]?.full_name || 'Someone';

  let groupLabel = null;
  if (group_id) {
    const groupRes = await fetch(`${SUPABASE_URL}/rest/v1/discipleship_groups?id=eq.${group_id}&select=label`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    const groups = groupRes.ok ? await groupRes.json() : [];
    groupLabel = groups[0]?.label || null;
  }

  const title = groupLabel ? `${senderName} in ${groupLabel}` : senderName;
  const messageBody = is_action
    ? `📋 New action: ${truncateForPush(body, 100)}`
    : truncateForPush(body, 140);

  let summary;
  try {
    summary = await sendToUsers(
      targets.map((t) => t.profile_id),
      { title, body: messageBody, data: { targetUrl: 'https://followingjesus.com/app', source: 'chat' } },
      { store, fcm }
    );
  } catch (err) {
    console.error('Chat push failed:', err);
    // 200 so Supabase's webhook doesn't keep retrying a message that is already saved.
    return { statusCode: 200, body: JSON.stringify({ ok: false, notified: targets.length, error: err.message }) };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true, notified: targets.length, devices: summary.devices, sent: summary.sent, failed: summary.failed }),
  };
};
