// netlify/functions/admin-resolve-youtube-channel.js
//
// Used by the "Video Churches" card in admin-dashboard.html (App page).
// Takes a pasted YouTube link (or @handle, or a UC... channel id) and returns
// the channel's id + name so the dashboard can save it to `video_churches`.
// Super-admin only: verifies the caller's own session token, same pattern as
// admin-send-push-notification.js. No new secrets or env variables.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const UA = 'Mozilla/5.0 (compatible; FollowingJesusApp/1.0)';

async function getCallerRole(token) {
  if (!token) return null;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!u.ok) return null;
  const user = await u.json();
  if (!user?.id) return null;
  const p = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } });
  if (!p.ok) return null;
  return (await p.json())[0]?.role || null;
}

async function get(url, tries = 3) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': UA, 'accept-language': 'en-US,en;q=0.9' } });
      clearTimeout(t);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.text();
    } catch (e) { err = e; await new Promise(r => setTimeout(r, 500)); }
  }
  throw err;
}

const decode = s => String(s).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'");

// Pull whatever identifies the channel out of what was pasted.
function parseInput(raw) {
  const s = String(raw || '').trim();
  let m = s.match(/(UC[\w-]{22})/);
  if (m) return { channelId: m[1] };
  m = s.match(/youtube\.com\/(@[\w.\-]+)/i) || s.match(/^(@[\w.\-]+)$/);
  if (m) return { handle: m[1] };
  m = s.match(/youtube\.com\/(?:c|user)\/([\w.\-]+)/i);
  if (m) return { handle: '@' + m[1] };
  return null;
}

async function channelIdFromHandle(handle) {
  const html = await get('https://www.youtube.com/' + handle);
  const m = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/itemprop="(?:channelId|identifier)" content="(UC[\w-]{22})"/) ||
            html.match(/"externalId":"(UC[\w-]{22})"/) || html.match(/channel\/(UC[\w-]{22})/);
  if (!m) throw new Error('no channel id on page');
  return m[1];
}

exports.resolve = { parseInput };

exports.handler = async (event) => {
  const json = (code, obj) => ({ statusCode: code, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const token = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if ((await getCallerRole(token)) !== 'super_admin') return json(403, { error: 'Super admin only.' });

  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad request.' }); }
  const parsed = parseInput(body.link);
  if (!parsed) return json(400, { error: 'Paste a YouTube channel link like youtube.com/@name' });

  try {
    const channelId = parsed.channelId || await channelIdFromHandle(parsed.handle);
    const xml = await get('https://www.youtube.com/feeds/videos.xml?channel_id=' + channelId);
    const name = decode((xml.match(/<author>\s*<name>([^<]*)<\/name>/) || [])[1] || '').trim();
    if (!name) throw new Error('feed had no channel name');
    return json(200, { channelId, name });
  } catch (e) {
    return json(502, { error: "YouTube didn't answer from the server (" + String(e.message || e) + "). Try again in a minute, or paste the channel's UC… id instead (I can look one up for you)." });
  }
};
