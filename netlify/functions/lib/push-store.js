// netlify/functions/lib/push-store.js
//
// Thin Supabase REST helper for the push tables, using the SERVICE-ROLE key
// (env var SUPABASE_SERVICE_ROLE_KEY -- already set for the download-stats
// functions). Never imported by anything the browser loads.

const SUPABASE_URL = 'https://onflrmiifjjjboeimnva.supabase.co';

function headers(extra = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Missing environment variable: SUPABASE_SERVICE_ROLE_KEY');
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra };
}

async function parse(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(`${what} failed (${res.status}): ${text.slice(0, 300)}`);
  if (!text) return null;
  try { return JSON.parse(text); } catch (e) { return text; }
}

async function rpc(name, args = {}, { fetchImpl } = {}) {
  const res = await (fetchImpl || fetch)(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: headers(), body: JSON.stringify(args),
  });
  return parse(res, `rpc ${name}`);
}

// path is everything after /rest/v1/, e.g. 'push_campaigns?status=eq.sending&select=*'
async function select(path, { fetchImpl } = {}) {
  const res = await (fetchImpl || fetch)(`${SUPABASE_URL}/rest/v1/${path}`, { headers: headers() });
  return parse(res, `select ${path}`);
}

async function insert(table, row, { fetchImpl } = {}) {
  const res = await (fetchImpl || fetch)(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(row),
  });
  const rows = await parse(res, `insert ${table}`);
  return Array.isArray(rows) ? rows[0] : rows;
}

async function patch(pathWithFilter, values, { fetchImpl } = {}) {
  const res = await (fetchImpl || fetch)(`${SUPABASE_URL}/rest/v1/${pathWithFilter}`, {
    method: 'PATCH', headers: headers({ Prefer: 'return=representation' }), body: JSON.stringify(values),
  });
  return parse(res, `patch ${pathWithFilter}`);
}

// Exact row count without downloading rows.
async function count(pathWithFilter, { fetchImpl, col = 'id' } = {}) {
  const res = await (fetchImpl || fetch)(`${SUPABASE_URL}/rest/v1/${pathWithFilter}${pathWithFilter.includes('?') ? '&' : '?'}select=${col}`, {
    method: 'HEAD', headers: headers({ Prefer: 'count=exact' }),
  });
  if (!res.ok) throw new Error(`count ${pathWithFilter} failed (${res.status})`);
  const range = res.headers.get('content-range') || '';
  const total = Number(range.split('/')[1]);
  return Number.isFinite(total) ? total : 0;
}

module.exports = { rpc, select, insert, patch, count, SUPABASE_URL };
