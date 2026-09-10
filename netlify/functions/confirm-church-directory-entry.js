// netlify/functions/confirm-church-directory-entry.js
//
// Handles the "Fix This Info" path on confirm-church-directory-entry.html
// -- geocodes the corrected address (reusing the same Google Places API
// key as the rest of Find a Church) and confirms the entry in one step
// via update_and_confirm_pending_church. The simple "Yes, this is
// correct" path doesn't need this function at all -- it calls
// confirm_pending_church directly from the page via supabaseClient,
// since no geocoding is needed when nothing's changing.
//
// REQUIRES the same environment variable already set for the other
// Find a Church functions:
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
  const { token, name, address } = body;
  if (!token || !name || !address) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing token, name, or address.' }) };
  }

  try {
    const geocoded = await geocodeAddress(address.trim(), apiKey);
    if (!geocoded) {
      return { statusCode: 200, body: JSON.stringify({ status: 'geocode_failed' }) };
    }

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/update_and_confirm_pending_church`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lookup_token: token,
        p_name: name.trim(),
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
