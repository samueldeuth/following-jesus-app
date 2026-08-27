// netlify/functions/send-admin-invites.js
//
// Sends the invite email for every admin_invites row that hasn't been
// emailed yet. Not scheduled -- triggered manually by visiting this
// function's URL in a browser, since this is a bulk/occasional
// operation (invite a batch of church admins as they're tracked down),
// not a recurring one like the weekly reminders.
//
// No Supabase service-role key anywhere -- same pattern as every other
// cross-boundary function in this project (see
// send-weekly-course-reminders.js). Calls security-definer Postgres
// functions using the regular, already-public anon key, protected by a
// shared secret instead of a key that would bypass every RLS policy in
// the database.
//
// ---------------------------------------------------------------------
// SETUP:
// ---------------------------------------------------------------------
// 1. Run admin-invites-schema.sql first, if you haven't already.
//
// 2. Add this Netlify environment variable (Site settings > Environment
//    variables), marked as secret:
//      ADMIN_INVITE_FUNCTION_SECRET -- the value embedded in
//                                       admin-invites-schema.sql, copied exactly
//    RESEND_API_KEY should already be set from the other email functions.
//
// 3. Whenever a new batch of church + email pairs is ready, run the
//    insert (see the bottom of admin-invites-schema.sql for the
//    pattern), then trigger a send by visiting, in a browser:
//      https://followingjesus.com/.netlify/functions/send-admin-invites?secret=<ADMIN_INVITE_FUNCTION_SECRET>
//    Only invites that haven't been emailed yet go out each time, so
//    this is safe to re-run as new batches are added -- it won't
//    re-email anyone already sent to.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';

exports.handler = async (event) => {
  const functionSecret = process.env.ADMIN_INVITE_FUNCTION_SECRET;
  const resendApiKey = process.env.RESEND_API_KEY;
  const missing = ['ADMIN_INVITE_FUNCTION_SECRET', 'RESEND_API_KEY'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')}` };
  }

  const providedSecret = event.queryStringParameters?.secret;
  if (providedSecret !== functionSecret) {
    return { statusCode: 401, body: 'Missing or incorrect secret query parameter.' };
  }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_pending_admin_invites_to_email`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ caller_secret: functionSecret })
  });

  if (!rpcRes.ok) {
    return { statusCode: 502, body: `get_pending_admin_invites_to_email failed: ${await rpcRes.text()}` };
  }

  const invites = await rpcRes.json();
  if (!Array.isArray(invites) || invites.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, message: 'No pending invites to email.' }) };
  }

  const sentIds = [];
  const results = [];
  for (const invite of invites) {
    const ok = await sendInviteEmail(invite, resendApiKey);
    results.push({ email: invite.email, church: invite.church_name, sent: ok });
    if (ok) sentIds.push(invite.invite_id);
  }

  if (sentIds.length > 0) {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/mark_admin_invites_emailed`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ caller_secret: functionSecret, invite_ids: sentIds })
    });
  }

  return { statusCode: 200, body: JSON.stringify({ sent: sentIds.length, total: invites.length, results }) };
};

async function sendInviteEmail(invite, apiKey) {
  const claimUrl = `${APP_URL}/admin-invite?token=${invite.invite_token}`;
  const courseUrl = `${APP_URL}/courses/${invite.church_slug}`;

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p>Hi,</p>
      <p><strong>${escapeHtml(invite.church_name)}</strong>'s Following Jesus course is moving to a new platform. Here's what's changing and what to do next.</p>

      <p style="margin-top:24px;"><strong>Your church's course link</strong> (share this with your congregation):</p>
      <p style="word-break:break-all;"><a href="${courseUrl}">${courseUrl}</a></p>

      <p style="margin-top:24px;"><strong>Your admin access</strong> — this is for you specifically, to see who's enrolled and track progress:</p>
      <p style="margin: 20px 0;">
        <a href="${claimUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Set Up Admin Access →</a>
      </p>
      <p style="color:#666;font-size:13px;">Sign in with Google using this same email address (${escapeHtml(invite.email)}) — that's how your access gets matched to your account.</p>

      <p style="color:#666;font-size:13px;margin-top:28px;border-top:1px solid #eee;padding-top:16px;">This link is good for 30 days.</p>
    </div>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: invite.email,
        subject: `${invite.church_name}'s course has a new home`,
        html
      })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
