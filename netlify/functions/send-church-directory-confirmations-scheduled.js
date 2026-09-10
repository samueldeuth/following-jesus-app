// netlify/functions/send-church-directory-confirmations-scheduled.js
//
// Runs hourly and sends the confirmation email to each pending church
// once it's genuinely 9am in THEIR OWN local time, on or after
// tomorrow's date (never later today, even for timezones where 9am
// hasn't happened yet today) -- a one-time, per-timezone-scheduled
// send, not a recurring thing.
//
// WHY THIS NEEDS ITS OWN FUNCTION: email has no built-in equivalent to
// OneSignal's delayed_option:'timezone' for push notifications -- there
// is no single API call that says "deliver this at 9am wherever the
// recipient is." This function does that itself: NAME_TIMEZONE_MAP
// below approximates each church's IANA timezone from their shipping
// address (state for US churches, country otherwise -- see the Python
// analysis this was generated from), and the hourly cron only sends
// once a recipient's own local clock actually reads 9am. A handful of
// US states genuinely span two zones (TX, FL, MI, etc.); this maps
// each state to whichever zone covers the clear majority of it -- a
// reasonable approximation for a one-time email, not perfectly precise
// for every address.
//
// THE "TOMORROW, NOT LATER TODAY" LOGIC: computed once at deploy time
// as a fixed target date (tomorrow's date in UTC, as this function was
// first written). A recipient only gets emailed once BOTH their own
// local calendar date has reached that target date AND their local
// hour is 9. This guarantees nobody gets it later today just because
// their zone hadn't hit 9am yet when this was first deployed -- everyone
// waits for their own genuine next-morning 9am.
//
// Safe to leave running indefinitely after everyone's been emailed --
// once every pending church has confirmation_email_sent_at set, this
// becomes a silent no-op each hour. Fine to remove the cron entry in
// netlify.toml later for cleanliness, but not required.
//
// REQUIRES:
//   RESEND_API_KEY
//   REMINDER_FUNCTION_SECRET (reused)

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';
const LOGO_URL = 'https://followingjesus.com/assets/FJ_logo_rectangle_Thinkific_v2.png';

// Fixed the moment this file was deployed -- everyone waits until their
// own local date reaches this, not just "next time it's 9am," so
// nobody gets it later TODAY just because their zone hadn't hit 9am
// yet when this shipped.
const TARGET_DATE = '2026-09-11';
const DEFAULT_TZ = 'America/Los_Angeles';

