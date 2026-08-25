// Sends a weekly reminder email to students who are enrolled in a course,
// haven't finished it (no certificate), and haven't turned reminders off.
// Runs every Monday 9am UTC via Netlify Scheduled Functions.
//
// NOTE ON TIMEZONE: Netlify Scheduled Functions run on UTC cron. "0 9 * * 1"
// below is 9am UTC, not 9am Pacific/wherever your churches are. If you want
// 9am in a specific US timezone, tell me which one and I'll adjust the cron
// expression (e.g. 9am Pacific during standard time is 17:00 UTC).

const { createClient } = require("@supabase/supabase-js");
const {
  getEnrollmentsNeedingReminder,
  buildReminderPayloads,
} = require("./lib/reminder-logic");

const SITE_URL = "https://followingjesus.com";

async function sendReminderEmail(payload) {
  const unsubscribeUrl = `${SITE_URL}/course-reminder-unsubscribe?token=${payload.unsubscribe_token}`;
  const continueUrl = `${SITE_URL}/course-player.html`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Following Jesus <reminders@followingjesus.com>",
      to: payload.to,
      subject: `Keep going in ${payload.course_title}`,
      html: `
        <p>Hi ${payload.student_name},</p>
        <p>Just a friendly nudge — you're partway through <strong>${payload.course_title}</strong> and we'd love to see you finish it.</p>
        <p><a href="${continueUrl}">Continue the course</a></p>
        <p style="margin-top:32px;font-size:12px;color:#888;">
          Don't want these reminders?
          <a href="${unsubscribeUrl}">Unsubscribe from this course's reminders</a>.
        </p>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend error ${res.status}: ${body}`);
  }
}

async function handler() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // 1. All enrollments with reminders still turned on.
  const { data: enrollments, error: enrollErr } = await supabase
    .from("enrollments")
    .select("id, student_id, course_id, unsubscribe_token, reminder_email_enabled")
    .eq("reminder_email_enabled", true);
  if (enrollErr) throw enrollErr;
  if (!enrollments || enrollments.length === 0) {
    return { statusCode: 200, body: "No enrollments with reminders enabled." };
  }

  // 2. Certificates, queried separately (no embedded join) so we can match
  //    student+course pairs client-side rather than relying on Supabase to
  //    disambiguate a join Postgrest might not resolve the way we expect.
  const { data: certificates, error: certErr } = await supabase
    .from("certificates")
    .select("student_id, course_id");
  if (certErr) throw certErr;

  const needsReminder = getEnrollmentsNeedingReminder(
    enrollments,
    certificates || []
  );
  if (needsReminder.length === 0) {
    return { statusCode: 200, body: "Everyone is finished or opted out." };
  }

  // 3. Profiles + courses, also queried separately, then joined in JS.
  const studentIds = [...new Set(needsReminder.map((e) => e.student_id))];
  const courseIds = [...new Set(needsReminder.map((e) => e.course_id))];

  const { data: profiles, error: profileErr } = await supabase
    .from("profiles")
    .select("id, email, full_name")
    .in("id", studentIds);
  if (profileErr) throw profileErr;

  const { data: courses, error: courseErr } = await supabase
    .from("courses")
    .select("id, title")
    .in("id", courseIds);
  if (courseErr) throw courseErr;

  const profilesById = new Map((profiles || []).map((p) => [p.id, p]));
  const coursesById = new Map((courses || []).map((c) => [c.id, c]));

  const { payloads, skipped } = buildReminderPayloads(
    needsReminder,
    profilesById,
    coursesById
  );

  // 4. Send, then update last_reminder_sent_at ONLY for successful sends,
  //    so a failure is retried automatically next Monday instead of being
  //    silently marked as sent.
  const results = { sent: 0, failed: 0, skipped: skipped.length };

  for (const payload of payloads) {
    try {
      await sendReminderEmail(payload);
      const { error: updateErr } = await supabase
        .from("enrollments")
        .update({ last_reminder_sent_at: new Date().toISOString() })
        .eq("id", payload.enrollment_id);
      if (updateErr) throw updateErr;
      results.sent += 1;
    } catch (err) {
      console.error(
        `Failed to send/record reminder for enrollment ${payload.enrollment_id}:`,
        err
      );
      results.failed += 1;
    }
  }

  if (skipped.length > 0) {
    console.warn("Skipped enrollments (missing profile/course):", skipped);
  }

  return { statusCode: 200, body: JSON.stringify(results) };
}

module.exports.handler = handler;
module.exports.config = { schedule: "0 9 * * 1" };
