// netlify/functions/find-church.js
//
// Powers the "Find a Church" feature in app.html. Never exposes the
// Google Places API key to the client -- that key has real billing
// attached to it, so it stays server-side here, same reasoning as
// every other third-party API key in this project (OneSignal,
// Resend, etc.).
//
// Checks the standalone church_directory table FIRST for featured,
// confirmed church locations near the search point (see
// add-church-directory.sql), and returns those ahead of the generic
// Google results, clearly flagged with isPartner: true. church_directory
// is intentionally NOT the same as the churches table -- a single
// course customer can have multiple physical campus locations here
// (each its own row), and a church that's only ever bought books, with
// no churches row or course at all, can be featured too, once added
// (manually today, or via a planned future Shopify order import).
// Distance is computed with a plain haversine formula here in JS
// rather than a PostGIS/earthdistance query -- with well under a
// couple hundred entries total, pulling every featured+confirmed+
// geocoded row and filtering in code is simpler and plenty fast, with
// no extra Postgres extension to set up.
//
// Accepts EITHER a lat/lng pair (from the browser's own geolocation)
// OR a free-text location string (city, zip, address someone typed in
// manually) -- these map to two different Google Places API (New)
// endpoints for the GOOGLE portion of results:
//   - lat/lng  -> searchNearby   (a real radius search around a point)
//   - text     -> searchText     (Google resolves the location text
//                                 itself -- no separate Geocoding API
//                                 call needed first)
// The free-text case is also geocoded once (reusing that same
// searchText call's own returned location) so church_directory distance
// filtering has real coordinates to compare against too, not just the
// Google results.
//
// Only requests Pro-tier fields (name, address, location, phone,
// website) from Google -- deliberately NOT rating, reviews, or photos,
// since Google bills the ENTIRE request at whichever field's tier is
// highest. Adding a rating field alone would push every search from
// $32/1,000 (Pro) to $35/1,000 (Enterprise), and reviews/photos to
// $40/1,000. Confirmed directly against Google's own current pricing
// page before building this.
//
// includedTypes:['church'] is the actual filter that keeps mosques,
// synagogues, and Hindu temples out of the GOOGLE results -- Google's
// Places data tags those as separate, distinct types from 'church', so
// allow-listing just 'church' excludes them cleanly and reliably at the
// API level, no guessing involved. Directory entries are obviously
// already real churches by definition, so this filter only ever
// applies to the Google portion.
//
// The one thing Google's data CANNOT distinguish is denomination or
// theology within "church" itself -- Mormon/LDS meetinghouses, for
// instance, are tagged as plain 'church' in Google's system, same as
// every other Christian congregation, with no separate type to
// exclude. LDS_NAME_PATTERN below is a best-effort, NAME-based filter
// for that one specific gap -- not a real theological filter (nothing
// in Google's data supports one), just a narrow patch for the one
// denomination whose institutions commonly self-identify with a
// consistent, distinctive name pattern. It will miss any LDS
// congregation that doesn't happen to use these words in its name, and
// it says nothing at all about whether any OTHER result is doctrinally
// sound -- that discernment is left to the person visiting, which is
// also why app.html's own UI carries an explicit disclaimer alongside
// these results rather than implying they're all vetted.
//
// REQUIRES one Netlify environment variable:
//   GOOGLE_PLACES_API_KEY

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

const LDS_NAME_PATTERN = /latter-day saints|latter day saints|\bLDS\b/i;
const SEARCH_RADIUS_MILES = 25;

function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.8; // Earth's radius in miles
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

