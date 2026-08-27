// netlify/functions/shopify-order-webhook.js
//
// Receives Shopify's order webhooks. When a paid order includes a
// product matching one of our courses' shopify_product_id, grants that
// buyer access to the course (via the process_shopify_order Postgres
// function) and emails them a direct link.
//
// Subscribed to TWO Shopify webhook topics pointing at this same
// function: "Order payment" (orders/paid) as the primary trigger, and
// "Order creation" (orders/create) as a backup. This is because
// orders/paid is known to sometimes not fire even for a genuinely paid
// order -- a real, documented Shopify platform quirk, not specific to
// this integration. Since orders/create fires before payment
// necessarily clears, this function checks order.financial_status ===
// 'paid' itself before granting anything, so access still only follows
// real payment either way, and process_shopify_order tracks whether
// each grant is new so the same order firing both webhooks doesn't
// double-email anyone.
//
// No Supabase service-role key anywhere -- same pattern as every other
// cross-boundary function in this project (see
// send-weekly-course-reminders.js). This calls a security-definer
// Postgres function using the regular, already-public anon key,
// protected by a shared secret instead of a key that would bypass every
// row-security policy in the database if it ever leaked.
//
// ---------------------------------------------------------------------
// SETUP (do this after uploading the file, in this order):
// ---------------------------------------------------------------------
// 1. Run paywall-schema.sql first, if you haven't already, then also
//    run paywall-dedupe-emails.sql (needed for the is_new tracking this
//    version of the function relies on).
//
// 2. Find the real Shopify product ID for "The Process of Promotion"
//    (the URL slug, 1824415, is NOT reliably the same as the internal
//    product ID -- confirm the real one). In Shopify Admin, open the
//    product to edit it and look at the browser URL:
//      https://admin.shopify.com/store/<yourstore>/products/<PRODUCT_ID>
//    That numeric ID at the end is the one you need.
//
// 3. Run this SQL with the real ID from step 2 (skip if already done):
//      update courses set shopify_product_id = '<the real product id>'
//      where id = '9fd36fd4-8c3d-4305-a7dd-d2a1d7f3abcc';
//
// 4. In Shopify Admin: Settings > Notifications > scroll down to
//    Webhooks > Create webhook -- do this TWICE, once for each event
//    below, both pointing at the exact same URL:
//      Event: Order payment       (topic: orders/paid)
//      Event: Order creation      (topic: orders/create)
//      Format: JSON (both)
//      URL (both): https://followingjesus.com/.netlify/functions/shopify-order-webhook
//    Shopify shows a signing secret on that same page -- it's shared
//    across all webhooks on this store, so you only need to copy it once.
//
// 5. Add these Netlify environment variables (Site settings >
//    Environment variables), both marked as secret:
//      SHOPIFY_WEBHOOK_SECRET         -- from step 4, Shopify's signing secret
//      SHOPIFY_WEBHOOK_FUNCTION_SECRET -- the value embedded in
//                                          paywall-schema.sql, copied exactly
//    RESEND_API_KEY should already be set from the other email functions
//    -- nothing new needed there if so.
//
// 6. Use Shopify's "Send test notification" button on EACH of the two
//    webhooks to confirm both reach this function before relying on it
//    for a real sale. A test notification won't match a real product ID
//    or have financial_status set, so expect a "skipped" response --
//    that still confirms the signature check and connection are working.

