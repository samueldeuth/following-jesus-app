// netlify/functions/lib/push-admin.js
// Shared by the admin push functions: verifies the caller is a signed-in
// super_admin using their own session token (same pattern as before).

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

async function getCallerInfo(event, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const authHeader = (event.headers && (event.headers['authorization'] || event.headers['Authorization'])) || '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token) return { role: null, userId: null };
  const userRes = await doFetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) return { role: null, userId: null };
  const user = await userRes.json();
  if (!user || !user.id) return { role: null, userId: null };
  const profileRes = await doFetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!profileRes.ok) return { role: null, userId: user.id };
  const rows = await profileRes.json();
  return { role: (rows[0] && rows[0].role) || null, userId: user.id };
}

// Starts the background dispatcher. Uses the site's own URL (Netlify sets
// process.env.URL) and the shared REMINDER_FUNCTION_SECRET so the endpoint
// can't be triggered by the public.
async function triggerBackground(payload, { fetchImpl } = {}) {
  const secret = process.env.REMINDER_FUNCTION_SECRET;
  if (!secret) throw new Error('Missing environment variable: REMINDER_FUNCTION_SECRET');
  const base = (process.env.URL || 'https://followingjesus.com').replace(/\/$/, '');
  const res = await (fetchImpl || fetch)(`${base}/.netlify/functions/push-dispatch-background`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-push-dispatch-secret': secret },
    body: JSON.stringify(payload || {}),
  });
  if (res.status !== 202 && !res.ok) throw new Error(`push-dispatch-background returned ${res.status}`);
  return res.status;
}

function to12Hour(time24) {
  const [hourStr, minute] = String(time24).split(':');
  let hour = parseInt(hourStr, 10);
  const period = hour < 12 ? 'AM' : 'PM';
  hour = hour % 12; if (hour === 0) hour = 12;
  return `${hour}:${minute}${period}`;
}

module.exports = { getCallerInfo, triggerBackground, to12Hour, SUPABASE_URL, SUPABASE_ANON_KEY };
