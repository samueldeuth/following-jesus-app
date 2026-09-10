// netlify/functions/geocode-address.js
//
// Resolves a plain address into lat/lng, for the admin Church Directory
// tool. Super_admin-only -- same authorization pattern as every other
// admin-only function in this project. The actual insert/update into
// church_directory happens client-side via supabaseClient (RLS already
// restricts that table to super_admin), so this function's only job is
// the one piece that needs the server-side Places API key: turning an
// address into coordinates.
//
// Reuses the same Google Places API (New) Text Search call already
// used by find-church.js and submit-church-location.js -- one API,
// one key, no separate Geocoding API needed anywhere in this project.
//
// REQUIRES the same environment variable already set for the other
// Find a Church functions:
//   GOOGLE_PLACES_API_KEY

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

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

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: GOOGLE_PLACES_API_KEY' }) };
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
  const { address } = body;
  if (!address || !address.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing address.' }) };
  }

  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'places.location,places.formattedAddress'
      },
      body: JSON.stringify({ textQuery: address.trim(), maxResultCount: 1 })
    });
    const data = await res.json();
    const place = data.places?.[0];
    if (!place?.location) {
      return { statusCode: 200, body: JSON.stringify({ found: false }) };
    }
    return {
      statusCode: 200,
      body: JSON.stringify({ found: true, lat: place.location.latitude, lng: place.location.longitude, formattedAddress: place.formattedAddress || address })
    };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
