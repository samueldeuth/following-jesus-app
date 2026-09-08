// netlify/functions/send-single-admin-invite.js
//
// Sends exactly one admin-invite email -- called right after a church
// admin (the course contact) creates a co-admin invite for their own
// church via create_admin_invite_as_church_contact.
//
// Deliberately a separate, minimal function rather than reusing
// send-admin-invites.js: that one sends every globally-pending invite
// across every church in one batch, and its response includes each
// recipient's email and church name -- exactly the kind of thing that
// must never be exposed to a church_admin, who should only ever see
// their own church's data. This function only ever sends the one
// invite it's given, nothing else, and returns nothing about anyone
// else's invites.
//
// Always uses the "live church" framing -- a course contact inviting a
// co-admin implies the church is actively in use, so there's no
// draft/re-engagement branch to consider here the way
// send-admin-invites.js has for its bulk historical sends.

const APP_URL = 'https://followingjesus.com';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';

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

  const { email, contact_name, church_name, church_slug, invite_token } = body;
  if (!email || !church_name || !invite_token) {
    return { statusCode: 400, body: 'Missing required fields.' };
  }

  const claimUrl = `${APP_URL}/admin-invite?token=${invite_token}`;
  const courseUrl = `${APP_URL}/courses/${church_slug}`;
  const firstName = contact_name ? String(contact_name).trim().split(/\s+/)[0] : '';
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi,';

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p>${greeting}</p>
      <p>You've been invited to help manage <strong>${escapeHtml(church_name)}</strong>'s Following Jesus course.</p>

      <p style="margin-top:24px;"><strong>Your church's course link</strong> (share this with your congregation):</p>
      <p style="word-break:break-all;"><a href="${courseUrl}">${courseUrl}</a></p>

      <p style="margin-top:24px;"><strong>Your admin access</strong> — this is for you specifically, to see who's enrolled and track progress:</p>
      <p style="margin: 20px 0;">
        <a href="${claimUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Set Up Admin Access →</a>
      </p>
      <p style="color:#666;font-size:13px;">Sign in with Google using this same email address (${escapeHtml(email)}) — that's how your access gets matched to your account. If you'd rather use a different email, sign in with that account instead and you'll be given the option to use it.</p>

      <p style="margin-top:28px;">Any questions let us know,</p>
      <p>Thank you,<br>Following Jesus Team</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: email,
        reply_to: 'info@followingjesusbook.com',
        subject: `You're invited to help manage ${church_name}'s Following Jesus course`,
        html
      })
    });
    return { statusCode: 200, body: JSON.stringify({ sent: res.ok }) };
  } catch (e) {
    return { statusCode: 502, body: `Failed to send: ${e.message}` };
  }
};
