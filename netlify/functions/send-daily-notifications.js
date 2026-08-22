// netlify/functions/send-daily-notifications.js
//
// Runs on a daily schedule (see netlify.toml) and sends two pushes via
// OneSignal's REST API:
//   1. "Reading reminder" — to devices tagged reading_reminder=true
//   2. "Verse of the day"  — to devices tagged verse_of_day=true
//
// Both pulls today's reading from the same 365-day plan embedded in the
// app (reading-plan-data.js), using the same Jan-1-is-Day-1 calendar math
// as the app's "Follow the Calendar" mode — so the notification always
// matches what someone sees if they open the app that day.
//
// REQUIRES two environment variables to be set in the Netlify dashboard
// (Site settings -> Environment variables) before this will actually send
// anything — see the bottom of this file for exactly what to enter:
//   ONESIGNAL_APP_ID
//   ONESIGNAL_REST_API_KEY

const { READING_PLAN, BOOKS } = require('./reading-plan-data.js');

function bookName(id) {
  const b = BOOKS.find(x => x[0] === id);
  return b ? b[1] : id;
}
function refLabel(ref) {
  const [id, ...rest] = ref.split(' ');
  return `${bookName(id)} ${rest.join(' ')}`;
}

function todayISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function daysBetween(isoA, isoB) {
  const a = new Date(isoA + 'T00:00:00Z');
  const b = new Date(isoB + 'T00:00:00Z');
  return Math.round((b - a) / 86400000);
}
function calendarPlanDay() {
  const jan1 = `${new Date().getUTCFullYear()}-01-01`;
  const diff = daysBetween(jan1, todayISODate()) + 1;
  return Math.min(Math.max(diff, 1), 365);
}

async function sendOneSignalPush({ appId, apiKey, tagKey, title, body }) {
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Basic ${apiKey}`
    },
    body: JSON.stringify({
      app_id: appId,
      filters: [{ field: 'tag', key: tagKey, relation: '=', value: 'true' }],
      headings: { en: title },
      contents: { en: body }
    })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

exports.handler = async function () {
  const appId = process.env.ONESIGNAL_APP_ID;
  const apiKey = process.env.ONESIGNAL_REST_API_KEY;

  if (!appId || !apiKey) {
    return {
      statusCode: 200,
      body: JSON.stringify({
        skipped: true,
        reason: 'ONESIGNAL_APP_ID / ONESIGNAL_REST_API_KEY not set yet in Netlify environment variables.'
      })
    };
  }

  const day = calendarPlanDay();
  const refs = READING_PLAN[day - 1] || [];
  const readingText = refs.map(refLabel).join(', ');

  const results = {};

  try {
    results.readingReminder = await sendOneSignalPush({
      appId,
      apiKey,
      tagKey: 'reading_reminder',
      title: `Day ${day} of 365`,
      body: `Today's reading: ${readingText}`
    });
  } catch (err) {
    results.readingReminder = { ok: false, error: err.message };
  }

  try {
    // Uses the first passage of the day as a simple "verse of the day" pull.
    // If a separate curated verse list is wanted later, swap this line for
    // a lookup into that list instead.
    const firstRef = refs[0] ? refLabel(refs[0]) : '';
    results.verseOfDay = await sendOneSignalPush({
      appId,
      apiKey,
      tagKey: 'verse_of_day',
      title: 'Verse of the Day',
      body: firstRef ? `Open today's verse from ${firstRef} →` : 'Open today\u2019s verse →'
    });
  } catch (err) {
    results.verseOfDay = { ok: false, error: err.message };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ day, readingText, results })
  };
};

// ---------------------------------------------------------------
// SETUP CHECKLIST (do this once OneSignal + Median are connected):
// 1. In your OneSignal dashboard: Settings -> Keys & IDs
//    - Copy the "OneSignal App ID"      -> Netlify env var ONESIGNAL_APP_ID
//    - Copy the "REST API Key"          -> Netlify env var ONESIGNAL_REST_API_KEY
// 2. In Netlify: Site settings -> Environment variables -> add both above
// 3. Redeploy the site so the function picks up the new env vars
// 4. This function is scheduled via netlify.toml (see the [functions] block)
// ---------------------------------------------------------------
