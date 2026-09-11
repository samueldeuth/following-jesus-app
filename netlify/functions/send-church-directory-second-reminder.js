// netlify/functions/send-church-directory-second-reminder.js
//
// Runs on a schedule (see netlify.toml) and sends a one-time follow-up
// reminder to any church_directory entry that got the original
// confirmation email 7+ days ago but never actually clicked through
// (church_confirmed_at still null). Each church is marked sent
// IMMEDIATELY after its own individual send succeeds -- not batched at
// the end -- so a mid-run failure can never cause a duplicate reminder
// on retry. Same safe pattern already established for the original
// confirmation batch send, after the earlier duplicate-send incident.
//
// REQUIRES: RESEND_API_KEY, REMINDER_FUNCTION_SECRET (both already set)

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';
const LOGO_URL = 'https://followingjesus.com/assets/FJ_logo_rectangle_Thinkific_v2.png';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildReminderHtml(churchName, confirmToken) {
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
    <p>Just a quick follow-up — we reached out last week about featuring <strong>${escapeHtml(churchName)}</strong> in our "Find a Church" feature in the Following Jesus app, and wanted to check back in case it got buried.</p>
    <p>It only takes a second to confirm your info is correct (or let us know if you'd rather not be featured).</p>
    <p style="margin: 28px 0;">
      <a href="${confirmUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Confirm Our Info →</a>
    </p>
    <p>Thank you,<br>Following Jesus Team</p>
  </div>
</body>
</html>`;
}

exports.handler = async function () {
  const resendApiKey = process.env.RESEND_API_KEY;
  const functionSecret = process.env.REMINDER_FUNCTION_SECRET;
  if (!resendApiKey || !functionSecret) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'Missing RESEND_API_KEY or REMINDER_FUNCTION_SECRET' }) };
  }

  const listRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_churches_needing_second_reminder`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: functionSecret })
  });
  if (!listRes.ok) {
    return { statusCode: 502, body: `get_churches_needing_second_reminder failed: ${await listRes.text()}` };
  }
  const churches = await listRes.json();
  if (!Array.isArray(churches) || churches.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, message: 'No churches currently due for a second reminder.' }) };
  }

  const results = [];
  for (const church of churches) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: church.contact_email,
          reply_to: 'info@followingjesusbook.com',
          subject: `Still want to feature ${church.name} in our church directory?`,
          html: buildReminderHtml(church.name, church.confirmation_token)
        })
      });
      if (res.ok) {
        // Marked immediately, one at a time -- not batched at the end --
        // so a later failure in this same run can never cause this
        // specific church to be re-sent to on the next scheduled run.
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_second_reminder_sent`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ caller_secret: functionSecret, church_ids: [church.id] })
        });
        results.push({ name: church.name, sent: true });
      } else {
        results.push({ name: church.name, sent: false, error: await res.text() });
      }
    } catch (err) {
      results.push({ name: church.name, sent: false, error: err.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ sent: results.filter(r => r.sent).length, total: churches.length, results }) };
};
