// Runs daily. Pulls the daily Sales Report from App Store Connect
// (the same report shown in Payments and Financial Reports) and stores
// this app's total download count for the day in app_download_stats.
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

exports.handler = async () => {
  try {
    const creds = await getAppleCredentials();
    const jwt = buildAppleJwt(creds);

    const reportDate = new Date();
    reportDate.setUTCDate(reportDate.getUTCDate() - 2);
    const dateStr = formatDate(reportDate);

    const url = `https://api.appstoreconnect.apple.com/v1/salesReports?filter[frequency]=DAILY&filter[reportDate]=${dateStr}&filter[reportType]=SALES&filter[reportSubType]=SUMMARY&filter[vendorNumber]=${creds.APP_STORE_CONNECT_VENDOR_NUMBER}&filter[version]=1_0`;

    const response = await fetch(url, { headers: { Authorization: `Bearer ${jwt}` } });

    if (response.status === 404) {
      // Apple omits the report entirely on days with zero activity for
      // this vendor number, rather than returning a report full of
      // zeros -- so a 404 here means zero downloads, not an error.
      await upsertDownloadStat(
        { platform: 'ios', stat_date: dateStr, downloads: 0, fetched_at: new Date().toISOString() }
      );
      console.log(`No Apple sales report for ${dateStr} -- recorded 0 downloads.`);
      return { statusCode: 200, body: `No report for ${dateStr}, recorded 0.` };
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Apple API error ${response.status}: ${text}`);
    }

    const gzipped = Buffer.from(await response.arrayBuffer());
    const tsv = zlib.gunzipSync(gzipped).toString('utf-8');
    const lines = tsv.split('\n').filter(Boolean);
    const headers = lines[0].split('\t');
    const appleIdCol = headers.indexOf('Apple Identifier');
    const unitsCol = headers.indexOf('Units');

    if (appleIdCol === -1 || unitsCol === -1) {
      throw new Error(`Unexpected sales report columns: ${headers.join(', ')}`);
    }

    let totalDownloads = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split('\t');
      if (cols[appleIdCol] === OUR_APPLE_ID) {
        totalDownloads += parseInt(cols[unitsCol], 10) || 0;
      }
    }

    await upsertDownloadStat(
      { platform: 'ios', stat_date: dateStr, downloads: totalDownloads, fetched_at: new Date().toISOString() }
    );

    console.log(`iOS downloads for ${dateStr}: ${totalDownloads}`);
    return { statusCode: 200, body: `iOS downloads for ${dateStr}: ${totalDownloads}` };
  } catch (err) {
    console.error('Apple downloads fetch failed:', err);
    return { statusCode: 500, body: err.message };
  }
};

exports.config = {
  schedule: '@daily'
};
