// Records a coarse visitor location (country / state / city) for the admin map.
// The place comes from Netlify's own geolocation of the request, never from the browser,
// and the IP address is not stored. Always answers 204 so it can never disturb a page.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

const done = () => new Response(null, { status: 204 });

export default async (req, context) => {
  try {
    if (req.method !== 'POST') return done();
    const body = await req.json().catch(() => ({}));
    const source = ['app', 'course', 'site'].includes(body.source) ? body.source : null;
    if (!source) return done();

    let geo = context && context.geo;
    if (!geo || !geo.country) {
      const h = req.headers.get('x-nf-geo');
      if (h) { try { geo = JSON.parse(atob(h)); } catch (e) {} }
    }
    if (!geo || !geo.country || geo.latitude == null || geo.longitude == null) return done();

    const headers = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY };
    const auth = req.headers.get('authorization');
    if (auth && /^Bearer\s+\S+/i.test(auth)) headers.Authorization = auth; // signed-in visitor: lets the database tie it to their account

    await fetch(SUPABASE_URL + '/rest/v1/rpc/log_visitor_location', {
      method: 'POST', headers,
      body: JSON.stringify({
        p_source: source,
        p_visitor_key: String(body.visitorKey || '').slice(0, 64) || null,
        p_country: geo.country.name || geo.country.code,
        p_region: geo.subdivision && (geo.subdivision.name || geo.subdivision.code) || null,
        p_region_code: geo.subdivision && geo.subdivision.code || null,
        p_city: geo.city || null,
        p_lat: Number(geo.latitude),
        p_lng: Number(geo.longitude)
      })
    });
  } catch (e) { /* never surface errors to visitors */ }
  return done();
};
