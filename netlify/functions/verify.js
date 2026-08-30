const crypto = require('crypto');

/**
 * Verify a Shopify webhook's HMAC signature.
 * rawBody MUST be the exact, unparsed request body string.
 */
function verifyShopifyWebhook(rawBody, hmacHeader, secret) {
  if (!hmacHeader || !secret) return false;
  const digest = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('base64');
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader));
  } catch {
    return false; // length mismatch etc.
  }
}

/**
 * Verify a Resend (Svix-format) webhook signature.
 * rawBody MUST be the exact, unparsed request body string.
 * secret is the whsec_... value from the Resend webhook's settings page.
 */
function verifyResendWebhook(rawBody, headers, secret) {
  const svixId = headers['svix-id'];
  const svixTimestamp = headers['svix-timestamp'];
  const svixSignature = headers['svix-signature'];

  if (!svixId || !svixTimestamp || !svixSignature || !secret) return false;

  // Reject anything outside a 5-minute window to block replay attacks.
  const timestampSeconds = parseInt(svixTimestamp, 10);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampSeconds) > 5 * 60) return false;

  const secretBytes = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64');
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSignature = crypto.createHmac('sha256', secretBytes).update(signedContent, 'utf8').digest('base64');

  // svix-signature header can contain multiple space-separated "v1,<sig>" values
  const providedSignatures = svixSignature.split(' ').map((s) => s.split(',')[1]).filter(Boolean);

  return providedSignatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'base64'), Buffer.from(expectedSignature, 'base64'));
    } catch {
      return false;
    }
  });
}

module.exports = { verifyShopifyWebhook, verifyResendWebhook };
