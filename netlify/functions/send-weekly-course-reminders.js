// netlify/functions/send-weekly-course-reminders.js
//
// Runs every Monday and emails anyone enrolled in a course who hasn't
// finished it yet, reminding them to continue. Scheduled via
// netlify.toml (see the [functions."send-weekly-course-reminders"]
// block).
//
// REQUIRES two environment variables in the Netlify dashboard
// (Site settings -> Environment variables):
//   RESEND_API_KEY            — already set up for the leader-approval emails
//   REMINDER_FUNCTION_SECRET  — the exact value embedded in
//                               weekly-course-reminders-schema.sql, copied here too
//
// SUPABASE_URL and the anon key are hardcoded below rather than pulled
// from environment variables — same as every .html file in this
// project already does. The anon key isn't a secret (it's already
// sitting in plain view in every page's source code, protected by Row
// Level Security instead of by being hidden), so there's no reason to
// treat it differently here.
//
// No Supabase service-role key anywhere — this calls a security-definer
// Postgres function (get_students_needing_reminders) using the regular,
// public anon key, protected by REMINDER_FUNCTION_SECRET instead. Same
// pattern as every other cross-boundary query in this project.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <reminders@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json'
    },
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

exports.handler = async function () {
  const resendApiKey = process.env.RESEND_API_KEY;
  const reminderSecret = process.env.REMINDER_FUNCTION_SECRET;

  const missing = ['RESEND_API_KEY', 'REMINDER_FUNCTION_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    return {
      statusCode: 200,
      body: JSON.stringify({ skipped: true, reason: `Missing environment variables: ${missing.join(', ')}` })
    };
  }

  // Fetch who needs a reminder — the security-definer function does all
  // the real eligibility logic (enrolled, not finished, opted in, not
  // reminded in the last 6 days), so this is just a straight call.
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_students_needing_reminders`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ caller_secret: reminderSecret })
  });

  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    return { statusCode: 502, body: `Could not look up who needs a reminder: ${errText}` };
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
      // Deliberately not added to successfulIds — last_reminder_sent_at
      // stays untouched for this one, so it's picked up again next
      // week rather than silently skipped forever.
      failures.push({ enrollment_id: student.enrollment_id, error: e.message });
    }
  }

  // Only mark the ones that actually succeeded — matches the same
  // "don't mark it done unless it's really done" principle used for
  // the daily-notifications skip-if-not-configured check above.
  if (successfulIds.length) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_reminders_sent`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ caller_secret: reminderSecret, enrollment_ids: successfulIds })
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ totalEligible: students.length, sent: successfulIds.length, failed: failures.length, failures })
  };
};
