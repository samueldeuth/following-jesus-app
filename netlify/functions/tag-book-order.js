// Fires on Shopify's orders/create webhook. Only acts on orders that
// contain at least one line item tagged "outreach-fulfilled" on its
// product (see lib/shopify.js's getProductTags) — this covers Outreach's
// ~11 fulfilled products (books, wristbands, journal, etc.) while skipping
// course purchases, digital downloads, and any physical product you
// fulfill yourself rather than through Outreach.
//
// Tag each Outreach-fulfilled product in Shopify Admin with:
//   outreach-fulfilled
// Adding a new Outreach product later is just adding that tag — no code
// changes needed.
//
// Set up in Shopify Admin: Settings > Notifications > Webhooks
//   Event: Order creation
//   Format: JSON
//   URL: https://followingjesus.com/.netlify/functions/tag-book-order
//   (uses the same signing secret as the existing SHOPIFY_WEBHOOK_SECRET)

const { verifyShopifyWebhook } = require('./lib/verify');
const { tagOrderAwaitingOutreach, getProductTags } = require('./lib/shopify');

const OUTREACH_FULFILLED_TAG = 'outreach-fulfilled';

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

  let outreachLineItems;
  try {
    const productIds = [...new Set(physicalLineItems.map((li) => li.product_id).filter(Boolean))];
    const tagsByProductId = await getProductTags(productIds);
    outreachLineItems = physicalLineItems.filter((li) =>
      (tagsByProductId[li.product_id] || []).includes(OUTREACH_FULFILLED_TAG)
    );
  } catch (err) {
    console.error(`Failed to look up product tags for order ${order.name}:`, err);
    return { statusCode: 200, body: 'Logged error looking up product tags, not retrying' };
  }

  if (outreachLineItems.length === 0) {
    // Physical, but not one of Outreach's products (e.g. self-fulfilled merch).
    return { statusCode: 200, body: 'Skipped: no outreach-fulfilled line items' };
  }

  const shipping = order.shipping_address || {};

  const matchData = {
    name: shipping.name || '',
    company: shipping.company || '',
    address1: shipping.address1 || '',
    city: shipping.city || '',
    province: shipping.province_code || shipping.province || '',
    zip: shipping.zip || '',
    items: outreachLineItems.map((li) => ({
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
