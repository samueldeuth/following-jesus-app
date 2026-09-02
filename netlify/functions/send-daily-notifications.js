// netlify/functions/send-daily-notifications.js
//
// Runs on a daily schedule (see netlify.toml) and sends pushes via
// OneSignal's REST API for two notification types:
//   1. "Reading reminder" — to devices tagged reading_reminder=true
//   2. "Verse of the day"  — to devices tagged verse_of_day=true
//
// Both pull today's reading from the same 365-day plan embedded in the
// app (reading-plan-data.js), using the same Jan-1-is-Day-1 calendar math
// as the app's "Follow the Calendar" mode — so the notification always
// matches what someone sees if they open the app that day.
//
// PER-USER FREQUENCY + TIME (added — see app.html's notification settings
// UI): each device carries three OneSignal tags per notification type
// instead of one, e.g. for the reading reminder:
//   reading_reminder        'true' | 'false'  (existing on/off)
//   reading_reminder_freq   'daily' | 'weekly' (weekly = every Monday)
//   reading_reminder_hour   '06'..'21'         (2-digit 24h, device-local)
// This function loops every supported hour (NOTIF_HOURS below) and fires
// one OneSignal call per (hour, frequency) combination, using
// delayed_option: 'timezone' + delivery_time_of_day so OneSignal delivers
// each push at that hour in each recipient's OWN device timezone — someone
// in one timezone and someone in another both get "7AM" at their actual
// 7AM, from a single daily trigger of this function.
//
// REAL VERSE TEXT (added): the "Verse of the Day" push now shows actual
// verse words in the body, not just a citation + "open the app" prompt.
// Pulled from bible-api.com — the same public API app.html already uses
// for its Bible reader — using the same default translation ('web', the
// first/default option in app.html's translationSelect) for consistency.
// Only the FIRST VERSE of the day's first reading-plan passage is fetched
// (e.g. just John 15:1, not the whole 15:1-8 range) since a full passage
// is far too long for a notification body. This is a pragmatic stand-in
// for a true single curated "verse of the day" — this project doesn't
// have a separate 365-day single-verse list, only the reading plan's
// passage references. If bible-api.com is unreachable or the passage
// can't be parsed, falls back to the old citation-only body rather than
// failing the whole send.
//
// KNOWN TRADEOFF (not a bug): OneSignal's timezone delivery skips a
// recipient to the next day if their chosen local hour has already
// passed by the time this function's daily trigger actually runs. For a
// once-a-day cron this is unavoidable for someone at an extreme enough
// UTC offset — OneSignal's own guidance is to trigger at least 24h ahead
// of the target window. Not worth engineering around for this app's
// mostly-US-timezone audience; documented here so it isn't mistaken for
// a bug if someone's reminder is occasionally a day late.
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

// Pulls just the first verse's text for a reading-plan ref like
// 'jhn 15:1-8' or 'jhn 15' (no verse given, defaults to verse 1). Returns
// null (not a throw) on any failure, so the caller can cleanly fall back
// to the citation-only body instead of the whole send failing.
async function fetchFirstVerseText(ref, translation) {
  const [id, ...rest] = ref.split(' ');
  const chapterVersePart = rest.join(' ');
  const match = chapterVersePart.match(/^(\d+)(?::(\d+))?/);
  if (!match) return null;
  const chapter = match[1];
  const verse = match[2] || '1';
  try {
    const res = await fetch(`https://bible-api.com/${id}+${chapter}:${verse}?translation=${translation}`);
    if (!res.ok) return null;
    const data = await res.json();
    const text = (data.text || '').trim().replace(/\s+/g, ' ');
    return text || null;
  } catch (err) {
    return null;
  }
}

// Push notification bodies get cut off by the OS anyway, but truncating
// ourselves keeps it clean (cuts on a word boundary, adds an ellipsis)
// rather than leaving that entirely up to however each platform clips it.
function truncateForPush(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
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

// Hour options offered in the app's picker (6AM-9PM local). Keep in sync
// with NOTIF_HOURS in app.html's notification settings script — adding an
// hour there without adding it here means that hour silently never sends.
const NOTIF_HOURS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];

function hourTo12Label(h) {
  // OneSignal's delivery_time_of_day expects e.g. "9:00AM" (no space).
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12; if (h12 === 0) h12 = 12;
  return `${h12}:00${period}`;
}

async function sendTimedPush({ appId, apiKey, tagKey, hourValue, freqValue, title, body }) {
  const hourStr = String(hourValue).padStart(2, '0');
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Authorization': `Basic ${apiKey}`
    },
    body: JSON.stringify({
      app_id: appId,
      filters: [
        { field: 'tag', key: tagKey, relation: '=', value: 'true' },
        { field: 'tag', key: `${tagKey}_freq`, relation: '=', value: freqValue },
        { field: 'tag', key: `${tagKey}_hour`, relation: '=', value: hourStr }
      ],
      delayed_option: 'timezone',
      delivery_time_of_day: hourTo12Label(hourValue),
      headings: { en: title },
      contents: { en: body }
    })
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, hour: hourStr, freq: freqValue, data };
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
  const firstRef = refs[0] ? refLabel(refs[0]) : '';

  // 'web' matches app.html's translationSelect default (first/no explicit
  // "selected" option) so the verse text matches what someone would see
  // in-app if they opened today's passage themselves.
  const verseText = refs[0] ? await fetchFirstVerseText(refs[0], 'web') : null;
  const verseBody = verseText
    ? truncateForPush(verseText, 150)
    : (firstRef ? `Open today's verse from ${firstRef} →` : 'Open today\u2019s verse →');

  // Weekly-cadence users only get included on the day their weekly send
  // is due. Fixed to Monday (UTC calendar day) for now — no per-user
  // day-of-week choice yet, just daily vs weekly.
  const isWeeklySendDay = new Date().getUTCDay() === 1; // 1 = Monday
  const freqsToSend = isWeeklySendDay ? ['daily', 'weekly'] : ['daily'];

  const readingTasks = [];
  const verseTasks = [];

  for (const h of NOTIF_HOURS) {
    for (const freq of freqsToSend) {
      readingTasks.push(
        sendTimedPush({
          appId, apiKey, tagKey: 'reading_reminder', hourValue: h, freqValue: freq,
          title: `Day ${day} of 365`,
          body: `Today's reading: ${readingText}`
        }).catch(err => ({ ok: false, error: err.message, hour: h, freq }))
      );

      verseTasks.push(
        sendTimedPush({
          appId, apiKey, tagKey: 'verse_of_day', hourValue: h, freqValue: freq,
          title: 'Verse of the Day',
          body: verseBody
        }).catch(err => ({ ok: false, error: err.message, hour: h, freq }))
      );
    }
  }

  const [readingResults, verseResults] = await Promise.all([
    Promise.all(readingTasks),
    Promise.all(verseTasks)
  ]);

  const failedReading = readingResults.filter(r => !r.ok);
  const failedVerse = verseResults.filter(r => !r.ok);

  return {
    statusCode: 200,
    body: JSON.stringify({
      day,
      readingText,
      verseTextUsed: !!verseText,
      verseBody,
      isWeeklySendDay,
      readingReminder: { sent: readingResults.length, failed: failedReading.length, failures: failedReading },
      verseOfDay: { sent: verseResults.length, failed: failedVerse.length, failures: failedVerse }
    })
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
//    -- the exact trigger time matters less now than it used to, since
//    delivery time is computed per-recipient via delayed_option:
//    'timezone'. Any consistent once-daily trigger works; see the "KNOWN
//    TRADEOFF" note above the handler for the one edge case worth knowing.
// ---------------------------------------------------------------
