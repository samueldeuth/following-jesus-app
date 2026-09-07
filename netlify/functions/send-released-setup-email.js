// netlify/functions/send-released-setup-email.js
//
// Sends the purchaser's "finish setting up your course" email once it's
// been released -- called from the admin dashboard right after a
// super_admin clicks "Approve & Go Live" on a pending church that had a
// suggested merge match. The actual authorization already happened in
// release_withheld_setup_email (Postgres, checked against the caller's
// real session, only returns real contact details to a genuine
// super_admin) -- this function's only job is sending the email itself,
// using the exact same template as the original webhook.
//
// ---------------------------------------------------------------------
// SETUP: no new environment variables -- reuses RESEND_API_KEY, already
// set for shopify-church-signup-webhook.js.

const APP_URL = 'https://followingjesus.com';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';

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

  const { email, name, token } = body;
  if (!email || !token) {
    return { statusCode: 400, body: 'Missing email or token.' };
  }

  const completionUrl = `${APP_URL}/church-signup-complete.html?token=${token}`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p>Thanks for getting your church started with the Following Jesus course!</p>
      <p>Before your church's page goes live, we need a few details from you -- your church name, contact info, and (optionally) a custom welcome message for your students.</p>
      <p style="margin: 28px 0;">
        <a href="${completionUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Complete Your Church Setup →</a>
      </p>
      <p style="color:#666;font-size:13px;">Takes about 2 minutes. Once submitted, our team will review it and get your page live.</p>
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
        subject: `Finish setting up your church's Following Jesus page`,
        html,
      }),
    });
    return { statusCode: 200, body: JSON.stringify({ sent: res.ok }) };
  } catch (e) {
    return { statusCode: 502, body: `Failed to send: ${e.message}` };
  }
};
