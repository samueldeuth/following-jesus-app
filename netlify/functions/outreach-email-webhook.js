// Fires on Resend's email.received webhook. Handles the two Outreach email
// types that matter for fulfillment:
//   1. "Outreach Order #M1556390 Confirmation" — matches back to a Shopify
//      order by shipping name/address (Outreach never echoes the Shopify
//      order number), then tags that order outreach:M1556390 and moves its
//      fulfillment status to "In Progress" so it no longer sits as a flat
//      Unfulfilled while Outreach is actually working on it.
//   2. "Shipping Notification from Outreach Inc." — looks up the order by
//      that outreach:<number> tag and fulfills it with tracking.
//
// Setup needed:
//   - Resend: Receiving domain configured, webhook subscribed to
//     email.received, pointed at
//     https://followingjesus.com/.netlify/functions/outreach-email-webhook
//   - Have Outreach's confirmation + shipping emails forwarded (or CC'd) to
//     that receiving address.
//   - Env vars: RESEND_API_KEY (existing), RESEND_WEBHOOK_SECRET (new,
//     specific to this webhook endpoint — from its Resend dashboard page),
//     SHOPIFY_STORE_DOMAIN, SHOPIFY_ADMIN_API_ACCESS_TOKEN, ALERT_EMAIL_TO
//     (where to send "couldn't match this order" notices — e.g. Samuel's
//     own address).

const { verifyResendWebhook } = require('./lib/verify');
const {
  findAwaitingOutreachOrders,
  markOrderMatchedToOutreach,
  markOrderInProgress,
  findOrderByOutreachNumber,
  fulfillOrderWithTracking,
} = require('./lib/shopify');
const { parseConfirmationEmail, parseShippingEmail, isMatch, normalize } = require('./lib/parse-outreach');
const { parseSquarespaceOrder, matchedOutreachProducts } = require('./lib/parse-squarespace-order');

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

async function fetchReceivedEmail(emailId) {
  const res = await fetch(`https://api.resend.com/emails/receiving/${emailId}`, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to fetch received email ${emailId}: ${res.status}`);
  }
  return res.json();
}

async function handleConfirmationEmail(outreachOrderNumber, html) {
  const { shippingBlockText, shippingBlob } = parseConfirmationEmail(html);

  if (!shippingBlockText) {
    console.warn(`Could not find a "Shipping Address" block in confirmation ${outreachOrderNumber}`);
  }

  const sinceDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const candidates = await findAwaitingOutreachOrders(sinceDate);

  const scored = candidates
    .map((order) => {
      if (!order.matchData || !order.matchData.value) return null;
      const data = JSON.parse(order.matchData.value);
      return { order, data, matched: isMatch(data, shippingBlob) };
    })
    .filter((c) => c && c.matched);

  if (scored.length === 0) {
    await sendAlertEmail(
      `Outreach order ${outreachOrderNumber} — no Shopify order match found`,
      `Couldn't automatically match Outreach order ${outreachOrderNumber} to any Shopify order awaiting confirmation (searched last 14 days).\n\nShipping block found in the email:\n${shippingBlockText || '(none found)'}\n\nYou'll need to tag the matching Shopify order manually: add tag outreach:${outreachOrderNumber}`
    );
    return;
  }

  if (scored.length > 1) {
    await sendAlertEmail(
      `Outreach order ${outreachOrderNumber} — multiple possible Shopify matches`,
      `Found ${scored.length} Shopify orders that could match Outreach order ${outreachOrderNumber}: ${scored.map((s) => s.order.name).join(', ')}.\n\nPicked ${scored[0].order.name} automatically (first match) — double check this is right, and manually fix the tag if not.`
    );
  }

  const best = scored[0];
  await markOrderMatchedToOutreach(best.order.id, outreachOrderNumber, best.order.note);
  console.log(`Matched Outreach order ${outreachOrderNumber} to Shopify order ${best.order.name}`);

  // Nudge the order's display status to "In Progress" now that Outreach has
  // confirmed they have it. Fully isolated and non-fatal — see
  // markOrderInProgress's own comment in lib/shopify.js for why this
  // deliberately can't affect the match/tag/note logic above, even if it
  // fails due to a missing scope or an unsupported location type.
  await markOrderInProgress(best.order.id, best.order.name);
}

async function handleShippingEmail(outreachOrderNumber, html) {
  const { trackingNumber, trackingCompany, trackingUrl } = parseShippingEmail(html);

  if (!trackingNumber) {
    await sendAlertEmail(
      `Outreach shipping email for ${outreachOrderNumber} — couldn't parse tracking number`,
      `Got a shipping notification for Outreach order ${outreachOrderNumber} but couldn't extract a tracking number from it.`
    );
    return;
  }

  const matches = await findOrderByOutreachNumber(outreachOrderNumber);

  if (matches.length !== 1) {
    await sendAlertEmail(
      `Outreach shipping email for ${outreachOrderNumber} — order not found`,
      `Got a shipping notification for Outreach order ${outreachOrderNumber} (tracking ${trackingNumber}) but found ${matches.length} Shopify orders tagged outreach:${outreachOrderNumber}. This order needs to be fulfilled manually with this tracking number.`
    );
    return;
  }

  const order = matches[0];
  try {
    await fulfillOrderWithTracking(order, { trackingNumber, trackingCompany, trackingUrl });
    console.log(`Fulfilled ${order.name} with tracking ${trackingNumber}`);
  } catch (err) {
    console.error(`Failed to fulfill ${order.name}:`, err);
    await sendAlertEmail(
      `Failed to auto-fulfill ${order.name} (Outreach ${outreachOrderNumber})`,
      `Tracking number ${trackingNumber} (${trackingCompany}) needs to be added manually. Error: ${err.message}`
    );
  }
}

