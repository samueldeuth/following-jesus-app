// Sends a "your course is ready" invite email to someone in the legacy
// Thinkific student directory, pointing them at their church's course
// page to sign in (Google or Apple) with the same email so they get
// auto-matched. Auth is the calling admin's OWN Supabase session token
// (verified server-side against profiles.role), not a shared secret --
// same pattern as send-admin-invites.js, since this is a direct
// browser-triggered action rather than a server-to-server webhook.

const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
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

  // Verify the token is a real, current session, then re-check
  // authorization server-side (super_admin, or church_admin of THIS
  // church) rather than trusting the client -- the RPC also enforces
  // this, but the email send itself shouldn't fire on a forged request
  // even if the RPC call afterward would have been blocked anyway.
  const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return { statusCode: 401, body: JSON.stringify({ error: 'Invalid session' }) };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role, church_id')
    .eq('id', userData.user.id)
    .single();

  const isAuthorized =
    profile && (profile.role === 'super_admin' || (profile.role === 'church_admin' && profile.church_id === churchId));

  if (profileError || !isAuthorized) {
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
