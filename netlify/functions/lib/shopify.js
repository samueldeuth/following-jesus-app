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

// Shopify's GraphQL mutations can return a normal 200 OK — so
// shopifyGraphQL() above sees nothing wrong and returns cleanly — while
// the mutation's own per-field `userErrors` array still reports a real
// failure (e.g. a tagsAdd that didn't actually apply). This is the same
// class of check markOrderInProgress already did correctly further down
// in this file; this helper centralizes it so every mutation uses it,
// rather than each one needing to remember to inline it.
function assertNoUserErrors(data, mutationNames, context) {
  const allErrors = [];
  for (const name of mutationNames) {
    const errors = data?.[name]?.userErrors;
    if (errors && errors.length > 0) {
      allErrors.push(...errors.map((e) => `${name}: ${e.field ? e.field + ' — ' : ''}${e.message}`));
    }
  }
  if (allErrors.length > 0) {
    throw new Error(`Shopify mutation userErrors for ${context}: ${allErrors.join('; ')}`);
  }
}

/**
 * Tag a newly-placed physical order as "awaiting-outreach-confirm" and stash
 * the shipping name/company/address/items on it as a metafield, so the
 * Outreach confirmation email can be matched back to it later (Outreach's
 * confirmation never references the Shopify order number).
 *
 * Now checks userErrors on both tagsAdd and metafieldsSet before returning
 * — previously this returned shopifyGraphQL()'s result directly without
 * inspecting it, so a silent per-field failure (HTTP 200, but the tag
 * genuinely never applied) would still log as a success one level up in
 * tag-book-order.js. Root cause fixed here.
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
  const data = await shopifyGraphQL(mutation, {
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
  assertNoUserErrors(data, ['tagsAdd', 'metafieldsSet'], `tagOrderAwaitingOutreach(${orderGid})`);
  return data;
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
 *
 * Now checks userErrors on all four mutation fields before returning, same
 * fix as tagOrderAwaitingOutreach above and for the same reason — this
 * function had the identical silent-failure gap.
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
  const data = await shopifyGraphQL(safeMutation, {
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
  assertNoUserErrors(
    data,
    ['tagsAdd', 'tagsRemove', 'metafieldsSet', 'orderUpdate'],
    `markOrderMatchedToOutreach(${orderGid}, ${outreachOrderNumber})`
  );
  return data;
}

/**
 * Find the single Shopify order tagged with a given Outreach order number.
 *
 * Deliberately does NOT request fulfillmentOrders here -- this query's only
 * job is locating the order by tag, and requesting fulfillmentOrders (which
 * needs a scope this app didn't have) failed the ENTIRE call with
 * ACCESS_DENIED, taking the lookup down with it (real orders affected:
 * M1556605's shipping email on Sep 1, plus retries). Same failure mode
 * markOrderInProgress was already isolated against, just a second call site
 * that needed the same treatment. Callers that need fulfillment-order data
 * should call getOrderFulfillmentOrders() separately, as its own isolated
 * step, after this lookup succeeds.
 */
