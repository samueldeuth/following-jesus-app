// Runs daily. Pulls the daily Sales Report from App Store Connect
// (the same report shown in Payments and Financial Reports) and stores
// this app's numbers for the day in app_download_stats:
//   new_installs = first-time downloads only (what the admin dashboard shows)
//   reinstalls   = re-downloads (someone installing again, e.g. a new phone)
//   downloads    = every unit Apple reports, including app updates (legacy column)
// Apple's "Units" column counts first-time downloads, re-downloads AND
// updates together, which is what inflated the old numbers. The
// "Product Type Identifier" column tells them apart: 1/1F/1T/F1 = first-time
// download, 3/3F/3T/F3 = re-download, 7/7F/7T = update.
//
// Each run also fills in older days (BACKFILL_DAYS_PER_RUN at a time,
// walking backward from the oldest day already done, up to one year back)
// so the all-time total fills in over the first couple of weeks.
//
// Apple's daily sales data isn't considered final until roughly two
// days after the fact, so this always fetches (and overwrites) the
// count for two days ago rather than yesterday -- that naturally lets
// each day's number get corrected once before we stop touching it.
//
// Requires these Netlify environment variables (Functions scope):
//   APP_STORE_CONNECT_KEY_ID
//   APP_STORE_CONNECT_ISSUER_ID
//   APP_STORE_CONNECT_PRIVATE_KEY   (full contents of the .p8 file)
//   APP_STORE_CONNECT_VENDOR_NUMBER
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const crypto = require('crypto');
const zlib = require('zlib');

// Talks to Supabase's REST API (PostgREST) directly with plain fetch,
// rather than the @supabase/supabase-js package -- this repo's
// package.json doesn't declare that dependency, so pulling it in here
// broke Netlify's function bundling for the whole site. No dependency
// needed at all for a single upsert call.
async function upsertDownloadStat(row) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/app_download_stats?on_conflict=platform,stat_date`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(row)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase upsert failed (${response.status}): ${text}`);
  }
}

// The four Apple credentials live in a locked-down Supabase table
// (service-role only, no RLS policy grants it to anyone else) rather
// than as Netlify environment variables. Netlify Functions share a
// hard 4KB total env var budget across every function on the whole
// site (an AWS Lambda limit) -- these four values alone (especially
// the private key) were enough to push every one of this site's 50+
// other functions over that limit and break the entire deploy. Fetching
// them from the database at call time sidesteps the limit completely.
async function getAppleCredentials() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/app_store_credentials?select=credential_name,credential_value&credential_name=in.(APP_STORE_CONNECT_KEY_ID,APP_STORE_CONNECT_ISSUER_ID,APP_STORE_CONNECT_PRIVATE_KEY,APP_STORE_CONNECT_VENDOR_NUMBER)`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Could not load Apple credentials (${response.status}): ${text}`);
  }
  const rows = await response.json();
  const creds = {};
  rows.forEach(r => { creds[r.credential_name] = r.credential_value; });
  const missing = ['APP_STORE_CONNECT_KEY_ID', 'APP_STORE_CONNECT_ISSUER_ID', 'APP_STORE_CONNECT_PRIVATE_KEY', 'APP_STORE_CONNECT_VENDOR_NUMBER']
    .filter(name => !creds[name]);
  if (missing.length) {
    throw new Error(`Missing Apple credentials in app_store_credentials: ${missing.join(', ')}`);
  }
  return creds;
}

