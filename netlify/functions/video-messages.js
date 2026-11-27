// netlify/functions/video-messages.js
//
// Feeds the app's "Video Messages" page. For each church in CHURCHES below it
// reads that channel's public YouTube feed (no API key, no new secrets) and
// returns one merged, newest-first list the app can filter by church.
//
// TO ADD A CHURCH: add one line to CHURCHES. Easiest is `handle` (the part after
// the @ in youtube.com/@name). If you have a youtube.com/channel/UC... link,
// put the UC... part in `channelId` instead -- that is the most reliable.
// `expect` is a safety net: if the channel found doesn't have that word in its
// name, the church is skipped instead of showing the wrong channel's videos.

const CHURCHES = [
  { id: 'awaken',      name: 'Awaken Church',     handle: 'awaken.church',   expect: /awaken/i },
  { id: 'elevation',  name: 'Elevation Church',  handle: 'elevationchurch', expect: /elevation/i },
  { id: 'lifechurch', name: 'Life.Church',       handle: 'life.church',     expect: /life\.?\s?church/i },
  { id: 'jentezen',   name: 'Jentezen Franklin', handle: 'jentezenfranklinmedia', expect: /jentezen/i },
  { id: 'pringle',    name: 'Phil Pringle',      handle: 'philpringle',     expect: /pringle/i },
  { id: 'freechapel', name: 'Free Chapel',       handle: 'freechapel',      expect: /free chapel/i }
];

const PER_CHURCH = 12;                 // newest videos kept per church
const TIMEOUT_MS = 7000;
const SKIP_TITLE = /#shorts?\b|\bshorts?\b|lyric video|official music video/i;

const idCache = {};                    // handle -> channel id (lives while the function stays warm)
const UA = 'Mozilla/5.0 (compatible; FollowingJesusApp/1.0)';

async function get(url) {
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
    if (id && title && published) entries.push({ id, title: decode(title).trim(), published });
  }
  return { author: decode(author), entries };
}

async function loadChurch(c) {
  try {
    const channelId = await resolveChannelId(c);
    const { author, entries } = parseFeed(await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId));
    if (c.expect && !c.expect.test(author)) return { church: c, ok: false, why: 'channel name did not match (' + author + ')', videos: [] };
    const videos = entries.filter(v => !SKIP_TITLE.test(v.title)).slice(0, PER_CHURCH)
      .map(v => ({ id: v.id, title: v.title, church: c.id, published: v.published }));
    return { church: c, ok: true, videos };
  } catch (e) {
    return { church: c, ok: false, why: String(e && e.message || e), videos: [] };
  }
}

exports.CHURCHES = CHURCHES; exports.parseFeed = parseFeed;

exports.handler = async () => {
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
