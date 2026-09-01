// Shared helper for talking to the Shopify Admin GraphQL API.
//
// This app was created via the Dev Dashboard (required for any app created
// after Jan 1, 2026 — the old "copy a static token from Shopify admin" flow
// is closed to new apps). Dev Dashboard apps don't hand you a token directly;
// instead you get a Client ID + Client Secret, and your code exchanges those
// for an access token using the client_credentials grant. That access token
// is short-lived (~24h), so rather than trying to cache it across serverless
// cold starts, this just fetches a fresh one on every invocation — these
// functions run rarely enough (per order/email) that the extra round trip
// is negligible.
//
// Required Netlify env vars:
//   SHOPIFY_STORE_DOMAIN     e.g. "samueldeuth.myshopify.com"
//   SHOPIFY_CLIENT_ID        from the app's API credentials page in Dev Dashboard
//   SHOPIFY_CLIENT_SECRET    from the same page
//     App's Admin API scopes must include: read_orders, write_orders

const API_VERSION = '2026-07';

async function getAccessToken(domain) {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET env var');
  }

  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'client_credentials',
    }),
  });

  const json = await res.json();

  if (!res.ok || !json.access_token) {
    throw new Error(`Failed to get Shopify access token: ${JSON.stringify(json)}`);
  }

  return json.access_token;
}

async function shopifyGraphQL(query, variables = {}) {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) {
    throw new Error('Missing SHOPIFY_STORE_DOMAIN env var');
  }

  const token = await getAccessToken(domain);

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
            note
            matchData: metafield(namespace: "outreach", key: "match_data") { value }
            fulfillmentOrders(first: 5) {
              edges { node { id status } }
            }
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
 * "awaiting" tag for a specific "outreach:<number>" tag, store the Outreach
 * order number as its own metafield (so the later shipping notification
 * email can look the order straight back up by tag), and append the
 * Outreach order number to the order's Notes field so it's visible directly
 * on the order too, not just in the tag list.
 *
 * currentNote is read first by the caller (from the same query that found
 * this order) and merged here — read-merge-write, not a blind overwrite,
 * so any note Samuel or a customer already left on the order is preserved.
 */
async function markOrderMatchedToOutreach(orderGid, outreachOrderNumber, currentNote) {
  const noteLine = `Outreach order: ${outreachOrderNumber}`;
  const existingNote = (currentNote || '').trim();
  const newNote = existingNote ? `${existingNote}\n${noteLine}` : noteLine;

  const mutation = `
    mutation MarkMatched($orderId: ID!, $metafields: [MetafieldsSetInput!]!, $note: String) {
      tagsAdd(id: $orderId, tags: [$outreachTag]) {
        userErrors { field message }
      }
      tagsRemove(id: $orderId, tags: ["awaiting-outreach-confirm"]) {
        userErrors { field message }
      }
      metafieldsSet(metafields: $metafields) {
        userErrors { field message }
      }
      orderUpdate(input: { id: $orderId, note: $note }) {
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
    note: newNote,
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

/**
 * Look up the tags on a set of Shopify products by their REST numeric IDs.
 * Used to figure out which line items in an order are actually fulfilled
 * by Outreach (tagged "outreach-fulfilled" on the product), as opposed to
 * physical items you fulfill some other way.
 */
async function getProductTags(productIds) {
  if (productIds.length === 0) return {};

  const gids = productIds.map((id) => `gid://shopify/Product/${id}`);
  const query = `
    query GetProductTags($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          tags
        }
      }
    }
  `;
  const data = await shopifyGraphQL(query, { ids: gids });

  const tagsByNumericId = {};
  data.nodes.filter(Boolean).forEach((node) => {
    const numericId = node.id.split('/').pop();
    tagsByNumericId[numericId] = node.tags;
  });
  return tagsByNumericId;
}

/**
 * Move an order's open fulfillment order(s) into Shopify's "In Progress"
 * display status, via fulfillmentOrderSubmitFulfillmentRequest. Called right
 * after a confirmation email is matched, so the order visibly reflects
 * "Outreach has it and is working on it" instead of sitting as a flat
 * Unfulfilled the whole time.
 *
 * NOTE: this mutation is designed for fulfillment orders assigned to a
 * fulfillment-service-type location. "Following Jesus HQ" was deliberately
 * set up as a plain (non-fulfillment-service) location to avoid Shopify's
 * built-in fulfillment-service email side effects — so this call may come
 * back with a userError instead of actually changing anything, until
 * confirmed against a real order. Failure here is intentionally non-fatal
 * (logged, not thrown) so a failed status nudge never blocks the real
 * match/tag logic that already succeeded.
 */
async function markOrderInProgress(order) {
  const openFulfillmentOrders = (order.fulfillmentOrders?.edges || [])
    .map((e) => e.node)
    .filter((fo) => fo.status === 'OPEN');

  if (openFulfillmentOrders.length === 0) {
    console.warn(`markOrderInProgress: no OPEN fulfillment orders on ${order.name}, skipping`);
    return;
  }

  const mutation = `
    mutation SubmitFulfillmentRequest($id: ID!) {
      fulfillmentOrderSubmitFulfillmentRequest(id: $id) {
        submittedFulfillmentOrder { id status requestStatus }
        userErrors { field message }
      }
    }
  `;

  for (const fo of openFulfillmentOrders) {
    try {
      const data = await shopifyGraphQL(mutation, { id: fo.id });
      const errors = data.fulfillmentOrderSubmitFulfillmentRequest.userErrors;
      if (errors && errors.length > 0) {
        console.warn(`markOrderInProgress: Shopify userErrors on ${order.name}:`, errors);
      } else {
        console.log(`markOrderInProgress: ${order.name} fulfillment order ${fo.id} now in progress`);
      }
    } catch (err) {
      console.error(`markOrderInProgress: failed for ${order.name}:`, err.message);
    }
  }
}

module.exports = {
  shopifyGraphQL,
  getProductTags,
  tagOrderAwaitingOutreach,
  findAwaitingOutreachOrders,
  markOrderMatchedToOutreach,
  findOrderByOutreachNumber,
  fulfillOrderWithTracking,
  markOrderInProgress,
};
