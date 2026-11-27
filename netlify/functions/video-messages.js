// netlify/functions/video-messages.js
//
// Feeds the app's "Video Messages" page. For each church it reads the channel's recent uploads
// and returns one merged, newest-first list the app can filter by church.
//
// With the Netlify environment variable YOUTUBE_API_KEY set, it uses YouTube's official API:
// it can look back WINDOW_DAYS and it drops every video shorter than MIN_SECONDS (full-length
// messages only). Without the key it falls back to the public feed (about the last 15 uploads,
// no length filter) so the page never goes empty.
//
// The church list lives in the Supabase table `video_churches` (managed from the
// admin dashboard, App page > Video Churches). The FALLBACK list below is used
// only if the table can't be read, so the page never goes empty.

const FALLBACK = [
  { id: 'awaken',     name: 'Awaken Church',     channelId: 'UCBYjJLwtiJm1gszCH3ISo3w', expect: /awaken/i },
  { id: 'elevation',  name: 'Elevation Church',  channelId: 'UCSf-NCzjwcnXErUBW_qeFvA', expect: /elevation/i, exclude: /elevation worship|elevation nights|\bworship\b/i },
  { id: 'lifechurch', name: 'Life.Church',       channelId: 'UCIIdiIO-Y20hRW9niR0CA8A', expect: /life\.?\s?church/i },
  { id: 'pringle',    name: 'Phil Pringle',      channelId: 'UCrnbsxwsvBCMGZwK1XI-xfw', expect: /pringle/i },
  { id: 'pursuit',    name: 'Pursuit NW',        channelId: 'UCDhfk3sPpwjIedZ1Bya1VrQ', expect: /pursuit/i },
  { id: 'freechapel', name: 'Free Chapel',       channelId: 'UCTPf84o895qPnPAkSbfm1Tw', expect: /free chapel/i }
];

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

async function loadChurchList() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(SUPABASE_URL + '/rest/v1/video_churches?active=eq.true&select=id,name,channel_id,exclude_title&order=sort_order.asc,created_at.asc',
      { signal: ctl.signal, headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error('empty');
    return rows.map(x => {
      let exclude = null;
      if (x.exclude_title) { try { exclude = new RegExp(x.exclude_title, 'i'); } catch (e) {} }
      return { id: x.id, name: x.name, channelId: x.channel_id, exclude };
    });
  } catch (e) { return FALLBACK; }
}

const PER_CHURCH = 20;                 // newest videos kept per church
const WINDOW_DAYS = 30;               // how far back the page reaches
const MIN_SECONDS = 15 * 60;          // anything shorter than this (clips, shorts, promos) is left out
const TIMEOUT_MS = 7000;
// Hidden from every church: shorts, music, and church promos/announcements (we want preaching only).
// To hide another kind of title, add a word to this list.
const SKIP_TITLE = new RegExp([
  '#shorts?\\b', '\\bshorts?\\b', 'lyric video', 'official music video',
  '\\bchurch (news|updates?|announcements?)\\b', '\\b(announcements?|weekly update|news update)\\b',
  '(?<!good\\s)\\bnews\\b', 'what you need to know', '\\b(weekly|monthly|staff|campus|building) update\\b', '\\bconference\\b', '\\bpromo\\b', '\\btrailer\\b', 'save the date', '\\bregist(er|ration)\\b', '\\btickets?\\b', '\\bnow open\\b'
].join('|'), 'i');

// Same title from the same church within 3 days = a re-upload; keep only the newest.
const normTitle = t => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function dedupe(list) {                       // list is newest-first
  const out = [];
  for (const v of list) {
    const k = normTitle(v.title);
    if (out.some(o => normTitle(o.title) === k && Math.abs(new Date(o.published) - new Date(v.published)) < 3 * 86400000)) continue;
    out.push(v);
  }
  return out;
}

const idCache = {};                    // handle -> channel id (lives while the function stays warm)
const UA = 'Mozilla/5.0 (compatible; FollowingJesusApp/1.0)';

