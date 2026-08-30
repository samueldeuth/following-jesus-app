// Shared helper for talking to the Shopify Admin GraphQL API.
// Requires two env vars in Netlify:
//   SHOPIFY_STORE_DOMAIN         e.g. "samueldeuth.myshopify.com"
//   SHOPIFY_ADMIN_API_ACCESS_TOKEN   token from a custom app (Settings > Apps > Develop apps)
//     Required scopes: read_orders, write_orders

const API_VERSION = '2026-07';

async function shopifyGraphQL(query, variables = {}) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_API_ACCESS_TOKEN;

  if (!domain || !token) {
    throw new Error('Missing SHOPIFY_STORE_DOMAIN or SHOPIFY_ADMIN_API_ACCESS_TOKEN env var');
  }

  const res = await fetch(`https://${domain}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (!res.ok || json.errors) {
    throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors || json)}`);
  }

  return json.data;
}

/**
 * Tag a newly-placed physical order as "awaiting-outreach-confirm" and stash
 * the shipping name/company/address/items on it as a metafield, so the
 * Outreach confirmation email can be matched back to it later (Outreach's
 * confirmation never references the Shopify order number).
 */
async function tagOrderAwaitingOutreach(orderGid, matchData) {
  const mutation = `
    mutation TagAwaitingOutreach($orderId: ID!, $metafields: [MetafieldsSetInput!]!) {
      tagsAdd(id: $orderId, tags: ["awaiting-outreach-confirm"]) {
        userErrors { field message }
      }
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `;
  return shopifyGraphQL(mutation, {
    orderId: orderGid,
    metafields: [
      {
        ownerId: orderGid,
        namespace: 'outreach',
        key: 'match_data',
        type: 'json',
        value: JSON.stringify(matchData),
      },
    ],
  });
}

/**
 * Search orders currently awaiting an Outreach match (last N days), returning
 * each order's id, name, and stashed match_data metafield for comparison.
 */
async function findAwaitingOutreachOrders(sinceISODate) {
  const query = `
    query AwaitingOutreach($searchQuery: String!) {
      orders(first: 25, query: $searchQuery, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            matchData: metafield(namespace: "outreach", key: "match_data") { value }
          }
        }
      }
    }
  `;
  const data = await shopifyGraphQL(query, {
    searchQuery: `tag:'awaiting-outreach-confirm' created_at:>=${sinceISODate}`,
  });
  return data.orders.edges.map((e) => e.node);
}

/**
 * Once an Outreach order number is matched to a Shopify order, swap the
 * "awaiting" tag for a specific "outreach:<number>" tag and store the
 * Outreach order number as its own metafield, so the later shipping
 * notification email can look the order straight back up by that tag.
 */
async function markOrderMatchedToOutreach(orderGid, outreachOrderNumber) {
  const mutation = `
    mutation MarkMatched($orderId: ID!, $metafields: [MetafieldsSetInput!]!) {
      tagsAdd(id: $orderId, tags: [$outreachTag]) {
        userErrors { field message }
      }
      tagsRemove(id: $orderId, tags: ["awaiting-outreach-confirm"]) {
        userErrors { field message }
      }
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
    }
  `;
  // Note: tagsAdd's $outreachTag isn't a real GraphQL variable placeholder
  // for a list item, so we inline it safely (order numbers are alphanumeric
  // only, validated by the caller) rather than trying to parameterize it.
  const outreachTag = `outreach:${outreachOrderNumber}`;
  const safeMutation = mutation.replace('[$outreachTag]', `["${outreachTag}"]`);
  return shopifyGraphQL(safeMutation, {
    orderId: orderGid,
    metafields: [
      {
        ownerId: orderGid,
        namespace: 'outreach',
        key: 'order_number',
        type: 'single_line_text_field',
        value: outreachOrderNumber,
      },
    ],
  });
}

/**
 * Find the single Shopify order tagged with a given Outreach order number.
 */
async function findOrderByOutreachNumber(outreachOrderNumber) {
  const query = `
    query FindByOutreach($searchQuery: String!) {
      orders(first: 5, query: $searchQuery) {
        edges {
          node {
            id
            name
            fulfillmentOrders(first: 5) {
              edges { node { id status } }
            }
          }
        }
      }
    }
  `;
  const data = await shopifyGraphQL(query, {
    searchQuery: `tag:'outreach:${outreachOrderNumber}'`,
  });
  return data.orders.edges.map((e) => e.node);
}

/**
 * Create a fulfillment with tracking info for every open fulfillment order
 * on the given order (normally there's just one for these simple book
 * orders). Notifies the customer, same as Shopify's own default behavior.
 */
async function fulfillOrderWithTracking(order, { trackingNumber, trackingCompany, trackingUrl }) {
  const openFulfillmentOrders = order.fulfillmentOrders.edges
    .map((e) => e.node)
    .filter((fo) => fo.status === 'OPEN' || fo.status === 'IN_PROGRESS');

  if (openFulfillmentOrders.length === 0) {
    throw new Error(`No open fulfillment orders on ${order.name} — may already be fulfilled`);
  }

  const mutation = `
    mutation Fulfill($fulfillment: FulfillmentInput!) {
      fulfillmentCreateV2(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }
  `;

  return shopifyGraphQL(mutation, {
    fulfillment: {
      lineItemsByFulfillmentOrder: openFulfillmentOrders.map((fo) => ({
        fulfillmentOrderId: fo.id,
      })),
      trackingInfo: {
        number: trackingNumber,
        company: trackingCompany,
        url: trackingUrl,
      },
      notifyCustomer: true,
    },
  });
}

module.exports = {
  shopifyGraphQL,
  tagOrderAwaitingOutreach,
  findAwaitingOutreachOrders,
  markOrderMatchedToOutreach,
  findOrderByOutreachNumber,
  fulfillOrderWithTracking,
};
