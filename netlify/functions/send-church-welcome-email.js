// netlify/functions/send-church-welcome-email.js
//
// Sends the "how to use and set up" welcome email the first time a
// church is approved and goes live -- called right after
// mark_welcome_email_sent confirms it hasn't already been sent.
//
// Content is a first draft covering the practical basics of what a
// church admin can actually do in their dashboard -- meant to be
// revised based on what Samuel wants emphasized, not treated as final.

const APP_URL = 'https://followingjesus.com';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const LOGO_URL = 'https://followingjesus.com/assets/FJ_logo_rectangle_Thinkific_v2.png';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    return { statusCode: 500, body: 'Missing environment variable: RESEND_API_KEY' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  const { email, name, slug, additional_emails } = body;
  if (!email) {
    return { statusCode: 400, body: 'Missing email.' };
  }

  const dashboardUrl = `${APP_URL}/dashboard`;
  const courseUrl = slug ? `${APP_URL}/courses/${slug}` : `${APP_URL}/course`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${LOGO_URL}" alt="Following Jesus" style="max-width:200px;width:100%;height:auto;" />
    </div>
    <p>Hi${name ? ' ' + escapeHtml(name) : ''},</p>
    <p>Welcome! Your church's Following Jesus page is now live. Here's how to get the most out of it.</p>

    <h3 style="margin-top:28px;">Your church's course link</h3>
    <p>Share this with your congregation -- it's where they'll go to start the course:</p>
    <p style="margin: 12px 0;">
      <a href="${courseUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">${courseUrl.replace('https://', '')}</a>
    </p>

    <h3 style="margin-top:28px;">Your admin dashboard</h3>
    <p>Sign in at <a href="${dashboardUrl}">${dashboardUrl.replace('https://', '')}</a> with the same Google account you used to sign up. From there you can:</p>
    <ul style="line-height:1.7;">
      <li><strong>See every student's progress</strong> at a glance, or export the full list as a CSV</li>
      <li><strong>Send a reminder email</strong> to a specific student, or to everyone who hasn't finished yet</li>
      <li><strong>Email your students directly</strong> for announcements or encouragement</li>
      <li><strong>Download the course videos</strong> for offline use or in-person group settings</li>
    </ul>

    <h3 style="margin-top:28px;">Need help?</h3>
    <p>Just reply to this email -- it comes straight to us.</p>

    <p style="margin-top:32px;">We're glad you're here.</p>
  </div>
</body>
</html>`;

  // Sent to the primary contact, plus anyone who's already an admin
  // for this church (deduplicated server-side in
  // mark_welcome_email_sent, so no address appears twice here).
  const recipients = [email, ...(Array.isArray(additional_emails) ? additional_emails : [])];

  try {
    const results = await Promise.all(recipients.map(to =>
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to,
          reply_to: 'info@followingjesusbook.com',
          subject: `Welcome to the Following Jesus Online Course — here's how to get started`,
          html
        })
      })
    ));
    return { statusCode: 200, body: JSON.stringify({ sent: results.every(r => r.ok), recipientCount: recipients.length }) };
  } catch (e) {
    return { statusCode: 502, body: `Failed to send: ${e.message}` };
  }
};
