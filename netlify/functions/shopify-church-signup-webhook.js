// netlify/functions/shopify-church-signup-webhook.js
//
// Handles the initial purchase of "The Following Jesus Course" --
// creates a new church (status: pending_approval) on a genuinely new
// customer's first order, does nothing on a renewal (same customer,
// recurring subscription charge). On a genuinely new signup, sends
// TWO emails: one to Samuel (a new church is waiting for review) and
// one to the purchaser themselves, with a secure link to fill in their
// church's real name, contact info, pastor info, and optional custom
// welcome message before Samuel reviews and approves it.
//
// Subscribed to both "Order payment" (orders/paid) and "Order
// creation" (orders/create), same reasoning as the Process of
// Promotion integration: orders/paid is known to sometimes not fire
// even for a genuinely paid order, so orders/create is the backup --
// and since this function checks financial_status itself, having both
// wired up can't accidentally create a church for an unpaid order.
//
// No Supabase service-role key anywhere -- same pattern as every other
// server-side function in this project.
//
// ---------------------------------------------------------------------
// SETUP:
// ---------------------------------------------------------------------
// 1. Run shopify-church-signup-schema.sql first.
//
// 2. In Shopify Admin: Settings > Notifications > Webhooks > Create
//    webhook, twice:
//      Event: Order payment       URL: (this function's URL)
//      Event: Order creation      URL: (same URL)
//    Format: JSON for both. Signing secret is shared across all
//    webhooks on this store -- same one already in
//    SHOPIFY_WEBHOOK_SECRET if that's already set from Process of
//    Promotion; if not, copy it from this page.
//
// 3. Add these Netlify environment variables (marked secret):
//      SHOPIFY_WEBHOOK_SECRET           -- Shopify's signing secret (shared store-wide)
//      SHOPIFY_CHURCH_SIGNUP_SECRET     -- the value embedded in
//                                          shopify-church-signup-schema.sql
//      CHURCH_SIGNUP_NOTIFY_EMAIL        -- the email address that
//                                           should get "new church
//                                           waiting for review" emails
//    RESEND_API_KEY should already be set.
//
// 4. IMPORTANT -- the subscription_contract_id extraction below is a
//    best guess at where Shopify puts this on an order payload; it
//    could not be confirmed from documentation alone. Check this
//    function's logs after a real test purchase (ideally the $50/mo
//    subscription option, not the one-time purchase, since only a
//    subscription actually has a contract) to see what
//    "raw order keys touching subscription" logs -- if it's empty or
//    looks wrong, this needs a follow-up fix once we can see the real
//    payload shape.

