// netlify/functions/lib/push-dispatch.js
//
// The brain of the push system. Runs every 15 minutes (see netlify.toml ->
// send-daily-notifications -> push-dispatch-background) and does three jobs:
//
//   1. REMINDERS  -- reading reminder, verse of the day, the six 52-day plan
//      reminders. Each phone stores its own choices (on/off, daily/weekly,
//      hour) in push_prefs plus its own timezone in push_devices. A
//      reminder is "due" when the phone's LOCAL clock is inside the
//      15-minute slot of the hour it chose -- the same "7 AM wherever you
//      are" behaviour OneSignal's delayed_option:'timezone' used to provide.
//   2. ADMIN CAMPAIGNS -- pushes composed on the admin dashboard:
//      immediate broadcasts, "deliver at <time> in everyone's own timezone"
//      scheduled pushes, and the recurring ones (converted into scheduled
//      campaigns once a day at 08:00 UTC, same moment the old cron ran).
//   3. HOUSEKEEPING -- delete dead tokens as FCM reports them, and (once a
//      day) stop sending to phones that haven't opened the app in 120 days.
//
// Safety:
//   * push_claim_run() makes each slot / campaign-slot run exactly once even
//     if Netlify fires a cron twice or a request is retried.
//   * Everything pages by id (2,000 rows at a time) so 100k+ devices never
//     sit in memory at once, and stops cleanly at a time budget.
//   * A failure in one device / one campaign never aborts the rest.

const { READING_PLAN, BOOKS } = require('../reading-plan-data.js');
const { VERSE_OF_DAY_LIST, VERSE_OF_DAY_EPOCH } = require('../verse-of-day-data.js');

const PAGE_SIZE = 2000;
const SEND_CONCURRENCY = 50;
const SLOT_MS = 15 * 60 * 1000;

const DEVOTIONAL_PLAN_TITLES = {
  hope: '52 Bible Verses on Hope',
  miracles: '52 Bible Verses on Miracles',
  new_believer: '52 Bible Verses for New Believers',
  kids: '52 Bible Verses to Teach Your Kids',
  men: '52 Bible Verses for Men',
  youth: '52 Bible Verses for Youth',
};

const READING_TARGET_URL = 'https://followingjesus.com/app#bible';
const VERSE_TARGET_URL = 'https://followingjesus.com/app';
const DEVO_PLAN_TARGET_URL = 'https://followingjesus.com/app#plans';

// ---------- small helpers ----------
function slotKeyFor(now) {
  return new Date(Math.floor(now.getTime() / SLOT_MS) * SLOT_MS).toISOString();
}
function pad2(n) { return String(n).padStart(2, '0'); }

function daysBetween(isoA, isoB) {
  return Math.round((new Date(isoB + 'T00:00:00Z') - new Date(isoA + 'T00:00:00Z')) / 86400000);
}
function bookName(id) {
  const b = BOOKS.find((x) => x[0] === id);
  return b ? b[1] : id;
}
function refLabel(ref) {
  const [id, ...rest] = ref.split(' ');
  return `${bookName(id)} ${rest.join(' ')}`;
}
// Day-of-plan for the PERSON'S OWN calendar date ('YYYY-MM-DD').
function planDayFor(localDate) {
  const year = localDate.slice(0, 4);
  const diff = daysBetween(`${year}-01-01`, localDate) + 1;
  return Math.min(Math.max(diff, 1), 365);
}
function verseRefFor(localDate) {
  const len = VERSE_OF_DAY_LIST.length;
  const diff = daysBetween(VERSE_OF_DAY_EPOCH, localDate);
  return VERSE_OF_DAY_LIST[((diff % len) + len) % len];
}
function truncateForPush(text, maxLen) {
  if (!text || text.length <= maxLen) return text;
  return text.slice(0, maxLen).replace(/\s+\S*$/, '') + '…';
}

async function defaultFetchVerseText(ref, translation = 'web') {
  const [id, ...rest] = ref.split(' ');
  const m = rest.join(' ').match(/^(\d+)(?::(\d+))?/);
  if (!m) return null;
  try {
    const res = await fetch(`https://bible-api.com/${id}+${m[1]}:${m[2] || '1'}?translation=${translation}`);
    if (!res.ok) return null;
    const data = await res.json();
    return (data.text || '').trim().replace(/\s+/g, ' ') || null;
  } catch (e) { return null; }
}

