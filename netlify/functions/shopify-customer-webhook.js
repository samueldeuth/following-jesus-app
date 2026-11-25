// netlify/functions/shopify-customer-webhook.js
//
// Receives Shopify's customer webhooks ("Customer creation" and "Customer update") and keeps
// the stored Shopify list (shopify_contacts) current, so the "Skip people Shopify will email"
// option in the Church Leaders email composer stays accurate without re-uploading the file.
//
// Same pattern as shopify-order-webhook.js: Shopify's signature is checked here, then a
// security-definer Postgres function is called with the shared secret. No service-role key.
//
// REQUIRES (already set for the order webhook): SHOPIFY_WEBHOOK_SECRET, SHOPIFY_WEBHOOK_FUNCTION_SECRET

const crypto = require('crypto');

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const shopifySecret = process.env.SHOPIFY_WEBHOOK_SECRET;
  const functionSecret = process.env.SHOPIFY_WEBHOOK_FUNCTION_SECRET;
  const missing = ['SHOPIFY_WEBHOOK_SECRET', 'SHOPIFY_WEBHOOK_FUNCTION_SECRET'].filter(n => !process.env[n]);
  if (missing.length) {
    console.error(`shopify-customer-webhook: missing env vars: ${missing.join(', ')}`);
    return { statusCode: 500, body: `Missing environment variables: ${missing.join(', ')}` };
  }

  // Signature check on the RAW body, exactly like the order webhook.
  const rawBody = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body || '', 'utf8');
  const hmacHeader = event.headers['x-shopify-hmac-sha256'] || event.headers['X-Shopify-Hmac-Sha256'];
  if (!hmacHeader) {
    return { statusCode: 401, body: 'Missing Shopify signature header.' };
  }
  const computedHmac = crypto.createHmac('sha256', shopifySecret).update(rawBody).digest('base64');
  const ok = Buffer.byteLength(hmacHeader) === Buffer.byteLength(computedHmac) &&
    crypto.timingSafeEqual(Buffer.from(hmacHeader), Buffer.from(computedHmac));
  if (!ok) {
    console.error('shopify-customer-webhook: signature mismatch');
    return { statusCode: 401, body: 'Invalid webhook signature.' };
  }

  let customer;
  try {
    customer = JSON.parse(rawBody.toString('utf8'));
  } catch (e) {
    return { statusCode: 400, body: 'Invalid JSON body.' };
  }

  const email = String(customer.email || '').trim().toLowerCase();
  if (!email) {
    // Customer deletions only carry an id, and some test payloads have no email. Nothing to save.
    console.log('shopify-customer-webhook: skipped, no email in payload');
    return { statusCode: 200, body: 'skipped: no email' };
  }

  // "Accepts email marketing" = subscribed. Newer payloads carry email_marketing_consent.state;
  // older ones only the accepts_marketing flag.
  const state = customer.email_marketing_consent && customer.email_marketing_consent.state;
  const accepts = state ? state === 'subscribed' : customer.accepts_marketing === true;

  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/upsert_shopify_contact`, {
    method: 'POST',
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller_secret: functionSecret, p_email: email, p_accepts: accepts })
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`shopify-customer-webhook: upsert_shopify_contact failed (${res.status}): ${errText}`);
    return { statusCode: 502, body: 'upsert_shopify_contact call failed' };
  }
  const saved = await res.json();
  if (saved !== true) {
    // Wrong or missing stored secret. Return an error so Shopify retries and it shows up in the log.
    console.error('shopify-customer-webhook: Supabase refused the save (shared secret not stored, or wrong)');
    return { statusCode: 500, body: 'Save was refused: check the shared secret.' };
  }
  console.log(`shopify-customer-webhook: saved a customer (accepts marketing: ${accepts})`);
  return { statusCode: 200, body: 'ok' };
};
