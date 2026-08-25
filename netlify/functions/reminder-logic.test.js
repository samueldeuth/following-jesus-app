const assert = require("assert");
const {
  getEnrollmentsNeedingReminder,
  buildReminderPayloads,
} = require("./reminder-logic");

function run(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

run("excludes enrollments with reminders disabled", () => {
  const enrollments = [
    { id: "e1", student_id: "s1", course_id: "c1", reminder_email_enabled: false },
    { id: "e2", student_id: "s2", course_id: "c1", reminder_email_enabled: true },
  ];
  const result = getEnrollmentsNeedingReminder(enrollments, []);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, "e2");
});

run("excludes enrollments with a matching certificate (finished course)", () => {
  const enrollments = [
    { id: "e1", student_id: "s1", course_id: "c1", reminder_email_enabled: true },
    { id: "e2", student_id: "s2", course_id: "c1", reminder_email_enabled: true },
  ];
  const certificates = [{ student_id: "s1", course_id: "c1" }];
  const result = getEnrollmentsNeedingReminder(enrollments, certificates);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].id, "e2");
});

run("does not cross-match certificates from a different course", () => {
  const enrollments = [
    { id: "e1", student_id: "s1", course_id: "c1", reminder_email_enabled: true },
  ];
  // s1 finished a DIFFERENT course (c2) — should still get reminded about c1.
  const certificates = [{ student_id: "s1", course_id: "c2" }];
  const result = getEnrollmentsNeedingReminder(enrollments, certificates);
  assert.strictEqual(result.length, 1);
});

run("returns empty array when everyone is finished or opted out", () => {
  const enrollments = [
    { id: "e1", student_id: "s1", course_id: "c1", reminder_email_enabled: false },
    { id: "e2", student_id: "s2", course_id: "c1", reminder_email_enabled: true },
  ];
  const certificates = [{ student_id: "s2", course_id: "c1" }];
  const result = getEnrollmentsNeedingReminder(enrollments, certificates);
  assert.strictEqual(result.length, 0);
});

run("buildReminderPayloads joins profile + course data correctly", () => {
  const enrollments = [
    {
      id: "e1",
      student_id: "s1",
      course_id: "c1",
      unsubscribe_token: "tok-1",
    },
  ];
  const profilesById = new Map([
    ["s1", { email: "sam@example.com", full_name: "Sam" }],
  ]);
  const coursesById = new Map([["c1", { title: "Foundations" }]]);

  const { payloads, skipped } = buildReminderPayloads(
    enrollments,
    profilesById,
    coursesById
  );

  assert.strictEqual(payloads.length, 1);
  assert.strictEqual(skipped.length, 0);
  assert.strictEqual(payloads[0].to, "sam@example.com");
  assert.strictEqual(payloads[0].student_name, "Sam");
  assert.strictEqual(payloads[0].course_title, "Foundations");
  assert.strictEqual(payloads[0].unsubscribe_token, "tok-1");
});

run("buildReminderPayloads skips (not throws) on missing profile or course", () => {
  const enrollments = [
    { id: "e1", student_id: "ghost", course_id: "c1", unsubscribe_token: "t1" },
    { id: "e2", student_id: "s1", course_id: "ghost-course", unsubscribe_token: "t2" },
  ];
  const profilesById = new Map([["s1", { email: "sam@example.com" }]]);
  const coursesById = new Map([["c1", { title: "Foundations" }]]);

  const { payloads, skipped } = buildReminderPayloads(
    enrollments,
    profilesById,
    coursesById
  );

  assert.strictEqual(payloads.length, 0);
  assert.strictEqual(skipped.length, 2);
});

run("buildReminderPayloads falls back to 'there' when full_name is missing", () => {
  const enrollments = [
    { id: "e1", student_id: "s1", course_id: "c1", unsubscribe_token: "t1" },
  ];
  const profilesById = new Map([["s1", { email: "sam@example.com" }]]);
  const coursesById = new Map([["c1", { title: "Foundations" }]]);

  const { payloads } = buildReminderPayloads(enrollments, profilesById, coursesById);
  assert.strictEqual(payloads[0].student_name, "there");
});
