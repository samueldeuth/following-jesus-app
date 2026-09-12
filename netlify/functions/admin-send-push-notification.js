// netlify/functions/admin-send-push-notification.js
//
// Sends a one-off broadcast push notification to every app user, via
// OneSignal's REST API -- called from the "Send Push Notification" card
// on the Overview page of admin-dashboard.html.
//
// Reaches only people who have actually opened the Following Jesus app
// on their phone and have push permission granted -- confirmed directly
// that course-player.html has no OneSignal integration at all, so
// course-only purchasers are never reachable this way, by design.
//
// Same authorization pattern as admin-trigger-weekly-reminders.js: this
// sits at a normal public URL, so it verifies the caller is a real,
// currently-signed-in super_admin using their own session token before
// doing anything -- never trusts anything else about the request.
//
// REQUIRES a new Netlify environment variable:
//   ONESIGNAL_REST_API_KEY  -- from OneSignal dashboard: Settings > Keys & IDs
//                               (different from the App ID, which is not
//                               a secret and is hardcoded below same as
//                               every other public identifier in this
//                               project)

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const ONESIGNAL_APP_ID = '35033fa8-5eb5-45b0-aa14-0d7d7a6c6443';

// Verifies the caller is a real, currently-signed-in super_admin, using
// their own session token -- same helper pattern as the reminder
// functions built earlier the same day. Also returns their own user id,
// needed for targeting a test send at just them specifically.
async function getCallerInfo(userAccessToken) {
  if (!userAccessToken) return { role: null, userId: null };
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userAccessToken}` }
  });
  if (!userRes.ok) return { role: null, userId: null };
  const user = await userRes.json();
  if (!user?.id) return { role: null, userId: null };

  const profileRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${userAccessToken}` }
  });
  if (!profileRes.ok) return { role: null, userId: user.id };
  const rows = await profileRes.json();
  return { role: rows[0]?.role || null, userId: user.id };
}

// The admin dashboard's <input type="time"> gives 24-hour values like
// "09:00" or "17:30" -- OneSignal's delivery_time_of_day field
// specifically requires 12-hour format like "9:00AM", no space. This
// was silently mismatched before: OneSignal accepted the malformed
// value without erroring, but never actually created a working
// scheduled send from it, which is why "Scheduled ✓" showed on screen
// while nothing ever appeared as scheduled or delivered.
function to12Hour(time24) {
  const [hourStr, minute] = time24.split(':');
  let hour = parseInt(hourStr, 10);
  const period = hour < 12 ? 'AM' : 'PM';
  hour = hour % 12; if (hour === 0) hour = 12;
  return `${hour}:${minute}${period}`;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const restApiKey = process.env.ONESIGNAL_REST_API_KEY;
  if (!restApiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: ONESIGNAL_REST_API_KEY' }) };
  }

  const authHeader = event.headers['authorization'] || event.headers['Authorization'] || '';
  const userAccessToken = authHeader.replace(/^Bearer\s+/i, '');
  const { role, userId } = await getCallerInfo(userAccessToken);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  const { title, message, url, deliveryTime, testOnly } = body;
  if (!title || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing title or message.' }) };
  }

  const notificationPayload = {
    app_id: ONESIGNAL_APP_ID,
    headings: { en: title },
    contents: { en: message },
    // Identifies this as a general alert sent from this composer,
    // distinct from the automated Verse of the Day and Reading Plan
    // systems, which also send via this same API but aren't created
    // here -- list-push-notifications.js filters on this so the
    // Scheduled/Sent Log only shows what was actually sent from this
    // page, not every automated send mixed in with it.
    data: { source: 'admin_composer' }
  };
  // Median reads targetUrl from the notification's own "Additional
  // Data" (not OneSignal's native top-level "url" field) to navigate
  // fully inside the wrapped app when tapped, rather than opening an
  // external browser or webview -- see
  // https://docs.median.co/docs/open-url-from-notification.
  if (url) notificationPayload.data.targetUrl = url;

  // A test send targets ONLY the caller's own device, by their own real
  // user id -- never anything sent from the client, so there's no way
  // to spoof targeting someone else's device. This relies on app.html's
  // existing median.onesignal.login(myId) call, which links every
  // signed-in user's device to their own id in OneSignal already.
  if (testOnly) {
    notificationPayload.include_external_user_ids = [userId];
    notificationPayload.channel_for_external_user_ids = 'push';
  } else {
    notificationPayload.included_segments = ['Subscribed Users'];
  }

  // When a delivery time is given, this becomes a one-time send that
  // OneSignal delivers to each person at their own next occurrence of
  // that clock time -- OneSignal resolves each recipient's timezone
  // itself (from data its own SDK already collects), so nothing needs
  // to be stored or computed on our end for this to work correctly.
  // With no delivery time, this sends immediately to everyone, exactly
  // as before.
  if (deliveryTime) {
    notificationPayload.delayed_option = 'timezone';
    notificationPayload.delivery_time_of_day = to12Hour(deliveryTime);
  }

  try {
    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${restApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(notificationPayload)
    });
    const result = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: result.errors ? JSON.stringify(result.errors) : 'OneSignal rejected the request.' }) };
    }
    // OneSignal has a documented quirk: when nothing currently matches
    // the targeting, it returns a normal 200 OK with an EMPTY id and an
    // errors array (most commonly "All included players are not
    // subscribed") -- not an HTTP error. Checking res.ok alone missed
    // this entirely, which is exactly why "Scheduled ✓" showed on
    // screen while nothing was ever actually created.
    if (!result.id || (result.errors && result.errors.length)) {
      return { statusCode: 200, body: JSON.stringify({ ok: false, recipients: 0, error: (result.errors && result.errors[0]) || 'No one currently matches this send -- nothing was actually scheduled.' }) };
    }
    if (testOnly && !result.recipients) {
      return { statusCode: 200, body: JSON.stringify({ id: result.id, recipients: 0, testOnly: true, note: "No test device found for your account -- this only works if you've personally opened the Following Jesus app on your own phone with push notifications enabled." }) };
    }
    return { statusCode: 200, body: JSON.stringify({ id: result.id, recipients: result.recipients, scheduled: !!deliveryTime, testOnly: !!testOnly }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
