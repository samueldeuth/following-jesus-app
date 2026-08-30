// netlify/functions/bold-register-subscription-webhooks.js
//
// ONE-OFF SETUP FUNCTION -- run once, then delete.
//
// Registers the four Bold Subscriptions webhook subscriptions this
// project needs, using the real topic ids confirmed for this shop via
// Bold's List Webhook Topics endpoint:
//   12  subscription_cancelled
//   6   subscription_order_transaction_failed
//   20  subscription_payment_failed
//   15  subscription_reactivated
//
// Each is registered with callback_url pointing at
// bold-subscription-webhook.js, and shared_secret set to
// BOLD_WEBHOOK_SIGNING_SECRET -- Bold uses that secret to sign every
// webhook payload with an x-bold-signature header (SHA-256 HMAC),
// which bold-subscription-webhook.js verifies on every request.
//
// ---------------------------------------------------------------------
// HOW TO USE:
// ---------------------------------------------------------------------
// 1. Confirm BOLD_WEBHOOK_SIGNING_SECRET is already set in Netlify.
// 2. Upload this file to netlify/functions/.
// 3. Visit: https://followingjesus.com/.netlify/functions/bold-register-subscription-webhooks
// 4. It returns JSON showing what happened for each of the 4 topics.
//    Safe to run more than once -- if a topic is already registered,
//    Bold's response for that one will show as an error, which is fine
//    to ignore (it means it's already set up).
// 5. Once all four show success (or "already exists"), delete this
//    file -- it has no ongoing purpose.

const BOLD_SHOP_IDENTIFIER = '8809381984';
const CALLBACK_URL = 'https://followingjesus.com/.netlify/functions/bold-subscription-webhook';

const TOPICS_TO_REGISTER = [
  { name: 'subscription_cancelled', id: 12 },
  { name: 'subscription_order_transaction_failed', id: 6 },
  { name: 'subscription_payment_failed', id: 20 },
  { name: 'subscription_reactivated', id: 15 },
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Use GET to run this setup script.' };
  }

  const apiToken = process.env.BOLD_API_TOKEN;
  const signingSecret = process.env.BOLD_WEBHOOK_SIGNING_SECRET;
  const missing = ['BOLD_API_TOKEN', 'BOLD_WEBHOOK_SIGNING_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')}` };
  }

  const results = [];

  for (const topic of TOPICS_TO_REGISTER) {
    try {
      const res = await fetch(
        `https://api.boldcommerce.com/subscriptions/v1/shops/${BOLD_SHOP_IDENTIFIER}/webhooks/subscriptions`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiToken}`,
            'Bold-API-Version-Date': '2022-05-01',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            webhook_subscription: {
              callback_url: CALLBACK_URL,
              webhook_topic_id: topic.id,
              shared_secret: signingSecret,
            },
          }),
        }
      );

      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        parsed = { raw: text.slice(0, 300) };
      }

      results.push({
        topic: topic.name,
        topicId: topic.id,
        status: res.status,
        ok: res.ok,
        response: parsed,
      });
    } catch (e) {
      results.push({ topic: topic.name, topicId: topic.id, error: e.message });
    }
  }

  const allOk = results.every(r => r.ok);

  return {
    statusCode: allOk ? 200 : 207,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      {
        summary: allOk
          ? 'All four Bold webhooks registered. Delete this function now.'
          : 'One or more registrations failed -- see per-topic results below.',
        results,
      },
      null,
      2
    ),
  };
};
