// netlify/functions/admin-trigger-church-reminders.js
//
// Powers two buttons in church-admin-dashboard.html: "Send Reminders
// to This Church" (bulk, no enrollment_id) and a per-student "Send
// Reminder" action (single, with enrollment_id). Also usable by a
// super_admin from the main admin dashboard for any church.
//
// Authorization is checked here, server-side, against the caller's own
// real profile -- never trusted from the request body. A church_admin
// can only ever act on the church_id already stored on their own
// profile; a super_admin can act on any church. Passing a different
// church_id than your own does nothing -- it's rejected before any
// lookup or send happens.
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

// Returns { role, church_id } for the real, currently-signed-in user
// behind this token -- never trusts anything the request claims about
// who's calling.
async function getCallerProfile(userAccessToken) {
  if (!userAccessToken) return null;
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userAccessToken}` }
  });
  if (!userRes.ok) return null;
  const user = await userRes.json();
  if (!user?.id) return null;

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,church_id`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userAccessToken}` }
  });
  if (!profileRes.ok) return null;
  const rows = await profileRes.json();
  return rows[0] || null;
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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  const { church_id, enrollment_id } = body;
  if (!church_id) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing church_id.' }) };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const userAccessToken = authHeader.replace(/^Bearer\s+/i, '');
  const caller = await getCallerProfile(userAccessToken);
  const authorized = !!caller && (caller.role === 'super_admin' || (caller.role === 'church_admin' && caller.church_id === church_id));
  if (!authorized) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for this church.' }) };
  }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_reminder_targets`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: reminderSecret, p_church_id: church_id, p_enrollment_id: enrollment_id || null })
  });
  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    return { statusCode: 502, body: JSON.stringify({ error: `Could not look up who needs a reminder: ${errText}` }) };
  }

  const students = await rpcRes.json();
  const successfulIds = [];
  const failures = [];

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
