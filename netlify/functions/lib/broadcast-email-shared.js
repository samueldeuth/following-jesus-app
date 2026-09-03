// Shared between send-broadcast-email.js (fast: auth, test-send, and
// kicking off the background job) and send-broadcast-email-background.js
// (does the actual batched sending). Kept in one place so the template
// and formatting rules can never drift between the two.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9uZmxybWlpZmpqamJvZWltbnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNTQ3NDUsImV4cCI6MjEwMjkzMDc0NX0.CeHfkR5PIH1dLW6JUPAoHSwx_AcQkFg0HtFQXV9jk5A';
const FROM_ADDRESS = 'Following Jesus <reminders@mail.followingjesus.com>';
const APP_URL = 'https://followingjesus.com';
const SUPABASE_PAGE_SIZE = 1000; // Supabase's own default per-response row cap

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Lightweight markdown-style formatting inside a paragraph, applied
// AFTER escaping so someone typing "**" or "[" never accidentally
// injects real HTML -- only these specific, safe patterns turn into
// tags:
//   **bold text**        -> <strong>
//   [link text](url)     -> inline <a>
//   ![](image url)       -> inline <img>, full width
function applyInlineFormatting(escapedLine) {
  return escapedLine
    .replace(/!\[\]\((https?:\/\/[^\s)]+)\)/g, '<img src="$1" alt="" style="width:100%;display:block;border-radius:8px;margin:8px 0;" />')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#17191D;text-decoration:underline;">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function textToParagraphs(text) {
  return text
    .split(/\n\s*\n/)
    .map(block => {
      const escaped = escapeHtml(block);
      if (/^#\s+/.test(block)) {
        const headingText = applyInlineFormatting(escapeHtml(block.replace(/^#\s+/, '')));
        return `<p style="margin:0 0 16px;font-size:19px;font-weight:700;">${headingText}</p>`;
      }
      return `<p style="margin:0 0 16px;">${applyInlineFormatting(escaped).replace(/\n/g, '<br>')}</p>`;
    })
    .join('');
}

function buildEmailHtml(bodyText, unsubscribeToken, imageUrl, linkText, linkUrl) {
  const unsubscribeUrl = `${APP_URL}/general-email-unsubscribe?token=${encodeURIComponent(unsubscribeToken)}`;
  const imageBlock = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="" style="width:100%;display:block;" />`
    : '';
  const buttonBlock = (linkUrl && linkText)
    ? `<p style="text-align:center;margin:8px 0 24px;"><a href="${escapeHtml(linkUrl)}" style="background:#17191D;color:#ffffff;padding:12px 24px;text-decoration:none;border-radius:6px;display:inline-block;font-weight:600;">${escapeHtml(linkText)}</a></p>`
    : '';
  return `
    <div style="background:#F4F4F2;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
      <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;">
        <div style="background:#17191D;padding:22px 24px;text-align:center;">
          <span style="color:#ffffff;font-weight:700;letter-spacing:0.14em;font-size:13px;text-transform:uppercase;">Following Jesus</span>
        </div>
        ${imageBlock}
        <div style="padding:32px 28px 8px;color:#17191D;font-size:15px;line-height:1.65;">
          ${textToParagraphs(bodyText)}
        </div>
        ${buttonBlock}
        <div style="padding:0 28px 28px;">
          <p style="color:#9CA3AF;font-size:11.5px;margin:0;border-top:1px solid #E4E3DD;padding-top:16px;">
            Don't want occasional emails like this? <a href="${unsubscribeUrl}" style="color:#9CA3AF;">Unsubscribe</a>
          </p>
        </div>
      </div>
    </div>
  `;
}

// Supabase caps every API response at 1,000 rows by default -- silently,
// with no error. Loops using PostgREST's Range header until a page
// comes back with fewer rows than requested.
async function fetchAllRpcRows(rpcName, rpcParams, token) {
  const allRows = [];
  let offset = 0;
  const maxPages = 100; // 100,000 rows -- far beyond any realistic list size here

  for (let page = 0; page < maxPages; page++) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Range: `${offset}-${offset + SUPABASE_PAGE_SIZE - 1}`,
      },
      body: JSON.stringify(rpcParams),
    });

    if (!res.ok) {
      throw new Error(`RPC ${rpcName} failed at offset ${offset}: ${res.status}`);
    }

    const pageRows = await res.json();
    if (!Array.isArray(pageRows) || pageRows.length === 0) break;

    allRows.push(...pageRows);
    if (pageRows.length < SUPABASE_PAGE_SIZE) break;
    offset += SUPABASE_PAGE_SIZE;
  }

  return allRows;
}

// Calls a Supabase RPC once, as the given user token -- used for the
// small, single-row job-tracking calls (create/update job), which never
// need pagination.
async function callRpc(rpcName, rpcParams, token) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(rpcParams),
  });
  if (!res.ok) {
    throw new Error(`RPC ${rpcName} failed: ${res.status}`);
  }
  return res.json();
}

module.exports = {
  SUPABASE_URL, SUPABASE_ANON_KEY, FROM_ADDRESS, APP_URL,
  escapeHtml, applyInlineFormatting, textToParagraphs, buildEmailHtml,
  fetchAllRpcRows, callRpc,
};
