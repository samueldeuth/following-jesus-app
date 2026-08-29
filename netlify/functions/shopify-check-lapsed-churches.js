// netlify/functions/shopify-check-lapsed-churches.js
//
// Runs once a day. Finds any church whose subscription lapsed (a
// failed billing attempt or cancelled contract, recorded by
// shopify-subscription-status-webhook.js) more than 7 days ago and is
// still marked "live", and reverts it to "draft" -- page stays visible,
// enrollment pauses. This is the actual grace-period enforcement; the
// webhook function only ever records WHEN a lapse started.
//
// Scheduled via netlify.toml (same pattern as keep-alive-ping,
// send-daily-notifications, send-weekly-course-reminders in this
// project), not the @netlify/functions package's schedule() wrapper --
// that package isn't a project dependency, and requiring it broke the
// whole site's build. Add this to netlify.toml:
//
//   [functions."shopify-check-lapsed-churches"]
//     schedule = "0 9 * * *"
//
// No Supabase service-role key -- same pattern as everything else.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

exports.handler = async () => {
  const functionSecret = process.env.SHOPIFY_CHURCH_SIGNUP_SECRET;
  if (!functionSecret) {
    console.error('shopify-check-lapsed-churches: missing SHOPIFY_CHURCH_SIGNUP_SECRET');
    return { statusCode: 500, body: 'Missing SHOPIFY_CHURCH_SIGNUP_SECRET' };
  }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/apply_draft_for_lapsed_churches`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: functionSecret })
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`shopify-check-lapsed-churches: apply_draft_for_lapsed_churches failed: ${errText}`);
    return { statusCode: 502, body: errText };
  }

  const affected = await res.json();
  console.log(`shopify-check-lapsed-churches: reverted ${affected.length} church(es) to draft: ${JSON.stringify(affected)}`);
  return { statusCode: 200, body: JSON.stringify({ revertedCount: affected.length, churches: affected }) };
};
