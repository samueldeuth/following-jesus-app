// DRY-RUN diagnostic only -- NEVER calls Resend, NEVER sends a single
// email. Exists purely to verify the recipient-fetching/pagination/
// dedup logic in isolation, at zero cost, before trusting it with a
// real send again.
//
// Calls the exact same fetchAllRpcRows() used by the real background
// sender, against the exact same RPC, with the exact same pagination
// logic -- so if the underlying bug (unstable/broken pagination
// inflating the recipient count) is still present, this will surface
// it directly. If it's fixed, `total` here should land close to the
// real subscriber count (e.g. ~7,067), not anywhere near 100,000.
//
// Same auth gate as the real send functions (super_admin or
// church_admin only) since this still reads real subscriber emails.
//
// Regular (non-background) function -- expected to finish in well
// under Netlify's sync execution window for any realistic list size;
// if it doesn't finish quickly, that itself is diagnostic information
// (the pagination loop is likely still broken).

const {
  SUPABASE_URL, SUPABASE_ANON_KEY,
} = require('./lib/broadcast-email-shared');

const SUPABASE_PAGE_SIZE = 1000;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const authHeader = event.headers.authorization || event.headers.Authorization;
  const token = authHeader && authHeader.replace(/^Bearer\s+/i, '');
  if (!token) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Missing session token' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }
  const { audience, churchId, courseId } = body;

  // Same auth check as the real send path.
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
  }
  const user = await userRes.json();
  if (!user?.id) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const profiles = profileRes.ok ? await profileRes.json() : [];
  const callerRole = profiles[0]?.role;
  if (callerRole !== 'super_admin' && callerRole !== 'church_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };
  }

  let rpcName, rpcParams;
  if (callerRole === 'church_admin') {
    rpcName = 'get_my_church_broadcast_recipients';
    rpcParams = {};
  } else if (audience === 'subscribers') {
    rpcName = 'get_subscriber_list_recipients';
    rpcParams = {};
  } else {
    rpcName = 'get_broadcast_recipients';
    rpcParams = { p_church_id: churchId || null, p_course_id: courseId || null };
  }

  // Deliberately capped much lower than the real 100 -- if the bug is
  // still present, we'll see it clearly well before this, and there's
  // no reason to burn 100 round-trips just to prove a point already
  // proven by page 3 or 4.
  const DIAGNOSTIC_MAX_PAGES = 15;

  const pageSizes = [];
  const allRows = [];
  let offset = 0;
  let error = null;

  try {
    for (let page = 0; page < DIAGNOSTIC_MAX_PAGES; page++) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_ANON_KEY,
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...rpcParams, p_limit: SUPABASE_PAGE_SIZE, p_offset: offset }),
      });

      if (!res.ok) {
        error = `RPC ${rpcName} failed at offset ${offset}: ${res.status}`;
        break;
      }

      const pageRows = await res.json();
      if (!Array.isArray(pageRows) || pageRows.length === 0) {
        pageSizes.push(0);
        break;
      }

      pageSizes.push(pageRows.length);
      allRows.push(...pageRows);

      if (pageRows.length < SUPABASE_PAGE_SIZE) break;
      offset += SUPABASE_PAGE_SIZE;
    }
  } catch (err) {
    error = err.message;
  }

  const rawCount = allRows.length;

  // Dedup by email -- same logic as the real fetchAllRpcRows.
  const seen = new Set();
  let dupesFound = 0;
  for (const row of allRows) {
    const key = (row.email || '').toLowerCase().trim();
    if (key) {
      if (seen.has(key)) dupesFound++;
      else seen.add(key);
    }
  }
  const dedupedCount = seen.size;

  const hitPageCap = pageSizes.length === DIAGNOSTIC_MAX_PAGES && pageSizes[pageSizes.length - 1] === SUPABASE_PAGE_SIZE;

  return {
    statusCode: 200,
    body: JSON.stringify({
      rpcName,
      pagesFetched: pageSizes.length,
      pageSizes,
      rawRowCount: rawCount,
      dedupedUniqueEmails: dedupedCount,
      duplicateRowsFound: dupesFound,
      hitDiagnosticPageCap: hitPageCap,
      error,
      verdict: hitPageCap
        ? 'STILL BROKEN: every page returned a full 1000 rows with no end in sight -- do not send yet.'
        : (dedupedCount > 0 && dedupedCount < 10000
            ? `LOOKS FIXED: settled at ${dedupedCount} unique recipients after ${pageSizes.length} page(s).`
            : 'INCONCLUSIVE: check the numbers above manually.'),
    }, null, 2),
  };
};
