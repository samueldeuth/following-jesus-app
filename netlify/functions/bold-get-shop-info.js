// netlify/functions/bold-get-shop-info.js
//
// ONE-OFF DIAGNOSTIC -- run once, then delete.
//
// Calls Bold's "Get Shop Info" endpoint to retrieve shop_identifier,
// which isn't shown anywhere in Bold's own dashboard UI. Needed before
// we can call any other Bold Subscriptions API endpoint (webhook
// topics, webhook subscriptions, etc.), since those all require
// shop_identifier in the URL path.
//
// ---------------------------------------------------------------------
// HOW TO USE:
// ---------------------------------------------------------------------
// 1. Upload this file to netlify/functions/.
// 2. Visit: https://followingjesus.com/.netlify/functions/bold-get-shop-info
// 3. It returns Bold's shop info JSON, including shop_identifier.
// 4. Once we've confirmed and saved the shop_identifier, delete this
//    file -- it has no ongoing purpose.

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Use GET to run this diagnostic.' };
  }

  const apiToken = process.env.BOLD_API_TOKEN;
  if (!apiToken) {
    return { statusCode: 500, body: 'Missing BOLD_API_TOKEN environment variable.' };
  }

  try {
    const res = await fetch('https://api.boldcommerce.com/shops/v1/info', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    });

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