// A forwarded Squarespace order-notification email -- a genuinely
// separate concern from the two Outreach-email types above (this isn't
// a reply FROM Outreach, it's a NEW order that might NEED to go TO
// Outreach). Deliberately does NOT try to auto-tag or auto-fulfill
// anything the way the Shopify pipeline does -- instead sends a clear,
// honest "here's what was detected, please verify" alert, since the
// underlying parser (see lib/parse-squarespace-order.js) is built from
// screenshots, not confirmed real HTML, and the line items aren't
// parsed into exact structured quantities on purpose.
async function handleSquarespaceOrderEmail(html, subject) {
  const parsed = parseSquarespaceOrder(html, subject);
  const matched = matchedOutreachProducts(parsed.orderSummaryText);

  if (matched.length === 0) {
    // Not an outreach-fulfilled product -- nothing to do, same as most
    // Squarespace orders (course purchases, digital-only items, etc.).
    console.log(`Squarespace order ${parsed.orderNumber || '(unknown)'}: no outreach-fulfilled products detected, skipping.`);
    return;
  }

  const to = process.env.ALERT_EMAIL_TO;
  if (!to || !process.env.RESEND_API_KEY) {
    console.error('Squarespace order needs Outreach fulfillment but ALERT_EMAIL_TO or RESEND_API_KEY is not set -- nobody was notified.');
    return;
  }

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: 'Following Jesus Books <no-reply@mail.followingjesus.com>',
      to: [to],
      reply_to: 'info@followingjesusbook.com',
      subject: `Squarespace order ${parsed.orderNumber || ''} needs Outreach fulfillment — please verify`,
      text: `A Squarespace order was detected containing at least one outreach-fulfilled product. Since this is auto-detected from a forwarded order email (not Shopify's own structured order data), please verify the details below against the original email before sending anything to Outreach.\n\nOrder #: ${parsed.orderNumber || '(not found)'}\nCustomer email: ${parsed.customerEmail || '(not found)'}\n\nShipping info (raw, as detected):\n${parsed.shippingBlock || '(not found -- check the original email)'}\n\nMatched outreach-fulfilled product(s):\n${matched.map(m => '- ' + m).join('\n')}\n\nFull order summary (raw, as detected):\n${parsed.orderSummaryText || '(not found -- check the original email)'}`
    })
  }).catch(err => console.error('Squarespace order alert email failed to send:', err));

  console.log(`Squarespace order ${parsed.orderNumber || '(unknown)'}: matched outreach-fulfilled product(s), alert sent to ${to}.`);
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const rawBody = event.body;
  const valid = verifyResendWebhook(rawBody, event.headers, process.env.RESEND_WEBHOOK_SECRET);
  if (!valid) {
    return { statusCode: 401, body: 'Invalid signature' };
  }

  const payload = JSON.parse(rawBody);
  if (payload.type !== 'email.received') {
    return { statusCode: 200, body: 'Ignored non-email.received event' };
  }

  const subject = payload.data.subject || '';
  const emailId = payload.data.email_id;

  const confirmationMatch = subject.match(/Outreach Order #([A-Za-z0-9]+) Confirmation/i);
  const shippingMatch = subject.match(/Shipping Notification from Outreach/i);
  const squarespaceOrderMatch = subject.match(/A New Order has Arrived/i);

  if (!confirmationMatch && !shippingMatch && !squarespaceOrderMatch) {
    // Not an email we recognize — ignore quietly.
    return { statusCode: 200, body: 'Not a recognized order email, ignored' };
  }

  const email = await fetchReceivedEmail(emailId);
  const html = email.html || '';

  try {
    if (confirmationMatch) {
      await handleConfirmationEmail(confirmationMatch[1], html);
    } else if (shippingMatch) {
      const { orderNumber } = parseShippingEmail(html);
      if (!orderNumber) {
        await sendAlertEmail(
          'Outreach shipping email — could not find order number',
          `Got a shipping notification email but couldn't find "Order# ..." in the body. Subject: ${subject}`
        );
        return { statusCode: 200, body: 'Could not parse order number' };
      }
      await handleShippingEmail(orderNumber, html);
    } else {
      await handleSquarespaceOrderEmail(html, subject);
    }
  } catch (err) {
    console.error('Error processing Outreach email:', err);
    // Still 200 — we don't want Resend retry-storming us, and the alert
    // email inside each handler already covers the "needs manual attention"
    // case for expected failures. This catch is for unexpected ones.
    await sendAlertEmail('Outreach email processing error', `Unexpected error: ${err.message}\n\nSubject: ${subject}`);
  }

  return { statusCode: 200, body: 'OK' };
};
