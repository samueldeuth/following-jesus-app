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

const SEARCH_TERMS = [
  'sunrise sky', 'mountain landscape', 'forest path', 'ocean horizon',
  'peaceful field', 'golden hour nature', 'calm lake', 'desert sky'
];

// Turns a seed string (a gospel card's id) into a stable number, so the
// same verse consistently gets a similar search/photo rather than a new
// random one every single time it's opened.
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
  const hash = hashSeed(seed);
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
        // Cached for a week — a given verse's photo doesn't need to
        // change often, and this keeps well within Pexels' free rate
        // limit even with regular use.
        'Cache-Control': 'public, max-age=604800'
      },
      body: Buffer.from(imageBuffer).toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    return { statusCode: 502, body: `Could not fetch a nature photo: ${e.message}` };
  }
};