async function findOrderByOutreachNumber(outreachOrderNumber) {
  const query = `
    query FindByOutreach($searchQuery: String!) {
      orders(first: 5, query: $searchQuery) {
        edges {
          node {
            id
            name
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
 * Fetch just the fulfillment orders (id + status) for a single order, as
 * its own isolated query -- shared by markOrderInProgress and
 * fulfillOrderWithTracking so there's one place, not two copies, of the
 * "this needs a scope that might be missing" query. Callers decide for
 * themselves whether a failure here is fatal (fulfillOrderWithTracking) or
 * safe to skip (markOrderInProgress) -- this helper just throws on failure
 * and lets the caller choose.
 */
async function getOrderFulfillmentOrders(orderGid) {
  const query = `
    query GetFulfillmentOrders($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 5) {
          edges { node { id status } }
        }
      }
    }
  `;
  const data = await shopifyGraphQL(query, { id: orderGid });
  return (data.order?.fulfillmentOrders?.edges || []).map((e) => e.node);
}

/**
 * Create a fulfillment with tracking info for every open fulfillment order
 * on the given order (normally there's just one for these simple book
 * orders). Notifies the customer, same as Shopify's own default behavior.
 */
async function fulfillOrderWithTracking(order, { trackingNumber, trackingCompany, trackingUrl }) {
  const fulfillmentOrderNodes = await getOrderFulfillmentOrders(order.id);
  const openFulfillmentOrders = fulfillmentOrderNodes.filter(
    (fo) => fo.status === 'OPEN' || fo.status === 'IN_PROGRESS'
  );

  if (openFulfillmentOrders.length === 0) {
    throw new Error(`No open fulfillment orders on ${order.name} — may already be fulfilled`);
  }

  const mutation = `
    mutation Fulfill($fulfillment: FulfillmentV2Input!) {
      fulfillmentCreateV2(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphQL(mutation, {
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
  assertNoUserErrors(data, ['fulfillmentCreateV2'], `fulfillOrderWithTracking(${order.name})`);
  return data;
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
 * display status, via fulfillmentOrderReportProgress. Called right
 * after a confirmation email is matched, so the order visibly reflects
 * "Outreach has it and is working on it" instead of sitting as a flat
 * Unfulfilled the whole time.
 *
 * NOTE ON MUTATION CHOICE: this used to call
 * fulfillmentOrderSubmitFulfillmentRequest, which is built for a
 * completely different scenario -- requesting fulfillment from a
 * formally registered Shopify "fulfillment service" app (like ShipHero).
 * "Following Jesus HQ" is a plain, merchant-managed location; Outreach
 * isn't a Shopify-integrated fulfillment service, just a real-world
 * vendor coordinated with by email. That mutation always failed here
 * with ACCESS_DENIED (confirmed on real order #FJ8806/M1556893, Sep 2)
 * requesting write_third_party_fulfillment_orders -- a scope that
 * wouldn't have helped anyway, since it governs OTHER apps' registered
 * fulfillment-service locations, not this one.
 *
 * fulfillmentOrderReportProgress (Shopify API 2026-04+, this project
 * already uses 2026-07) is the actually-correct mutation: added
 * specifically for 3PLs/fulfillment vendors to report progress on
 * merchant-managed fulfillment orders, using the
 * write_merchant_managed_fulfillment_orders scope this app already has
 * -- no further scope changes needed. Confirmed via Shopify's own
 * current docs before making this change, not guessed.
 *
 * Deliberately fetches fulfillmentOrders itself, in its own isolated
 * query, rather than requiring the caller to have already fetched it as
 * part of a bigger batch query -- see getOrderFulfillmentOrders' own
 * history for why (a missing scope on a shared query once broke order
 * matching entirely for real orders M1556712/M1556713). Keeping it
 * isolated here means any failure only skips the "in progress" nudge --
 * it can never again take down the match/tag/note logic that already
 * succeeded before this function is even called.
 *
 * This function already checked userErrors correctly before this fix --
 * it's the reference pattern the other two mutations above were missing
 * and have now been brought in line with.
 */
async function markOrderInProgress(orderGid, orderName) {
  let openFulfillmentOrders;
  try {
    const nodes = await getOrderFulfillmentOrders(orderGid);
    openFulfillmentOrders = nodes.filter((fo) => fo.status === 'OPEN');
  } catch (err) {
    console.error(`markOrderInProgress: could not fetch fulfillmentOrders for ${orderName}:`, err.message);
    return;
  }

  if (openFulfillmentOrders.length === 0) {
    console.warn(`markOrderInProgress: no OPEN fulfillment orders on ${orderName}, skipping`);
    return;
  }

  const mutation = `
    mutation ReportProgress($id: ID!, $progressReport: FulfillmentOrderReportProgressInput) {
      fulfillmentOrderReportProgress(id: $id, progressReport: $progressReport) {
        fulfillmentOrder { id status }
        userErrors { field message }
      }
    }
  `;

  for (const fo of openFulfillmentOrders) {
    try {
      const data = await shopifyGraphQL(mutation, {
        id: fo.id,
        progressReport: { reasonNotes: 'Outreach confirmed this order and is preparing it for shipment.' }
      });
      const errors = data.fulfillmentOrderReportProgress.userErrors;
      if (errors && errors.length > 0) {
        console.warn(`markOrderInProgress: Shopify userErrors on ${orderName}:`, errors);
      } else {
        console.log(`markOrderInProgress: ${orderName} fulfillment order ${fo.id} now in progress`);
      }
    } catch (err) {
      console.error(`markOrderInProgress: failed for ${orderName}:`, err.message);
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
  getOrderFulfillmentOrders,
  fulfillOrderWithTracking,
  markOrderInProgress,
};
