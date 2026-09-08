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
// functions built earlier the same day.
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
  const role = await getCallerRole(userAccessToken);
  if (role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized.' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  const { title, message, url, deliveryTime } = body;
  if (!title || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing title or message.' }) };
  }

  const notificationPayload = {
    app_id: ONESIGNAL_APP_ID,
    // 'Subscribed Users' is NOT a real segment in this OneSignal app --
    // confirmed directly in the OneSignal dashboard (Audience > Segments)
    // that the actual segments here are All Email Subscriptions, All SMS
    // Subscriptions, Engaged/Inactive/Active Subscriptions, and Total
    // Subscriptions (the Default "everyone with push enabled" segment,
    // 104 push subs as of this fix). Sending to a segment name that
    // doesn't exist doesn't error -- OneSignal returns 200 with an EMPTY
    // id and no recipients field, silently matching zero people. That
    // looked like a successful send in the UI ("Sent! Reached an unknown
    // number of app users.") while actually reaching no one and never
    // creating a real notification record for list-push-notifications.js
    // to find -- explaining both "nothing arrived" and "nothing in the
    // Sent Log" at once. Use the real segment name here.
    included_segments: ['Total Subscriptions'],
    headings: { en: title },
    contents: { en: message },
    // Identifies this as a general alert sent from this composer,
    // distinct from the automated Verse of the Day and Reading Plan
    // systems, which also send via this same API but aren't created
    // here -- list-push-notifications.js filters on this so the
    // Scheduled/Sent Log only shows what was actually sent from this
    // page, not every automated send mixed in with it.
    // Destination goes in data.targetUrl, NOT the top-level `url` field.
    // OneSignal's top-level `url` opens the link in an external
    // browser/webview when tapped. Median instead reads a `targetUrl`
    // key from the notification's "Additional Data" to navigate inside
    // the app itself, using app.html's own hash router -- see
    // https://docs.median.co/docs/open-url-from-notification. This is
    // the same pattern send-daily-notifications.js already uses
    // correctly for the Verse of the Day / Reading Reminder pushes; this
    // composer was setting the wrong field, which is why tapping a push
    // sent from here opened a website instead of the in-app tab.
    data: url ? { source: 'admin_composer', targetUrl: url } : { source: 'admin_composer' }
  };
  // When a delivery time is given, this becomes a one-time send that
  // OneSignal delivers to each person at their own next occurrence of
  // that clock time -- OneSignal resolves each recipient's timezone
  // itself (from data its own SDK already collects), so nothing needs
  // to be stored or computed on our end for this to work correctly.
  // With no delivery time, this sends immediately to everyone, exactly
  // as before.
  if (deliveryTime) {
    notificationPayload.delayed_option = 'timezone';
    notificationPayload.delivery_time_of_day = deliveryTime;
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
    return { statusCode: 200, body: JSON.stringify({ id: result.id, recipients: result.recipients, scheduled: !!deliveryTime }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
