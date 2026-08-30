// netlify/functions/setup-subscription-webhooks.js
//
// ONE-OFF SETUP FUNCTION -- run once, then delete.
//
// Registers the three subscription-lifecycle webhook topics that
// shopify-subscription-status-webhook.js needs. These topics
// (subscription_billing_attempts/failure, subscription_billing_attempts/success,
// subscription_contracts/update) do NOT appear in Shopify Admin's
// Settings > Notifications > Webhooks UI -- that page only exposes a
// curated subset of topics. Subscription-contract topics can only be
// registered through the Admin GraphQL API's webhookSubscriptionCreate
// mutation, which is what this does.
//
// ---------------------------------------------------------------------
// HOW TO USE:
// ---------------------------------------------------------------------
// 1. Upload this file to netlify/functions/ alongside the others.
// 2. Once deployed, visit this URL in your browser (GET request, no
//    body needed):
//      https://followingjesus.com/.netlify/functions/setup-subscription-webhooks
// 3. It will attempt to register all three topics and return a JSON
//    summary of what succeeded/failed for each. If any show a scope
//    error, the app's Admin API scopes (Dev Dashboard > this app's API
//    credentials) need read_own_subscription_contracts added -- lib/shopify.js's
//    header comment only lists read_orders/write_orders, which may not
//    be enough for these topics.
// 4. Once all three show "created" (or "already exists" on a re-run --
//    this is safe to run more than once), delete this file from the
//    repo. It has no ongoing purpose after setup and there's no reason
//    to leave a setup-only endpoint live.
//
// Uses the same lib/shopify.js helper (Dev Dashboard client_credentials
// flow) as everything else in netlify/functions/lib.

const { shopifyGraphQL } = require('./lib/shopify');

const WEBHOOK_URL = 'https://followingjesus.com/.netlify/functions/shopify-subscription-status-webhook';

const TOPICS = [
  'SUBSCRIPTION_BILLING_ATTEMPTS_FAILURE',
  'SUBSCRIPTION_BILLING_ATTEMPTS_SUCCESS',
  'SUBSCRIPTION_CONTRACTS_UPDATE',
];

const MUTATION = `
  mutation CreateSubWebhook($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
    webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
      webhookSubscription { id topic uri format }
      userErrors { field message }
    }
  }
`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Use GET to run this setup script.' };
  }

  const results = [];

  for (const topic of TOPICS) {
    try {
      const data = await shopifyGraphQL(MUTATION, {
        topic,
        webhookSubscription: { uri: WEBHOOK_URL, format: 'JSON' },
      });

      const payload = data.webhookSubscriptionCreate;
      if (payload.userErrors && payload.userErrors.length > 0) {
        results.push({ topic, status: 'error', errors: payload.userErrors });
      } else {
        results.push({ topic, status: 'created', subscription: payload.webhookSubscription });
      }
    } catch (e) {
      results.push({ topic, status: 'exception', message: e.message });
    }
  }

  const allOk = results.every(r => r.status === 'created');

  return {
    statusCode: allOk ? 200 : 207, // 207: some succeeded, some didn't
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: allOk
        ? 'All three subscription webhooks registered. Delete this function now -- it has no further purpose.'
        : 'One or more topics failed -- see per-topic errors below. A common cause is the app missing the read_own_subscription_contracts Admin API scope.',
      results,
    }, null, 2),
  };
};