// The numeric Apple ID for the Following Jesus app, from its App Store
// Connect URL (appstoreconnect.apple.com/apps/1460179217/...). Sales
// reports cover the whole vendor account, so this is what isolates
// just this app's rows from anyone else's under the same account.
const OUR_APPLE_ID = '1460179217';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Builds a short-lived JWT signed with the App Store Connect API key,
// per Apple's documented auth scheme (ES256, 20-minute max lifetime).
function buildAppleJwt(creds) {
  const header = { alg: 'ES256', kid: creds.APP_STORE_CONNECT_KEY_ID, typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: creds.APP_STORE_CONNECT_ISSUER_ID,
    iat: now,
    exp: now + 1200,
    aud: 'appstoreconnect-v1'
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sign = crypto.createSign('SHA256');
  sign.update(signingInput);
  sign.end();
  // Apple wants a raw (IEEE P1363) ES256 signature, not the DER format
  // Node produces by default. The stored credential is base64 of the
  // whole .p8 file's contents, not the raw multi-line PEM text -- an
  // earlier version stored the actual PEM directly, but typing real
  // newlines into Supabase's SQL editor silently triggered its
  // code-editor auto-indent, corrupting the key with extra whitespace
  // on every line after the first. Base64 is a single unbroken line,
  // so there's nothing left for an editor to "helpfully" reformat.
  const pem = Buffer.from(creds.APP_STORE_CONNECT_PRIVATE_KEY, 'base64').toString('utf-8');
  const keyObject = crypto.createPrivateKey(pem);
  const signature = sign.sign({ key: keyObject, dsaEncoding: 'ieee-p1363' });
  return `${signingInput}.${base64url(signature)}`;
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

const FIRST_TIME_TYPES = new Set(['1', '1F', '1T', 'F1']);
const REDOWNLOAD_TYPES = new Set(['3', '3F', '3T', 'F3']);
const BACKFILL_DAYS_PER_RUN = 15;
const MAX_HISTORY_DAYS = 360;     // Apple only keeps daily reports for about a year
const RECENT_DAYS_TO_REFRESH = 3; // re-fetch the last few finalized days so corrections land

async function oldestDoneDate() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/app_download_stats?platform=eq.ios&new_installs=not.is.null&select=stat_date&order=stat_date.asc&limit=1`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows.length ? rows[0].stat_date : null;
}

// Fetches one day's report and returns the row to store, or null if Apple
// returned something unexpected for that day (so one bad day can't stop the rest).
async function fetchDay(jwt, vendor, dateStr) {
  const url = `https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=DAILY&filter[reportDate]=${dateStr}&filter[reportType]=SALES&filter[reportSubType]=SUMMARY&filter[vendorNumber]=${vendor}&filter[version]=1_0`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });
  const now = new Date().toISOString();

  // Apple omits the report entirely on days with zero activity, so a 404
  // means zero downloads, not an error.
  if (response.status === 404) {
    return { platform: 'ios', stat_date: dateStr, downloads: 0, new_installs: 0, reinstalls: 0, fetched_at: now };
  }
  if (!response.ok) {
    const text = await response.text();
    console.error(`Apple API error ${response.status} for ${dateStr}: ${text}`);
    return null;
  }

  const tsv = zlib.gunzipSync(Buffer.from(await response.arrayBuffer())).toString('utf-8');
  const lines = tsv.split('\n').filter(Boolean);
  const headers = lines[0].split('\t');
  const appleIdCol = headers.indexOf('Apple Identifier');
  const unitsCol = headers.indexOf('Units');
  const typeCol = headers.indexOf('Product Type Identifier');
  if (appleIdCol === -1 || unitsCol === -1 || typeCol === -1) {
    console.error(`Unexpected sales report columns for ${dateStr}: ${headers.join(', ')}`);
    return null;
  }

  let total = 0, firstTime = 0, reDownloads = 0;
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols[appleIdCol] !== OUR_APPLE_ID) continue;
    const units = parseInt(cols[unitsCol], 10) || 0;
    const type = (cols[typeCol] || '').trim();
    total += units;
    if (FIRST_TIME_TYPES.has(type)) firstTime += units;
    else if (REDOWNLOAD_TYPES.has(type)) reDownloads += units;
  }
  return { platform: 'ios', stat_date: dateStr, downloads: total, new_installs: firstTime, reinstalls: reDownloads, fetched_at: now };
}

exports.handler = async () => {
  try {
    const creds = await getAppleCredentials();
    const jwt = buildAppleJwt(creds);
    const vendor = creds.APP_STORE_CONNECT_VENDOR_NUMBER;

    const dayOffset = (n) => {
      const d = new Date();
      d.setUTCDate(d.getUTCDate() - n);
      return formatDate(d);
    };

    // Recent days (Apple's numbers settle about two days after the fact).
    const dates = [];
    for (let n = 2; n < 2 + RECENT_DAYS_TO_REFRESH; n++) dates.push(dayOffset(n));

    // Backfill: keep walking backward from the oldest day already done.
    const oldest = await oldestDoneDate();
    let startOffset = 2 + RECENT_DAYS_TO_REFRESH;
    if (oldest) {
      const msPerDay = 24 * 3600 * 1000;
      const now = new Date();
      const todayMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      const oldestOffset = Math.round((todayMidnight - new Date(oldest + 'T00:00:00Z').getTime()) / msPerDay);
      startOffset = Math.max(startOffset, oldestOffset + 1);
    }
    for (let n = startOffset; n < startOffset + BACKFILL_DAYS_PER_RUN && n <= MAX_HISTORY_DAYS; n++) {
      dates.push(dayOffset(n));
    }

    const rows = [];
    for (const dateStr of dates) {
      const row = await fetchDay(jwt, vendor, dateStr);
      if (row) rows.push(row);
    }

    if (rows.length) await upsertDownloadStat(rows);

    const summary = rows.map(r => `${r.stat_date}: ${r.new_installs} new / ${r.reinstalls} re / ${r.downloads} units`).join('; ');
    console.log(`iOS stats updated for ${rows.length} days. ${summary}`);
    return { statusCode: 200, body: `iOS stats updated for ${rows.length} days.` };
  } catch (err) {
    console.error('Apple downloads fetch failed:', err);
    return { statusCode: 500, body: err.message };
  }
};

exports.config = {
  schedule: '@daily'
};
