// netlify/functions/lib/add-church-from-order.js
//
// Extends the order-arrival pipeline (tag-book-order.js) with a second,
// completely independent concern: checking whether this order's
// shipping Company field looks like a church, and if so, adding it as
// a new pending church_directory entry -- the same keyword-matching
// approach originally used for the one-time historical Shopify CSV
// import, now running live on every new order instead of just past
// ones.
//
// New churches land as status='pending_confirmation', NOT immediately
// emailed -- matches the existing review-then-send-in-batches workflow
// already established for the historical import. Change this file's
// caller in tag-book-order.js to also trigger
// send-single-church-confirmation.js's logic if immediate emailing is
// ever wanted instead.
//
// Deliberately its own try/caught, isolated function -- a failure here
// (bad geocode, database hiccup, whatever) can never take down the
// Outreach tagging/emailing logic in tag-book-order.js that runs
// alongside it, matching that file's own established defensive pattern
// for its own steps.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const REMINDER_FUNCTION_SECRET = process.env.REMINDER_FUNCTION_SECRET;

const CHURCH_KEYWORDS = /church|ministr|fellowship|chapel|assembly|congregation|parish|cathedral|worship\s*center|christian\s*center|tabernacle/i;

function normalize(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

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

async function maybeAddChurchFromOrder(order) {
  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!placesApiKey || !REMINDER_FUNCTION_SECRET) {
    console.log('Skipping church-directory check: missing GOOGLE_PLACES_API_KEY or REMINDER_FUNCTION_SECRET');
    return;
  }

  const shipping = order.shipping_address || {};
  const companyName = (shipping.company || '').trim();
  if (!companyName || !CHURCH_KEYWORDS.test(companyName)) {
    return; // Not a church-like name -- nothing to do, same as most orders.
  }

  const email = order.email || order.contact_email || '';
  const addressParts = [shipping.address1, shipping.city, shipping.province, shipping.zip, shipping.country]
    .filter(Boolean)
    .join(', ');

  // Skip if a church with this normalized name already exists (course
  // customer, prior import, or a previous order from the same church) --
  // reuses the same lookup already used by the historical import's own
  // dedup step.
  try {
    const existingRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_church_directory_names`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ caller_secret: REMINDER_FUNCTION_SECRET })
    });
    const existingNames = new Set((await existingRes.json()).map(normalize));
    if (existingNames.has(normalize(companyName))) {
      console.log(`Church-directory check: "${companyName}" already exists, skipping.`);
      return;
    }

    const geocoded = addressParts ? await geocodeAddress(addressParts, placesApiKey) : null;
    if (!geocoded) {
      console.log(`Church-directory check: could not geocode "${addressParts}" for "${companyName}", skipping.`);
      return;
    }

    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/insert_pending_church_from_order`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller_secret: REMINDER_FUNCTION_SECRET,
        p_name: companyName,
        p_address: geocoded.formattedAddress,
        p_lat: geocoded.lat,
        p_lng: geocoded.lng,
        p_email: email || null
      })
    });
    const result = await insertRes.json();
    if (result === 'success') {
      console.log(`Added "${companyName}" to church_directory as pending_confirmation, from order ${order.name}.`);
    } else {
      console.log(`Church-directory insert for "${companyName}" returned: ${result}`);
    }
  } catch (err) {
    // Deliberately just logged, not alerted -- this is a nice-to-have
    // enrichment, not something that needs to interrupt anyone or
    // require manual recovery the way a missed Outreach tag would.
    console.error(`Church-directory check failed for order ${order.name}:`, err);
  }
}

module.exports = { maybeAddChurchFromOrder };
