// netlify/functions/send-weekly-checkin-reminders.js
//
// Runs once a week (see netlify.toml). Finds every leader who has the
// Weekly Check-In Reminder toggled on AND has at least one disciple
// with an incomplete action item (group-level or individually
// assigned) -- see get_leaders_needing_checkin_reminder for the actual
// logic -- and sends each one a single targeted push to their own
// registered device(s), by Supabase user id. A blanket per-leader reminder, not a per-disciple
// one, per Samuel's own simplification of the original idea.
//
// REQUIRES: REMINDER_FUNCTION_SECRET (already set), FIREBASE_SERVICE_ACCOUNT_JSON,
// SUPABASE_SERVICE_ROLE_KEY (new -- push now goes through Firebase Cloud Messaging)

const fcm = require('./lib/fcm');
const store = require('./lib/push-store');
const { sendToUsers } = require('./lib/push-send-users');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

exports.handler = async function () {
  const functionSecret = process.env.REMINDER_FUNCTION_SECRET;
  if (!process.env.FIREBASE_SERVICE_ACCOUNT_JSON || !process.env.SUPABASE_SERVICE_ROLE_KEY || !functionSecret) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'Missing FIREBASE_SERVICE_ACCOUNT_JSON, SUPABASE_SERVICE_ROLE_KEY, or REMINDER_FUNCTION_SECRET' }) };
  }

  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_leaders_needing_checkin_reminder`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: functionSecret })
  });
  if (!listRes.ok) {
    return { statusCode: 502, body: `get_leaders_needing_checkin_reminder failed: ${await listRes.text()}` };
  }
  const leaders = await listRes.json();
  if (!Array.isArray(leaders) || leaders.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, message: 'No leaders currently due for a check-in reminder.' }) };
  }

  // Every leader gets the same message, so send to all of them in one pass.
  let summary;
  try {
    summary = await sendToUsers(
      leaders.map((l) => l.leader_id),
      {
        title: 'Weekly Check-In',
        body: 'One or more of your disciples still has something to finish -- might be worth a check-in.',
        data: { targetUrl: 'https://followingjesus.com/app', source: 'weekly_checkin' },
      },
      { store, fcm }
    );
  } catch (err) {
    console.error('Weekly check-in push failed:', err);
    return { statusCode: 200, body: JSON.stringify({ sent: 0, total: leaders.length, error: err.message }) };
  }
  return { statusCode: 200, body: JSON.stringify({ sent: summary.sent, total: leaders.length, devices: summary.devices, failed: summary.failed }) };
};
