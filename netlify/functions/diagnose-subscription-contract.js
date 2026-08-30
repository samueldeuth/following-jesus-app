// netlify/functions/diagnose-subscription-contract.js
//
// ONE-OFF DIAGNOSTIC -- run once, then delete.
//
// The real church-signup test showed shopify_subscription_contract_id
// came back NULL, meaning the guessed extraction path
// (line_items[].selling_plan_allocation.selling_plan.id) didn't find
// anything on the order payload. Rather than keep guessing at order
// line-item shape, this queries Shopify's Admin GraphQL API directly
// for the real SubscriptionContract object tied to a given customer --
// giving us the real contract id and its real shape in one shot.
//
// ---------------------------------------------------------------------
// HOW TO USE:
// ---------------------------------------------------------------------
// 1. Upload this file to netlify/functions/.
// 2. Visit this URL, with the real Shopify customer ID from the test
//    church's shopify_customer_id column (1170302304352 as of this
//    writing) as a query param:
//      https://followingjesus.com/.netlify/functions/diagnose-subscription-contract?customerId=1170302304352
// 3. It returns the real subscription contract(s) for that customer --
//    id, status, and line item / selling plan details -- so we can see
//    the actual field shape and fix the extraction logic in both
//    shopify-church-signup-webhook.js (at signup) and
//    shopify-subscription-status-webhook.js (at cancel/lapse/renew)
//    to use the real, confirmed field instead of a guess.
// 4. Once we've confirmed the fix, delete this file -- it has no
//    ongoing purpose.

const { shopifyGraphQL } = require('./lib/shopify');

const QUERY = `
  query CustomerSubscriptionContracts($customerId: ID!) {
    customer(id: $customerId) {
      id
      email
      subscriptionContracts(first: 10) {
        edges {
          node {
            id
            status
            createdAt
            nextBillingDate
            lines(first: 5) {
              edges {
                node {
                  productId
                  title
                  sellingPlanId
                  sellingPlanName
                }
              }
            }
          }
        }
      }
    }
  }
`;

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Use GET to run this diagnostic.' };
  }

  const customerId = event.queryStringParameters && event.queryStringParameters.customerId;
  if (!customerId) {
    return {
      statusCode: 400,
      body: 'Missing ?customerId= query param -- pass the numeric Shopify customer id (e.g. from churches.shopify_customer_id).',
    };
  }

  const customerGid = `gid://shopify/Customer/${customerId}`;

  try {
    const data = await shopifyGraphQL(QUERY, { customerId: customerGid });

    if (!data.customer) {
      return {
        statusCode: 404,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: `No customer found for id ${customerId}` }),
      };
    }

    const contracts = data.customer.subscriptionContracts.edges.map((e) => e.node);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        {
          customerEmail: data.customer.email,
          contractCount: contracts.length,
          contracts,
        },
        null,
        2
      ),
    };
  } catch (e) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: e.message }),
    };
  }
};
