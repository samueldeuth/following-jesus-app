// netlify/functions/bold-subscription-webhook.js
//
// Receives Bold Subscriptions' own webhook events -- NOT Shopify's
// native subscription webhooks. Bold owns and manages the actual
// SubscriptionContract objects for this store (via Bold Subscriptions
// for Shopify Checkout), so Shopify's native subscription_contracts/*
// and subscription_billing_attempts/* webhooks never fire for
// Bold-managed subscriptions -- confirmed during testing, not a guess.
// Bold has its own separate webhook system that DOES fire reliably,
// which is what this function listens to instead.
//
// Handles four Bold webhook topics, distinguished by the numeric
// webhook_topic_id embedded in each payload (confirmed real ids via
// Bold's List Webhook Topics endpoint for this shop -- ids are NOT
// guessed, and are NOT guaranteed the same across other Bold shops):
//   12  subscription_cancelled                    -> marks church lapsed
//   6   subscription_order_transaction_failed      -> marks church lapsed
//        (a recurring monthly charge failing -- this is the one that
//        matters most for ongoing subscriptions, since the *initial*
//        transaction failing means no church was ever created)
//   20  subscription_payment_failed                -> marks church lapsed
//        (failure of the *initial* transaction -- included for
//        completeness/logging, though in practice no church row would
//        exist yet to mark lapsed in this case)
//   15  subscription_reactivated                   -> clears the lapse
//
// Signature verification: Bold signs every webhook payload with a
// SHA-256 HMAC in the `x-bold-signature` header, computed from the raw
// payload and a shared_secret YOU chose when registering the webhook
// subscription (BOLD_WEBHOOK_SIGNING_SECRET below) -- this is a
// different secret from BOLD_SHARED_SECRET, which only authenticates
// API *token* access, not webhook payloads.
//
// Matching a Bold event back to a church: rather than depend on Bold's
// own subscription external_id/id (which would require correctly
// capturing an opaque Bold identifier at signup time -- something we
// don't have reliable visibility into), this matches on the Shopify
// customer id instead. Bold syncs customer data from Shopify, so its
// subscription payloads include the underlying platform (Shopify)
// customer id -- and shopify_church_signup_webhook.js already stores
// shopify_customer_id correctly and reliably (confirmed via real test).
// One church has exactly one Shopify customer, so this is an
// unambiguous match with no dependency on Bold-specific identifiers.

//
// No Supabase service-role key -- same pattern as every other
// server-side function in this project.
//
// ---------------------------------------------------------------------
// SETUP:
// ---------------------------------------------------------------------
// 1. Add BOLD_WEBHOOK_SIGNING_SECRET to Netlify env vars (already done
//    if you're reading this after the initial setup conversation).
// 2. Upload this file to netlify/functions/.
// 3. Run bold-register-subscription-webhooks.js once (see that file's
//    own header) to actually register these 4 webhook subscriptions
//    with Bold -- uploading this handler alone does NOT make Bold
//    start sending events, the registration call is a separate step.

const crypto = require('crypto');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

