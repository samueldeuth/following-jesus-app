// netlify/functions/send-single-church-confirmation.js
//
// Sends the confirmation email to exactly ONE church_directory entry,
// triggered from a button in the admin Church Directory page. Built
// specifically to give Samuel full manual, one-at-a-time control over
// this after a bulk-send incident where a retried request caused the
// same email to go out multiple times to 247 real churches -- this
// function has no loop at all, so there's nothing to retry into a
// duplicate storm. Also usable as a deliberate re-send for a single
// church, which the bulk sender was never designed for.
//
// Requires a real, currently-signed-in super_admin -- same
// authorization pattern already used throughout this project's other
// admin-only functions (verified server-side via the caller's own
// session token, never trusted from the request body).
//
// REQUIRES:
//   RESEND_API_KEY

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';
const LOGO_URL = 'https://followingjesus.com/assets/FJ_logo_rectangle_Thinkific_v2.png';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

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

function buildEmailHtml(churchName, confirmToken) {
  const confirmUrl = `${APP_URL}/confirm-church-directory-entry?token=${confirmToken}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${LOGO_URL}" alt="Following Jesus" style="max-width:200px;width:100%;height:auto;" />
    </div>
    <p>Hi there,</p>
    <p>We're building a new "Find a Church" feature in the Following Jesus app — it helps people get connected, planted, and serving in a local church near them.</p>
    <p>We'd love to feature <strong>${escapeHtml(churchName)}</strong> in our church directory. Can you take a second to confirm your info is correct?</p>
    <p style="margin: 28px 0;">
      <a href="${confirmUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Confirm Our Info →</a>
    </p>
    <p>Thank you,<br>Following Jesus Team</p>
  </div>
</body>
</html>`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: RESEND_API_KEY' }) };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const userAccessToken = authHeader.replace(/^Bearer\s+/i, '');
  const role = await getCallerRole(userAccessToken);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  const { churchId } = body;
  if (!churchId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing churchId.' }) };
  }

  const churchRes = await fetch(`${SUPABASE_URL}/rest/v1/church_directory?id=eq.${churchId}&select=name,contact_email,confirmation_token`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
  });
  if (!churchRes.ok) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not look up that church.' }) };
  }
  const rows = await churchRes.json();
  const church = rows[0];
  if (!church) {
    return { statusCode: 404, body: JSON.stringify({ error: 'Church not found.' }) };
  }
  if (!church.contact_email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'This church has no contact email on file.' }) };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: church.contact_email,
        reply_to: 'info@followingjesusbook.com',
        subject: `Feature ${church.name} in our new church directory`,
        html: buildEmailHtml(church.name, church.confirmation_token)
      })
    });
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: await res.text() }) };
    }

    await fetch(`${SUPABASE_URL}/rest/v1/church_directory?id=eq.${churchId}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${userAccessToken}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify({ confirmation_email_sent_at: new Date().toISOString() })
    });

    return { statusCode: 200, body: JSON.stringify({ status: 'success', sentTo: church.contact_email }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
