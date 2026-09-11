// netlify/functions/lib/parse-squarespace-order.js
//
// Parses a forwarded Squarespace "A New Order has Arrived" order
// notification email. Built entirely from two real screenshots of what
// this email looks like rendered -- NOT from the actual raw HTML
// markup, which hasn't been seen. This is a genuine, real limitation:
// Squarespace's order-summary table could turn into differently-
// ordered plain text than expected once HTML tags are stripped, which
// is exactly why this deliberately does NOT try to parse exact
// quantities per line item the way the Shopify order pipeline does.
//
// Instead: strips to plain text, extracts what's reliably locatable by
// label (order number, shipping block, customer email), and returns
// the raw "Order Summary" section as a human-readable text block for
// a person to visually double-check against the original email, rather
// than a structured line-items array claiming a certainty this parser
// doesn't actually have.
//
// Confirm this works correctly against a REAL order once deployed --
// check this function's logs after a genuine Squarespace purchase
// comes through, same caution shopify-church-signup-webhook.js gives
// its own unconfirmed field.

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseSquarespaceOrder(html, subject) {
  const text = stripHtml(html || '');

  // Subject looks like: "SAMUELDEUTH.COM: A New Order has Arrived (03191)"
  const subjectOrderMatch = (subject || '').match(/\((\w+)\)/);
  const bodyOrderMatch = text.match(/Order #(\w+)/i);
  const orderNumber = (subjectOrderMatch && subjectOrderMatch[1]) || (bodyOrderMatch && bodyOrderMatch[1]) || null;

  const emailMatch = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
  const customerEmail = emailMatch ? emailMatch[0] : null;

  // Captures the text after "SHIPPING TO:" up to the next likely
  // section boundary -- not split into individual fields (name,
  // street, city, etc.) since the exact original line breaks aren't
  // preserved once HTML is stripped to plain text.
  const shippingMatch = text.match(/SHIPPING TO:\s*(.+?)(?=Order Summary|ITEM\s|$)/i);
  const shippingBlock = shippingMatch ? shippingMatch[1].trim() : null;

  // Raw text block, not structured line items -- see file header for
  // why. A person reads this to confirm what was actually ordered.
  const summaryMatch = text.match(/Order Summary\s*(.+?)(?=Item Subtotal|Additional Information|$)/i);
  const orderSummaryText = summaryMatch ? summaryMatch[1].trim() : null;

  return { orderNumber, customerEmail, shippingBlock, orderSummaryText, fullText: text };
}

// Case-insensitive substring match against the known outreach-fulfilled
// product list -- kept here as a simple, editable array rather than a
// Shopify-style tag lookup, since there's no Squarespace API access set
// up for this project. Add a new product name here whenever Outreach
// starts fulfilling something new sold through Squarespace.
const OUTREACH_FULFILLED_PRODUCTS = [
  'Water Baptism - Handbook (10 Pack)',
  'FOLLOWING JESUS at Christmas',
  '52 Bible Verses on Miracles',
  'Following Jesus Journal',
  '52 Bible Verses for New Believers',
  '52 Bible Verses for Men',
  '52 Bible Verses On Hope',
  '52 Bible Verses To Teach Your Kids',
  'Following Jesus | Wristband',
  "2'7\" x 6'7\" Vinyl RollUp Following Jesus Banner & Stand",
  '2\'7" x 6\'7" Stretch "Sleeve" Following Jesus Banner & Stand',
  'Siguiendo A Jesús',
  'Following Jesus — New Believer Discipleship Book',
];

function matchedOutreachProducts(orderSummaryText) {
  if (!orderSummaryText) return [];
  return OUTREACH_FULFILLED_PRODUCTS.filter(p => orderSummaryText.toLowerCase().includes(p.toLowerCase()));
}

module.exports = { parseSquarespaceOrder, matchedOutreachProducts, OUTREACH_FULFILLED_PRODUCTS };