// Builds {title, body, targetUrl} for one reminder kind on one local date.
// Cached per (kind, localDate) so 100,000 devices cost one lookup, not 100,000.
async function buildContent(kind, localDate, cache, fetchVerseText) {
  const key = `${kind}|${localDate}`;
  if (cache.has(key)) return cache.get(key);
  let content = null;
  if (kind === 'reading_reminder') {
    const day = planDayFor(localDate);
    const refs = READING_PLAN[day - 1] || [];
    content = { title: `Day ${day} of 365`, body: `Today's reading: ${refs.map(refLabel).join(', ')}`, targetUrl: READING_TARGET_URL };
  } else if (kind === 'verse_of_day') {
    const ref = verseRefFor(localDate);
    const label = refLabel(ref);
    const text = await fetchVerseText(ref);
    content = {
      title: 'Verse of the Day',
      body: text ? `${truncateForPush(text, 130)} — ${label}` : `Open today's verse from ${label} →`,
      targetUrl: VERSE_TARGET_URL,
    };
  } else if (kind.startsWith('devo_reminder_')) {
    const title = DEVOTIONAL_PLAN_TITLES[kind.slice('devo_reminder_'.length)];
    if (title) content = { title, body: `Don't forget today's reading in ${title}!`, targetUrl: DEVO_PLAN_TARGET_URL };
  }
  cache.set(key, content);
  return content;
}

// ---------- 1. reminders ----------
async function runReminders({ now, store, fcm, fetchVerseText = defaultFetchVerseText, deadlineMs, log = console.log }) {
  const stats = { due: 0, sent: 0, failed: 0, dead: 0, unknownKind: 0, errors: {}, stoppedEarly: false };
  const cache = new Map();
  let after = 0;
  for (;;) {
    if (deadlineMs && Date.now() > deadlineMs) { stats.stoppedEarly = true; break; }
    const rows = await store.rpc('push_due_prefs', { p_now: now.toISOString(), p_after: after, p_limit: PAGE_SIZE });
    if (!Array.isArray(rows) || rows.length === 0) break;
    after = rows[rows.length - 1].pref_id;
    stats.due += rows.length;

    const items = [];
    for (const r of rows) {
      const content = await buildContent(r.kind, r.local_date, cache, fetchVerseText);
      if (!content) { stats.unknownKind++; continue; }
      items.push({ token: r.token, title: content.title, body: content.body, data: { targetUrl: content.targetUrl, kind: r.kind }, ref: r.device_id });
    }
    const res = await fcm.sendMany(items, { concurrency: SEND_CONCURRENCY, deadlineMs });
    stats.sent += res.sent; stats.failed += res.failed;
    for (const [k, v] of Object.entries(res.errors)) stats.errors[k] = (stats.errors[k] || 0) + v;
    if (res.sample && !stats.sample) stats.sample = res.sample;
    if (res.dead.length) {
      stats.dead += res.dead.length;
      await store.rpc('push_delete_tokens', { p_tokens: res.dead }).catch((e) => log('[push] dead-token cleanup failed:', e.message));
    }
    if (res.skipped) { stats.stoppedEarly = true; break; }
    if (rows.length < PAGE_SIZE) break;
  }
  return stats;
}

// ---------- 2. campaigns ----------
async function recountCampaign(store, id) {
  const ok = await store.count(`push_campaign_sends?campaign_id=eq.${id}&ok=eq.true`, { col: 'device_id' });
  const bad = await store.count(`push_campaign_sends?campaign_id=eq.${id}&ok=eq.false`, { col: 'device_id' });
  return { successful: ok, failed: bad };
}

async function finalizeCampaign(store, c, now) {
  const counts = await recountCampaign(store, c.id);
  await store.patch(`push_campaigns?id=eq.${c.id}&status=in.(scheduled,sending)`, { status: 'sent', completed_at: now.toISOString(), ...counts });
  return counts;
}

async function processCampaign(c, { now, store, fcm, deadlineMs, log = console.log }) {
  const slot = slotKeyFor(now);
  const out = { id: c.id, sent: 0, failed: 0, dead: 0, finalized: false, skipped: false, stoppedEarly: false };

  // Scheduled campaign whose window is over: just close it out.
  if (c.window_end && now >= new Date(c.window_end)) {
    await finalizeCampaign(store, c, now);
    out.finalized = true;
    return out;
  }
  if (now < new Date(c.window_start)) { out.skipped = true; return out; }

  const claimed = await store.rpc('push_claim_run', { p_key: `campaign:${c.id}:${slot}` });
  if (!claimed) { out.skipped = true; return out; }

  // Re-check status right now so a cancel clicked a moment ago is respected.
  const fresh = await store.select(`push_campaigns?id=eq.${c.id}&select=status`);
  if (!fresh || !fresh[0] || !['scheduled', 'sending'].includes(fresh[0].status)) { out.skipped = true; return out; }

  let after = 0;
  let exhausted = false;
  for (;;) {
    if (deadlineMs && Date.now() > deadlineMs) { out.stoppedEarly = true; break; }
    const devices = await store.rpc('push_campaign_due_devices', { p_campaign: c.id, p_now: now.toISOString(), p_after: after, p_limit: PAGE_SIZE });
    if (!Array.isArray(devices) || devices.length === 0) { exhausted = true; break; }
    after = devices[devices.length - 1].device_id;

    const items = devices.map((d) => ({
      token: d.token, title: c.title, body: c.message,
      data: { ...(c.url ? { targetUrl: c.url } : {}), source: c.source, campaignId: c.id },
      ref: d.device_id,
    }));
    const res = await fcm.sendMany(items, { concurrency: SEND_CONCURRENCY, deadlineMs });
    out.sent += res.sent; out.failed += res.failed; out.dead += res.dead.length;
    if (res.failed && !out.error) out.error = res.sample || JSON.stringify(res.errors);
    if (res.okRefs.length) await store.rpc('push_record_campaign_sends', { p_campaign: c.id, p_device_ids: res.okRefs, p_ok: true });
    if (res.failedRefs.length) await store.rpc('push_record_campaign_sends', { p_campaign: c.id, p_device_ids: res.failedRefs, p_ok: false });
    if (res.dead.length) await store.rpc('push_delete_tokens', { p_tokens: res.dead }).catch((e) => log('[push] dead-token cleanup failed:', e.message));
    if (res.skipped) { out.stoppedEarly = true; break; }
    if (devices.length < PAGE_SIZE) { exhausted = true; break; }
  }

  if (!c.local_time && exhausted) {
    // Immediate broadcast that has reached everyone: done.
    await finalizeCampaign(store, c, now);
    out.finalized = true;
  } else {
    // Scheduled campaign mid-window: keep the running totals fresh.
    const counts = await recountCampaign(store, c.id);
    await store.patch(`push_campaigns?id=eq.${c.id}`, counts).catch(() => {});
  }
  return out;
}

