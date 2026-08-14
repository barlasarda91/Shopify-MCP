import { shopifyGraphql } from "./shopify.js";

/**
 * Server-rendered HTML dashboard showing recent orders and customer signups.
 * Data is fetched live from Shopify on every page load — Shopify is the system
 * of record, so nothing needs to be stored here.
 */

interface ShopMeta {
  name: string;
  currencyCode: string;
  ianaTimezone: string;
}

let cachedShopMeta: ShopMeta | null = null;

async function getShopMeta(): Promise<ShopMeta> {
  if (cachedShopMeta) return cachedShopMeta;
  const data = await shopifyGraphql(
    `query dashboardShop { shop { name currencyCode ianaTimezone } }`
  );
  cachedShopMeta = data.shop as ShopMeta;
  return cachedShopMeta;
}

function dayKey(date: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone }).format(date);
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleize(status: string | null | undefined): string {
  if (!status) return "—";
  const words = status.toLowerCase().replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const FINANCIAL_STATUS_ROLE: Record<string, string> = {
  PAID: "good",
  AUTHORIZED: "warning",
  PENDING: "warning",
  PARTIALLY_PAID: "warning",
  PARTIALLY_REFUNDED: "serious",
  REFUNDED: "serious",
  VOIDED: "critical",
  EXPIRED: "critical",
};

const FULFILLMENT_STATUS_ROLE: Record<string, string> = {
  FULFILLED: "good",
  IN_PROGRESS: "warning",
  UNFULFILLED: "warning",
  PARTIALLY_FULFILLED: "warning",
  SCHEDULED: "warning",
  ON_HOLD: "serious",
  REQUEST_DECLINED: "critical",
};

function badge(status: string | null | undefined, roleMap: Record<string, string>): string {
  const role = (status && roleMap[status]) || "neutral";
  return `<span class="badge"><span class="dot dot-${role}"></span>${esc(titleize(status))}</span>`;
}

export async function renderDashboard(): Promise<string> {
  const shop = await getShopMeta();
  const tz = shop.ianaTimezone;
  const now = new Date();
  const todayKey = dayKey(now, tz);
  const weekStartKey = dayKey(new Date(now.getTime() - 6 * 86400_000), tz);

  const data = await shopifyGraphql(
    `query dashboard($orderQuery: String!, $customerQuery: String!) {
      recentOrders: orders(first: 25, sortKey: CREATED_AT, reverse: true) {
        nodes {
          name
          createdAt
          displayFinancialStatus
          displayFulfillmentStatus
          totalPriceSet { shopMoney { amount currencyCode } }
          customer { displayName }
        }
      }
      weekOrders: orders(first: 250, query: $orderQuery) {
        nodes {
          createdAt
          totalPriceSet { shopMoney { amount } }
        }
      }
      recentCustomers: customers(first: 25, sortKey: CREATED_AT, reverse: true) {
        nodes {
          displayName
          email
          createdAt
          numberOfOrders
          amountSpent { amount currencyCode }
        }
      }
      weekCustomers: customers(first: 250, query: $customerQuery) {
        nodes { createdAt }
      }
    }`,
    {
      orderQuery: `created_at:>=${weekStartKey}`,
      customerQuery: `customer_date:>=${weekStartKey}`,
    }
  );

  const recentOrders: any[] = data.recentOrders.nodes;
  const weekOrders: any[] = data.weekOrders.nodes;
  const recentCustomers: any[] = data.recentCustomers.nodes;
  const weekCustomers: any[] = data.weekCustomers.nodes;

  const money = new Intl.NumberFormat("en", {
    style: "currency",
    currency: shop.currencyCode,
    maximumFractionDigits: 2,
  });
  const timeFmt = new Intl.DateTimeFormat("en", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  // Per-day buckets for the last 7 calendar days in the shop's timezone.
  const days: Array<{ key: string; label: string; orders: number; revenue: number }> = [];
  const weekdayFmt = new Intl.DateTimeFormat("en", { timeZone: tz, weekday: "short" });
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86400_000);
    days.push({ key: dayKey(d, tz), label: weekdayFmt.format(d), orders: 0, revenue: 0 });
  }
  const dayIndex = new Map(days.map((d, i) => [d.key, i]));
  for (const order of weekOrders) {
    const idx = dayIndex.get(dayKey(new Date(order.createdAt), tz));
    if (idx !== undefined) {
      days[idx].orders += 1;
      days[idx].revenue += Number(order.totalPriceSet.shopMoney.amount);
    }
  }

  const todayStats = days[6];
  const weekOrderCount = days.reduce((sum, d) => sum + d.orders, 0);
  const weekRevenue = days.reduce((sum, d) => sum + d.revenue, 0);
  // The query filter narrows the fetch, but count from createdAt so the
  // numbers stay right even if Shopify ignores an unsupported filter term.
  const signupKeys = weekCustomers.map((c) => dayKey(new Date(c.createdAt), tz));
  const signupsToday = signupKeys.filter((k) => k === todayKey).length;
  const signupsWeek = signupKeys.filter((k) => k >= weekStartKey).length;
  const capped = weekOrders.length === 250 || weekCustomers.length === 250;

  const maxDayOrders = Math.max(1, ...days.map((d) => d.orders));
  const barsHtml = days
    .map((d, i) => {
      const h = Math.round((d.orders / maxDayOrders) * 100);
      const isMax = d.orders === maxDayOrders && d.orders > 0;
      const label = isMax || i === 6 ? `<span class="bar-value">${d.orders}</span>` : "";
      return `<div class="bar-col" data-tip="${esc(d.label)}: ${d.orders} order${d.orders === 1 ? "" : "s"}, ${esc(money.format(d.revenue))}">
        ${label}
        <div class="bar" style="height:${Math.max(h, d.orders > 0 ? 4 : 0)}%"></div>
        <span class="bar-label">${esc(d.label)}</span>
      </div>`;
    })
    .join("");

  const orderRows = recentOrders
    .map(
      (o) => `<tr>
        <td class="num">${esc(o.name)}</td>
        <td>${esc(timeFmt.format(new Date(o.createdAt)))}</td>
        <td>${esc(o.customer?.displayName ?? "Guest")}</td>
        <td>${badge(o.displayFinancialStatus, FINANCIAL_STATUS_ROLE)}</td>
        <td>${badge(o.displayFulfillmentStatus, FULFILLMENT_STATUS_ROLE)}</td>
        <td class="num right">${esc(money.format(Number(o.totalPriceSet.shopMoney.amount)))}</td>
      </tr>`
    )
    .join("");

  const customerRows = recentCustomers
    .map(
      (c) => `<tr>
        <td>${esc(c.displayName)}</td>
        <td>${esc(c.email ?? "—")}</td>
        <td>${esc(timeFmt.format(new Date(c.createdAt)))}</td>
        <td class="num right">${esc(c.numberOfOrders)}</td>
        <td class="num right">${esc(money.format(Number(c.amountSpent.amount)))}</td>
      </tr>`
    )
    .join("");

  const updatedAt = new Intl.DateTimeFormat("en", {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(now);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="120">
<title>${esc(shop.name)} Dashboard</title>
<style>
  :root {
    color-scheme: light;
    --page: #f9f9f7;
    --surface-1: #fcfcfb;
    --text-primary: #0b0b0b;
    --text-secondary: #52514e;
    --muted: #898781;
    --gridline: #e1e0d9;
    --baseline: #c3c2b7;
    --border: rgba(11,11,11,0.10);
    --series-1: #2a78d6;
    --status-good: #0ca30c;
    --status-warning: #fab219;
    --status-serious: #ec835a;
    --status-critical: #d03b3b;
    --status-neutral: #898781;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      color-scheme: dark;
      --page: #0d0d0d;
      --surface-1: #1a1a19;
      --text-primary: #ffffff;
      --text-secondary: #c3c2b7;
      --muted: #898781;
      --gridline: #2c2c2a;
      --baseline: #383835;
      --border: rgba(255,255,255,0.10);
      --series-1: #3987e5;
    }
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    background: var(--page);
    color: var(--text-primary);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 24px;
    max-width: 1100px;
    margin: 0 auto;
  }
  header { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: 8px; margin-bottom: 20px; }
  h1 { font-size: 20px; font-weight: 650; }
  .updated { color: var(--muted); font-size: 12px; }
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .tile { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .tile .label { color: var(--text-secondary); font-size: 12px; margin-bottom: 6px; }
  .tile .value { font-size: 26px; font-weight: 650; }
  .card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 18px; margin-bottom: 20px; overflow-x: auto; }
  .card h2 { font-size: 14px; font-weight: 650; margin-bottom: 12px; }
  .chart { display: flex; align-items: flex-end; gap: 8px; height: 120px; border-bottom: 1px solid var(--baseline); padding: 18px 4px 0; }
  .bar-col { position: relative; flex: 1; max-width: 56px; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; }
  .bar { width: 100%; max-width: 40px; background: var(--series-1); border-radius: 4px 4px 0 0; min-height: 0; }
  .bar-value { color: var(--text-secondary); font-size: 11px; font-variant-numeric: tabular-nums; margin-bottom: 3px; }
  .bar-label { position: absolute; top: 100%; margin-top: 5px; color: var(--muted); font-size: 11px; }
  .bar-col::after {
    content: attr(data-tip);
    position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
    background: var(--text-primary); color: var(--page);
    font-size: 11px; padding: 4px 8px; border-radius: 6px; white-space: nowrap;
    opacity: 0; pointer-events: none; transition: opacity .12s; z-index: 2;
  }
  .bar-col:hover::after { opacity: 1; }
  .chart-wrap { padding-bottom: 22px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--muted); font-weight: 500; font-size: 12px; padding: 6px 10px; border-bottom: 1px solid var(--gridline); }
  td { padding: 8px 10px; border-bottom: 1px solid var(--gridline); }
  tr:last-child td { border-bottom: none; }
  th.right, td.right { text-align: right; }
  .num { font-variant-numeric: tabular-nums; }
  .badge { display: inline-flex; align-items: center; gap: 6px; color: var(--text-secondary); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .dot-good { background: var(--status-good); }
  .dot-warning { background: var(--status-warning); }
  .dot-serious { background: var(--status-serious); }
  .dot-critical { background: var(--status-critical); }
  .dot-neutral { background: var(--status-neutral); }
  .empty { color: var(--muted); font-size: 13px; padding: 12px 0; }
  .note { color: var(--muted); font-size: 11px; margin-top: -12px; margin-bottom: 20px; }
</style>
</head>
<body>
<header>
  <h1>${esc(shop.name)}</h1>
  <span class="updated">Updated ${esc(updatedAt)} · refreshes every 2 min</span>
</header>

<div class="tiles">
  <div class="tile"><div class="label">Orders today</div><div class="value">${todayStats.orders}</div></div>
  <div class="tile"><div class="label">Revenue today</div><div class="value">${esc(money.format(todayStats.revenue))}</div></div>
  <div class="tile"><div class="label">Orders · 7 days</div><div class="value">${weekOrderCount}</div></div>
  <div class="tile"><div class="label">Revenue · 7 days</div><div class="value">${esc(money.format(weekRevenue))}</div></div>
  <div class="tile"><div class="label">Signups today</div><div class="value">${signupsToday}</div></div>
  <div class="tile"><div class="label">Signups · 7 days</div><div class="value">${signupsWeek}</div></div>
</div>
${capped ? `<p class="note">7-day figures include the first 250 records only.</p>` : ""}

<div class="card chart-wrap">
  <h2>Orders per day</h2>
  ${weekOrderCount > 0 ? `<div class="chart">${barsHtml}</div>` : `<p class="empty">No orders in the last 7 days.</p>`}
</div>

<div class="card">
  <h2>Recent orders</h2>
  ${
    recentOrders.length > 0
      ? `<table>
    <thead><tr><th>Order</th><th>Placed</th><th>Customer</th><th>Payment</th><th>Fulfillment</th><th class="right">Total</th></tr></thead>
    <tbody>${orderRows}</tbody>
  </table>`
      : `<p class="empty">No orders yet.</p>`
  }
</div>

<div class="card">
  <h2>Recent signups</h2>
  ${
    recentCustomers.length > 0
      ? `<table>
    <thead><tr><th>Customer</th><th>Email</th><th>Signed up</th><th class="right">Orders</th><th class="right">Spent</th></tr></thead>
    <tbody>${customerRows}</tbody>
  </table>`
      : `<p class="empty">No customers yet.</p>`
  }
</div>
</body>
</html>`;
}

export function renderErrorPage(message: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Dashboard error</title>
<style>
  body { font-family: system-ui, sans-serif; padding: 40px; max-width: 700px; margin: 0 auto; background: #f9f9f7; color: #0b0b0b; }
  @media (prefers-color-scheme: dark) { body { background: #0d0d0d; color: #fff; } }
  .box { border: 1px solid rgba(128,128,128,.3); border-radius: 10px; padding: 20px; }
  h1 { font-size: 18px; margin: 0 0 10px; }
  pre { white-space: pre-wrap; font-size: 13px; color: #d03b3b; }
</style></head>
<body><div class="box"><h1>Couldn't load dashboard</h1><pre>${esc(message)}</pre>
<p>Check the server's Shopify credentials and try reloading.</p></div></body></html>`;
}
