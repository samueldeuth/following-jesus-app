// netlify/functions/video-messages.js
//
// Feeds the app's "Video Messages" page. For each church in CHURCHES below it
// reads that channel's public YouTube feed (no API key, no new secrets) and
// returns one merged, newest-first list the app can filter by church.
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

const PER_CHURCH = 12;                 // newest videos kept per church
const TIMEOUT_MS = 7000;
const SKIP_TITLE = /#shorts?\b|\bshorts?\b|lyric video|official music video/i;

const idCache = {};                    // handle -> channel id (lives while the function stays warm)
const UA = 'Mozilla/5.0 (compatible; FollowingJesusApp/1.0)';

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
  const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/) ||
            html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
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

async function loadChurch(c) {
  try {
    const channelId = await resolveChannelId(c);
    const { author, entries } = parseFeed(await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId));
    if (c.expect && !c.expect.test(author)) return { church: c, ok: false, why: 'channel name did not match (' + author + ')', videos: [] };
    const videos = entries.filter(v => !SKIP_TITLE.test(v.title) && !(c.exclude && c.exclude.test(v.title))).slice(0, PER_CHURCH)
      .map(v => ({ id: v.id, title: v.title, church: c.id, published: v.published, d: v.desc }));
    return { church: c, ok: true, videos };
  } catch (e) {
    return { church: c, ok: false, why: String(e && e.message || e), videos: [] };
  }
}

exports.FALLBACK = FALLBACK; exports.parseFeed = parseFeed;

exports.handler = async () => {
  const CHURCHES = await loadChurchList();
  const results = await Promise.all(CHURCHES.map(loadChurch));
  const churches = results.filter(r => r.ok && r.videos.length).map(r => ({ id: r.church.id, name: r.church.name }));
  const videos = results.flatMap(r => r.videos).sort((a, b) => (a.published < b.published ? 1 : -1));
  const problems = results.filter(r => !r.ok).map(r => r.church.name + ': ' + r.why);
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