// Hidden-word list: managed in the admin dashboard (App > Video Churches > Hidden words), stored in the
// `video_filter_words` table. mode 'hide' = hide titles containing it; mode 'keep' = a phrase that is
// never treated as a hidden word (e.g. "good news" so "news" doesn't hide gospel sermons).
// If the table can't be read, the built-in SKIP_TITLE list above is used.
const escRe = w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const phraseRe = w => new RegExp('(?<![a-z0-9])' + escRe(w.trim()) + '(?![a-z0-9])', 'gi');
function makeFilter(rows) {
  const hide = rows.filter(r => r.mode === 'hide' && r.word && r.word.trim()).map(r => phraseRe(r.word));
  const keep = rows.filter(r => r.mode === 'keep' && r.word && r.word.trim()).map(r => phraseRe(r.word));
  return title => {
    let t = String(title);
    keep.forEach(k => { t = t.replace(k, ' '); });
    return hide.some(h => { h.lastIndex = 0; return h.test(t); });
  };
}
async function loadFilter() {
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(SUPABASE_URL + '/rest/v1/video_filter_words?select=word,mode',
      { signal: ctl.signal, headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY } });
    clearTimeout(t);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const rows = await r.json();
    if (!Array.isArray(rows) || !rows.length) throw new Error('empty');
    return makeFilter(rows);
  } catch (e) { return title => SKIP_TITLE.test(title); }
}

async function get(url, tries = 2) {
  try { return await get1(url); }
  catch (e) { if (tries > 1) { await new Promise(r => setTimeout(r, 400)); return get(url, tries - 1); } throw e; }
}
async function get1(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

const decode = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(+n));

async function resolveChannelId(c) {
  if (c.channelId) return c.channelId;
  if (idCache[c.handle]) return idCache[c.handle];
  const html = await get('https://www.youtube.com/@' + encodeURIComponent(c.handle));
  // The channel's own id is in the page's canonical / RSS link. The first "channelId" in the
  // page source can belong to a related or featured channel, so it is only a last resort.
  const m = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/) ||
            html.match(/feeds\/videos\.xml\?channel_id=(UC[\w-]{22})/) ||
            html.match(/<meta itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/) ||
            html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/"channelId":"(UC[\w-]{22})"/);
  if (!m) throw new Error('channel id not found');
  return (idCache[c.handle] = m[1]);
}

function parseFeed(xml) {
  const author = (xml.match(/<author>\s*<name>([^<]*)<\/name>/) || [])[1] || '';
  const entries = [];
  const re = /<entry>([\s\S]*?)<\/entry>/g;
  let m;
  while ((m = re.exec(xml))) {
    const e = m[1];
    const id = (e.match(/<yt:videoId>([^<]+)<\/yt:videoId>/) || [])[1];
    const title = (e.match(/<title>([^<]*)<\/title>/) || [])[1];
    const published = (e.match(/<published>([^<]+)<\/published>/) || [])[1];
    const desc = (e.match(/<media:description>([\s\S]*?)<\/media:description>/) || [])[1] || '';
    if (id && title && published) entries.push({ id, title: decode(title).trim(), published, desc: decode(desc).replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) });
  }
  return { author: decode(author), entries };
}


// ---- YouTube Data API (needs the YOUTUBE_API_KEY environment variable) ----
const API = 'https://www.googleapis.com/youtube/v3/';
const durCache = {};                   // videoId -> seconds (kept while the function stays warm)
function parseDuration(iso) {          // "PT1H2M3S" -> seconds; live/upcoming ("P0D") -> 0
  const m = String(iso || '').match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}