const crypto = require('crypto');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_EMAIL = 'Following Jesus <approvals@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';
// This product's ID -- confirmed from Shopify Admin (product edit page
// URL), not the storefront slug, same lesson as Process of Promotion.
const CHURCH_SIGNUP_PRODUCT_ID = '4546123071584';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const functionSecret = process.env.SHOPIFY_CHURCH_SIGNUP_SECRET;
  const resendApiKey = process.env.RESEND_API_KEY;
  const notifyEmail = process.env.CHURCH_SIGNUP_NOTIFY_EMAIL;
  const missing = ['SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_CHURCH_SIGNUP_SECRET', 'RESEND_API_KEY', 'CHURCH_SIGNUP_NOTIFY_EMAIL'].filter(name => !process.env[name]);
  if (missing.length) {
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')}` };
  }

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
    console.error('shopify-church-signup-webhook: signature mismatch');
    return { statusCode: 401, body: 'Invalid webhook signature.' };
  }
  console.log('shopify-church-signup-webhook: signature verified OK');

  let order;
  try {
    order = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const productIds = lineItems.map(li => String(li.product_id));
  if (!productIds.includes(CHURCH_SIGNUP_PRODUCT_ID)) {
    console.log('shopify-church-signup-webhook: skipped -- not this product');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'not the church signup product' }) };
  }

  if (order.financial_status !== 'paid') {
    console.log(`shopify-church-signup-webhook: skipped -- financial_status is "${order.financial_status}", not paid yet`);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `financial_status is ${order.financial_status}` }) };
  }

  const customerEmail = (order.email || order.contact_email || order.customer?.email || '').trim().toLowerCase();
  const customerName = [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ') || null;
  const companyName = order.billing_address?.company || order.shipping_address?.company || null;
  const shopifyCustomerId = order.customer?.id ? String(order.customer.id) : null;

  // Best-guess extraction -- see setup note #4 at the top of this file.
  // Logged explicitly so the real shape can be confirmed from a real
  // test order.
  const subscriptionContractId =
    lineItems.find(li => li.selling_plan_allocation)?.selling_plan_allocation?.selling_plan?.id
    ? String(lineItems.find(li => li.selling_plan_allocation).selling_plan_allocation.selling_plan.id)
    : null;
  console.log(`shopify-church-signup-webhook: order ${order.id} -- customer_id: ${shopifyCustomerId}, subscription fields present: ${JSON.stringify(lineItems.map(li => Object.keys(li).filter(k => k.toLowerCase().includes('selling') || k.toLowerCase().includes('subscription'))))}`);

  if (!customerEmail || !shopifyCustomerId) {
    console.log('shopify-church-signup-webhook: skipped -- missing email or customer id');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'missing email or customer id' }) };
  }

  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_church_signup_order`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      caller_secret: functionSecret,
      customer_email: customerEmail,
      customer_name: customerName,
      company_name: companyName,
      p_shopify_customer_id: shopifyCustomerId,
      p_subscription_contract_id: subscriptionContractId,
      order_id: String(order.id || '')
    })
  });

  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    console.error(`shopify-church-signup-webhook: process_church_signup_order failed: ${errText}`);
    return { statusCode: 502, body: `process_church_signup_order failed: ${errText}` };
  }

  const result = await rpcRes.json();
  console.log(`shopify-church-signup-webhook: result: ${JSON.stringify(result)}`);

  if (!result.is_new) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'existing church (renewal), no action needed' }) };
  }

  const emailSent = await notifySamuel(result.name, customerEmail, notifyEmail, resendApiKey);
  const purchaserEmailSent = result.signup_token
    ? await notifyPurchaser(customerEmail, result.name, result.signup_token, resendApiKey)
    : false;
  if (!result.signup_token) {
    console.error('shopify-church-signup-webhook: no signup_token returned from process_church_signup_order -- purchaser was NOT emailed a completion link. Run add-church-signup-completion-flow.sql if this is unexpected.');
  }
  return { statusCode: 200, body: JSON.stringify({ created: true, churchId: result.church_id, name: result.name, notifyEmailSent: emailSent, purchaserEmailSent }) };
};

async function notifyPurchaser(purchaserEmail, churchName, signupToken, apiKey) {
  const completionUrl = `${APP_URL}/church-signup-complete.html?token=${signupToken}`;
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p>Thanks for getting your church started with the Following Jesus course!</p>
      <p>Before your church's page goes live, we need a few details from you -- your church name, contact info, and (optionally) a custom welcome message for your students.</p>
      <p style="margin: 28px 0;">
        <a href="${completionUrl}" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Complete Your Church Setup →</a>
      </p>
      <p style="color:#666;font-size:13px;">Takes about 2 minutes. Once submitted, our team will review it and get your page live.</p>
    </div>
  `;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: purchaserEmail,
        reply_to: 'info@followingjesusbook.com',
        subject: `Finish setting up your church's Following Jesus page`,
        html,
      }),
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function notifySamuel(churchName, purchaserEmail, notifyEmail, apiKey) {
  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px;">
      <p>A new church just purchased The Following Jesus Course and is waiting for you to review.</p>
      <p><strong>Starting name:</strong> ${escapeHtml(churchName)}<br>
      <strong>Purchaser email:</strong> ${escapeHtml(purchaserEmail)}</p>
      <p style="margin: 20px 0;">
        <a href="${APP_URL}/admin" style="background:#0a0a0a;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">Review in Admin Dashboard →</a>
      </p>
      <p style="color:#666;font-size:13px;">This name came from the checkout's Company field (if filled in) or the purchaser's own name -- worth confirming the real church name before approving.</p>
    </div>
  `;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: FROM_EMAIL, to: notifyEmail, subject: `New church pending approval: ${churchName}`, html })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
