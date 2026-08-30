// Sends Outreach their order email ourselves, via Resend — completely
// decoupled from Shopify's fulfillment status. This replaces Shopify's
// built-in "Custom order fulfillment" email-on-fulfill feature, which had
// no way to notify Outreach without also marking the order fulfilled.
//
// Modeled on the real "New order" staff notification email (order number,
// shipping address, line items, shipping method) so the content looks
// familiar to Outreach's staff, even though it's now sent independently
// at order-creation time rather than at fulfillment time.

const OUTREACH_ORDER_EMAIL = 'CustomerService@outreach.com';
const FROM_ADDRESS = 'Following Jesus Books <no-reply@mail.followingjesus.com>';
const CC_ADDRESS = 'info@followingjesusbook.com'; // Samuel keeps a visible copy, same as before

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildOrderEmailHtml(order, lineItems) {
  const shipping = order.shipping_address || {};

  const itemRows = lineItems
    .map(
      (li) => `
    <tr>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(li.title)}${
        li.variant_title && li.variant_title !== 'Default Title' ? ' — ' + escapeHtml(li.variant_title) : ''
      }</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:center;">${li.quantity}</td>
      <td style="padding:6px 12px;border-bottom:1px solid #eee;">${escapeHtml(li.sku || '')}</td>
    </tr>`
    )
    .join('');

  const placedAt = order.created_at
    ? new Date(order.created_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
    : '';

  return `
    <div style="font-family:Arial,sans-serif;max-width:600px;color:#222;">
      <h2 style="margin-bottom:0;">New Order ${escapeHtml(order.name)}</h2>
      <p style="color:#666;margin-top:4px;">Placed ${placedAt}</p>

      <h3>Ship To</h3>
      <p style="line-height:1.5;">
        ${escapeHtml(shipping.name)}<br/>
        ${shipping.company ? escapeHtml(shipping.company) + '<br/>' : ''}
        ${escapeHtml(shipping.address1)}${shipping.address2 ? ', ' + escapeHtml(shipping.address2) : ''}<br/>
        ${escapeHtml(shipping.city)}, ${escapeHtml(shipping.province)} ${escapeHtml(shipping.zip)}<br/>
        ${escapeHtml(shipping.country)}<br/>
        ${shipping.phone ? escapeHtml(shipping.phone) : ''}
      </p>

      <h3>Items to Fulfill</h3>
      <table style="border-collapse:collapse;width:100%;">
        <thead>
          <tr>
            <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #333;">Item</th>
            <th style="text-align:center;padding:6px 12px;border-bottom:2px solid #333;">Qty</th>
            <th style="text-align:left;padding:6px 12px;border-bottom:2px solid #333;">SKU</th>
          </tr>
        </thead>
        <tbody>${itemRows}</tbody>
      </table>

      <h3>Shipping Method Requested</h3>
      <p>${escapeHtml(order.shipping_lines && order.shipping_lines[0] && order.shipping_lines[0].title)}</p>

      <p style="color:#999;font-size:12px;margin-top:32px;">
        Order placed on followingjesusbook.com. Please reply with your order confirmation number,
        and separately with shipping/tracking info once it ships.
      </p>
    </div>
  `;
}

async function sendOutreachOrderEmail(order, outreachLineItems) {
  const html = buildOrderEmailHtml(order, outreachLineItems);
  const customerName = (order.shipping_address && order.shipping_address.name) || 'a customer';

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [OUTREACH_ORDER_EMAIL],
      cc: [CC_ADDRESS],
      reply_to: CC_ADDRESS,
      subject: `[Following Jesus] Order ${order.name} placed by ${customerName}`,
      html,
    }),
  });

  const json = await res.json();
  if (!res.ok) {
    throw new Error(`Failed to send Outreach order email: ${JSON.stringify(json)}`);
  }
  return json;
}

module.exports = { sendOutreachOrderEmail, buildOrderEmailHtml };
