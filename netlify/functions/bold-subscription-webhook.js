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
// Handles events for the four Bold webhook topics this project
// registered (subscription_cancelled, subscription_order_transaction_failed,
// subscription_payment_failed, subscription_reactivated). Bold's payload
// body does NOT include a topic field -- but a real live delivery
// revealed Bold DOES send the topic name via an `event-identifier`
// request header (e.g. "subscription_reactivated"), confirmed from
// actual production traffic, not documentation. That header is the
// primary signal used below. As a defensive fallback (in case a future
// Bold payload arrives without that header for any reason), this also
// derives an action from the subscription's actual state:
//   subscription_status === 'inactive'  -> lapsed (covers cancellation;
//     Bold's own docs confirm a cancelled subscription shows as inactive)
//   subscription_status === 'active' AND last_failure_code present
//     -> lapsed (a recurring or initial transaction failed, but the
//     subscription is still within its retry window)
//   subscription_status === 'active' AND no failure present -> renewed
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

// Real Bold event-identifier header values for the four topics this
// project registered -- confirmed from a live delivery's actual
// request headers, not guessed from documentation.
const LAPSE_EVENT_IDENTIFIERS = [
  'subscription_cancelled',
  'subscription_order_transaction_failed',
  'subscription_payment_failed',
];
const RENEW_EVENT_IDENTIFIERS = ['subscription_reactivated'];

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

  // Log all headers once -- useful in case Bold does communicate the
  // topic via a header we haven't identified yet, even though it's not
  // needed for the status-based logic below to work correctly.
  console.log(`bold-subscription-webhook: headers: ${JSON.stringify(event.headers)}`);
  console.log(`bold-subscription-webhook: payload keys: ${JSON.stringify(Object.keys(payload))}`);

  // Bold's payload is the raw Subscription entity itself -- no wrapper,
  // no topic field in the body. subscription_status, last_failure_code,
  // and current_retries are used only as a defensive fallback below.
  const subscription = payload.subscription || payload;

  // Primary signal: the real event-identifier header, confirmed from a
  // live delivery.
  const eventIdentifier = event.headers['event-identifier'] || event.headers['Event-Identifier'];
  console.log(`bold-subscription-webhook: event-identifier header: ${eventIdentifier}`);

  let action = null;
  if (eventIdentifier && LAPSE_EVENT_IDENTIFIERS.includes(eventIdentifier)) {
    action = 'lapsed';
  } else if (eventIdentifier && RENEW_EVENT_IDENTIFIERS.includes(eventIdentifier)) {
    action = 'renewed';
  } else {
    // Fallback -- only reached if the header is missing or holds an
    // unrecognized value, which shouldn't normally happen given this
    // endpoint is only registered for the four topics above.
    const status = subscription.subscription_status;
    const hasRecentFailure = !!subscription.last_failure_code;
    console.log(`bold-subscription-webhook: event-identifier missing/unrecognized ("${eventIdentifier}") -- falling back to status-based detection. subscription_status: ${status}, last_failure_code: ${subscription.last_failure_code}, current_retries: ${subscription.current_retries}`);
    if (status === 'inactive') {
      action = 'lapsed';
    } else if (status === 'active' && hasRecentFailure) {
      action = 'lapsed';
    } else if (status === 'active' && !hasRecentFailure) {
      action = 'renewed';
    }
  }

  console.log(`bold-subscription-webhook: derived action: ${action}`);

  if (!action) {
    console.log(`bold-subscription-webhook: skipped -- could not derive an action (event-identifier: ${eventIdentifier}, subscription_status: ${subscription.subscription_status})`);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'could not derive action', eventIdentifier }) };
  }

  // Looking for the underlying Shopify customer id, which Bold syncs
  // from the platform -- commonly platform_customer_id on the customer
  // or billing/shipping address sub-objects (confirmed present in
  // Bold's own API docs sample responses).
  const shopifyCustomerId =
    subscription.platform_customer_id ||
    (subscription.customer && subscription.customer.platform_customer_id) ||
    (subscription.billing_address && subscription.billing_address.platform_customer_id) ||
    (subscription.shipping_address && subscription.shipping_address.platform_customer_id) ||
    null;

  console.log(`bold-subscription-webhook: extracted shopify_customer_id: ${shopifyCustomerId}, billing_address keys: ${JSON.stringify(Object.keys(subscription.billing_address || {}))}`);

  if (!shopifyCustomerId) {
    console.log('bold-subscription-webhook: skipped -- could not find platform_customer_id anywhere on payload; check the logged billing_address keys above to find the real field');
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
  return { statusCode: 200, body: JSON.stringify({ action, shopifyCustomerId, eventIdentifier }) };
};