const crypto = require('crypto');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const functionSecret = process.env.SHOPIFY_WEBHOOK_FUNCTION_SECRET;
  const resendApiKey = process.env.RESEND_API_KEY;
  const missing = ['SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_WEBHOOK_FUNCTION_SECRET', 'RESEND_API_KEY'].filter(name => !process.env[name]);
  if (missing.length) {
    console.error(`shopify-order-webhook: missing env vars: ${missing.join(', ')}`);
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')} -- see setup notes at the top of this file.` };
  }

  // Verify this actually came from Shopify before trusting anything in
  // it. Computed on the RAW body -- re-serializing the parsed JSON can
  // reorder keys or change whitespace and silently break the signature
  // match, so the raw string is used here, not JSON.parse output.
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '', 'utf8');
  const hmacHeader = event.headers['x-shopify-hmac-sha256'] || event.headers['X-Shopify-Hmac-Sha256'];
  if (!hmacHeader) {
    console.error('shopify-order-webhook: no x-shopify-hmac-sha256 header on the request');
    return { statusCode: 401, body: 'Missing Shopify signature header.' };
  }
  const computedHmac = crypto.createHmac('sha256', shopifySecret).update(rawBody).digest('base64');
  const signaturesMatch =
    Buffer.byteLength(hmacHeader) === Buffer.byteLength(computedHmac) &&
    crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(computedHmac));
  if (!signaturesMatch) {
    console.error('shopify-order-webhook: signature mismatch -- SHOPIFY_WEBHOOK_SECRET likely does not match what Shopify shows for this webhook');
    return { statusCode: 401, body: 'Invalid webhook signature.' };
  }
  console.log('shopify-order-webhook: signature verified OK');

  let order;
  try {
    order = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    console.error('shopify-order-webhook: body was not valid JSON');
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  const customerEmail = (order.email || order.contact_email || order.customer?.email || '').trim().toLowerCase();
  const firstName = order.customer?.first_name || '';
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const productIds = [...new Set(lineItems.map(li => String(li.product_id)).filter(Boolean))];
  console.log(`shopify-order-webhook: order ${order.id || '(no id)'} -- email present: ${!!customerEmail}, financial_status: ${order.financial_status}, product_ids: ${JSON.stringify(productIds)}`);

  // This function is subscribed to BOTH orders/paid and orders/create --
  // orders/create fires for an order the moment it's placed, before
  // payment necessarily clears, so this check is what actually keeps
  // access gated on real payment rather than just "an order exists."
  // orders/paid is kept as the primary trigger (and is checked here too,
  // redundantly but harmlessly) since it's the more precise signal when
  // it does fire -- orders/create is the backup for the cases where
  // orders/paid doesn't, which is a known, documented Shopify quirk and
  // not specific to this integration.
  if (order.financial_status !== 'paid') {
    console.log(`shopify-order-webhook: skipped -- financial_status is "${order.financial_status}", not "paid" yet`);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `financial_status is ${order.financial_status}, not paid` }) };
  }

  if (!customerEmail || productIds.length === 0) {
    // Still a 200 -- this is a legitimate, verified webhook, just not
    // one with anything for us to do. Returning an error here would
    // make Shopify retry it repeatedly for no reason.
    console.log('shopify-order-webhook: skipped -- no email or no line items (expected for Shopify\'s test payload)');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no email or line items on this order' }) };
  }

  // The security-definer function does the real work: matching
  // product_ids against our courses, inserting the purchase row(s),
  // and returning which courses actually matched (and whether each was
  // a brand new grant, so this doesn't double-email someone if both
  // orders/create and orders/paid fire for the same order).
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_shopify_order`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      caller_secret: functionSecret,
      customer_email: customerEmail,
      product_ids: productIds,
      order_id: String(order.id || '')
    })
  });

  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    console.error(`shopify-order-webhook: process_shopify_order RPC failed (${rpcRes.status}): ${errText}`);
    return { statusCode: 502, body: `process_shopify_order call failed: ${errText}` };
  }

  const matchedCourses = await rpcRes.json();
  console.log(`shopify-order-webhook: matched courses: ${JSON.stringify(matchedCourses)}`);
  if (!Array.isArray(matchedCourses) || matchedCourses.length === 0) {
    console.log('shopify-order-webhook: skipped -- none of this order\'s product_ids matched a course.shopify_product_id (expected for Shopify\'s test payload, or if shopify_product_id isn\'t set correctly yet)');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no matching course product in this order' }) };
  }

  const results = [];
  for (const course of matchedCourses) {
    // Only email on a genuinely new grant -- if orders/create already
    // granted this same course+email for this order (or a prior
    // delivery attempt), skip the email rather than sending a second
    // one for the same purchase.
    const emailSent = course.is_new ? await sendAccessEmail(customerEmail, firstName, course.title, resendApiKey) : false;
    results.push({ course: course.title, isNew: course.is_new, emailSent });
  }
  console.log(`shopify-order-webhook: granted access + email results: ${JSON.stringify(results)}`);

  return { statusCode: 200, body: JSON.stringify({ processed: results }) };
};

async function sendAccessEmail(toEmail, firstName, courseTitle, apiKey) {
  const courseUrl = `${APP_URL}/theprocessofpromotion`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p>Hi${firstName ? ' ' + escapeHtml(firstName) : ''},</p>
      <p>Thanks for purchasing <strong>${escapeHtml(courseTitle)}</strong>! Your course access is ready.</p>
      <p style="margin: 28px 0;">
        <a href="${courseUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Start the Course →</a>
      </p>
      <p style="color:#666;font-size:13px;">Sign in with Google using this same email address (${escapeHtml(toEmail)}) to unlock it -- that's how we match your purchase to your account.</p>
    </div>
  `;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: toEmail,
        subject: `Your access to ${courseTitle} is ready`,
        html
      })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