async function getPartnerChurches(lat, lng) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_confirmed_partner_churches`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if (!res.ok) return [];
  const rows = await res.json();
  return rows
    .map(c => ({ ...c, distance: milesBetween(lat, lng, c.latitude, c.longitude) }))
    .filter(c => c.distance <= SEARCH_RADIUS_MILES)
    .sort((a, b) => a.distance - b.distance)
    .map(c => ({
      id: 'partner-' + c.id,
      name: c.name,
      address: c.address,
      lat: c.latitude,
      lng: c.longitude,
      phone: null,
      website: c.website || null,
      isPartner: true
    }));
}

exports.handler = async function (event) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: GOOGLE_PLACES_API_KEY' }) };
  }

  const params = event.queryStringParameters || {};
  let lat = params.lat ? parseFloat(params.lat) : null;
  let lng = params.lng ? parseFloat(params.lng) : null;
  const query = (params.q || '').trim();

  if ((lat === null || lng === null || isNaN(lat) || isNaN(lng)) && !query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Provide either lat/lng or a q (location text) parameter.' }) };
  }

  // Pro-tier fields only -- see the file header for why rating/photos
  // are deliberately left out.
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.nationalPhoneNumber',
    'places.websiteUri'
  ].join(',');

  let endpoint, body;
  const usingCoordinates = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);
  if (usingCoordinates) {
    endpoint = 'https://places.googleapis.com/v1/places:searchNearby';
    body = {
      includedTypes: ['church'],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_MILES * 1609.34 }
      }
    };
  } else {
    endpoint = 'https://places.googleapis.com/v1/places:searchText';
    body = {
      textQuery: `church near ${query}`,
      includedType: 'church',
      maxResultCount: 20
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: data.error?.message || 'Google Places rejected the request.' }) };
    }

    const googleChurches = (data.places || [])
      .filter(p => !LDS_NAME_PATTERN.test(p.displayName?.text || ''))
      .map(p => ({
        id: p.id,
        name: p.displayName?.text || 'Unnamed',
        address: p.formattedAddress || '',
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        phone: p.nationalPhoneNumber || null,
        website: p.websiteUri || null,
        isPartner: false
      }));

    // For a text-search request, borrow the FIRST Google result's own
    // resolved coordinates to check the directory for partner churches
    // nearby too -- Google already did the work of turning "Escondido,
    // CA" or a zip code into a real point, no separate geocoding call
    // needed.
    let searchLat = lat, searchLng = lng;
    if (!usingCoordinates && googleChurches.length && googleChurches[0].lat !== null) {
      searchLat = googleChurches[0].lat;
      searchLng = googleChurches[0].lng;
    }

    let partnerChurches = [];
    if (searchLat !== null && searchLng !== null && !isNaN(searchLat) && !isNaN(searchLng)) {
      partnerChurches = await getPartnerChurches(searchLat, searchLng);
    }

    // Partner churches first, then Google's results -- de-duplicated on
    // name+address so a partner church that also happens to show up in
    // Google's own results isn't listed twice.
    const partnerKeys = new Set(partnerChurches.map(c => (c.name + c.address).toLowerCase()));
    const dedupedGoogle = googleChurches.filter(c => !partnerKeys.has((c.name + c.address).toLowerCase()));

    return { statusCode: 200, body: JSON.stringify({ churches: [...partnerChurches, ...dedupedGoogle] }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};

exports.handler = async function (event) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: GOOGLE_PLACES_API_KEY' }) };
  }

  const params = event.queryStringParameters || {};
  let lat = params.lat ? parseFloat(params.lat) : null;
  let lng = params.lng ? parseFloat(params.lng) : null;
  const query = (params.q || '').trim();

  if ((lat === null || lng === null || isNaN(lat) || isNaN(lng)) && !query) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Provide either lat/lng or a q (location text) parameter.' }) };
  }

  // Pro-tier fields only -- see the file header for why rating/photos
  // are deliberately left out.
  const fieldMask = [
    'places.id',
    'places.displayName',
    'places.formattedAddress',
    'places.location',
    'places.nationalPhoneNumber',
    'places.websiteUri'
  ].join(',');

  let endpoint, body;
  const usingCoordinates = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);
  if (usingCoordinates) {
    endpoint = 'https://places.googleapis.com/v1/places:searchNearby';
    body = {
      includedTypes: ['church'],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: SEARCH_RADIUS_MILES * 1609.34 }
      }
    };
  } else {
    endpoint = 'https://places.googleapis.com/v1/places:searchText';
    body = {
      textQuery: `church near ${query}`,
      includedType: 'church',
      maxResultCount: 20
    };
  }

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': fieldMask
      },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      return { statusCode: 502, body: JSON.stringify({ error: data.error?.message || 'Google Places rejected the request.' }) };
    }

    const googleChurches = (data.places || [])
      .filter(p => !LDS_NAME_PATTERN.test(p.displayName?.text || ''))
      .map(p => ({
        id: p.id,
        name: p.displayName?.text || 'Unnamed',
        address: p.formattedAddress || '',
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        phone: p.nationalPhoneNumber || null,
        website: p.websiteUri || null,
        isPartner: false
      }));

    // For a text-search request, borrow the FIRST Google result's own
    // resolved coordinates to check for partner churches nearby too --
    // Google already did the work of turning "Escondido, CA" or a zip
    // code into a real point, no separate geocoding call needed.
    let searchLat = lat, searchLng = lng;
    if (!usingCoordinates && googleChurches.length && googleChurches[0].lat !== null) {
      searchLat = googleChurches[0].lat;
      searchLng = googleChurches[0].lng;
    }

    let partnerChurches = [];
    if (searchLat !== null && searchLng !== null && !isNaN(searchLat) && !isNaN(searchLng)) {
      partnerChurches = await getPartnerChurches(searchLat, searchLng);
    }

    // Partner churches first, then Google's results -- de-duplicated on
    // name+address so a partner church that also happens to show up in
    // Google's own results isn't listed twice.
    const partnerKeys = new Set(partnerChurches.map(c => (c.name + c.address).toLowerCase()));
    const dedupedGoogle = googleChurches.filter(c => !partnerKeys.has((c.name + c.address).toLowerCase()));

    return { statusCode: 200, body: JSON.stringify({ churches: [...partnerChurches, ...dedupedGoogle] }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
