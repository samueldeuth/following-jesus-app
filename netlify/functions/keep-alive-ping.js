// netlify/functions/keep-alive-ping.js
//
// Supabase's free tier automatically pauses a project after 7 days with no
// database activity — it won't come back on its own, someone has to log
// into the Supabase dashboard and manually resume it. This function just
// does a trivial, harmless read every few days (see the schedule in
// netlify.toml) purely to keep the project active. It doesn't create,
// change, or delete any real data.
//
// The anon key below is the same public-safe key already embedded in
// index.html — if that project ever changes, update both places to match.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

exports.handler = async function () {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/shared_kv?select=key&limit=1`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      }
    });
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: res.ok, status: res.status, pingedAt: new Date().toISOString() })
    };
  } catch (err) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: false, error: err.message, pingedAt: new Date().toISOString() })
    };
  }
};
