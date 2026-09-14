// netlify/functions/send-disciple-maker-email.js
//
// Sends a plain email from a super_admin to one or more currently-
// approved disciple makers -- either a single person (the "Email"
// button on one row) or the whole group at once (the "Email All"
// button) on the Disciple Makers page in admin-dashboard.html.
//
// Deliberately a separate, lightweight function rather than routing
// through send-broadcast-email.js -- that system is built for
// hundreds/thousands of students or subscribers, with unsubscribe
// tracking, image uploads, and saved drafts. Disciple makers are a
// small, specific group with no unsubscribe concept of their own, so
// none of that infrastructure actually applies here.
//
// REQUIRES the same RESEND_API_KEY already set up for every other
// transactional email in this project.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <reminders@mail.followingjesus.com>';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Plain text -> simple paragraphs, same lightweight approach used for
// the other transactional emails in this project rather than pulling
// in the broadcast composer's full markdown-style formatting toolbar --
// this is a plain message field, not a rich composer.
function textToHtmlParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map(para => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
}

// Same auth pattern as admin-trigger-weekly-reminders.js's getCallerRole.
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

async function sendOne({ resendApiKey, toEmail, toName, subject, messageHtml }) {
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <p>Hi ${escapeHtml(toName || 'there')},</p>
    ${messageHtml}
  </div>
</body>
</html>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: toEmail,
      reply_to: 'info@followingjesusbook.com',
      subject,
      html
    })
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend API error (${res.status}): ${errText}`);
  }
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
  const { recipients, subject, message } = body;
  if (!Array.isArray(recipients) || !recipients.length || !subject || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing recipients, subject, or message.' }) };
  }

  const messageHtml = textToHtmlParagraphs(message);
  const successfulEmails = [];
  const failures = [];

  // Same 150ms pacing already established elsewhere in this project for
  // sending several emails in a row -- see send-weekly-course-reminders.js's
  // comment for the real incident that made this necessary.
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (const r of recipients) {
    if (!r.email) { failures.push({ email: r.email || null, error: 'Missing email address' }); continue; }
    try {
      await sendOne({ resendApiKey, toEmail: r.email, toName: r.name, subject, messageHtml });
      successfulEmails.push(r.email);
    } catch (e) {
      failures.push({ email: r.email, error: e.message });
    }
    await sleep(150);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ sent: successfulEmails.length, failed: failures.length, failures })
  };
};
