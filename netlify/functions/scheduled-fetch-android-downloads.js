// Runs daily. Downloads this month's install-stats CSV from the
// private Cloud Storage bucket Google Play automatically maintains for
// this developer account, and stores one row per day into
// app_download_stats. Re-fetching the whole month each run (rather
// than just "today") is deliberate -- Google backfills/corrects a day
// or two after the fact, and upserting the full month lets those
// corrections land automatically without any extra logic.
//
// Note: this is NOT the newer Play Developer Reporting API
// (playdeveloperreporting.googleapis.com) -- that one only covers
// Android vitals (crash rate, ANR rate, etc.), not install counts.
// Install/download data only exists in this older bulk-CSV export.
//
// Requires these Netlify environment variables (Functions scope):
//   GOOGLE_PLAY_SERVICE_ACCOUNT_JSON   (full contents of the service account .json key)
//   SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY

const crypto = require('crypto');

// Talks to Supabase's REST API (PostgREST) directly with plain fetch,
// rather than the @supabase/supabase-js package -- this repo's
// package.json doesn't declare that dependency, so pulling it in here
// broke Netlify's function bundling for the whole site. No dependency
// needed at all for a single bulk upsert call.
async function upsertDownloadStats(rows) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/app_download_stats?on_conflict=platform,stat_date`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase upsert failed (${response.status}): ${text}`);
  }
}

// The Google service account key lives in the same locked-down
// Supabase table as the Apple credentials, rather than as a Netlify
// environment variable -- see the matching comment in
// scheduled-fetch-apple-downloads.js for why (the shared 4KB Lambda
// env var budget across every function on the site).
async function getGoogleServiceAccountKey() {
  const url = `${process.env.SUPABASE_URL}/rest/v1/app_store_credentials?select=credential_value&credential_name=eq.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON`;
  const response = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Could not load Google Play credentials (${response.status}): ${text}`);
  }
  const rows = await response.json();
  if (!rows.length) {
    throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON not found in app_store_credentials');
  }
  return JSON.parse(rows[0].credential_value);
}

// From Play Console -> Download reports -> Statistics -> "Copy Cloud
// Storage URI" next to Installs.
const BUCKET = 'pubsite_prod_7377240062662882401';
const PACKAGE_NAME = 'com.customchurchapps.appazzfb19a';

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Exchanges the service account key for a short-lived OAuth access
// token, per Google's standard JWT-bearer service account flow.
async function getGoogleAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/devstorage.read_only',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  };
  const signingInput = `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(payload))}`;
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(signingInput);
  sign.end();
  // Parsing the PEM into a KeyObject first (rather than handing sign()
  // the raw string) avoids an "unsupported" DECODER error seen on
  // Node 24's OpenSSL when signing straight from a string key -- same
  // fix as the Apple function's identical pattern.
  const keyObject = crypto.createPrivateKey(key.private_key);
  const signature = sign.sign(keyObject);
  const assertion = `${signingInput}.${base64url(signature)}`;

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  });
  const data = await response.json();
  if (!data.access_token) throw new Error('Failed to get Google access token: ' + JSON.stringify(data));
  return data.access_token;
}

// Google's bulk reports are UTF-16 with a byte-order mark -- plain
// utf-8 decoding would garble every character.
function decodeReportBuffer(buffer) {
  if (buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.toString('utf16le').slice(1);
  }
  return buffer.toString('utf8');
}

// A tiny CSV line splitter -- this report's fields are simple
// (quoted strings, commas, no embedded newlines), so a full CSV
// parser dependency isn't needed.
function parseCsvLine(line) {
  return line.split(',').map(cell => cell.replace(/^"|"$/g, ''));
}

exports.handler = async () => {
  try {
    const key = await getGoogleServiceAccountKey();
    const accessToken = await getGoogleAccessToken(key);

    const now = new Date();
    const yearMonth = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const objectName = `stats/installs/installs_${PACKAGE_NAME}_${yearMonth}_overview.csv`;

    const fileUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectName)}?alt=media`;
    const response = await fetch(fileUrl, { headers: { Authorization: `Bearer ${accessToken}` } });

    if (response.status === 404) {
      console.log(`No installs report yet for ${yearMonth}.`);
      return { statusCode: 200, body: `No installs report yet for ${yearMonth}.` };
    }
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Google Cloud Storage error ${response.status}: ${text}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const csv = decodeReportBuffer(buffer);
    const lines = csv.split('\n').map(l => l.trim()).filter(Boolean);
    const headers = parseCsvLine(lines[0]);
    const dateCol = headers.indexOf('Date');
    const installsCol = headers.indexOf('Daily Device Installs');

    if (dateCol === -1 || installsCol === -1) {
      throw new Error(`Unexpected installs report columns: ${headers.join(', ')}`);
    }

    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = parseCsvLine(lines[i]);
      const dateStr = cols[dateCol];
      if (!dateStr) continue;
      rows.push({
        platform: 'android',
        stat_date: dateStr,
        downloads: parseInt(cols[installsCol], 10) || 0,
        fetched_at: new Date().toISOString()
      });
    }

    if (rows.length) {
      await upsertDownloadStats(rows);
    }

    console.log(`Updated ${rows.length} days of Android installs for ${yearMonth}.`);
    return { statusCode: 200, body: `Updated ${rows.length} days of Android installs for ${yearMonth}.` };
  } catch (err) {
    console.error('Android downloads fetch failed:', err);
    return { statusCode: 500, body: err.message };
  }
};

exports.config = {
  schedule: '@daily'
};
