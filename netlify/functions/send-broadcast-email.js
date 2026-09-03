// Sends a one-off broadcast email to everyone who hasn't opted out of
// general emails. Triggered ON DEMAND from the admin dashboard (not
// scheduled) -- for "shoot out an email from time to time" use, not a
// recurring automation like the weekly course reminders.
//
// Auth: the admin's OWN Supabase session token, same pattern as
// send-legacy-student-invite.js -- this is a direct browser-triggered
// action, not an external webhook, so there's no shared secret. Both
// this function AND the get_broadcast_recipients() RPC independently
// verify the caller is a real super admin.
//
// REQUIRES: RESEND_API_KEY (already set)

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
// Public anon key -- safe to hardcode, same value already embedded
// client-side in admin-dashboard.html.
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_ADDRESS = 'Following Jesus <reminders@mail.followingjesus.com>'; // same verified sender as the weekly reminders
const APP_URL = 'https://followingjesus.com';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Turns plain text into paragraphs, splitting on blank lines -- same
// simple convention already used for a church's welcome-letter body,
// so composing an email doesn't require knowing any HTML.
function textToParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map(p => `<p style="margin:0 0 16px;">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function buildEmailHtml(bodyText, unsubscribeToken, imageUrl, linkText, linkUrl) {
  const unsubscribeUrl = `${APP_URL}/general-email-unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const imageBlock = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" style="width:100%;display:block;" />`
    : '';
  // Same styled-button convention as send-weekly-course-reminders.js's
  // "Continue the Course" button, for visual consistency across every
  // email this project sends.
  const buttonBlock = (linkUrl && linkText)
    ? `<p style="text-align:center;margin:8px 0 24px;"><a href="${escapeHtml(linkUrl)}" style="background:#17191D;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">${escapeHtml(linkText)}</a></p>`
    : '';
  return `
    <div style="background:#F4F4F2;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
        <div style="background:#17191D;padding:22px 24px;text-align:center;">
          <span style="color:#ffffff;font-weight:700;letter-spacing:0.14em;font-size:13px;text-transform:uppercase;">Following Jesus</span>
        </div>
        ${imageBlock}
        <div style="padding:32px 28px 8px;color:#17191D;font-size:15px;line-height:1.65;">
          ${textToParagraphs(bodyText)}
        </div>
        ${buttonBlock}
        <div style="padding:0 28px 28px;">
          <p style="color:#9CA3AF;font-size:11.5px;margin:0;border-top:1px solid #E4E3DD;padding-top:16px;">
            Don't want occasional emails like this? <a href="${unsubscribeUrl}" style="color:#9CA3AF;">Unsubscribe</a>
          </p>
        </div>
      </div>
    </div>
  `;
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

  const { subject, message, imageUrl, linkText, linkUrl, testOnly } = body;
  if (!subject || !message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing subject or message' }) };
  }

  // Verify the token is a real session, then re-check the caller is
  // actually a super admin -- the RPC also enforces this, but the send
  // shouldn't even start on a forged request.
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
  if (!profiles[0] || profiles[0].role !== 'super_admin') {
    return { statusCode: 403, body: JSON.stringify({ error: 'Not authorized' }) };
  }

  // Test mode: send exactly one real email, to the caller's own address,
  // using a fake unsubscribe token (harmless -- it doesn't correspond to
  // any real profile or subscriber row, so clicking it in a test just
  // silently updates nothing). Skips the recipient RPC and the real
  // send loop entirely.
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

  // RPC call uses the ADMIN'S OWN token too (not the anon key alone) --
  // get_broadcast_recipients() checks is_super_admin(auth.uid()), which
  // needs auth.uid() to actually resolve to this specific caller.
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_broadcast_recipients`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({}),
  });

  if (!rpcRes.ok) {
    return { statusCode: 502, body: JSON.stringify({ error: 'Could not look up recipients' }) };
  }

  const recipients = await rpcRes.json();
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, failed: 0, total: 0 }) };
  }

  let sent = 0;
  const failures = [];

  for (const r of recipients) {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: r.email,
          reply_to: 'info@followingjesusbook.com',
          subject,
          html: buildEmailHtml(message, r.unsubscribe_token, imageUrl, linkText, linkUrl),
        }),
      });
      if (!res.ok) throw new Error(`Resend ${res.status}`);
      sent++;
    } catch (err) {
      failures.push({ email: r.email, error: err.message });
    }
    // Same pacing convention already used for the legacy-invite "Invite
    // All" button -- avoids bursting Resend's rate limit.
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ sent, failed: failures.length, total: recipients.length, failures }),
  };
};
