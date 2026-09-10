// netlify/functions/send-church-location-emails.js
//
// One-time (or occasional) bulk send announcing the new "Find a
// Church" feature and asking each church to submit their address so
// they can show up as a featured partner church. Not scheduled --
// triggered manually by visiting this function's URL, same pattern as
// send-admin-invites.js, since this is an occasional outreach send,
// not a recurring one.
//
// Sends to every church that has a contact_email on file AND hasn't
// already submitted a location (skips churches that already have an
// address set, so this is safe to re-run for any newly-added churches
// without re-emailing everyone who's already responded).
//
// ---------------------------------------------------------------------
// SETUP:
// ---------------------------------------------------------------------
// REQUIRES the same two environment variables already set for the
// other bulk-email functions in this project:
//   RESEND_API_KEY
//   REMINDER_FUNCTION_SECRET (reused -- same shared-secret pattern,
//                             no new secret needed for this)
//
// To send, visit in a browser:
//   https://followingjesus.com/.netlify/functions/send-church-location-emails?secret=<REMINDER_FUNCTION_SECRET>

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

exports.handler = async function (event) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const functionSecret = process.env.REMINDER_FUNCTION_SECRET;
  const missing = ['RESEND_API_KEY', 'REMINDER_FUNCTION_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')}` };
  }

  const providedSecret = event.queryStringParameters?.secret;
  if (providedSecret !== functionSecret) {
    return { statusCode: 401, body: 'Not authorized -- provide the secret query parameter.' };
  }

  // Only churches with a contact email who haven't already submitted a
  // location -- safe to re-run without re-emailing anyone who's
  // already responded.
  const churchesRes = await fetch(
    `${SUPABASE_URL}/rest/v1/churches?select=name,contact_email,contact_name,location_submission_token&contact_email=not.is.null&address=is.null`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } }
  );
  if (!churchesRes.ok) {
    return { statusCode: 502, body: `Could not look up churches: ${await churchesRes.text()}` };
  }
  const churches = await churchesRes.json();

  const successful = [];
  const failures = [];
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  // Shared brand header for every email this project sends -- logo
  // lives at this one real, hosted URL. Wrapping in a full
  // <!DOCTYPE html> document with an explicit <meta charset="UTF-8">
  // is what actually prevents special characters (the em dash, the
  // arrow below) from rendering as garbled "â€"" / "â†'" in some email
  // clients -- a bare HTML fragment with no charset declaration leaves
  // them to guess the encoding, and they don't always guess UTF-8.
  const LOGO_URL = 'https://followingjesus.com/assets/FJ_logo_rectangle_Thinkific_v2.png';

  for (const church of churches) {
    const formUrl = `${APP_URL}/church-location-form?token=${church.location_submission_token}`;
    const firstName = church.contact_name ? church.contact_name.trim().split(/\s+/)[0] : '';
    const greeting = firstName ? `Hi Pastor ${escapeHtml(firstName)},` : 'Hi Pastor,';

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${LOGO_URL}" alt="Following Jesus" style="max-width:200px;width:100%;height:auto;" />
    </div>
    <p>${greeting}</p>
    <p>We just launched a new "Find a Church" feature in the Following Jesus app — it helps people get connected, planted, and serving in a local church near them, using their own location to surface nearby options.</p>
    <p>We'd love to feature <strong>${escapeHtml(church.name)}</strong> as a Following Jesus partner church for anyone searching nearby. It just takes adding your address:</p>
    <p style="margin: 28px 0;">
      <a href="${formUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Add Our Church's Location →</a>
    </p>
    <p>Thank you,<br>Following Jesus Team</p>
  </div>
</body>
</html>`;

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: church.contact_email,
          reply_to: 'info@followingjesusbook.com',
          subject: `Feature ${church.name} in the new Find a Church feature`,
          html
        })
      });
      if (res.ok) {
        successful.push(church.contact_email);
      } else {
        failures.push({ email: church.contact_email, error: await res.text() });
      }
    } catch (e) {
      failures.push({ email: church.contact_email, error: e.message });
    }
    await sleep(150); // stays comfortably under Resend's rate limit, same pattern as the other bulk-email functions in this project
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ totalEligible: churches.length, sent: successful.length, failed: failures.length, failures })
  };
};
