// netlify/functions/admin-trigger-weekly-reminders.js
//
// Lets a signed-in super_admin manually fire the same reminder send
// that normally runs on its own every Monday -- called from the
// "Send Weekly Reminders Now" button in admin-dashboard.html.
//
// This is a genuinely separate function from
// send-weekly-course-reminders.js, deliberately kept as its own file
// rather than sharing code, matching the pattern already used
// elsewhere in this project (e.g. send-released-setup-email.js next
// to shopify-church-signup-webhook.js) -- each function stays fully
// self-contained and independently readable, at the cost of a small
// amount of duplicated logic between the two.
//
// IMPORTANT, security-relevant difference from the scheduled version:
// that one has no caller authorization at all (fine, since only
// Netlify's own internal scheduler invokes it) -- this one is reachable
// at a normal public URL that any browser could call, so it verifies
// the caller is a real, currently-authenticated super_admin BEFORE
// doing anything, using their own Supabase session token rather than
// trusting anything else about the request.
//
// REQUIRES the same two environment variables already set for
// send-weekly-course-reminders.js:
//   RESEND_API_KEY
//   REMINDER_FUNCTION_SECRET

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <reminders@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Verifies the caller is a real, currently-signed-in super_admin,
// using their own session token rather than trusting anything supplied
// by the request itself. Two calls: confirm the token is a genuine,
// live Supabase session, then read that same user's own profile row
// (allowed under this project's normal RLS -- everyone can already
// read their own profile) to check their role.
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

async function sendReminderEmail({ resendApiKey, toEmail, studentName, courseTitle, unsubscribeToken }) {
  const continueUrl = `${APP_URL}/course`;
  const unsubscribeUrl = `${APP_URL}/course-reminder-unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p>Hi ${escapeHtml(studentName)},</p>
      <p>Just a gentle nudge — you're partway through <strong>${escapeHtml(courseTitle)}</strong> and haven't finished yet. Whenever you're ready to pick back up:</p>
      <p style="margin: 28px 0;">
        <a href="${continueUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Continue the Course →</a>
      </p>
      <p style="color:#999;font-size:12px;margin-top:36px;border-top:1px solid #eee;padding-top:16px;">
        Getting this every week and would rather not? <a href="${unsubscribeUrl}" style="color:#999;">Unsubscribe from reminders</a>
      </p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: toEmail,
      reply_to: 'info@followingjesusbook.com',
      subject: `Keep going — ${courseTitle}`,
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
  const reminderSecret = process.env.REMINDER_FUNCTION_SECRET;
  const missing = ['RESEND_API_KEY', 'REMINDER_FUNCTION_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 500, body: JSON.stringify({ error: `Missing environment variables: ${missing.join(', ')}` }) };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const userAccessToken = authHeader.replace(/^Bearer\s+/i, '');
  const role = await getCallerRole(userAccessToken);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_students_needing_reminders`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: reminderSecret })
  });
  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    return { statusCode: 502, body: JSON.stringify({ error: `Could not look up who needs a reminder: ${errText}` }) };
  }

  const students = await rpcRes.json();
  const successfulIds = [];
  const failures = [];

  // 150ms between sends keeps this comfortably under Resend's rate
  // limit even for a large batch -- confirmed necessary from a real
  // run: 78 sequential sends with no pause completed in 8.2 seconds
  // (~9.5/sec), and the 20 that failed left zero trace anywhere in
  // Resend's own log (not Bounced, Failed, or Suppressed) -- consistent
  // with being rejected at the rate limit before Resend ever created a
  // record for them, not a real delivery problem with those addresses.
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (const student of students) {
    try {
      await sendReminderEmail({
        resendApiKey,
        toEmail: student.student_email,
        studentName: student.student_name,
        courseTitle: student.course_title,
        unsubscribeToken: student.unsubscribe_token
      });
      successfulIds.push(student.enrollment_id);
    } catch (e) {
      failures.push({ enrollment_id: student.enrollment_id, error: e.message });
    }
    await sleep(150);
  }

  if (successfulIds.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_reminders_sent`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ caller_secret: reminderSecret, enrollment_ids: successfulIds })
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ totalEligible: students.length, sent: successfulIds.length, failed: failures.length, failures })
  };
};
