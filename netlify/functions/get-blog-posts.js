// netlify/functions/get-blog-posts.js
//
// Live-pulls blog posts from both samueldeuth.com (Squarespace) and
// followingjesusbook.com (Shopify), merges them into one feed sorted by
// publish date (newest first), and returns JSON for the app to render.
//
// This runs server-side, so there's no browser CORS restriction — that's
// the whole reason this needs to be a backend function rather than
// something the app's own JavaScript can do directly.
//
// Deploy: this file must live at netlify/functions/get-blog-posts.js in a
// Netlify site that's connected to a Git repo (or deployed via the Netlify
// CLI) — functions do NOT work with a plain Netlify Drop of static files.
// Once deployed, it's reachable at:
//   https://<your-site>.netlify.app/.netlify/functions/get-blog-posts

const SQUARESPACE_BLOG_URL = 'https://www.samueldeuth.com/blog';
const SHOPIFY_ATOM_URL = 'https://followingjesusbook.com/blogs/articles-updates.atom';

const MAX_SQUARESPACE_PAGES = 4; // ~ 4 x 20 = up to 80 posts
const CACHE_SECONDS = 3600; // 1 hour — keeps us from hammering either site

// ---------- tiny HTML sanitizer (no external dependencies) ----------
// Strips script/style tags, event handler attributes, and javascript: URLs.
// Good enough for first-party content from two sites the pastor owns;
// not a substitute for a real sanitizer if this ever pulls third-party HTML.
function sanitizeHtml(html) {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '');
}

// Squarespace (and several other page builders) lazy-load in-body images:
// the real URL sits in data-src, and the <img> tag's own src is left
// blank or pointed at a tiny placeholder until the page's own JavaScript
// swaps the real one in on scroll. That JavaScript is part of
// Squarespace's site, not this app, so it never runs here — every
// in-body image would otherwise stay blank. This copies data-src into
// src wherever src is missing or empty, so the image actually renders
// instead.
function fixLazyLoadedImages(html) {
  if (!html) return html;
  return html.replace(/<img\b([^>]*)>/gi, (fullTag, attrs) => {
    const dataSrcMatch = attrs.match(/\sdata-src="([^"]*)"/i) || attrs.match(/\sdata-src='([^']*)'/i);
    if (!dataSrcMatch || !dataSrcMatch[1]) return fullTag;
    const hasRealSrc = /\ssrc="[^"]+"/.test(attrs) || /\ssrc='[^']+'/.test(attrs);
    if (hasRealSrc) return fullTag; // already has a working src — leave it alone
    return `<img${attrs} src="${dataSrcMatch[1]}">`;
  });
}

// The other half of the same lazy-loading pattern: a wrapper element
// reserves an image's vertical space up front (via a percentage
// padding-bottom, a well-known aspect-ratio trick) so the page doesn't
// jump around as images load in. That reserved space renders as pure
// blank gap regardless of whether the image inside it ever actually
// loads — which is exactly the large empty area between an article's
// title and its first paragraph. Safe to strip broadly: this specific
// inline-style pattern only ever exists for this one purpose.
function stripReservedImageSpace(html) {
  if (!html) return html;
  return html.replace(/\bpadding-bottom:\s*[\d.]+%;?/gi, '');
}

