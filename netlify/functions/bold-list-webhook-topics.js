// netlify/functions/bold-list-webhook-topics.js
//
// ONE-OFF DIAGNOSTIC -- run once, then delete.
//
// Lists every webhook topic Bold Subscriptions supports for this shop,
// along with the real numeric ID assigned to each -- needed before we
// can register a webhook subscription, since Create Webhook Subscription
// requires a webhook_topic_id, not a topic name.
//
// ---------------------------------------------------------------------
// HOW TO USE:
// ---------------------------------------------------------------------
// 1. Upload this file to netlify/functions/.
// 2. Visit: https://followingjesus.com/.netlify/functions/bold-list-webhook-topics
// 3. It returns every topic Bold supports, with its id. We specifically
//    need the ids for: subscription_cancelled,
//    subscription_order_transaction_failed, subscription_payment_failed,
//    and subscription_reactivated.
// 4. Once we've confirmed those ids, delete this file -- it has no
//    ongoing purpose.

const BOLD_SHOP_IDENTIFIER = '8809381984';

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Use GET to run this diagnostic.' };
  }

  const apiToken = process.env.BOLD_API_TOKEN;
  if (!apiToken) {
    return { statusCode: 500, body: 'Missing BOLD_API_TOKEN environment variable.' };
  }

  try {
    const res = await fetch(
      `https://api.boldcommerce.com/subscriptions/v1/shops/${BOLD_SHOP_IDENTIFIER}/webhook_topics`,
      {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { raw: text };
    }

    if (!res.ok) {
      return {
        statusCode: res.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `Bold API returned ${res.status}`, details: json }, null, 2),
      };
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(json, null, 2),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
