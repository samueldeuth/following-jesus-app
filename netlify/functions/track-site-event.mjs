// netlify/functions/track-site-event.mjs
//
// Receives one tiny visit/click event from /fj-track.js, adds the visitor's COUNTRY, state and city
// (Netlify works them out; the IP address itself is never read or stored), and saves it
// through the log_site_event() database function created by website-tracking.sql.
//
// No environment variables needed: it uses the same public (anon) Supabase key the
// website already ships in its pages. The anon key can ONLY call log_site_event(),
// which can only add a row. It cannot read anything.
//
// Always answers 204 (even when something goes wrong) so a tracking hiccup can never
// show an error to a visitor.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

const done = () => new Response(null, { status: 204 });
const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : null);

export default async (req, context) => {
  try {
    if (req.method !== 'POST') return done();
    const ua = req.headers.get('user-agent') || '';
    if (/bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed/i.test(ua)) return done();

    let b;
    try { b = await req.json(); } catch (e) { return done(); }
    if (!b || typeof b !== 'object') return done();

    const geo = (context && context.geo) || {};
    const country = (geo.country && geo.country.code) || null;
    // State/province and city are Netlify's approximate guess from the network; the IP itself is never read.
    const region = (geo.subdivision && (geo.subdivision.name || geo.subdivision.code)) || null;
    const city = geo.city || null;

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/log_site_event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`
      },
      body: JSON.stringify({
        p_event: str(b.event, 10),
        p_visitor_id: str(b.visitor_id, 64),
        p_session_id: str(b.session_id, 64),
        p_first: b.first === true,
        p_path: str(b.path, 160),
        p_label: str(b.label, 80),
        p_area: str(b.area, 40),
        p_source: str(b.source, 20),
        p_referrer_host: str(b.referrer_host, 120),
        p_utm_source: str(b.utm_source, 60),
        p_utm_medium: str(b.utm_medium, 60),
        p_utm_campaign: str(b.utm_campaign, 80),
        p_country: country,
        p_device: str(b.device, 10),
        p_in_app: b.in_app === true,
        p_region: str(region, 60),
        p_city: str(city, 60)
      })
    });
  } catch (e) {
    // swallow: tracking must never surface an error
  }
  return done();
};
