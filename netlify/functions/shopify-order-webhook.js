// netlify/functions/shopify-order-webhook.js
//
// Receives Shopify's "Order payment" webhook. When a paid order includes
// a product matching one of our courses' shopify_product_id, grants that
// buyer access to the course (via the process_shopify_order Postgres
// function) and emails them a direct link.
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
// 1. Run paywall-schema.sql first, if you haven't already.
//
// 2. Find the real Shopify product ID for "The Process of Promotion"
//    (the URL slug, 1824415, is NOT reliably the same as the internal
//    product ID -- confirm the real one). In Shopify Admin, open the
//    product to edit it and look at the browser URL:
//      https://admin.shopify.com/store/<yourstore>/products/<PRODUCT_ID>
//    That numeric ID at the end is the one you need.
//
// 3. Run this SQL with the real ID from step 2:
//      update courses set shopify_product_id = '<the real product id>'
//      where id = '9fd36fd4-8c3d-4305-a7dd-d2a1d7f3abcc';
//
// 4. In Shopify Admin: Settings > Notifications > scroll down to
//    Webhooks > Create webhook.
//      Event: Order payment
//      Format: JSON
//      URL: https://followingjesus.com/.netlify/functions/shopify-order-webhook
//    Shopify shows a signing secret on that same page -- copy it.
//
// 5. Add these Netlify environment variables (Site settings >
//    Environment variables), both marked as secret:
//      SHOPIFY_WEBHOOK_SECRET         -- from step 4, Shopify's signing secret
//      SHOPIFY_WEBHOOK_FUNCTION_SECRET -- the value embedded in
//                                          paywall-schema.sql, copied exactly
//    RESEND_API_KEY should already be set from the other email functions
//    -- nothing new needed there if so.
//
// 6. Use Shopify's "Send test notification" button on the webhook to
//    confirm it reaches this function before relying on it for a real
//    sale. A test notification won't match a real product ID, so expect
//    a "skipped" response -- that still confirms the signature check
//    and connection are working.

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
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')} -- see setup notes at the top of this file.` };
  }

  // Verify this actually came from Shopify before trusting anything in
  // it. Computed on the RAW body -- re-serializing the parsed JSON can
  // reorder keys or change whitespace and silently break the signature
  // match, so the raw string is used here, not JSON.parse output.
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '', 'utf8');
  const hmacHeader = event.headers['x-shopify-hmac-sha256'] || event.headers['X-Shopify-Hmac-Sha256'];
  if (!hmacHeader) {
    return { statusCode: 401, body: 'Missing Shopify signature header.' };
  }
  const computedHmac = crypto.createHmac('sha256', shopifySecret).update(rawBody).digest('base64');
  const signaturesMatch =
    Buffer.byteLength(hmacHeader) === Buffer.byteLength(computedHmac) &&
    crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(computedHmac));
  if (!signaturesMatch) {
    return { statusCode: 401, body: 'Invalid webhook signature.' };
  }

  let order;
  try {
    order = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  const customerEmail = (order.email || order.contact_email || order.customer?.email || '').trim().toLowerCase();
  const firstName = order.customer?.first_name || '';
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const productIds = [...new Set(lineItems.map(li => String(li.product_id)).filter(Boolean))];

  if (!customerEmail || productIds.length === 0) {
    // Still a 200 -- this is a legitimate, verified webhook, just not
    // one with anything for us to do. Returning an error here would
    // make Shopify retry it repeatedly for no reason.
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no email or line items on this order' }) };
  }

  // The security-definer function does the real work: matching
  // product_ids against our courses, inserting the purchase row(s),
  // and returning which courses actually matched.
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
    return { statusCode: 502, body: `process_shopify_order call failed: ${await rpcRes.text()}` };
  }

  const matchedCourses = await rpcRes.json();
  if (!Array.isArray(matchedCourses) || matchedCourses.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no matching course product in this order' }) };
  }

  const results = [];
  for (const course of matchedCourses) {
    const emailSent = await sendAccessEmail(customerEmail, firstName, course.title, resendApiKey);
    results.push({ course: course.title, emailSent });
  }

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
