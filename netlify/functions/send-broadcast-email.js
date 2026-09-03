// FAST, synchronous function -- handles auth, the test-send-to-myself
// path (a single email, genuinely instant), and kicking off a real send
// as a background job. Does NOT do the actual bulk sending itself
// anymore -- a send to thousands of people cannot complete within any
// synchronous serverless function's execution window, confirmed by a
// real 504 timeout partway through an actual send to ~9,000 people.
// See send-broadcast-email-background.js for the part that actually
// works through the list.
//
// Auth: the admin's OWN Supabase session token, same pattern as
// send-legacy-student-invite.js.
//
// REQUIRES: RESEND_API_KEY (already set)

const {
  SUPABASE_URL, SUPABASE_ANON_KEY, FROM_ADDRESS,
  buildEmailHtml, callRpc,
} = require('./lib/broadcast-email-shared');

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
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  const { subject, message, imageUrl, linkText, linkUrl, testOnly, audience, churchId, courseId } = body;
  if (!subject || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing subject or message' }) };
  }

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

  // Test mode: a single email, genuinely instant -- stays synchronous,
  // no job needed.
  if (testOnly) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: user.email,
        reply_to: 'info@followingjesusbook.com',
        subject: `[TEST] ${subject}`,
        html: buildEmailHtml(message, '00000000-0000-0000-0000-000000000000', imageUrl, linkText, linkUrl),
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      return { statusCode: 502, body: JSON.stringify({ error: `Resend error: ${errText}` }) };
    }
    return { statusCode: 200, body: JSON.stringify({ testSent: true, to: user.email }) };
  }

  // Real send: create a job row, hand off to the background function,
  // and return immediately with the job id so the browser can poll for
  // progress. The background function re-verifies everything itself --
  // this function's own auth check above is just to fail fast on an
  // obviously bad request before creating a job at all.
  let jobId;
  try {
    jobId = await callRpc('create_broadcast_send_job', {}, token);
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not start the send: ' + err.message }) };
  }
  if (!jobId) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized to send' }) };
  }

  // Netlify background functions are invoked like any other function --
  // this call returns near-instantly with a 202 once accepted; the
  // actual work happens separately, outside this function's own
  // execution window. Built from the incoming request's own host header
  // rather than assuming an env var is set in every deploy context.
  const host = event.headers.host;
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const backgroundUrl = `${proto}://${host}/.netlify/functions/send-broadcast-email-background`;

  try {
    await fetch(backgroundUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId, token, subject, message, imageUrl, linkText, linkUrl, audience, churchId, courseId, callerRole }),
    });
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not start the background send: ' + err.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ jobId }) };
};