const NAME_TIMEZONE_MAP = {
  "Abide Church": "America/Los_Angeles",
  "Access Church": "America/Los_Angeles",
  "Amber Dillon- Awaken Church": "America/Los_Angeles",
  "Anthem Church": "America/New_York",
  "Appleton Gospel Church": "America/Chicago",
  "Authentic Church": "America/Los_Angeles",
  "Authentic Life Church": "America/Denver",
  "Awaken Church San Diego": "America/Los_Angeles",
  "AZ Vineyard Church": "America/Phoenix",
  "Bethany Church": "America/New_York",
  "Bethel Church": "America/Chicago",
  "Bethel Church of Tallmadge": "America/New_York",
  "Bettendorf Christian Church": "America/Chicago",
  "Bloom Church": "America/Chicago",
  "Bold church": "America/Los_Angeles",
  "Brandon Chapel COG": "America/New_York",
  "Bridge City Community Church": "America/New_York",
  "c/o Souls Church, Inc": "America/Chicago",
  "C3 Church": "America/Chicago",
  "C3 Church Belconnen": "Australia/Sydney",
  "C3 Church Bridgeman Downs": "Australia/Sydney",
  "C3 Church Darwin": "Australia/Sydney",
  "C3 Church Queanbeyan": "Australia/Sydney",
  "C3 church sandiego": "America/Los_Angeles",
  "C3 Church SWWA": "America/Los_Angeles",
  "Caldwell Assembly": "America/Chicago",
  "CALDWELL FIRST ASSEMBLY": "America/Chicago",
  "Calvary Church": "America/Chicago",
  "Calvary Church of Naperville": "America/Chicago",
  "Calvary Gospel Church": "America/New_York",
  "Campbell Ave. Baptist Church": "America/New_York",
  "Canvas Church": "America/Denver",
  "Cedar Park Church Lynnwood": "America/Los_Angeles",
  "Cedar Point Church": "America/Chicago",
  "Celebration Church": "America/Los_Angeles",
  "Champions Community Church": "America/Chicago",
  "Chapel": "America/Chicago",
  "Chapel North": "America/New_York",
  "Chapelhill Church": "America/New_York",
  "Chase Oaks Church": "America/Chicago",
  "Christ Alive Church": "America/New_York",
  "Christ Church of Central Arkansas": "America/Chicago",
  "Christ Church of Orlando": "America/New_York",
  "Christ Place Church": "America/Chicago",
  "Christ Unity Evangelistic Church": "America/Chicago",
  "Christ's Church A/G": "America/Phoenix",
  "Christian World Church": "America/Chicago",
  "Christwalk Church": "America/New_York",
  "Church": "America/Los_Angeles",
  "Church at the Grove": "America/New_York",
  "Church Eleven32": "America/Chicago",
  "Church of Grace": "America/Los_Angeles",
  "Church of Hope": "America/New_York",
  "Church of Jesus Christ Deliverance Center": "America/New_York",
  "Church of the Good Shepherd": "America/New_York",
  "Church of the Midcoast": "America/New_York",
  "Church Unlimited": "Australia/Sydney",
  "Church180 KW": "America/Toronto",
  "ChurchCMO": "America/Chicago",
  "Citipointe Church": "America/Chicago",
  "City Church Inc": "America/New_York",
  "City Gates Church": "Europe/London",
  "Cloverhill Church": "America/New_York",
  "Columbia Church of God": "America/New_York",
  "Columbia Heights Assembly": "America/Los_Angeles",
  "Community Fellowship Church": "America/Chicago",
  "Community Worship Center": "America/Los_Angeles",
  "Connect Church, Forney": "America/Chicago",
  "Connection Church": "America/New_York",
  "Cornerstone Christian Fellowship": "America/Los_Angeles",
  "Cornerstone Church": "America/Chicago",
  "Cornerstone Church International": "America/New_York",
  "Creative church": "America/Chicago",
  "Cross Church": "America/New_York",
  "Cross Community Church": "America/New_York",
  "Crossroads Church": "America/Chicago",
  "Crossroads Community Church": "America/New_York",
  "Daybreak Church": "America/New_York",
  "Desert Reign Church": "America/Los_Angeles",
  "Desert Springs Church": "America/Phoenix",
  "Destiny Christian Center": "America/Denver",
  "Destiny Church": "America/New_York",
  "Destiny Church Alabama": "America/Chicago",
  "Destiny Church Naples": "America/New_York",
  "Destiny Worship Center": "America/New_York",
  "Discover Church": "America/New_York",
  "District Church": "America/Los_Angeles",
  "DP City Church": "America/Los_Angeles",
  "Dwelling Place City Church": "America/Los_Angeles",
  "Eastridge Church": "America/Los_Angeles",
  "Elevate ministries Albuquerque": "America/Denver",
  "Elevation Church": "Australia/Sydney",
  "Elohim Christian Church": "America/New_York",
  "Ember Church": "America/Los_Angeles",
  "Encounter Church": "America/Chicago",
  "ESTwo47 Church": "America/New_York",
  "Evangel Assembly of God": "America/Chicago",
  "Expectation Church": "America/New_York",
  "Faith Assembly of God": "America/New_York",
  "Faith Family Church": "America/Los_Angeles",
  "FATHERS HOUSE CHURCH": "America/Los_Angeles",
  "Fellowship Church": "America/Los_Angeles",
  "Fellowship of Praise": "America/New_York",
  "First Assembly Church": "America/Toronto",
  "First Assembly of God": "America/Chicago",
  "First Baptist Church": "America/Chicago",
  "First Baptist Church of Flynn": "America/Chicago",
  "Florissant Assembly of God": "America/Chicago",
  "Fountain church": "America/Los_Angeles",
  "Free Chapel": "America/Los_Angeles",
  "Free Chapel Orange County": "America/Los_Angeles",
  "Free Chapel Worship Center": "America/New_York",
  "Freedom Fellowship Church": "America/New_York",
  "Freedom Life Church": "America/New_York",
  "freetrae church of god": "America/Chicago",
  "Gateway Church": "Australia/Sydney",
  "Gateway Church Tasmania": "Australia/Sydney",
  "Gateway City Church": "America/Denver",
  "Generation Church": "America/New_York",
  "GENERATION LIFE CHURCH": "America/Los_Angeles",
  "Generations Church": "America/New_York",
  "Genesis Church": "America/Chicago",
  "Georgetown Baptist Church": "America/Chicago",
  "Golden Gate Assembly of God": "America/New_York",
  "grace christian church": "America/New_York",
  "Grace Church of Rolla": "America/Chicago",
  "Grace Church Southern Pines": "America/New_York",
  "Grace Family Church": "America/New_York",
  "Grace Family Church ST Campus": "America/New_York",
  "Grace Fellowship": "America/New_York",
  "Grace Fellowship Church": "America/Chicago",
  "GraceValley Church": "America/New_York",
  "Greater Church": "America/New_York",
  "Harvest Church of Hampton": "America/New_York",
  "Harvest Time Assembly Of God": "America/Chicago",
  "Harvest Time Church": "America/Chicago",
  "Hayfield Assembly Of God": "America/New_York",
  "Heart Revolution Church": "America/Los_Angeles",
  "Heights Church": "America/Denver",
  "Hills Church": "America/Los_Angeles",
  "Hillside Christian Fellowship": "America/Los_Angeles",
  "Hillside Community Church": "America/New_York",
  "HIS CHURCH": "America/Phoenix",
  "Home Church": "America/Chicago",
  "Hope Alive Church": "America/Chicago",
  "Hope Church NW": "America/Los_Angeles",
  "Hope Village Church": "America/Los_Angeles",
  "Hutto Community Church": "America/Chicago",
  "Inspire Church": "Pacific/Honolulu",
  "iSEE CHURCH": "Australia/Sydney",
  "iSEE Church Hong Kong": "Asia/Hong_Kong",
  "James River Church": "America/Chicago",
  "Johnson Memorial Church": "America/New_York",
  "Kenosha City Church": "America/Chicago",
  "Keystone Church": "America/New_York",
  "Kings Church": "America/New_York",
  "Known Church": "America/Phoenix",
  "La Cima church": "America/Los_Angeles",
  "La Pine Christian Center": "America/Los_Angeles",
  "Lakeshore Church": "America/Chicago",
  "Launchpoint Church": "America/Chicago",
  "Life Church Bethlehem": "America/New_York",
  "Life Church Discipleship": "America/Chicago",
  "Life Church Ministries": "America/New_York",
  "Life Point Church": "America/Chicago",
  "LifeBridge Community Church": "America/Los_Angeles",
  "LIFECHURCH7": "America/Los_Angeles",
  "LifeHouse Church": "America/Los_Angeles",
  "Lifepointe Church": "America/New_York",
  "LifeStone Church": "America/New_York",
  "LiFT Church": "America/New_York",
  "Lighthouse Christian Church": "America/Los_Angeles",
  "lighthouse church": "America/Los_Angeles",
  "Lighthouse fellowship": "America/Phoenix",
  "Living Hope Church": "America/New_York",
  "Living Revival Ministries": "America/New_York",
  "Living Waters Church": "America/Phoenix",
  "Living Word Church": "America/New_York",
  "Locale Church": "America/New_York",
  "Love Church": "America/Chicago",
  "Luminous City Church": "America/Los_Angeles",
  "Magnolia Church": "America/Los_Angeles",
  "Meridian Church of God": "America/New_York",
  "Modern Church": "America/Chicago",
  "Mosaic Church Clarksville TN   Marriage Conference   August 2023": "America/Chicago",
  "Motor City Church": "America/New_York",
  "Mountain Home First Assembly": "America/Chicago",
  "Mountainview Church": "America/Los_Angeles",
  "MV Church": "America/Phoenix",
  "My city church HQ": "America/Chicago",
  "Nations United Church": "America/Chicago",
  "NB Church": "America/Los_Angeles",
  "Neighborhood Church": "America/Los_Angeles",
  "New Covenant Church": "America/Chicago",
  "New Hope Church": "America/New_York",
  "New Hope Community Church": "America/Los_Angeles",
  "New Life Assembly of God": "America/New_York",
  "New Life Worship Center": "America/Chicago",
  "New Song Church": "America/Los_Angeles",
  "New Tribe Church": "America/Chicago",
  "North Point Church": "America/Chicago",
  "North Shore Bible Church": "America/Los_Angeles",
  "NorthRock Church": "America/Chicago",
  "Oaks Church McKinney": "America/Chicago",
  "Oasis Church": "America/Denver",
  "Oasis LA Church": "America/Los_Angeles",
  "Oceana Ministries": "America/New_York",
  "OKC COMMUNITY CHURCH": "America/Chicago",
  "One Life Church, Inc": "America/Denver",
  "One Love Ministries/Waikiki Beach Chaplaincy": "Pacific/Honolulu",
  "Our City Church": "America/Los_Angeles",
  "Palmetto Pointe Church": "America/New_York",
  "Pathway Church": "America/Chicago",
  "Pathway Church Mid County": "America/Chicago",
  "People's Church": "America/Chicago",
  "Pine Grove Community Church": "America/Toronto",
  "Plummer Assembly of God": "America/Denver",
  "Production Assistant Grace Family Church": "America/New_York",
  "Purpose Church": "America/New_York",
  "Radiant Church Waco": "America/Chicago",
  "Red Cedar Church": "America/Chicago",
  "Refuge Church": "America/Chicago",
  "Reno Christian Fellowship": "America/Los_Angeles",
  "Rescue Church": "America/New_York",
  "Restoration Church ABQ": "America/Denver",
  "Restoration Church Bryan": "America/Chicago",
  "Resurrection Life Church": "America/Chicago",
  "Revival City Church": "Australia/Sydney",
  "Revival City Church Mount Barker": "Australia/Sydney",
  "Revivify Church": "America/New_York",
  "Revolve Church": "America/New_York",
  "River Church": "America/New_York",
  "River of Life Fellowship": "America/Los_Angeles",
  "Riverside Real Life Church": "America/Los_Angeles",
  "Roca Church": "America/Chicago",
  "Rock Church": "America/Phoenix",
  "Rock Hills Church": "America/Chicago",
  "RTLA Church": "America/Los_Angeles",
  "Samuel Deuth Ministries": "America/Los_Angeles",
  "Seattle Christian Church": "America/Los_Angeles",
  "Sendero Church": "America/New_York",
  "Shaping Lives Ministries": "America/New_York",
  "Simply Church": "America/Chicago",
  "Souls Church": "America/Chicago",
  "Souls Church, Inc": "America/Chicago",
  "Sound Life Church": "America/Los_Angeles",
  "South Burleson Baptist Church": "America/Chicago",
  "SpiritWord Church": "America/Chicago",
  "Springfield Assembly of God": "America/New_York",
  "Story Church": "America/Los_Angeles",
  "Storyside Church": "America/New_York",
  "Strong Tower Church": "America/Chicago",
  "StrongPoint Church": "America/New_York",
  "Summit Church": "America/New_York",
  "SURFCiTY Church": "Australia/Sydney",
  "The Bridge Church": "America/Chicago",
  "The C3 Church": "America/New_York",
  "The Cause Church": "America/Los_Angeles",
  "The Church Covington": "America/New_York",
  "The church of Twin Falls": "America/Denver",
  "the Church of Twin Falls Idaho": "America/Denver",
  "The Cure Church": "America/Chicago",
  "The Edge Church": "America/Chicago",
  "The Gathering Church": "America/New_York",
  "The Gathering Covenant Church": "America/Los_Angeles",
  "The Lakeside Church": "America/New_York",
  "The River Church": "America/Chicago",
  "The Rock Church": "America/Los_Angeles",
  "The Rose Church": "America/Los_Angeles",
  "The Tabernacle Church": "America/Chicago",
  "The Table Church": "America/Chicago",
  "theChapel": "America/New_York",
  "TimberCreek Church": "America/Chicago",
  "Together Church": "America/Phoenix",
  "Toni McCleary c/o The Cure Church lawrence": "America/Chicago",
  "Trademark Church": "America/Chicago",
  "Transformation Church": "America/New_York",
  "Trinity Church Harlem": "America/New_York",
  "Trinity Ministries Group": "America/Los_Angeles",
  "True North Church": "America/Anchorage",
  "Valley Fellowship Church": "America/Denver",
  "Vessel Church": "America/Chicago",
  "Victory Church": "America/Chicago",
  "Village Church": "America/Chicago",
  "Vima Church": "America/Chicago",
  "VIVE Church": "America/Chicago",
  "VIVE Church Chicago": "America/Chicago",
  "Warriors Hope Ministry": "America/New_York",
  "WaterVue Church": "America/New_York",
  "Wesleyan Church": "America/Chicago",
  "Westover Hills Church": "America/Chicago",
  "Whites Road Pentecostal Church": "America/Toronto",
  "Willmar Assembly of God": "America/Chicago",
  "Word of Life Church": "America/Chicago",
  "Word of Life Church - Highland Colony Campus": "America/Chicago",
  "X Church": "America/New_York"
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function localDateAndHour(timezone) {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hour12: false
  }).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type)?.value;
  const date = `${get('year')}-${get('month')}-${get('day')}`;
  const hour = parseInt(get('hour'), 10) % 24;
  return { date, hour };
}

