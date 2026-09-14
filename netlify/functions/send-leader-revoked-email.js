// netlify/functions/send-leader-revoked-email.js
//
// Notifies a pastor when someone they previously approved to disciple
// others has had that status removed -- called from the "Remove"
// button on the Disciple Makers list in admin-dashboard.html, right
// after revoke_leader_application() succeeds.
//
// Reachable at a normal public URL, so -- same pattern as
// admin-trigger-weekly-reminders.js -- this verifies the caller is a
// real, currently-authenticated super_admin before sending anything,
// using their own Supabase session token rather than trusting
// anything else about the request. The pastor's name/email and the
// applicant's name/church are trusted from the request body itself
// (not re-looked-up here) since the caller has already been confirmed
// as an authorized super_admin -- there's no separate secret or
// second RPC call needed just to pass along strings for an email.
//
// REQUIRES the same RESEND_API_KEY already set up for every other
// transactional email in this project.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <reminders@mail.followingjesus.com>';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Same auth pattern as admin-trigger-weekly-reminders.js's getCallerRole --
// confirms the token belongs to a real, currently-signed-in super_admin,
// never trusting anything the request itself claims about who's calling.
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
  const { pastorEmail, pastorName, applicantName, church } = body;
  if (!pastorEmail || !applicantName) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing pastorEmail or applicantName.' }) };
  }

  // Deliberately factual and brief -- the actual reason (anti-biblical
  // activity or otherwise) isn't spelled out here, since that's a
  // pastoral conversation, not something to put in an automated email.
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <p>Hi ${escapeHtml(pastorName || 'there')},</p>
    <p><strong>${escapeHtml(applicantName)}</strong>'s approved status to disciple others in the Following Jesus app${church ? ` (${escapeHtml(church)})` : ''} has been removed.</p>
    <p>They previously applied and were approved through you, so we wanted you to know directly rather than have this go unnoticed.</p>
    <p>If you have questions about this, feel free to reach out to us at <a href="mailto:info@followingjesusbook.com">info@followingjesusbook.com</a>.</p>
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: pastorEmail,
      reply_to: 'info@followingjesusbook.com',
      subject: `${applicantName}'s disciple maker status has been removed`,
      html
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    return { statusCode: 502, body: JSON.stringify({ error: `Resend API error (${res.status}): ${errText}` }) };
  }

  return { statusCode: 200, body: JSON.stringify({ sent: true }) };
};
