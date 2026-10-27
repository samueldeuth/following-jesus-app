// After a pastor/leader confirms someone's results on /confirm-gifts, they can
// press "Email these to <name>". This sends the person the confirmation.
//
// POST /.netlify/functions/email-gift-confirmation-to-person
//   body: { "token": "<the private confirmation token>" }
//
// The token is the only key (the confirmer isn't signed in). It only works once
// the confirmation is submitted, and only sends once per confirmation, always
// to the person who took the assessment (never an address from the request).
//
// Env vars (already set in Netlify): RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY.

const FJ = require('../../assessment-data.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://onflrmiifjjjboeimnva.supabase.co';
const SITE = 'https://followingjesus.com';
const FROM = 'Following Jesus <results@mail.followingjesus.com>';
const RATING_LABELS = { yes: 'Yes, I see this in you', somewhat: 'Somewhat', not_yet: 'Not yet' };

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function confirmationEmail(type, personFirst, conf, result) {
  const A = FJ.ASSESSMENTS[type];
  const top = (result.ranked || []).filter((k) => FJ.categoryByKey(type, k)).slice(0, A.topCount);
  const subject = `${conf.confirmer_name} confirmed your ${A.shortTitle} results`;
  const rows = top.map((k) => {
    const c = FJ.categoryByKey(type, k);
    const r = (conf.ratings || {})[k];
    return `<tr><td style="padding:10px 0;border-bottom:1px solid #ece8df;font-size:16px;font-weight:bold;">${esc(c.name)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #ece8df;font-size:14px;text-align:right;color:${r === 'yes' ? '#8f6a1f' : '#57534d'};font-weight:${r === 'yes' ? 'bold' : 'normal'};">${esc(RATING_LABELS[r] || '')}</td></tr>`;
  }).join('');
  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif;color:#1c1a17;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
    <tr><td style="background:#0a0a0a;color:#fff;padding:26px 24px;border-radius:12px 12px 0 0;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c89b3c;font-weight:bold;">Results confirmed</div>
      <div style="font-size:26px;font-weight:bold;margin:8px 0 6px;">${esc(conf.confirmer_name)} weighed in</div>
      <div style="font-size:15px;color:#d8d4cb;">${personFirst ? 'Hi ' + esc(personFirst) + ', here' : 'Here'}'s what ${esc(conf.confirmer_name)} sees in you.</div>
    </td></tr>
    <tr><td style="background:#fff;padding:20px 24px;border:1px solid #e4dfd3;border-top:0;border-radius:0 0 12px 12px;">
      <div style="font-size:13px;color:#57534d;margin-bottom:6px;">Your top ${type === 'gifts' ? 'gifts' : 'offices'}</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      ${conf.comment ? `<div style="margin-top:18px;border-left:3px solid #c89b3c;padding:6px 0 6px 14px;font-size:15px;line-height:1.55;white-space:pre-wrap;">${esc(conf.comment)}<div style="font-size:13px;color:#57534d;margin-top:6px;">— ${esc(conf.confirmer_name)}</div></div>` : ''}
      <p style="text-align:center;margin:24px 0 6px;"><a href="${SITE}${A.path}?view=results" style="display:inline-block;background:#c89b3c;color:#0a0a0a;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px;">See your full results</a></p>
    </td></tr>
    <tr><td style="padding:18px 4px;font-size:12px;color:#8a857c;text-align:center;">Gifts are affirmed in community and confirmed by those God has placed over you.<br>© Following Jesus</td></tr>
  </table></td></tr></table></body></html>`;
  const text = `${conf.confirmer_name} confirmed your ${A.shortTitle} results.\n\n` +
    top.map((k) => `${FJ.categoryByKey(type, k).name}: ${RATING_LABELS[(conf.ratings || {})[k]] || ''}`).join('\n') +
    (conf.comment ? `\n\n"${conf.comment}" — ${conf.confirmer_name}` : '') + `\n\nSee your full results: ${SITE}${A.path}?view=results\n`;
  return { subject, html, text };
}

exports.confirmationEmail = confirmationEmail;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!serviceKey || !resendKey) return json(500, { error: 'Email is not set up on the server.' });
  const svc = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };

  let token;
  try { token = JSON.parse(event.body || '{}').token; } catch (e) { return json(400, { error: 'Bad request' }); }
  if (!/^[0-9a-f-]{36}$/i.test(token || '')) return json(400, { error: 'Bad request' });

  const cRes = await fetch(`${SUPABASE_URL}/rest/v1/gift_confirmations?select=id,result_id,requester_id,assessment_type,confirmer_name,status,ratings,comment,emailed_to_person_at&token=eq.${token}`, { headers: svc });
  const confs = cRes.ok ? await cRes.json() : [];
  if (!confs.length) return json(404, { error: 'This link is no longer valid.' });
  const conf = confs[0];
  if (conf.status !== 'confirmed') return json(400, { error: 'Please submit your confirmation first.' });
  if (conf.emailed_to_person_at) return json(200, { ok: true, already: true });

  // Claim the send first so two clicks can't send twice.
  const claim = await fetch(`${SUPABASE_URL}/rest/v1/gift_confirmations?id=eq.${conf.id}&emailed_to_person_at=is.null`, {
    method: 'PATCH', headers: { ...svc, Prefer: 'return=representation' }, body: JSON.stringify({ emailed_to_person_at: new Date().toISOString() })
  });
  const claimed = claim.ok ? await claim.json() : [];
  if (!claimed.length) return json(200, { ok: true, already: true });

  const release = () => fetch(`${SUPABASE_URL}/rest/v1/gift_confirmations?id=eq.${conf.id}`, { method: 'PATCH', headers: svc, body: JSON.stringify({ emailed_to_person_at: null }) });

  const rRes = await fetch(`${SUPABASE_URL}/rest/v1/gift_assessment_results?select=scores,ranked&id=eq.${conf.result_id}`, { headers: svc });
  const results = rRes.ok ? await rRes.json() : [];
  const uRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${conf.requester_id}`, { headers: svc });
  const person = uRes.ok ? await uRes.json() : null;
  if (!results.length || !person || !person.email) { await release(); return json(500, { error: 'Could not find who to send this to.' }); }

  const meta = person.user_metadata || {};
  const first = String(meta.full_name || meta.name || '').trim().split(/\s+/)[0];
  const email = confirmationEmail(conf.assessment_type, first, conf, results[0]);
  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [person.email], subject: email.subject, html: email.html, text: email.text })
  });
  if (!send.ok) {
    console.error('Resend error', send.status, await send.text().catch(() => ''));
    await release();
    return json(502, { error: 'The email service had a problem. Please try again in a minute.' });
  }
  return json(200, { ok: true });
};