async function apiJson(path, key) {
  const r = await get1(API + path + (path.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(key));
  return JSON.parse(r);
}
async function fetchDurations(ids, key) {
  const need = ids.filter(id => !(id in durCache));
  for (let i = 0; i < need.length; i += 50) {
    const batch = need.slice(i, i + 50);
    const j = await apiJson('videos?part=contentDetails&id=' + batch.join(','), key);
    batch.forEach(id => { durCache[id] = null; });
    (j.items || []).forEach(it => { durCache[it.id] = parseDuration(it.contentDetails && it.contentDetails.duration); });
  }
}

const withinWindow = iso => (Date.now() - new Date(iso).getTime()) <= WINDOW_DAYS * 86400000;

// Candidates for one church, before the length filter.
async function loadChurch(c, isHidden, key) {
  try {
    const channelId = await resolveChannelId(c);
    let author = '', entries = [], mode = 'rss', apiFailed = '';
    if (key) {
      try {
        const j = await apiJson('playlistItems?part=snippet,contentDetails&maxResults=50&playlistId=UU' + channelId.slice(2), key);
        entries = (j.items || []).map(it => ({
          id: it.contentDetails && it.contentDetails.videoId,
          title: it.snippet && it.snippet.title || '',
          published: (it.contentDetails && it.contentDetails.videoPublishedAt) || (it.snippet && it.snippet.publishedAt),
          desc: String(it.snippet && it.snippet.description || '').replace(/https?:\/\/\S+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300)
        })).filter(v => v.id && v.title && v.published);
        author = (j.items && j.items[0] && j.items[0].snippet && j.items[0].snippet.channelTitle) || '';
        mode = 'api';
      } catch (e) { mode = 'rss'; apiFailed = String(e && e.message || e); }
    }
    if (mode === 'rss') {
      // Public feed; the "UULF" playlist feed = long-form uploads only (no Shorts)
      let xml;
      try { xml = await get('https://www.youtube.com/feeds/videos.xml?playlist_id=UULF' + channelId.slice(2)); }
      catch (e) { xml = await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId); }
      const f = parseFeed(xml); author = f.author; entries = f.entries;
    }
    if (c.expect && author && !c.expect.test(author)) return { church: c, ok: false, why: 'channel name did not match (' + author + ')', videos: [] };
    const videos = entries
      .filter(v => withinWindow(v.published) && !isHidden(v.title) && !(c.exclude && c.exclude.test(v.title)))
      .map(v => ({ id: v.id, title: v.title, church: c.id, published: v.published, d: v.desc }));
    return { church: c, ok: true, mode, apiFailed, videos };
  } catch (e) {
    return { church: c, ok: false, why: String(e && e.message || e), videos: [] };
  }
}

exports.makeFilter = makeFilter; exports.FALLBACK = FALLBACK; exports.SKIP_TITLE = SKIP_TITLE; exports.dedupe = dedupe; exports.parseDuration = parseDuration; exports.parseFeed = parseFeed;

exports.handler = async () => {
  const CHURCHES = await loadChurchList();
  const isHidden = await loadFilter();
  const key = process.env.YOUTUBE_API_KEY || '';
  const results = await Promise.all(CHURCHES.map(c => loadChurch(c, isHidden, key)));
  const problems = results.filter(r => !r.ok).map(r => r.church.name + ': ' + r.why);
  results.filter(r => r.ok && r.apiFailed).forEach(r => problems.push(r.church.name + ': YouTube API failed (' + r.apiFailed + '), no length filter applied'));

  // Full-length only: look up each API-sourced video's length and drop the short ones.
  const apiIds = results.filter(r => r.ok && r.mode === 'api').flatMap(r => r.videos.map(v => v.id));
  let lengthsKnown = true;
  if (apiIds.length) {
    try { await fetchDurations(apiIds, key); }
    catch (e) { lengthsKnown = false; problems.push('Could not check video lengths: ' + String(e && e.message || e)); }
  }
  results.forEach(r => {
    if (!r.ok) return;
    if (r.mode === 'api' && lengthsKnown) r.videos = r.videos.filter(v => (durCache[v.id] || 0) >= MIN_SECONDS);
    r.videos = dedupe(r.videos.sort((a, b) => (a.published < b.published ? 1 : -1))).slice(0, PER_CHURCH);
  });
  if (!key) problems.push('YOUTUBE_API_KEY is not set: showing the last ~15 uploads per church with no length filter.');

  const churches = results.filter(r => r.ok && r.videos.length).map(r => ({ id: r.church.id, name: r.church.name }));
  const videos = results.flatMap(r => r.videos).sort((a, b) => (a.published < b.published ? 1 : -1));
  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json',
      // Cache an hour at Netlify's edge and in the browser so YouTube isn't hit on every visit.
      'cache-control': 'public, max-age=900',
      'netlify-cdn-cache-control': 'public, max-age=3600, stale-while-revalidate=86400'
    },
    body: JSON.stringify({ churches, videos, problems })
  };
};