function buildEmailHtml(churchName, confirmToken) {
  const confirmUrl = `${APP_URL}/confirm-church-directory-entry?token=${confirmToken}`;
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${LOGO_URL}" alt="Following Jesus" style="max-width:200px;width:100%;height:auto;" />
    </div>
    <p>Hi there,</p>
    <p>We're building a new "Find a Church" feature in the Following Jesus app — it helps people get connected, planted, and serving in a local church near them.</p>
    <p>We'd love to feature <strong>${escapeHtml(churchName)}</strong> in our church directory. Can you take a second to confirm your info is correct?</p>
    <p style="margin: 28px 0;">
      <a href="${confirmUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Confirm Our Info →</a>
    </p>
    <p>Thank you,<br>Following Jesus Team</p>
  </div>
</body>
</html>`;
}

exports.handler = async function () {
  const resendApiKey = process.env.RESEND_API_KEY;
  const functionSecret = process.env.REMINDER_FUNCTION_SECRET;
  const missing = ['RESEND_API_KEY', 'REMINDER_FUNCTION_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `Missing environment variables: ${missing.join(', ')}` }) };
  }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_pending_churches_needing_email`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: functionSecret })
  });
  if (!rpcRes.ok) {
    return { statusCode: 502, body: `Could not look up pending churches: ${await rpcRes.text()}` };
  }
  const pendingChurches = await rpcRes.json();

  const successful = [];
  const skipped = [];
  const failures = [];
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (const church of pendingChurches) {
    const timezone = NAME_TIMEZONE_MAP[church.name] || DEFAULT_TZ;
    const { date, hour } = localDateAndHour(timezone);

    if (date < TARGET_DATE || hour !== 9) {
      skipped.push({ name: church.name, timezone, localDate: date, localHour: hour });
      continue;
    }

    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${resendApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM_EMAIL,
          to: church.contact_email,
          reply_to: 'info@followingjesusbook.com',
          subject: `Feature ${church.name} in our new church directory`,
          html: buildEmailHtml(church.name, church.confirmation_token)
        })
      });
      if (res.ok) {
        await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_confirmation_email_sent`, {
          method: 'POST',
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ caller_secret: functionSecret, p_id: church.id })
        });
        successful.push(church.contact_email);
      } else {
        failures.push({ email: church.contact_email, error: await res.text() });
      }
    } catch (e) {
      failures.push({ email: church.contact_email, error: e.message });
    }
    await sleep(150);
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ sentThisRun: successful.length, stillWaiting: skipped.length, failed: failures.length, failures })
  };
};
