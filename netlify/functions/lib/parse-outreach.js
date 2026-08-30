const CARRIER_MAP = {
  USPSGROUNDADV: 'USPS',
  USPSPRIORITY: 'USPS',
  USPSFIRSTCLASS: 'USPS',
  UPSGROUND: 'UPS',
  UPSNEXTDAY: 'UPS',
  FEDEXGROUND: 'FedEx',
  FEDEX2DAY: 'FedEx',
};

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<(br|\/p|\/tr|\/td|\/div|\/h[1-6])\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

function normalize(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseConfirmationEmail(html) {
  const text = stripHtml(html);
  const orderNumberMatch = text.match(/order number is\s+([A-Za-z0-9]+)\.?/i);
  const shippingBlockMatch = text.match(/Shipping Address\s*\n([\s\S]*?)\n\s*(?:Order details|Billing Address|$)/i);
  return {
    orderNumber: orderNumberMatch ? orderNumberMatch[1] : null,
    shippingBlockText: shippingBlockMatch ? shippingBlockMatch[1] : null,
    shippingBlob: normalize(shippingBlockMatch ? shippingBlockMatch[1] : text),
  };
}

function parseShippingEmail(html) {
  const text = stripHtml(html);
  const orderNumberMatch = text.match(/Order#\s*([A-Za-z0-9]+)/i);
  const carrierMatch = text.match(/Shipping Method:\s*([A-Za-z0-9]+)/i);
  const trackingNumberMatch = text.match(/Tracking Number is\s*([A-Za-z0-9]+)/i);
  const trackingUrlMatch = html.match(/href=['"]([^'"]*origTrackNum[^'"]*)['"]/i);
  const carrierRaw = carrierMatch ? carrierMatch[1].toUpperCase() : '';
  return {
    orderNumber: orderNumberMatch ? orderNumberMatch[1] : null,
    trackingNumber: trackingNumberMatch ? trackingNumberMatch[1] : null,
    trackingCompany: CARRIER_MAP[carrierRaw] || carrierMatch?.[1] || 'Other',
    trackingUrl: trackingUrlMatch ? trackingUrlMatch[1] : undefined,
  };
}

function isMatch(shopifyMatchData, shippingBlob) {
  const nameHit = shopifyMatchData.name && shippingBlob.includes(normalize(shopifyMatchData.name));
  const zipHit = shopifyMatchData.zip && shippingBlob.includes(normalize(shopifyMatchData.zip));
  return Boolean(nameHit && zipHit);
}

module.exports = { stripHtml, normalize, parseConfirmationEmail, parseShippingEmail, isMatch, CARRIER_MAP };
