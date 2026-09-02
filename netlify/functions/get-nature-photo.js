// netlify/functions/get-nature-photo.js
//
// Fetches a real nature photo from Pexels' free API and serves the actual
// image bytes back through this same domain — not just a link to Pexels.
// That's the important part: since this runs server-side, there's no
// browser CORS restriction to worry about, and because the response comes
// from followingjesusapp.netlify.app instead of images.pexels.com, the
// browser treats it as same-origin. That matters specifically because the
// Share the Gospel feature draws this image onto a <canvas> and then
// exports it (for the download/share button) — a canvas that's ever drawn
// cross-origin image data without proper CORS headers becomes "tainted"
// and refuses to export at all. Routing through here sidesteps that risk
// entirely, regardless of Pexels' own header behavior.
//
// Setup required (see the app conversation for full walkthrough):
//   1. Sign up for a free API key at pexels.com/api — instant, no cost.
//   2. Add it as a Netlify environment variable named PEXELS_API_KEY
//      (Site settings → Environment variables), same place the OneSignal
//      key already lives.
//
// Deploy: this file must live at netlify/functions/get-nature-photo.js —
// once deployed, it's reachable at:
//   https://<your-site>.netlify.app/.netlify/functions/get-nature-photo

// Two per requested category (beach, ocean, trees, sky, mountains) for
// real variety within each -- swap/add terms here to adjust the mix,
// nothing else needs to change.
const SEARCH_TERMS = [
  'tropical beach', 'sandy beach shoreline',
  'ocean horizon', 'ocean waves',
  'forest path', 'tall pine trees',
  'sunrise sky', 'sunset sky clouds',
  'mountain landscape', 'mountain peak sky'
];

// FNV-1a hash -- the previous simple multiply-and-add hash was
// clustering several of this app's real card ids onto the exact same
// search term AND result page, producing byte-for-byte identical
// photos for different verses (confirmed: 'hope', 'newlife', and 'life'
// all collided, as did 'calling' and 'forgiven'). FNV-1a distributes
// much better across short, similar-length strings like these card ids.
function hashString(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

exports.handler = async (event) => {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: 'PEXELS_API_KEY is not set in Netlify environment variables.' };
  }

  const seed = (event.queryStringParameters && event.queryStringParameters.seed) || 'default';
  const week = (event.queryStringParameters && event.queryStringParameters.week) || '';
  const baseSeed = week ? `${seed}|${week}` : seed;
  // Three independent hashes (different sub-seeds) rather than reusing
  // one hash's %10 and %15 remainders for term and page -- with a weak
  // hash and only ~10 real card ids, those two remainders ended up
  // correlated often enough to produce real collisions (see note above).
  // Hashing three distinct strings decorrelates them completely.
  const query = SEARCH_TERMS[hashString(`${baseSeed}#term`) % SEARCH_TERMS.length];
  const page = (hashString(`${baseSeed}#page`) % 15) + 1; // spreads results across Pexels' result pages
  const RESULTS_PER_PAGE = 5;
  const pickIndex = hashString(`${baseSeed}#pick`) % RESULTS_PER_PAGE; // which of that page's results to use

  try {
    const searchRes = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${RESULTS_PER_PAGE}&page=${page}&orientation=square`,
      { headers: { Authorization: apiKey } }
    );
    if (!searchRes.ok) throw new Error(`Pexels search failed: ${searchRes.status}`);
    const searchData = await searchRes.json();
    const photos = searchData.photos || [];
    if (photos.length === 0) throw new Error('No photo found for this query.');
    // Pexels may return fewer than RESULTS_PER_PAGE near the end of its
    // result set -- fall back to modulo the actual count rather than
    // failing outright.
    const photo = photos[pickIndex % photos.length];

    const imageRes = await fetch(photo.src.large);
    if (!imageRes.ok) throw new Error(`Image fetch failed: ${imageRes.status}`);
    const imageBuffer = await imageRes.arrayBuffer();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'image/jpeg',
        'Access-Control-Allow-Origin': '*',
        // Cached for a week. This only produces real weekly rotation
        // because the CLIENT includes a week identifier in the request
        // URL (see natureBackgroundUrlForCard in app.html) -- a browser
        // or CDN cache keys purely off the URL, so if the URL never
        // changed, caching it for 7 days would just freeze whatever
        // photo was first fetched, no matter how the internal query
        // logic changes. Since the URL DOES change every week, each
        // week's specific URL can safely be cached for the whole week
        // it's actually in use, then naturally stops being requested
        // once the week rolls over.
        'Cache-Control': 'public, max-age=604800'
      },
      body: Buffer.from(imageBuffer).toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    return { statusCode: 502, body: `Could not fetch a nature photo: ${e.message}` };
  }
};
