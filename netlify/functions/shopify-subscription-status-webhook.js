// netlify/functions/shopify-subscription-status-webhook.js
//
// Handles subscription lifecycle events for churches that pay $50/mo --
// marks a church as lapsed on a failed billing attempt or contract
// cancellation, and clears that lapse on a successful renewal. The
// actual "move to draft after 7 days" action doesn't happen here --
// this only records when a lapse started; a separate scheduled
// function (shopify-check-lapsed-churches.js) checks daily for anyone
// whose 7-day grace period has actually run out.
//
// One function, three webhook topics all pointed at the same URL,
// distinguished by Shopify's X-Shopify-Topic header:
//   subscription_billing_attempts/failure  -> marks lapsed
//   subscription_contracts/update          -> marks lapsed IF the new
//                                              status is cancelled/expired
//   subscription_billing_attempts/success  -> clears the lapse (renewed)
//
// Same no-service-role-key pattern as every other server-side function
// in this project.
//
// ---------------------------------------------------------------------
// SETUP:
// ---------------------------------------------------------------------
// 1. Run shopify-church-signup-schema.sql first (shared with the other
//    new function -- same secret, same new columns).
//
// 2. In Shopify Admin: Settings > Notifications > Webhooks > Create
//    webhook, three times, all pointing at this function's URL:
//      Event: Subscription billing attempt failure
//      Event: Subscription billing attempt success
//      Event: Subscription contract update
//    (Exact event names as shown in Shopify's dropdown may differ
//    slightly -- look for wording matching these three.)
//
// 3. Reuses SHOPIFY_WEBHOOK_SECRET and SHOPIFY_CHURCH_SIGNUP_SECRET --
//    no new environment variables needed if the signup webhook is
//    already set up.
//
// 4. IMPORTANT -- same caveat as the signup webhook: exactly which
//    field holds the subscription contract's own ID on each of these
//    payloads is a best guess below, not confirmed from documentation.
//    Check this function's logs after a real test (Shopify's test
//    notification button works for these subscription topics too) to
//    confirm or correct the field paths.

const crypto = require('crypto');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const functionSecret = process.env.SHOPIFY_CHURCH_SIGNUP_SECRET;
  const missing = ['SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_CHURCH_SIGNUP_SECRET'].filter(name => !process.env[name]);
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
    console.error('shopify-subscription-status-webhook: signature mismatch');
    return { statusCode: 401, body: 'Invalid webhook signature.' };
  }

  const topic = event.headers['x-shopify-topic'] || event.headers['X-Shopify-Topic'] || '';
  console.log(`shopify-subscription-status-webhook: signature OK, topic: ${topic}`);

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }
  console.log(`shopify-subscription-status-webhook: payload keys: ${JSON.stringify(Object.keys(payload))}`);

  // Best-guess field extraction -- see setup note #4 above.
  const contractId = payload.id ? String(payload.id) : (payload.subscription_contract_id ? String(payload.subscription_contract_id) : null);
  if (!contractId) {
    console.log('shopify-subscription-status-webhook: skipped -- could not find a contract id on this payload');
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no contract id found' }) };
  }

  let action = null;
  if (topic.includes('subscription_billing_attempts/failure')) {
    action = 'lapsed';
  } else if (topic.includes('subscription_billing_attempts/success')) {
    action = 'renewed';
  } else if (topic.includes('subscription_contracts/update')) {
    const status = (payload.status || '').toLowerCase();
    action = ['cancelled', 'canceled', 'expired', 'failed'].includes(status) ? 'lapsed' : (status === 'active' ? 'renewed' : null);
  }

  if (!action) {
    console.log(`shopify-subscription-status-webhook: skipped -- topic/status didn't indicate a lapse or renewal (topic: ${topic}, status: ${payload.status})`);
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'no actionable status change' }) };
  }

  const rpcName = action === 'lapsed' ? 'mark_church_subscription_lapsed' : 'mark_church_subscription_renewed';
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: functionSecret, p_subscription_contract_id: contractId })
  });

  if (!rpcRes.ok) {
    const errText = await rpcRes.text();
    console.error(`shopify-subscription-status-webhook: ${rpcName} failed: ${errText}`);
    return { statusCode: 502, body: `${rpcName} failed: ${errText}` };
  }

  console.log(`shopify-subscription-status-webhook: applied ${action} for contract ${contractId}`);
  return { statusCode: 200, body: JSON.stringify({ action, contractId }) };
};
