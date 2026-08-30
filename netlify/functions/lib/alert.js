async function sendAlertEmail(subject, bodyText) {
  const to = process.env.ALERT_EMAIL_TO;
  if (!to || !process.env.RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'Following Jesus Books <no-reply@mail.followingjesus.com>',
      to: [to],
      reply_to: 'info@followingjesusbook.com',
      subject,
      text: bodyText,
    }),
  }).catch((err) => console.error('Alert email failed to send:', err));
}

module.exports = { sendAlertEmail };
