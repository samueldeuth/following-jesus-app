// netlify/functions/lib/add-leader-from-order.js
//
// Runs on every new Shopify order (called from tag-book-order.js, right after
// maybeAddChurchFromOrder). Sends the buyer to the Supabase function
// add_church_leader_from_order, which decides:
//   - order has a Company name, OR the email is on a custom domain (not Gmail/Yahoo/etc.)
//       -> added straight to the Church Leaders list
//   - anything else -> held on the Pending list for Samuel to Approve / Dismiss
// Anyone already on the list is skipped. Failures are only logged -- this can
// never affect Outreach tagging/emailing in tag-book-order.js.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';

async function maybeAddLeaderFromOrder(order, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  try {
    const secret = process.env.REMINDER_FUNCTION_SECRET;
    if (!secret) {
      console.log('Church-leader check skipped: REMINDER_FUNCTION_SECRET not set');
      return 'skipped';
    }
    const shipping = order.shipping_address || {};
    const billing = order.billing_address || {};
    const email = (order.email || order.contact_email || order.customer?.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return 'no_email';

    const name = (shipping.name || billing.name
      || [order.customer?.first_name, order.customer?.last_name].filter(Boolean).join(' ')).trim();
    const company = (shipping.company || billing.company || '').trim();

    const res = await doFetch(`${SUPABASE_URL}/rest/v1/rpc/add_church_leader_from_order`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caller_secret: secret,
        p_email: email,
        p_name: name || null,
        p_company: company || null,
        p_order_name: order.name || null
      })
    });
    const result = await res.json();
    console.log(`Church-leader check for order ${order.name}: ${JSON.stringify(result)}`);
    return result;
  } catch (err) {
    console.error('Church-leader check failed (ignored):', err);
    return 'error';
  }
}

module.exports = { maybeAddLeaderFromOrder };
