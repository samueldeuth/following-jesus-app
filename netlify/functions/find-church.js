// netlify/functions/find-church.js
//
// Powers the "Find a Church" feature in app.html. Never exposes the
// Google Places API key to the client -- that key has real billing
// attached to it, so it stays server-side here, same reasoning as
// every other third-party API key in this project (OneSignal,
// Resend, etc.).
//
// Accepts EITHER a lat/lng pair (from the browser's own geolocation)
// OR a free-text location string (city, zip, address someone typed in
// manually) -- these map to two different Google Places API (New)
// endpoints:
//   - lat/lng  -> searchNearby   (a real radius search around a point)
//   - text     -> searchText     (Google resolves the location text
//                                 itself -- no separate Geocoding API
//                                 call needed first)
//
// Only requests Pro-tier fields (name, address, location, phone,
// website) -- deliberately NOT rating, reviews, or photos, since
// Google bills the ENTIRE request at whichever field's tier is
// highest. Adding a rating field alone would push every search from
// $32/1,000 (Pro) to $35/1,000 (Enterprise), and reviews/photos to
// $40/1,000. Confirmed directly against Google's own current pricing
// page before building this.
//
// includedTypes:['church'] is the actual filter that keeps mosques,
// synagogues, and Hindu temples out of results -- Google's Places data
// tags those as separate, distinct types from 'church', so allow-
// listing just 'church' excludes them cleanly and reliably at the API
// level, no guessing involved.
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

const LDS_NAME_PATTERN = /latter-day saints|latter day saints|\bLDS\b/i;

exports.handler = async function (event) {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Missing environment variable: GOOGLE_PLACES_API_KEY' }) };
  }

  const params = event.queryStringParameters || {};
  const lat = params.lat ? parseFloat(params.lat) : null;
  const lng = params.lng ? parseFloat(params.lng) : null;
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
  if (lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng)) {
    endpoint = 'https://places.googleapis.com/v1/places:searchNearby';
    body = {
      includedTypes: ['church'],
      maxResultCount: 20,
      locationRestriction: {
        circle: { center: { latitude: lat, longitude: lng }, radius: 40000 } // ~25 miles
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

    const places = (data.places || [])
      .filter(p => !LDS_NAME_PATTERN.test(p.displayName?.text || ''))
      .map(p => ({
        id: p.id,
        name: p.displayName?.text || 'Unnamed',
        address: p.formattedAddress || '',
        lat: p.location?.latitude ?? null,
        lng: p.location?.longitude ?? null,
        phone: p.nationalPhoneNumber || null,
        website: p.websiteUri || null
      }));

    return { statusCode: 200, body: JSON.stringify({ churches: places }) };
  } catch (e) {
    return { statusCode: 502, body: JSON.stringify({ error: e.message }) };
  }
};
