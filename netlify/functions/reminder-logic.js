// Pure functions for weekly course reminder eligibility.
// No network calls in here on purpose, so this logic can be unit tested
// without hitting Supabase or Resend.

/**
 * Given all enrollments with reminders enabled, and all certificates,
 * return the enrollments that should get a reminder email this run:
 * reminder_email_enabled = true AND no certificate for that student+course.
 *
 * Certificates are queried separately (not via an embedded Supabase join)
 * per project convention, so the matching happens here client-side.
 */
function getEnrollmentsNeedingReminder(enrollments, certificates) {
  const finishedKeys = new Set(
    certificates.map((c) => `${c.student_id}::${c.course_id}`)
  );

  return enrollments.filter((e) => {
    if (!e.reminder_email_enabled) return false;
    const key = `${e.student_id}::${e.course_id}`;
    return !finishedKeys.has(key);
  });
}

/**
 * Joins enrollment rows with the profile (email/name) and course (title)
 * data needed to actually build an email. Drops any enrollment whose
 * profile or course can't be found (logged, not sent) rather than sending
 * a broken email.
 */
function buildReminderPayloads(enrollments, profilesById, coursesById) {
  const payloads = [];
  const skipped = [];

  for (const e of enrollments) {
    const profile = profilesById.get(e.student_id);
    const course = coursesById.get(e.course_id);

    if (!profile || !profile.email) {
      skipped.push({ enrollment_id: e.id, reason: "missing profile/email" });
      continue;
    }
    if (!course) {
      skipped.push({ enrollment_id: e.id, reason: "missing course" });
      continue;
    }

    payloads.push({
      enrollment_id: e.id,
      to: profile.email,
      student_name: profile.full_name || "there",
      course_title: course.title,
      course_id: e.course_id,
      unsubscribe_token: e.unsubscribe_token,
    });
  }

  return { payloads, skipped };
}

module.exports = { getEnrollmentsNeedingReminder, buildReminderPayloads };
