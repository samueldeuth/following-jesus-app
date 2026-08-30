// Fires on Shopify's orders/create webhook. Only acts on orders that
// contain at least one physical (requires_shipping) line item — this
// naturally skips course purchases and free digital downloads, which are
// handled by the existing shopify-order-webhook.js instead.
//
// Set up in Shopify Admin: Settings > Notifications > Webhooks
//   Event: Order creation
//   Format: JSON
//   URL: https://followingjesus.com/.netlify/functions/tag-book-order
//   (uses the same signing secret as the existing SHOPIFY_WEBHOOK_SECRET)

const { verifyShopifyWebhook } = require('./lib/verify');
const { tagOrderAwaitingOutreach } = require('./lib/shopify');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const rawBody = event.body;
  const hmacHeader = event.headers['x-shopify-hmac-sha256'];
  const valid = verifyShopifyWebhook(rawBody, hmacHeader, process.env.SHOPIFY_WEBHOOK_SECRET);

  if (!valid) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const order = JSON.parse(rawBody);

  const physicalLineItems = (order.line_items || []).filter((li) => li.requires_shipping);

  if (physicalLineItems.length === 0) {
    // Digital-only order (course, ebook, free download) — not ours to handle.
    return { statusCode: 200, body: 'Skipped: no physical line items' };
  }

  const shipping = order.shipping_address || {};

  const matchData = {
    name: shipping.name || '',
    company: shipping.company || '',
    address1: shipping.address1 || '',
    city: shipping.city || '',
    province: shipping.province_code || shipping.province || '',
    zip: shipping.zip || '',
    items: physicalLineItems.map((li) => ({
      title: li.title,
      quantity: li.quantity,
    })),
  };

  try {
    await tagOrderAwaitingOutreach(`gid://shopify/Order/${order.id}`, matchData);
    console.log(`Tagged order ${order.name} as awaiting-outreach-confirm`);
    return { statusCode: 200, body: 'OK' };
  } catch (err) {
    console.error('Failed to tag order for Outreach matching:', err);
    // Return 200 anyway so Shopify doesn't retry-storm us; this order will
    // just need to be matched manually if it fails here.
    return { statusCode: 200, body: 'Logged error, not retrying' };
  }
};
