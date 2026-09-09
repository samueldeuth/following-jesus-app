// netlify/functions/send-recurring-push-notifications.js
//
// Runs once a day (see netlify.toml) and fires any recurring push
// notification whose schedule matches today and hasn't already been
// sent today.
//
// Unlike the weekly course reminder emails, this does NOT need to
// check "is it currently the right hour in each recipient's own
// timezone" itself -- OneSignal's own delayed_option:'timezone' +
// delivery_time_of_day already resolves that per-recipient at
// OneSignal's end, exactly the same mechanism the one-time "Scheduled"
// mode in the admin composer already uses (see
// admin-send-push-notification.js). So this only needs to fire ONCE
// per due schedule per day, at any consistent time -- OneSignal
// handles delivering it at the right local moment for each person.
//
// No caller authorization -- same as send-daily-notifications.js, this
// is only ever invoked by Netlify's own internal scheduler, never
// reachable in a way that matters from a normal request.
//
// REQUIRES environment variables already set for the other push/email
// functions in this project -- nothing new to add in Netlify:
//   ONESIGNAL_REST_API_KEY   -- already set for the other push functions
//   REMINDER_FUNCTION_SECRET -- reused from the weekly email reminder
//                               system; same shared-secret pattern,
//                               deliberately not a new secret

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const ONESIGNAL_APP_ID = '35033fa8-5eb5-45b0-aa14-0d7d7a6c6443';

// OneSignal's delivery_time_of_day wants e.g. "9:00AM" -- same format
// send-daily-notifications.js already builds for its own hourly loop.
function hourTo12Label(h) {
  const hourNum = parseInt(h, 10);
  const period = hourNum < 12 ? 'AM' : 'PM';
  let h12 = hourNum % 12; if (h12 === 0) h12 = 12;
  return `${h12}:00${period}`;
}

exports.handler = async function () {
  const restApiKey = process.env.ONESIGNAL_REST_API_KEY;
  const reminderSecret = process.env.REMINDER_FUNCTION_SECRET;
  const missing = ['ONESIGNAL_REST_API_KEY', 'REMINDER_FUNCTION_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `Missing environment variables: ${missing.join(', ')}` }) };
  }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_due_recurring_pushes`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: reminderSecret })
  });
  if (!rpcRes.ok) {
    return { statusCode: 502, body: `get_due_recurring_pushes failed: ${await rpcRes.text()}` };
  }

  const duePushes = await rpcRes.json();
  const results = [];

  for (const push of duePushes) {
    const notificationPayload = {
      app_id: ONESIGNAL_APP_ID,
      // 'Total Subscriptions' is the real "everyone with push enabled"
      // segment for this OneSignal app -- confirmed directly in the
      // OneSignal dashboard. 'Subscribed Users' (an earlier bug in
      // admin-send-push-notification.js) does NOT exist here and
      // silently matches zero people -- see that file's own comments
      // for the full incident this was caught from.
      included_segments: ['Total Subscriptions'],
      headings: { en: push.title },
      contents: { en: push.message },
      delayed_option: 'timezone',
      delivery_time_of_day: hourTo12Label(push.hour),
      // Destination goes in data.targetUrl, NOT the top-level url field
      // -- Median reads targetUrl from Additional Data to navigate
      // inside the app; the top-level url field opens an external
      // browser instead. Same fix already applied to the one-time
      // composer send, applied here from the start.
      data: push.url
        ? { source: 'admin_composer_recurring', targetUrl: push.url }
        : { source: 'admin_composer_recurring' }
    };

    try {
      const res = await fetch('https://onesignal.com/api/v1/notifications', {
        method: 'POST',
        headers: { Authorization: `Basic ${restApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(notificationPayload)
      });
      const data = await res.json().catch(() => ({}));
      results.push({ id: push.id, title: push.title, ok: res.ok, data });

      // Only mark it sent if OneSignal actually accepted it -- same
      // "don't mark it done unless it's really done" principle used
      // throughout this project's other reminder systems, so a failed
      // send gets picked up again tomorrow rather than silently skipped.
      if (res.ok) {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_recurring_push_sent`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ caller_secret: reminderSecret, push_id: push.id })
        });
      }
    } catch (e) {
      results.push({ id: push.id, title: push.title, ok: false, error: e.message });
    }
  }

  return { statusCode: 200, body: JSON.stringify({ checked: duePushes.length, results }) };
};
