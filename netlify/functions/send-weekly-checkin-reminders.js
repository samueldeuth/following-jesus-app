// netlify/functions/send-weekly-checkin-reminders.js
//
// Runs once a week (see netlify.toml). Finds every leader who has the
// Weekly Check-In Reminder toggled on AND has at least one disciple
// with an incomplete action item (group-level or individually
// assigned) -- see get_leaders_needing_checkin_reminder for the actual
// logic -- and sends each one a single targeted push via their own
// leader_user_id tag. A blanket per-leader reminder, not a per-disciple
// one, per Samuel's own simplification of the original idea.
//
// REQUIRES: ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY, REMINDER_FUNCTION_SECRET (all already set)

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

exports.handler = async function () {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;
  const functionSecret = process.env.REMINDER_FUNCTION_SECRET;
  if (!appId || !apiKey || !functionSecret) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'Missing ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY, or REMINDER_FUNCTION_SECRET' }) };
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

  const results = [];
  for (const leader of leaders) {
    try {
      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: `Basic ${apiKey}` },
        body: JSON.stringify({
          app_id: appId,
          filters: [{ field: 'tag', key: 'leader_user_id', relation: '=', value: leader.leader_id }],
          headings: { en: 'Weekly Check-In' },
          contents: { en: "One or more of your disciples still has something to finish -- might be worth a check-in." },
          data: { targetUrl: 'https://followingjesus.com/app' }
        })
      });
      results.push({ leaderId: leader.leader_id, sent: res.ok });
    } catch (err) {
      results.push({ leaderId: leader.leader_id, sent: false, error: err.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ sent: results.filter(r => r.sent).length, total: leaders.length, results }) };
};
