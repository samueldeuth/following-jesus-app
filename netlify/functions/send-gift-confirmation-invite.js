// Invite a pastor / leader to CONFIRM someone's Spiritual Gifts or Five-Fold results.
// ("The church body affirms; the pastor and five-fold confirm.")
//
// POST /.netlify/functions/send-gift-confirmation-invite
//   Authorization: Bearer <the signed-in person's Supabase access token>
//   body: { "result_id": "<uuid>", "invites": [ { "name", "email", "role"? }, ... ] }
//
// Only the owner of the result can invite, up to 3 people per result in total
// (also enforced in the database). Each invitee gets an email with a private
// link to /confirm-gifts?token=..., which needs no sign-in.
//
// Env vars (already set in Netlify): RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY.

const FJ = require('../../assessment-data.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://onflrmiifjjjboeimnva.supabase.co';
const SITE = 'https://followingjesus.com';
const FROM = 'Following Jesus <results@mail.followingjesus.com>';
const MAX_INVITES = 3;

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function isEmail(s) { return typeof s === 'string' && s.length <= 320 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }

function inviteEmail(type, personName, confirmerName, link) {
  const A = FJ.ASSESSMENTS[type];
  const first = (personName || '').trim().split(/\s+/)[0] || 'Someone';
  const what = type === 'gifts' ? 'spiritual gifts' : 'five-fold calling';
  const subject = `${first} asked you to confirm their ${A.shortTitle} results`;
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif;color:#1c1a17;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#0a0a0a;color:#fff;padding:26px 24px;border-radius:12px 12px 0 0;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c89b3c;font-weight:bold;">Confirmation request</div>
      <div style="font-size:26px;font-weight:bold;margin:8px 0 0;">${esc(first)} would value your voice</div>
    </td></tr>
    <tr><td style="background:#fff;padding:24px;border:1px solid #e4dfd3;border-top:0;border-radius:0 0 12px 12px;font-size:15px;line-height:1.6;">
      <p style="margin:0 0 14px;">Hi ${esc(confirmerName)},</p>
      <p style="margin:0 0 14px;">${esc(personName)} took the free <b>${esc(A.title)}</b> from Following Jesus and asked you to help confirm their ${what}.</p>
      <p style="margin:0 0 14px;">Gifts are affirmed in community, and confirmed by pastors and those serving in the five-fold. You'll see their results, and for their top ${A.topCount} you'll mark whether you see it in them. You can add a note, too. It takes about 2 minutes, and no account is needed.</p>
      <p style="text-align:center;margin:24px 0;"><a href="${link}" style="display:inline-block;background:#c89b3c;color:#0a0a0a;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px;">Review and confirm</a></p>
      <p style="margin:0;font-size:13px;color:#57534d;">This link is just for you. If you weren't expecting this, you can ignore it.</p>
    </td></tr>
    <tr><td style="padding:18px 4px;font-size:12px;color:#8a857c;text-align:center;">© Following Jesus · followingjesus.com</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `Hi ${confirmerName},\n\n${personName} took the free ${A.title} from Following Jesus and asked you to help confirm their ${what}. It takes about 2 minutes, and no account is needed.\n\nReview and confirm: ${link}\n`;
  return { subject, html, text };
}

exports.inviteEmail = inviteEmail;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!serviceKey || !resendKey) return json(500, { error: 'Email is not set up on the server.' });
  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Bad request' }); }
  const resultId = body.result_id;
  const invites = Array.isArray(body.invites) ? body.invites : [];
  if (!/^[0-9a-f-]{36}$/i.test(resultId || '')) return json(400, { error: 'Bad request' });
  if (!invites.length || invites.length > MAX_INVITES) return json(400, { error: `Invite 1 to ${MAX_INVITES} people.` });

  const clean = [];
  for (const inv of invites) {
    const name = String((inv && inv.name) || '').trim().slice(0, 120);
    const email = String((inv && inv.email) || '').trim().toLowerCase();
    const role = String((inv && inv.role) || '').trim().slice(0, 120) || null;
    if (!name) return json(400, { error: 'Please add a name for each person.' });
    if (!isEmail(email)) return json(400, { error: `"${email || name}" doesn't look like an email address.` });
    if (clean.some((c) => c.email === email)) continue;
    clean.push({ name, email, role });
  }

  // Who is asking?
  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Please sign in again.' });
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) return json(401, { error: 'Please sign in again.' });
  const user = await userRes.json();
  if (!user || !user.id || user.is_anonymous) return json(401, { error: 'Please sign in again.' });

  // The result must be theirs.
  const rRes = await fetch(`${SUPABASE_URL}/rest/v1/gift_assessment_results?select=id,user_id,assessment_type&id=eq.${resultId}`, { headers: svc });
  const rows = rRes.ok ? await rRes.json() : [];
  if (!rows.length || rows[0].user_id !== user.id) return json(404, { error: 'Result not found.' });
  const type = rows[0].assessment_type;

  // Room left, and no duplicates of people already invited.
  const eRes = await fetch(`${SUPABASE_URL}/rest/v1/gift_confirmations?select=confirmer_email&result_id=eq.${resultId}`, { headers: svc });
  const existing = eRes.ok ? (await eRes.json()).map((x) => (x.confirmer_email || '').toLowerCase()) : [];
  const fresh = clean.filter((c) => !existing.includes(c.email));
  if (!fresh.length) return json(400, { error: 'You already invited that person.' });
  if (existing.length + fresh.length > MAX_INVITES) {
    return json(400, { error: `You can invite up to ${MAX_INVITES} people for each result (${MAX_INVITES - existing.length} left).` });
  }

  const meta = user.user_metadata || {};
  let personName = (meta.full_name || meta.name || '').trim();
  if (!personName) {
    const pRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=full_name&id=eq.${user.id}`, { headers: svc });
    const p = pRes.ok ? await pRes.json() : [];
    personName = (p[0] && p[0].full_name) || 'A friend';
  }

  const sent = [];
  for (const inv of fresh) {
    const ins = await fetch(`${SUPABASE_URL}/rest/v1/gift_confirmations`, {
      method: 'POST',
      headers: { ...svc, Prefer: 'return=representation' },
      body: JSON.stringify({ result_id: resultId, requester_id: user.id, assessment_type: type, confirmer_name: inv.name, confirmer_email: inv.email, confirmer_role: inv.role })
    });
    if (!ins.ok) {
      console.error('insert failed', ins.status, await ins.text().catch(() => ''));
      return json(400, { error: 'Could not create the invitation.', sent });
    }
    const row = (await ins.json())[0];
    const email = inviteEmail(type, personName, inv.name, `${SITE}/confirm-gifts?token=${row.token}`);
    const send = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM, to: [inv.email], reply_to: user.email || undefined, subject: email.subject, html: email.html, text: email.text })
    });
    if (!send.ok) {
      console.error('Resend error', send.status, await send.text().catch(() => ''));
      // Don't leave an invitation nobody received: remove it so it doesn't count toward the 3.
      await fetch(`${SUPABASE_URL}/rest/v1/gift_confirmations?id=eq.${row.id}`, { method: 'DELETE', headers: svc });
      return json(502, { error: `The email to ${inv.email} didn't send. Please try again in a minute.`, sent });
    }
    sent.push({ name: inv.name, email: inv.email });
  }
  return json(200, { ok: true, sent });
};
