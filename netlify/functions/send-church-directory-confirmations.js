// netlify/functions/send-church-directory-confirmations.js
//
// Sends the confirmation email to every pending_confirmation church_directory
// entry that has a contact email on file, asking them to confirm (or
// fix) their info before it goes live in Find a Church.
//
// SAFETY: by default (no &send=true), this returns the fully-rendered
// email HTML for ONE real candidate WITHOUT sending anything to
// anyone -- lets you see exactly what will go out before it does.
// Only adding &send=true actually sends. This isn't just a suggestion
// in the comments -- the code itself refuses to send unless that
// parameter is explicitly present.
//
// BATCHED on purpose: a real run of ~289 sends, even with a small
// pause between each, took several minutes total -- comfortably past
// Netlify's own execution time limit for a single function call,
// which silently killed the function partway through with a 502 and
// zero emails actually sent. Processing a bounded number per call
// (default 20) and returning a nextOffset keeps each individual call
// well within that limit -- same fix already applied to the earlier
// geocoding import for the same underlying reason.
//
// Each successful send is marked via mark_confirmation_email_sent
// immediately (not batched up and marked all at once at the end), so
// if a later call in the sequence ever fails or times out, everyone
// already emailed in an earlier call is never re-sent.
//
// ---------------------------------------------------------------------
// USAGE:
// ---------------------------------------------------------------------
// Preview (safe, sends nothing):
//   https://followingjesus.com/.netlify/functions/send-church-directory-confirmations?secret=<REMINDER_FUNCTION_SECRET>
//
// Send a batch (repeat with the nextOffset each response gives back,
// until done:true):
//   https://followingjesus.com/.netlify/functions/send-church-directory-confirmations?secret=<REMINDER_FUNCTION_SECRET>&send=true&offset=0
//
// REQUIRES:
//   RESEND_API_KEY
//   REMINDER_FUNCTION_SECRET (reused -- same shared-secret pattern
//                             already used for the other bulk-email
//                             functions in this project)

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';
const BATCH_SIZE = 20;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Shared brand header for every email this project sends -- the logo
// lives at this one real, hosted URL (uploaded once to the assets
// folder), referenced the same way in every email function rather than
// duplicating an image anywhere. Wrapping in a full <!DOCTYPE html>
// document with an explicit <meta charset="UTF-8"> is what actually
// fixes special characters (the em dash in "Jesus app —", the arrow in
// "Confirm →") rendering as garbled "â€"" / "â†'" -- a bare HTML
// fragment with no charset declaration leaves email clients and
// browsers to guess the encoding, and they don't always guess UTF-8.
const LOGO_URL = 'https://followingjesus.com/assets/FJ_logo_rectangle_Thinkific_v2.png';
function wrapEmailHtml(bodyHtml) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;">
  <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="text-align:center;margin-bottom:28px;">
      <img src="${LOGO_URL}" alt="Following Jesus" style="max-width:200px;width:100%;height:auto;" />
    </div>
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function buildEmailHtml(churchName, confirmToken) {
  const confirmUrl = `${APP_URL}/confirm-church-directory-entry?token=${confirmToken}`;
  return wrapEmailHtml(`
      <p>Hi there,</p>
      <p>We're building a new "Find a Church" feature in the Following Jesus app — it helps people get connected, planted, and serving in a local church near them.</p>
      <p>We'd love to feature <strong>${escapeHtml(churchName)}</strong> in our church directory. Can you take a second to confirm your info is correct?</p>
      <p style="margin: 28px 0;">
        <a href="${confirmUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Confirm Our Info →</a>
      </p>
      <p>Thank you,<br>Following Jesus Team</p>
  `);
}

exports.handler = async function (event) {
  const resendApiKey = process.env.RESEND_API_KEY;
  const functionSecret = process.env.REMINDER_FUNCTION_SECRET;
  const missing = ['RESEND_API_KEY', 'REMINDER_FUNCTION_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')}` };
  }

  const params = event.queryStringParameters || {};
  if (params.secret !== functionSecret) {
    return { statusCode: 401, body: 'Not authorized -- provide the secret query parameter.' };
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

  // PREVIEW MODE (default) -- render one real example and return it as
  // HTML the browser displays directly, without sending anything to
  // anyone. This is the actual safety mechanism, not just a comment --
  // the send loop below literally never runs unless send=true is present.
  if (params.send !== 'true') {
    if (!pendingChurches.length) {
      return { statusCode: 200, body: 'No pending churches with an email on file to preview.' };
    }
    const sample = pendingChurches[0];
    const previewHtml = buildEmailHtml(sample.name, sample.confirmation_token);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: `
        <div style="background:#f5f5f5;padding:24px;font-family:-apple-system,sans-serif;">
          <p style="max-width:480px;margin:0 auto 16px;font-weight:600;">
            PREVIEW ONLY -- nothing has been sent. This is exactly what will go out to
            all ${pendingChurches.length} eligible churches once you visit this same URL with &send=true added.
            Example shown below using "${escapeHtml(sample.name)}"'s real data.
          </p>
          <div style="background:#fff;border-radius:8px;max-width:480px;margin:0 auto;">
            ${previewHtml}
          </div>
        </div>
      `
    };
  }

  // Real send -- only reachable with send=true explicitly in the URL.
  // Only processes one bounded batch (BATCH_SIZE, default 20) starting
  // at the given offset -- see the file header for why the whole list
  // was never safe to process in a single call.
  const offset = parseInt(params.offset || '0', 10);
  const batch = pendingChurches.slice(offset, offset + BATCH_SIZE);

  if (!batch.length) {
    return { statusCode: 200, body: JSON.stringify({ done: true, message: 'All eligible churches have been sent to.' }) };
  }

  const successful = [];
  const failures = [];
  const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  for (const church of batch) {
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
        // Marked immediately, not batched up for the end -- if a LATER
        // batch call in this same sequence ever fails or times out,
        // everyone already emailed here still never gets a duplicate.
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
    await sleep(150); // stays comfortably under Resend's rate limit, same pattern as the other bulk-email functions in this project
  }

  const nextOffset = offset + BATCH_SIZE;
  return {
    statusCode: 200,
    body: JSON.stringify({
      done: nextOffset >= pendingChurches.length,
      totalEligible: pendingChurches.length,
      processedThisBatch: batch.length,
      sentThisBatch: successful.length,
      failedThisBatch: failures.length,
      nextOffset: nextOffset < pendingChurches.length ? nextOffset : null,
      failures
    })
  };
};
