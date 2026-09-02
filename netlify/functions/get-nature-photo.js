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

// Turns a seed string into a stable number. The seed is normally a
// gospel card's id combined with the current week (see the "week" query
// param below) -- same card + same week always gets the same
// search/photo, but a new week produces a genuinely different one,
// since the resulting URL itself changes (see the Cache-Control note in
// the handler for why the URL needs to change, not just the internal
// pick, for weekly rotation to actually work).
function hashSeed(seed) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return hash;
}

exports.handler = async (event) => {
  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: 'PEXELS_API_KEY is not set in Netlify environment variables.' };
  }

  const seed = (event.queryStringParameters && event.queryStringParameters.seed) || 'default';
  const week = (event.queryStringParameters && event.queryStringParameters.week) || '';
  const hash = hashSeed(week ? `${seed}|${week}` : seed);
  const query = SEARCH_TERMS[hash % SEARCH_TERMS.length];
  const page = (hash % 15) + 1; // spreads results across Pexels' result pages for variety

  try {
    const searchRes = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=1&page=${page}&orientation=square`,
      { headers: { Authorization: apiKey } }
    );
    if (!searchRes.ok) throw new Error(`Pexels search failed: ${searchRes.status}`);
    const searchData = await searchRes.json();
    const photo = searchData.photos && searchData.photos[0];
    if (!photo) throw new Error('No photo found for this query.');

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