// Rewrites root-relative links/images (e.g. href="/products/...") to absolute
// URLs pointing back at the source site. Without this, a relative link in
// content pulled from another domain resolves against OUR domain once
// rendered in the app, producing a broken URL.
function makeLinksAbsolute(html, baseUrl) {
  if (!html) return html;
  return html
    .replace(/(href|src)="\/(?!\/)/gi, `$1="${baseUrl}/`)
    .replace(/(href|src)='\/(?!\/)/gi, `$1='${baseUrl}/`);
}

function stripTags(html) {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function formatDisplayDate(isoDate) {
  try {
    const d = new Date(isoDate);
    return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  } catch (e) {
    return '';
  }
}

function safeId(str) {
  return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
}

// ---------- Squarespace (samueldeuth.com) ----------
async function fetchSquarespacePosts() {
  const posts = [];
  let offset = null;

  for (let page = 0; page < MAX_SQUARESPACE_PAGES; page++) {
    const url = offset
      ? `${SQUARESPACE_BLOG_URL}?format=json-pretty&offset=${offset}`
      : `${SQUARESPACE_BLOG_URL}?format=json-pretty`;

    let res;
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'FollowingJesusApp/1.0' } });
    } catch (e) {
      break; // network failure — return what we have so far
    }
    if (!res.ok) break;

    let data;
    try {
      data = await res.json();
    } catch (e) {
      break; // Squarespace didn't return JSON (site config issue) — bail gracefully
    }

    const items = data.items || [];
    for (const item of items) {
      posts.push({
        id: `sd-${safeId(item.id || item.urlId || item.fullUrl)}`,
        source: 'samueldeuth.com',
        title: item.title || '',
        excerpt: stripTags(item.excerpt || '').slice(0, 200),
        image: item.assetUrl || (item.mainImage && item.mainImage.assetUrl) || null,
        url: `https://www.samueldeuth.com${item.fullUrl || ''}`,
        bodyHtml: stripReservedImageSpace(fixLazyLoadedImages(makeLinksAbsolute(sanitizeHtml(item.body || item.excerpt || ''), 'https://www.samueldeuth.com'))),
        date: item.publishOn ? new Date(item.publishOn).toISOString() : null
      });
    }

    if (data.pagination && data.pagination.nextPage && data.pagination.nextPageOffset) {
      offset = data.pagination.nextPageOffset;
    } else {
      break; // no more pages
    }
  }

  return posts;
}

// ---------- Shopify (followingjesusbook.com) ----------
function extractTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1] : '';
}
function extractAttr(xml, tag, attr) {
  const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 'i'));
  return m ? m[1] : '';
}
function decodeEntities(str) {
  return (str || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

async function fetchShopifyPosts() {
  let res;
  try {
    res = await fetch(SHOPIFY_ATOM_URL, { headers: { 'User-Agent': 'FollowingJesusApp/1.0' } });
  } catch (e) {
    return [];
  }
  if (!res.ok) return [];

  const xml = await res.text();
  const entries = xml.match(/<entry>[\s\S]*?<\/entry>/gi) || [];
  const posts = [];

  for (const entry of entries) {
    const title = decodeEntities(stripTags(extractTag(entry, 'title')));
    const link = extractAttr(entry, 'link', 'href');
    const published = extractTag(entry, 'published') || extractTag(entry, 'updated');
    const rawContent = decodeEntities(extractTag(entry, 'content'));
    const idTag = extractTag(entry, 'id');

    const imgMatch = rawContent.match(/<img[^>]*src="([^"]*)"/i);
    const slug = (link.split('/').pop() || idTag || Date.now().toString());

    posts.push({
      id: `fj-${safeId(slug)}`,
      source: 'followingjesusbook.com',
      title,
      excerpt: stripTags(rawContent).slice(0, 200),
      image: imgMatch ? imgMatch[1] : null,
      url: link,
      bodyHtml: stripReservedImageSpace(fixLazyLoadedImages(makeLinksAbsolute(sanitizeHtml(rawContent), 'https://followingjesusbook.com'))),
      date: published ? new Date(published).toISOString() : null
    });
  }

  return posts;
}

exports.handler = async function (event, context) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
    'Access-Control-Allow-Origin': '*'
  };

  try {
    const [sdPosts, fjPosts] = await Promise.all([
      fetchSquarespacePosts(),
      fetchShopifyPosts()
    ]);

    let all = [...sdPosts, ...fjPosts].filter(p => p.title && p.url);

    // newest first
    all.sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const db = b.date ? new Date(b.date).getTime() : 0;
      return db - da;
    });

    all = all.map(p => ({ ...p, displayDate: formatDisplayDate(p.date) }));

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ posts: all, fetchedAt: new Date().toISOString() })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Failed to fetch blog posts', message: err.message })
    };
  }
};
