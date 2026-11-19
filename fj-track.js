/* fj-track.js
 * Privacy-friendly visit and click counter for followingjesus.com.
 *
 * What it records (and nothing more): an anonymous random visitor id, a per-visit id,
 * the page path, where the visitor came from (search / social / email / referral / app /
 * direct), device type, and, on pages that opt in, which buttons and links were tapped.
 * No names, emails, IP addresses or cookies. Country is added on the server by Netlify.
 *
 * It can never affect a page: everything is wrapped in try/catch, nothing waits on it,
 * and it stays silent for bots, admin pages, and anyone who sets Do Not Track.
 *
 * To leave your OWN visits out: open https://followingjesus.com/?notrack=1 once on each
 * device ("?notrack=0" turns counting back on).
 *
 * Click tracking:
 *   - Pages that set  window.FJ_TRACK_CLICKS = 'all'  (the public homepage) count every
 *     link and button.
 *   - Everywhere else only elements that carry a  data-track="Label"  attribute are counted,
 *     so nothing like a student's name ever gets recorded.
 */
(function () {
  try {
    if (window.__fjTrack) return;
    window.__fjTrack = true;

    var ENDPOINT = '/.netlify/functions/track-site-event';
    var ua = navigator.userAgent || '';
    var loc = window.location;

    // ---- who we ignore ----
    if (/bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|bingpreview|monitor|uptime/i.test(ua)) return;
    if (navigator.doNotTrack === '1' || window.doNotTrack === '1') return;
    if (!/(^|\.)followingjesus\.com$/i.test(loc.hostname) && !window.__FJ_TRACK_TEST) return;
    if (/^\/(admin|dashboard|leader|leader-approval|course-reminder-unsubscribe)(\/|$)/i.test(loc.pathname)) return;

    function store(kind) { try { return window[kind]; } catch (e) { return null; } }
    var ls = store('localStorage'), ss = store('sessionStorage');
    function get(s, k) { try { return s ? s.getItem(k) : null; } catch (e) { return null; } }
    function set(s, k, v) { try { if (s) s.setItem(k, v); } catch (e) {} }

    // self-exclusion switch
    var qs = new URLSearchParams(loc.search);
    if (qs.get('notrack') === '1') set(ls, 'fj_no_track', '1');
    if (qs.get('notrack') === '0') { try { ls && ls.removeItem('fj_no_track'); } catch (e) {} }
    if (get(ls, 'fj_no_track') === '1') return;

    function rid() {
      var a = new Uint8Array(12);
      (window.crypto || window.msCrypto).getRandomValues(a);
      return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    }
    var memVid = rid(), memSid = rid();
    var vid = get(ls, 'fj_vid');
    if (!vid) { vid = memVid; set(ls, 'fj_vid', vid); }
    var sid = get(ss, 'fj_sid'), first = false;
    if (!sid) { sid = memSid; first = true; set(ss, 'fj_sid', sid); }

    // ---- where did they come from? ----
    var ownHost = /(^|\.)followingjesus\.com$/i;
    var refHost = '';
    try { refHost = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '').toLowerCase() : ''; } catch (e) {}
    var utmSource = (qs.get('utm_source') || '').toLowerCase(), utmMedium = (qs.get('utm_medium') || '').toLowerCase();
    var utmCampaign = qs.get('utm_campaign') || '';
    var inApp = /gonative|median/i.test(ua) || utmSource === 'app' || qs.get('src') === 'app';

    function classify() {
      if (inApp) return 'app';
      if (utmMedium === 'email' || utmSource === 'email' || utmMedium === 'newsletter') return 'email';
      if (/^(google|bing|duckduckgo|yahoo|ecosia|brave|baidu|yandex|startpage|search\.)/i.test(refHost) || /(^|\.)(google|bing|duckduckgo|yahoo|ecosia|baidu|yandex)\./i.test(refHost)) return 'search';
      if (/(chatgpt|openai|perplexity|claude\.ai|gemini\.google|copilot\.microsoft)/i.test(refHost) || utmSource === 'chatgpt.com') return 'ai';
      if (/(facebook|instagram|fb\.com|l\.messenger|t\.co|twitter|(^|\.)x\.com|youtube|youtu\.be|linkedin|pinterest|tiktok|reddit)/i.test(refHost) || utmMedium === 'social') return 'social';
      if (!refHost || ownHost.test(refHost)) return 'direct';
      return 'referral';
    }
    var source = classify();
    var device = /ipad|tablet/i.test(ua) ? 'tablet' : (/mobi|android|iphone|ipod/i.test(ua) ? 'mobile' : 'desktop');

    function cleanPath() {
      var p = (loc.pathname || '/').toLowerCase().replace(/\/+$/, '') || '/';
      return p.slice(0, 120);
    }

    function send(payload) {
      try {
        var body = JSON.stringify(payload);
        if (navigator.sendBeacon) {
          if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
        }
        fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      } catch (e) {}
    }

    function base(event, firstFlag) {
      return {
        event: event, visitor_id: vid, session_id: sid, first: !!firstFlag, path: cleanPath(),
        source: source, referrer_host: (firstFlag && refHost && !ownHost.test(refHost)) ? refHost : '',
        utm_source: firstFlag ? utmSource : '', utm_medium: firstFlag ? utmMedium : '', utm_campaign: firstFlag ? utmCampaign : '',
        device: device, in_app: inApp
      };
    }

    // ---- page view ----
    setTimeout(function () { send(base('view', first)); }, 0);

    // ---- clicks ----
    var allClicks = window.FJ_TRACK_CLICKS === 'all';
    var clicksSent = 0, lastKey = '', lastAt = 0;
    function areaOf(el) {
      var a = el.closest('[data-area]');
      if (a) return a.getAttribute('data-area').slice(0, 40);
      if (el.closest('.em-box, .em-back')) return 'email popup';
      if (el.closest('header')) return 'header';
      if (el.closest('footer')) return 'footer';
      if (el.closest('.hero')) return 'hero';
      var s = el.closest('section[id]');
      return s ? s.id.slice(0, 40) : '';
    }
    document.addEventListener('click', function (e) {
      try {
        if (clicksSent >= 40) return;
        var t = e.target;
        if (!t || !t.closest) return;
        var el = allClicks ? t.closest('[data-track], a[href], button') : t.closest('[data-track]');
        if (!el) return;
        if (el.closest('input, textarea, select, form')) { if (!el.hasAttribute('data-track')) return; }
        var heading = el.querySelector && el.querySelector('h1,h2,h3,h4');
        var label = (el.getAttribute('data-track') || el.getAttribute('aria-label') || (heading && heading.textContent) || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60);
        if (!label) return;
        var key = label + '|' + areaOf(el), now = Date.now();
        if (key === lastKey && now - lastAt < 500) return;
        lastKey = key; lastAt = now; clicksSent++;
        var p = base('click', false);
        p.label = label; p.area = areaOf(el);
        send(p);
      } catch (err) {}
    }, true);
  } catch (e) { /* tracking must never break a page */ }
})();