// Confirmed real topic ids for this shop via Bold's List Webhook Topics
// endpoint -- see bold-list-webhook-topics.js (already deleted after
// use). Do not assume these ids are the same on a different shop.
const TOPIC_IDS = {
  SUBSCRIPTION_CANCELLED: 12,
  SUBSCRIPTION_ORDER_TRANSACTION_FAILED: 6,
  SUBSCRIPTION_PAYMENT_FAILED: 20,
  SUBSCRIPTION_REACTIVATED: 15,
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const signingSecret = process.env.BOLD_WEBHOOK_SIGNING_SECRET;
  const functionSecret = process.env.SHOPIFY_CHURCH_SIGNUP_SECRET; // reused -- same RPCs as the Shopify-side lapse/renew functions
  const missing = ['BOLD_WEBHOOK_SIGNING_SECRET', 'SHOPIFY_CHURCH_SIGNUP_SECRET'].filter(name => !process.env[name]);
  if (missing.length) {
    console.error(`bold-subscription-webhook: missing env vars: ${missing.join(', ')}`);
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')}` };
  }

  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '', 'utf8');
  const boldSignature = event.headers['x-bold-signature'] || event.headers['X-Bold-Signature'];
  if (!boldSignature) {
    console.error('bold-subscription-webhook: no x-bold-signature header on the request');
    return { statusCode: 401, body: 'Missing Bold signature header.' };
  }

  const computedSignature = crypto.createHmac('sha256', signingSecret).update(rawBody).digest('hex');
  const signaturesMatch =
    Buffer.byteLength(boldSignature) === Buffer.byteLength(computedSignature) &&
    crypto.timingSafeEqual(Buffer.from(boldSignature), Buffer.from(computedSignature));
  if (!signaturesMatch) {
    console.error('bold-subscription-webhook: signature mismatch -- BOLD_WEBHOOK_SIGNING_SECRET likely does not match what was registered with Bold');
    return { statusCode: 401, body: 'Invalid webhook signature.' };
  }
  console.log('bold-subscription-webhook: signature verified OK');

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    console.error('bold-subscription-webhook: body was not valid JSON');
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  // Bold's webhook payloads wrap the event data under a topic-specific
  // key -- logging the raw keys so we can confirm the real shape on
  // first delivery rather than guessing.
  console.log(`bold-subscription-webhook: payload keys: ${JSON.stringify(Object.keys(payload))}`);

  const topicId = payload.webhook_topic_id || (payload.subscription && payload.subscription.webhook_topic_id);
  if (!topicId) {
    console.log('bold-subscription-webhook: skipped -- no webhook_topic_id found on payload');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no webhook_topic_id on payload' }) };
  }

  let action = null;
  if ([TOPIC_IDS.SUBSCRIPTION_CANCELLED, TOPIC_IDS.SUBSCRIPTION_ORDER_TRANSACTION_FAILED, TOPIC_IDS.SUBSCRIPTION_PAYMENT_FAILED].includes(topicId)) {
    action = 'lapsed';
  } else if (topicId === TOPIC_IDS.SUBSCRIPTION_REACTIVATED) {
    action = 'renewed';
  }

  if (!action) {
    console.log(`bold-subscription-webhook: skipped -- topic id ${topicId} is not one we act on`);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: `topic id ${topicId} not actionable` }) };
  }

  // Bold's subscription object should be under payload.subscription for
  // most topics -- logged explicitly since this is the first real
  // delivery and the exact shape needs confirming, same caution as
  // every other webhook in this project that started as a best guess.
  // Looking specifically for the underlying Shopify customer id, which
  // Bold syncs from the platform -- commonly platform_customer_id on
  // the customer or billing/shipping address sub-objects.
  const subscription = payload.subscription || payload;
  const shopifyCustomerId =
    subscription.platform_customer_id ||
    (subscription.customer && subscription.customer.platform_customer_id) ||
    (subscription.billing_address && subscription.billing_address.platform_customer_id) ||
    null;

  console.log(`bold-subscription-webhook: topic ${topicId} (${action}) -- extracted shopify_customer_id: ${shopifyCustomerId}, raw subscription keys: ${JSON.stringify(Object.keys(subscription))}`);

  if (!shopifyCustomerId) {
    console.log('bold-subscription-webhook: skipped -- could not find platform_customer_id anywhere on payload; check the logged raw keys above to find the real field');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no shopify_customer_id found on payload' }) };
  }

  const rpcName = action === 'lapsed' ? 'mark_church_subscription_lapsed' : 'mark_church_subscription_renewed';
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: functionSecret, p_shopify_customer_id: String(shopifyCustomerId) })
  });

  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    console.error(`bold-subscription-webhook: ${rpcName} failed: ${errText}`);
    return { statusCode: 502, body: `${rpcName} failed: ${errText}` };
  }

  console.log(`bold-subscription-webhook: applied ${action} for shopify_customer_id ${shopifyCustomerId}`);
  return { statusCode: 200, body: JSON.stringify({ action, shopifyCustomerId, topicId }) };
};
