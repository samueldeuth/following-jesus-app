// netlify/functions/send-daily-notifications.js
//
// Scheduled every 15 minutes (see netlify.toml). This used to send the
// reading / verse / 52-day-plan pushes through OneSignal once a day.
// Now it only KICKS OFF the real work, which lives in
// push-dispatch-background.js (a background function that can run for up to
// 15 minutes, enough for 100,000+ devices) -- scheduled functions themselves
// are cut off after ~30 seconds.
//
// If the kick-off request fails for any reason, it falls back to doing a
// time-boxed run right here so a reminder slot is never silently lost.
//
// REQUIRES env vars: REMINDER_FUNCTION_SECRET, FIREBASE_SERVICE_ACCOUNT_JSON,
// SUPABASE_SERVICE_ROLE_KEY.

const { triggerBackground } = require('./lib/push-admin');

exports.handler = async function () {
  if (!process.env.REMINDER_FUNCTION_SECRET) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'REMINDER_FUNCTION_SECRET not set' }) };
  }
  try {
    const status = await triggerBackground({});
    return { statusCode: 200, body: JSON.stringify({ started: true, status }) };
  } catch (err) {
    console.error('[send-daily-notifications] background start failed, running inline:', err.message);
    try {
      const fcm = require('./lib/fcm');
      const store = require('./lib/push-store');
      const { runSlot } = require('./lib/push-dispatch');
      const result = await runSlot({ store, fcm, budgetMs: 22 * 1000 });
      return { statusCode: 200, body: JSON.stringify({ started: false, inline: true, result }) };
    } catch (e2) {
      console.error('[send-daily-notifications] inline run failed:', e2);
      return { statusCode: 200, body: JSON.stringify({ started: false, error: e2.message }) };
    }
  }
};
