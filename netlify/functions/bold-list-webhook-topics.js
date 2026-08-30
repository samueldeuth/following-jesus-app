// netlify/functions/bold-list-webhook-topics.js
//
// ONE-OFF DIAGNOSTIC -- run once, then delete.
//
// Bold's docs page confirms a "List Webhook Topics" endpoint exists but
// the exact URL path kept getting cut off when reading the docs. Rather
// than guess once and fail, this tries several plausible REST paths
// (based on the confirmed pattern from other endpoints, e.g.
// .../webhooks/subscriptions for creating a webhook) and reports which
// one actually returns real topic data.
//
// ---------------------------------------------------------------------
// HOW TO USE:
// ---------------------------------------------------------------------
// 1. Upload this file to netlify/functions/ (overwriting the previous
//    version).
// 2. Visit: https://followingjesus.com/.netlify/functions/bold-list-webhook-topics
// 3. It tries each candidate path and returns a summary of which
//    succeeded (status 200 with topic data) vs failed, so we can lock
//    in the right one.
// 4. Once we've confirmed the working path and the real topic ids for
//    subscription_cancelled, subscription_order_transaction_failed,
//    subscription_payment_failed, and subscription_reactivated, delete
//    this file -- it has no ongoing purpose.

const BOLD_SHOP_IDENTIFIER = '8809381984';

const CANDIDATE_PATHS = [
  `/subscriptions/v1/shops/${BOLD_SHOP_IDENTIFIER}/webhooks/topics`,
  `/subscriptions/v1/shops/${BOLD_SHOP_IDENTIFIER}/webhook_topics`,
  `/subscriptions/v1/shops/${BOLD_SHOP_IDENTIFIER}/webhooks/subscriptions/topics`,
  `/subscriptions/v1/shops/${BOLD_SHOP_IDENTIFIER}/webhook_subscriptions/topics`,
];

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Use GET to run this diagnostic.' };
  }

  const apiToken = process.env.BOLD_API_TOKEN;
  if (!apiToken) {
    return { statusCode: 500, body: 'Missing BOLD_API_TOKEN environment variable.' };
  }

  const results = [];

  for (const path of CANDIDATE_PATHS) {
    try {
      const res = await fetch(`https://api.boldcommerce.com${path}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
      });

      const contentType = res.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      const text = await res.text();

      let parsed = null;
      if (isJson) {
        try {
          parsed = JSON.parse(text);
        } catch (e) {
          // leave parsed as null
        }
      }

      results.push({
        path,
        status: res.status,
        looksLikeJson: isJson,
        body: parsed || text.slice(0, 300), // truncate any HTML error pages
      });
    } catch (e) {
      results.push({ path, error: e.message });
    }
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ results }, null, 2),
  };
};

