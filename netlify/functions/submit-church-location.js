// netlify/functions/submit-church-location.js
//
// Powers the public "submit your church's location" form
// (church-location-form.html), reached via a unique per-church link
// sent in the outreach email. No login required -- the token itself is
// the authorization, matched to exactly one church row via
// submit_church_location, same pattern as every other token-gated
// public action in this project (claim_admin_invite,
// unsubscribe_from_course_reminders, etc.).
//
// Geocodes the submitted address using the SAME Google Places API (New)
// key already set up for the Find a Church feature itself -- reuses
// Places Text Search rather than requiring Samuel to enable a separate
// Geocoding API key for this one extra step. Text Search on a real
// street address reliably resolves to that address's own location, the
// same way it already resolves "church near <city>" queries for
// find-church.js.
//
// REQUIRES the same environment variable already set for
// find-church.js:
//   GOOGLE_PLACES_API_KEY

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

async function geocodeAddress(address, apiKey) {
  const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask': 'places.location,places.formattedAddress'
    },
    body: JSON.stringify({ textQuery: address, maxResultCount: 1 })
  });
  const data = await res.json();
  const place = data.places?.[0];
  if (!place?.location) return null;
  return { lat: place.location.latitude, lng: place.location.longitude, formattedAddress: place.formattedAddress || address };
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: GOOGLE_PLACES_API_KEY' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body.' }) };
  }
  const { token, address } = body;
  if (!token || !address || !address.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing token or address.' }) };
  }

  try {
    const geocoded = await geocodeAddress(address.trim(), apiKey);
    if (!geocoded) {
      return { statusCode: 200, body: JSON.stringify({ status: 'geocode_failed' }) };
    }

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/submit_church_location`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lookup_token: token,
        p_address: geocoded.formattedAddress,
        p_lat: geocoded.lat,
        p_lng: geocoded.lng
      })
    });
    const result = await rpcRes.json();
    return { statusCode: 200, body: JSON.stringify({ status: result }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
