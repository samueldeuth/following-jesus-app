// netlify/functions/send-leader-approval-email.js
//
// Sends the real "approve this person as a leader" email to a pastor,
// replacing the old demo self-approve shortcut. Called from the app
// right after someone submits their leader application.
//
// Setup required:
//   1. A free Resend account (resend.com) with a verified sending
//      domain — see the app conversation for the full walkthrough.
//   2. The API key added as a Netlify environment variable named
//      RESEND_API_KEY, marked as a secret (Site settings →
//      Environment variables).
//   3. IMPORTANT — update FROM_EMAIL below to match whatever sending
//      domain was actually verified in Resend (e.g. if the verified
//      domain is mail.followingjesus.com, this should be something
//      like "Following Jesus <approvals@mail.followingjesus.com>").
//      Sending from an unverified domain will fail.
//
// Deploy: this file must live at
// netlify/functions/send-leader-approval-email.js — once deployed,
// it's reachable at:
//   https://<your-site>.netlify.app/.netlify/functions/send-leader-approval-email

const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: 'RESEND_API_KEY is not set in Netlify environment variables.' };
  }

  let payload;
  try {
    payload = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: 'Invalid request body.' };
  }

  const { applicantName, church, pastorName, pastorEmail, approvalToken } = payload;
  if (!applicantName || !church || !pastorEmail || !approvalToken) {
    return { statusCode: 400, body: 'Missing required fields.' };
  }

  const approvalUrl = `${APP_URL}/leader-approval?token=${encodeURIComponent(approvalToken)}`;

  // Kept intentionally simple and plain — this is a one-time
  // notification to someone who may not be tech-savvy or expecting an
  // email from an app, not a marketing email. Clarity over polish.
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p>Hi${pastorName ? ' ' + escapeHtml(pastorName) : ''},</p>
      <p><strong>${escapeHtml(applicantName)}</strong> has asked to become a discipleship leader in the Following Jesus app, listing you as their pastor at <strong>${escapeHtml(church)}</strong>.</p>
      <p>If you know this person and are comfortable approving them to lead others through the app, please confirm below.</p>
      <p style="margin: 28px 0;">
        <a href="${approvalUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Review This Request →</a>
      </p>
      <p style="color:#666;font-size:13px;">If you weren't expecting this or don't recognize this person, you can safely ignore this email, or open the link above and choose "Deny."</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: pastorEmail,
        subject: `${applicantName} wants to become a leader on Following Jesus`,
        html
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Resend API error (${res.status}): ${errText}`);
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    return { statusCode: 502, body: `Could not send the approval email: ${e.message}` };
  }
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