async function runCampaigns({ now, store, fcm, deadlineMs, onlyId, log = console.log }) {
  const filter = onlyId ? `id=eq.${onlyId}&` : '';
  const campaigns = await store.select(`push_campaigns?${filter}status=in.(scheduled,sending)&select=*&order=created_at.asc`);
  const results = [];
  for (const c of campaigns || []) {
    if (deadlineMs && Date.now() > deadlineMs) break;
    try { results.push(await processCampaign(c, { now, store, fcm, deadlineMs, log })); }
    catch (e) { log(`[push] campaign ${c.id} failed:`, e.message); results.push({ id: c.id, error: e.message }); }
  }
  return results;
}

// ---------- recurring admin pushes -> campaigns ----------
async function convertRecurring({ now, store, secret, log = console.log }) {
  if (!secret) return { skipped: 'REMINDER_FUNCTION_SECRET not set' };
  const due = await store.rpc('get_due_recurring_pushes', { caller_secret: secret });
  const made = [];
  for (const p of due || []) {
    try {
      const hour = parseInt(p.hour, 10);
      const c = await store.insert('push_campaigns', {
        title: p.title, message: p.message, url: p.url || null,
        source: 'admin_composer_recurring', audience: 'all',
        local_time: `${pad2(Number.isFinite(hour) ? hour : 9)}:00`,
        window_start: now.toISOString(), window_end: new Date(now.getTime() + 24 * 3600 * 1000).toISOString(),
        status: 'scheduled',
      });
      await store.rpc('mark_recurring_push_sent', { caller_secret: secret, push_id: p.id });
      made.push({ recurringId: p.id, campaignId: c.id });
    } catch (e) { log(`[push] recurring ${p.id} failed:`, e.message); }
  }
  return { converted: made.length, made };
}

// ---------- one full 15-minute slot ----------
async function runSlot({ now = new Date(), store, fcm, fetchVerseText, secret = process.env.REMINDER_FUNCTION_SECRET, budgetMs = 13 * 60 * 1000, log = console.log }) {
  const key = `slot:${slotKeyFor(now)}`;
  const claimed = await store.rpc('push_claim_run', { p_key: key });
  if (!claimed) return { skipped: true, reason: `slot ${key} already ran` };

  const deadlineMs = Date.now() + budgetMs;
  const stats = { slot: key };
  try {
    // Same moment the old once-a-day OneSignal cron ran (08:00 UTC).
    if (now.getUTCHours() === 8 && now.getUTCMinutes() < 15) stats.recurring = await convertRecurring({ now, store, secret, log });
    stats.reminders = await runReminders({ now, store, fcm, fetchVerseText, deadlineMs, log });
    stats.campaigns = await runCampaigns({ now, store, fcm, deadlineMs, log });
    if (now.getUTCHours() === 3 && now.getUTCMinutes() < 15) {
      stats.staleDisabled = await store.rpc('push_disable_stale_devices', { p_days: 120 }).catch(() => null);
    }
  } catch (e) {
    stats.error = e.message;
    log('[push] slot failed:', e);
  }
  await store.patch(`push_runs?run_key=eq.${encodeURIComponent(key)}`, { finished_at: new Date().toISOString(), stats }).catch(() => {});
  return stats;
}

// Admin "send now": process just this campaign immediately.
async function runCampaignNow({ campaignId, now = new Date(), store, fcm, budgetMs = 13 * 60 * 1000, log = console.log }) {
  const deadlineMs = Date.now() + budgetMs;
  return runCampaigns({ now, store, fcm, deadlineMs, onlyId: campaignId, log });
}

module.exports = {
  runSlot, runCampaignNow, runReminders, runCampaigns, processCampaign, convertRecurring,
  buildContent, planDayFor, verseRefFor, slotKeyFor, truncateForPush, DEVOTIONAL_PLAN_TITLES, PAGE_SIZE,
};
