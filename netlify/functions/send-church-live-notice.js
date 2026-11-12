// netlify/functions/send-church-live-notice.js
//
// Sends the one-time "Find a Church is now live in the Following Jesus app" email to exactly ONE
// church_directory entry, from a button loop in the admin Church Directory page.
//
// Duplicate-proof by design (after the earlier duplicate-send incident):
//   1. The church row is CLAIMED first with an atomic update (live_notice_sent_at is null -> now).
//      If the claim matches no row, someone already sent it and nothing is emailed.
//   2. Only then is the email sent.
//   3. If the send fails, the claim is released so it can be retried.
// A church can therefore only ever get this email once, however many times this is called.
// If the live_notice_sent_at column doesn't exist yet (SQL not run), the look-up fails and NOTHING is sent.
//
// Requires a signed-in super_admin (verified server-side from the caller's own session token).
// REQUIRES: RESEND_API_KEY

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

function buildEmail(church) {
  const confirmUrl = `${APP_URL}/confirm-church-directory-entry?token=${church.confirmation_token}`;
  const name = escapeHtml(church.name);
  const isLive = church.status === 'confirmed';
  const subject = isLive
    ? `${church.name} is now listed in the Following Jesus app`
    : `Find a Church is live in the Following Jesus app: feature ${church.name}`;
  const intro = isLive
    ? `<p>Good news: <strong>Find a Church</strong> is now live in the Following Jesus app, and <strong>${name}</strong> is listed. People near you can now find your church, get connected, and start serving.</p>
    <p>Please take a second to confirm your church's info is correct.</p>`
    : `<p>Good news: <strong>Find a Church</strong> is now live in the Following Jesus app. It helps people get connected, planted, and serving in a local church near them, and we'd love to feature <strong>${name}</strong>.</p>
    <p>Please take a second to confirm your church's info is correct.</p>`;
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${LOGO_URL}" alt="Following Jesus" style="max-width:200px;width:100%;height:auto;" />
    </div>
    <p>Hi there,</p>
    ${intro}
    <p style="margin: 28px 0;">
      <a href="${confirmUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Confirm Our Info →</a>
    </p>
    <p style="font-size:14px;color:#555;">You can see the app at <a href="${APP_URL}" style="color:#555;">followingjesus.com</a>. If you have questions, just reply to this email.</p>
    <p>Thank you,<br>Following Jesus Team</p>
  </div>
</body>
</html>`;
  return { subject, html };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: RESEND_API_KEY' }) };

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const userAccessToken = authHeader.replace(/^Bearer\s+/i, '');
  if ((await getCallerRole(userAccessToken)) !== 'super_admin') return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) }; }
  const churchId = body.churchId;
  if (!churchId || !/^[0-9a-fA-F-]{8,64}$/.test(String(churchId))) return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid churchId.' }) };

  const authHeaders = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userAccessToken}` };

  // Look-up. Selecting live_notice_sent_at makes this fail (and send nothing) if the SQL hasn't been run.
  const churchRes = await fetch(`${SUPABASE_URL}/rest/v1/church_directory?id=eq.${churchId}&select=name,contact_email,confirmation_token,status,church_confirmed_at,live_notice_sent_at`, { headers: authHeaders });
  if (!churchRes.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Could not look up that church (has church-live-notice.sql been run?).' }) };
  const church = (await churchRes.json())[0];
  if (!church) return { statusCode: 404, body: JSON.stringify({ error: 'Church not found.' }) };
  if (!church.contact_email) return { statusCode: 400, body: JSON.stringify({ error: 'This church has no contact email on file.' }) };
  if (church.church_confirmed_at) return { statusCode: 200, body: JSON.stringify({ status: 'skipped', reason: 'Church already confirmed.' }) };
  if (church.status === 'declined') return { statusCode: 200, body: JSON.stringify({ status: 'skipped', reason: 'Church declined.' }) };
  if (church.live_notice_sent_at) return { statusCode: 200, body: JSON.stringify({ status: 'skipped', reason: 'Already sent.' }) };

  // Atomic claim: only one caller can flip live_notice_sent_at from null.
  const claimRes = await fetch(`${SUPABASE_URL}/rest/v1/church_directory?id=eq.${churchId}&live_notice_sent_at=is.null`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ live_notice_sent_at: new Date().toISOString() })
  });
  if (!claimRes.ok) return { statusCode: 502, body: JSON.stringify({ error: 'Could not record the send, so nothing was emailed.' }) };
  const claimed = await claimRes.json();
  if (!Array.isArray(claimed) || claimed.length === 0) return { statusCode: 200, body: JSON.stringify({ status: 'skipped', reason: 'Already sent.' }) };

  const release = () => fetch(`${SUPABASE_URL}/rest/v1/church_directory?id=eq.${churchId}`, {
    method: 'PATCH',
    headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
    body: JSON.stringify({ live_notice_sent_at: null })
  }).catch(() => {});

  try {
    const { subject, html } = buildEmail(church);
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `church-live-notice-${churchId}` },
      body: JSON.stringify({ from: FROM_EMAIL, to: church.contact_email, reply_to: 'info@followingjesusbook.com', subject, html })
    });
    if (!res.ok) { await release(); return { statusCode: 502, body: JSON.stringify({ error: await res.text() }) }; }
    return { statusCode: 200, body: JSON.stringify({ status: 'success', sentTo: church.contact_email }) };
  } catch (e) {
    await release();
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
