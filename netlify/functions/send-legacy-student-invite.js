// Sends a "your course is ready" invite email to someone in the legacy
// Thinkific student directory, pointing them at their church's course
// page to sign in (Google or Apple) with the same email so they get
// auto-matched. Auth is the calling admin's OWN Supabase session token
// (verified server-side against profiles.role), not a shared secret --
// same pattern as send-admin-invites.js, since this is a direct
// browser-triggered action rather than a server-to-server webhook.
//
// Uses plain fetch against Supabase's Auth (GoTrue) and REST
// (PostgREST) endpoints directly -- deliberately NOT @supabase/supabase-js,
// since that package isn't in this site's top-level package.json and
// isn't used by any other function in this project (same class of
// "missing dependency breaks the whole site's build" issue already
// hit once with lib/verify.js).

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
// Public anon key -- safe to hardcode, same value already embedded
// client-side in admin-dashboard.html. Not read from a Netlify env var
// because SUPABASE_ANON_KEY was never actually set as one in this
// project (confirmed from the build log's env var list) -- that gap
// was the real cause of the 401s on the first deploy of this function.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_ADDRESS = 'Following Jesus <no-reply@mail.followingjesus.com>';

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

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

  const { email, firstName, churchId, churchName, churchSlug } = body;
  if (!email || !churchId || !churchSlug) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing email, churchId, or churchSlug' }) };
  }

  // Verify the token is a real, current session via Supabase's Auth
  // (GoTrue) REST endpoint.
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

  // Re-check authorization server-side (super_admin, or church_admin of
  // THIS church) rather than trusting the client. Uses the caller's own
  // token against PostgREST, so this only ever sees what RLS already
  // allows that user to read (their own profile row).
  const profileRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=role,church_id`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } }
  );
  const profiles = profileRes.ok ? await profileRes.json() : [];
  const profile = profiles[0];

  const isAuthorized =
    profile && (profile.role === 'super_admin' || (profile.role === 'church_admin' && profile.church_id === churchId));

  if (!isAuthorized) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized for this church' }) };
  }

  const courseUrl = `https://followingjesus.com/courses/${churchSlug}`;
  const greetingName = firstName || 'there';
  const safeChurchName = escapeHtml(churchName || 'your church');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:520px;color:#222;">
      <p>Hi ${escapeHtml(greetingName)},</p>
      <p>Your ${safeChurchName} course is now on our new platform, with your progress, discussions, and certificate all in one place.</p>
      <p style="margin:24px 0;">
        <a href="${courseUrl}" style="background:#111;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;display:inline-block;">
          Sign In to Your Course
        </a>
      </p>
      <p>Sign in with Google or Apple using <strong>${escapeHtml(email)}</strong> — the same email you used before — and you'll be matched to your church automatically.</p>
      <p style="color:#999;font-size:12px;margin-top:32px;">
        If the button doesn't work, copy and paste this link: ${courseUrl}
      </p>
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [email],
      subject: `Your ${churchName || 'course'} is ready on our new platform`,
      html,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Resend failed', detail: json }) };
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
