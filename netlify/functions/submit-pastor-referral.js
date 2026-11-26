// netlify/functions/submit-pastor-referral.js
//
// Public endpoint behind the "Know another pastor?" form on
// referral-gift.html. It does NOT email the referred pastor -- it emails
// Samuel (info@followingjesusbook.com) so he can reach out personally.
//
// Needs the existing RESEND_API_KEY Netlify environment variable (already
// used by the other email functions). No new secrets.

const FROM_EMAIL = 'Following Jesus <referrals@mail.followingjesus.com>';
const TO_EMAIL = 'info@followingjesusbook.com';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clean = (v, max) => String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const cleanMultiline = (v, max) => String(v == null ? '' : v).replace(/\r/g, '').trim().slice(0, max);
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  let p;
  try { p = JSON.parse(event.body || '{}'); } catch (e) { return { statusCode: 400, body: 'Invalid request body.' }; }

  // Honeypot: real people never fill this. Pretend success so bots move on.
  if (p.website) return { statusCode: 200, body: JSON.stringify({ ok: true }) };

  const pastorName = clean(p.pastorName, 120);
  const pastorEmail = clean(p.pastorEmail, 200);
  const church = clean(p.church, 160);
  const referrerName = clean(p.referrerName, 120);
  const referrerEmail = clean(p.referrerEmail, 200);
  const note = cleanMultiline(p.note, 1000);

  if (!pastorName || !EMAIL_RE.test(pastorEmail)) return { statusCode: 400, body: 'Pastor name and a valid email are required.' };
  if (referrerEmail && !EMAIL_RE.test(referrerEmail)) return { statusCode: 400, body: 'Invalid referrer email.' };

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { statusCode: 500, body: 'RESEND_API_KEY is not set.' };

  const row = (label, value) => value
    ? `<tr><td style="padding:4px 14px 4px 0;color:#666;vertical-align:top;">${label}</td><td style="padding:4px 0;">${escapeHtml(value)}</td></tr>` : '';
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:520px;padding:8px;">
      <p><strong>New pastor referral</strong> from the thank-you page.</p>
      <table style="border-collapse:collapse;font-size:15px;">
        ${row('Pastor', pastorName)}
        ${row('Pastor email', pastorEmail)}
        ${row('Church', church)}
        ${row('Referred by', referrerName)}
        ${row('Their email', referrerEmail)}
      </table>
      ${note ? `<p style="margin-top:16px;white-space:pre-wrap;">${escapeHtml(note)}</p>` : ''}
      <p style="color:#666;font-size:13px;margin-top:20px;">Reply to this email to write to the person who referred them${referrerEmail ? '' : ' (they left no email)'}.</p>
    </div>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: TO_EMAIL,
        ...(referrerEmail ? { reply_to: referrerEmail } : {}),
        subject: `Pastor referral: ${pastorName}${church ? ' (' + church + ')' : ''}`,
        html
      })
    });
    if (!res.ok) {
      console.error('Resend error', res.status, await res.text());
      return { statusCode: 502, body: 'Could not send.' };
    }
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error(e);
    return { statusCode: 502, body: 'Could not send.' };
  }
};
