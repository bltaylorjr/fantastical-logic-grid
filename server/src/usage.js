// Free plan allowances and Cloudflare's own usage counts, shared by the
// dashboard's Usage page (admin.js) and the free-limit alerts (report.js).
const DAY = 24 * 3600_000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// Free plan allowances (Cloudflare and Firebase pages, October 2026).
export const FREE_LIMITS = {
  workerRequestsPerDay: 100_000, d1RowsReadPerDay: 5_000_000, d1RowsWrittenPerDay: 100_000,
  d1DatabaseBytes: 500 * 1024 * 1024, d1AccountBytes: 5 * 1024 * 1024 * 1024, firebaseMonthlyActiveUsers: 50_000,
};

// Cloudflare's own daily counts for this Worker and D1, from its GraphQL
// analytics API. Optional: needs the CF_API_TOKEN (Account Analytics: Read)
// and CF_ACCOUNT_ID secrets. Free on every plan.
export async function cloudflareUsage(env, days, now = Date.now()) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) return { configured: false, limits: FREE_LIMITS };
  const start = isoDay(now - (days - 1) * DAY);
  const end = isoDay(now);
  const query = `query ($account: String!, $start: Date!, $end: Date!, $script: String!) { viewer { accounts(filter: { accountTag: $account }) {
    d1: d1AnalyticsAdaptiveGroups(limit: 1000, filter: { date_geq: $start, date_leq: $end }) { sum { readQueries writeQueries rowsRead rowsWritten } dimensions { date } }
    workers: workersInvocationsAdaptive(limit: 1000, filter: { date_geq: $start, date_leq: $end, scriptName: $script }) { sum { requests errors } dimensions { date } }
  } } }`;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { account: env.CF_ACCOUNT_ID, start, end, script: env.WORKER_NAME || 'flg-api' } }),
    });
    const j = await res.json();
    if (!res.ok || j.errors?.length) return { configured: true, error: (j.errors && j.errors[0]?.message) || `HTTP ${res.status}`, limits: FREE_LIMITS };
    const acct = j.data.viewer.accounts[0] || { d1: [], workers: [] };
    const byDay = {};
    const add = (date, k, v) => { (byDay[date] ||= { date, requests: 0, errors: 0, rowsRead: 0, rowsWritten: 0, readQueries: 0, writeQueries: 0 })[k] += v || 0; };
    for (const g of acct.d1) for (const k of ['rowsRead', 'rowsWritten', 'readQueries', 'writeQueries']) add(g.dimensions.date, k, g.sum[k]);
    for (const g of acct.workers) for (const k of ['requests', 'errors']) add(g.dimensions.date, k, g.sum[k]);
    return { configured: true, days: Object.values(byDay).sort((a, b) => a.date.localeCompare(b.date)), limits: FREE_LIMITS };
  } catch (e) {
    return { configured: true, error: 'Cloudflare did not answer.', limits: FREE_LIMITS };
  }
}
