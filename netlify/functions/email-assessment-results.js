// Emails someone their latest Spiritual Gifts or Five-Fold Office results.
//
// POST /.netlify/functions/email-assessment-results
//   Authorization: Bearer <the signed-in person's Supabase access token>
//   body: { "type": "gifts" | "fivefold" }
//
// Only ever sends to the signed-in person's own email address, and only
// their own latest saved result (read server-side, never taken from the
// request), so it can't be used to email anyone else or send made-up content.
//
// Env vars (already set in Netlify): RESEND_API_KEY, SUPABASE_SERVICE_ROLE_KEY.
// Gift/office names and descriptions come from assessment-data.js in the
// repo root, the same file the assessment pages use.

const FJ = require('../../assessment-data.js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://onflrmiifjjjboeimnva.supabase.co';
const SITE = 'https://followingjesus.com';
const FROM = 'Following Jesus <results@mail.followingjesus.com>';

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function absUrl(url) {
  return /^https?:/.test(url) ? url : SITE + url;
}

// Builds the email. Exported for tests.
function buildEmail(type, result, name) {
  const A = FJ.ASSESSMENTS[type];
  const max = FJ.maxScore(type);
  const noun = type === 'gifts' ? 'gift' : 'office';
  const ranked = (result.ranked || []).filter((k) => FJ.categoryByKey(type, k));
  const top = ranked.slice(0, A.topCount);
  const date = new Date(result.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  const first = (name || '').trim().split(/\s+/)[0];

  const topHtml = top.map((key, i) => {
    const c = FJ.categoryByKey(type, key);
    const score = (result.scores || {})[key] || 0;
    const resources = FJ.resourcesFor(key);
    return `
      <tr><td style="padding:18px 20px;border:1px solid #e4dfd3;border-top:4px solid #c89b3c;border-radius:10px;background:#ffffff;">
        <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#8f6a1f;font-weight:bold;">${i === 0 ? 'Your top ' + noun : '#' + (i + 1)}</div>
        <div style="font-size:22px;font-weight:bold;margin:6px 0 4px;color:#0a0a0a;">${esc(c.name)}</div>
        <div style="font-size:13px;color:#57534d;margin-bottom:10px;">${score} of ${max} · ${esc(FJ.bandFor(type, score))} · ${esc(c.scripture)}</div>
        ${c.path ? `<div style="font-size:14px;font-weight:bold;color:#8f6a1f;margin-bottom:8px;">${esc(c.path)}</div>` : ''}
        <div style="font-size:15px;line-height:1.55;color:#1c1a17;">${esc(c.description)}</div>
        <div style="font-size:14px;font-weight:bold;margin:14px 0 4px;">How it often shows up</div>
        <ul style="margin:0;padding-left:20px;font-size:14px;line-height:1.55;color:#1c1a17;">${c.functions.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>
        ${resources.length ? `<div style="font-size:14px;font-weight:bold;margin:14px 0 4px;">Grow in this ${noun}</div>
          ${resources.map((r) => `<div style="font-size:14px;margin:4px 0;"><a href="${esc(absUrl(r.url))}" style="color:#8f6a1f;">${esc(r.label)}</a> <span style="color:#57534d;">· ${esc(r.note || '')}</span></div>`).join('')}` : ''}
      </td></tr>
      <tr><td style="height:14px;"></td></tr>`;
  }).join('');

  const rowsHtml = ranked.map((key, i) => {
    const score = (result.scores || {})[key] || 0;
    const pct = Math.max(3, Math.round((score / max) * 100));
    return `<tr>
      <td style="padding:6px 0;font-size:14px;${i < A.topCount ? 'font-weight:bold;' : ''}width:42%;">${esc(FJ.categoryByKey(type, key).name)}</td>
      <td style="padding:6px 8px;width:38%;"><div style="background:#ece8df;border-radius:6px;height:9px;"><div style="background:${i < A.topCount ? '#c89b3c' : '#b9b2a4'};width:${pct}%;height:9px;border-radius:6px;"></div></div></td>
      <td style="padding:6px 0;font-size:12px;color:#57534d;text-align:right;white-space:nowrap;">${score}/${max} · ${esc(FJ.bandFor(type, score))}</td>
    </tr>`;
  }).join('');

  const note = FJ.BEST_USE_NOTE;
  const topNames = top.map((k) => FJ.categoryByKey(type, k).name);
  const subject = `Your ${A.shortTitle} results: ${topNames.join(', ')}`;

  const html = `<!doctype html><html><body style="margin:0;background:#f6f4ef;font-family:Helvetica,Arial,sans-serif;color:#1c1a17;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f4ef;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
    <tr><td style="background:#0a0a0a;color:#ffffff;padding:26px 24px;border-radius:12px 12px 0 0;">
      <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;color:#c89b3c;font-weight:bold;">Your results · ${esc(date)}</div>
      <div style="font-size:28px;font-weight:bold;margin:8px 0 10px;">${esc(A.shortTitle)} results</div>
      <div style="font-size:15px;line-height:1.5;color:#d8d4cb;">${first ? 'Hi ' + esc(first) + ', here' : 'Here'}'s where you lean right now. This is a starting point for prayer and conversation with your pastor, not a final word.</div>
    </td></tr>
    <tr><td style="padding:20px 0 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${topHtml}</table>
    </td></tr>
    <tr><td style="padding:18px 20px;background:#ffffff;border:1px solid #e4dfd3;border-radius:10px;">
      <div style="font-size:18px;font-weight:bold;margin-bottom:8px;">All your scores</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}</table>
    </td></tr>
    <tr><td style="padding:22px 4px 6px;font-size:15px;line-height:1.55;">
      <b>Share this with your pastor.</b> Forward this email and ask what they see in you. Their voice matters more than any score.
    </td></tr>
    <tr><td style="padding:10px 4px;">
      ${note.sections.map((sec) => `<div style="font-size:15px;font-weight:bold;margin:12px 0 4px;">${esc(sec.heading)}</div><div style="font-size:14px;line-height:1.55;color:#1c1a17;">${esc(sec.body)}</div>`).join('')}
      <div style="border-left:3px solid #c89b3c;padding:4px 0 4px 12px;margin:14px 0;font-style:italic;font-size:14px;">"${esc(note.verses[0].text)}"<div style="font-style:normal;font-size:12px;color:#57534d;margin-top:4px;">${esc(note.verses[0].ref)}</div></div>
    </td></tr>
    <tr><td align="center" style="padding:14px 0 6px;">
      <a href="${SITE}${A.path}?view=results" style="display:inline-block;background:#c89b3c;color:#0a0a0a;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:10px;font-size:15px;">See your full results online</a>
    </td></tr>
    <tr><td style="padding:18px 4px 0;font-size:13px;line-height:1.5;color:#57534d;text-align:center;">
      Know someone who'd find this helpful? Send them the free assessment: <a href="${SITE}${A.path}" style="color:#8f6a1f;">${SITE.replace('https://', '')}${A.path}</a>
    </td></tr>
    <tr><td style="padding:22px 4px;font-size:12px;color:#8a857c;text-align:center;">
      You're getting this because you asked for a copy of your results on followingjesus.com.<br>© Following Jesus
    </td></tr>
  </table></td></tr></table></body></html>`;

  const text = [
    `${A.shortTitle} results · ${date}`, '',
    `Your top ${noun}${top.length > 1 ? 's' : ''}: ${topNames.join(', ')}`, '',
    'All your scores:',
    ...ranked.map((k) => `  ${FJ.categoryByKey(type, k).name}: ${(result.scores || {})[k] || 0}/${max} (${FJ.bandFor(type, (result.scores || {})[k] || 0)})`),
    '', `See your full results: ${SITE}${A.path}?view=results`
  ].join('\n');

  return { subject, html, text };
}

exports.buildEmail = buildEmail;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendKey = process.env.RESEND_API_KEY;
  if (!serviceKey || !resendKey) return json(500, { error: 'Email is not set up on the server.' });

  let type;
  try { type = JSON.parse(event.body || '{}').type; } catch (e) { return json(400, { error: 'Bad request' }); }
  if (!FJ.ASSESSMENTS[type]) return json(400, { error: 'Unknown assessment' });

  const auth = event.headers.authorization || event.headers.Authorization || '';
  const token = auth.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Please sign in again.' });

  // Who is asking? (Supabase checks the token.)
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: `Bearer ${token}` } });
  if (!userRes.ok) return json(401, { error: 'Please sign in again.' });
  const user = await userRes.json();
  if (!user || !user.id || user.is_anonymous || !user.email) return json(401, { error: 'Please sign in to email your results.' });

  // Their latest saved result for this assessment.
  const q = `${SUPABASE_URL}/rest/v1/gift_assessment_results?select=scores,ranked,created_at&user_id=eq.${encodeURIComponent(user.id)}&assessment_type=eq.${type}&order=created_at.desc&limit=1`;
  const rRes = await fetch(q, { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } });
  if (!rRes.ok) return json(500, { error: 'Could not load your results.' });
  const rows = await rRes.json();
  if (!rows.length) return json(404, { error: 'No saved results found yet.' });

  const name = (user.user_metadata && (user.user_metadata.full_name || user.user_metadata.name)) || '';
  const email = buildEmail(type, rows[0], name);

  const send = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [user.email], subject: email.subject, html: email.html, text: email.text })
  });
  if (!send.ok) {
    console.error('Resend error', send.status, await send.text().catch(() => ''));
    return json(502, { error: 'The email service had a problem. Please try again in a minute.' });
  }
  return json(200, { ok: true, to: user.email });
};
