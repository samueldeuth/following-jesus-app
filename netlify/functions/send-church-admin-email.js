// netlify/functions/send-church-admin-email.js
//
// Sends a notification email to someone right after they're promoted to
// church admin from the super-admin dashboard, letting them know and
// pointing them to the dashboard they now have access to.
//
// Setup required: same as send-leader-approval-email.js --
//   1. RESEND_API_KEY already set as a Netlify environment variable
//      (shared across all the email-sending functions, nothing new to
//      add here if that's already configured).
//   2. FROM_EMAIL below matches the same verified sending domain
//      already used by send-leader-approval-email.js.
//
// Deploy: netlify/functions/send-church-admin-email.js — once deployed,
// reachable at:
//   https://<your-site>.netlify.app/.netlify/functions/send-church-admin-email

const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';
const LOGO_URL = 'https://followingjesus.com/assets/FJ_logo_rectangle_Thinkific_v2.png';

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

  const { adminName, adminEmail, churchName } = payload;
  if (!adminEmail || !churchName) {
    return { statusCode: 400, body: 'Missing required fields.' };
  }

  const dashboardUrl = `${APP_URL}/dashboard`;

  // Wrapped in a full <!DOCTYPE html> document with the shared logo
  // header now standard across every email this project sends -- the
  // explicit UTF-8 charset is also what prevents special characters
  // (em dashes, arrows) from garbling in some email clients.
  const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${LOGO_URL}" alt="Following Jesus" style="max-width:200px;width:100%;height:auto;" />
    </div>
    <p>Hi${adminName ? ' ' + escapeHtml(adminName) : ''},</p>
    <p>You've been given <strong>church admin</strong> access for <strong>${escapeHtml(churchName)}</strong> on Following Jesus.</p>
    <p>As a church admin, you can view your church's students, track course progress, and manage your groups from your dashboard.</p>
    <p style="margin: 28px 0;">
      <a href="${dashboardUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Open Your Dashboard →</a>
    </p>
    <p style="color:#666;font-size:13px;">Sign in with the same Google account you already use for Following Jesus, and your dashboard will load automatically at ${dashboardUrl.replace(/^https?:\/\//, '')}.</p>
  </div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: adminEmail,
        reply_to: 'info@followingjesusbook.com',
        subject: `You've been made a church admin for ${churchName}`,
        html
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Resend API error (${res.status}): ${errText}`);
    }

    return { statusCode: 200, body: JSON.stringify({ sent: true }) };
  } catch (e) {
    return { statusCode: 502, body: `Could not send the admin notification email: ${e.message}` };
  }
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
