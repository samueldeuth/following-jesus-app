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
const { sendOutreachOrderEmail } = require('./lib/send-outreach-order-email');
const { sendAlertEmail } = require('./lib/alert');

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
  } catch (err) {
    console.error('Failed to tag order for Outreach matching:', err);
    // Now that lib/shopify.js checks userErrors, this catch block actually
    // fires on a real failure (previously it never would have, since the
    // old code silently returned success even when Shopify's mutation
    // rejected the tag — confirmed on real order FJ8817, Sep 4). Alerting
    // here matters more than the email-failure alert below: a missed tag
    // means the order will never be auto-matched when Outreach's
    // confirmation email arrives later, and nothing else will ever
    // surface that on its own.
    await sendAlertEmail(
      `Failed to tag order ${order.name} for Outreach matching`,
      `Order ${order.name} needs the tag "awaiting-outreach-confirm" added manually in Shopify — the automatic tagging failed.\n\nWithout this tag, the order will not be auto-matched when Outreach's confirmation email arrives.\n\nError: ${err.message}`
    );
    // Still try to send the email below — being untagged just means the
    // later confirmation-matching step won't find it automatically, but
    // Outreach still needs to hear about the order regardless.
  }

  try {
    await sendOutreachOrderEmail(order, outreachLineItems);
    console.log(`Sent order email to Outreach for ${order.name}`);
  } catch (err) {
    console.error(`Failed to send order email to Outreach for ${order.name}:`, err);
    await sendAlertEmail(
      `Failed to email Outreach for order ${order.name}`,
      `Order ${order.name} needs to be manually emailed to Outreach — the automatic email failed.\n\nError: ${err.message}`
    );
  }

  return { statusCode: 200, body: 'OK' };
};
