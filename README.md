# Shopify MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives Claude access to your Shopify store through the Shopify Admin GraphQL API.

It runs in two modes from the same codebase:

- **Remote (HTTP)** — deploy it to any host and add it to [claude.ai](https://claude.ai) as a custom connector, so it works from the web and mobile apps everywhere. See [Use from claude.ai](#use-from-claudeai-web--mobile).
- **Local (stdio)** — run it on your machine for Claude Desktop or Claude Code.

## Tools

| Tool | What it does |
| --- | --- |
| `get-shop-info` | Store name, domain, currency, and plan |
| `get-products` | List/search products |
| `get-product-by-id` | Full product details (description, images, variants) |
| `update-product` | Change a product's title, description, or status |
| `update-variant-price` | Change a variant's price / compare-at price |
| `get-orders` | List/search recent orders |
| `get-order-by-id` | Full order details (line items, address, totals) |
| `get-customers` | List/search customers |
| `get-customer-orders` | A customer's profile and recent orders |
| `get-locations` | List inventory locations |
| `adjust-inventory` | Add or remove available stock for a variant |
| `list-discounts` | List automatic and code discounts with amounts, minimums, products, purchase type, and combination settings |
| `create-automatic-discount` | Create an automatic amount-off-products discount (per item or per order, products/collections, minimums, purchase type, combinations) |
| `update-automatic-discount` | Change an existing automatic discount's amount, per-item setting, minimum, purchase type, combinations, or dates |
| `create-discount-code` | Create a percentage or fixed-amount discount code |

Read tools accept Shopify search query syntax (e.g. `status:active`, `fulfillment_status:unfulfilled`, `created_at:>2026-01-01`) and IDs may be given as bare numbers or full `gid://shopify/...` IDs.

## Get Shopify API credentials

Both modes need Admin API credentials. There are two kinds, depending on how your app was created; the server supports both.

### Dev Dashboard app (current Shopify flow)

Shopify has deprecated creating custom apps inside the store admin — new apps are created in the [Dev Dashboard](https://dev.shopify.com) and authenticate with a client ID/secret. The server exchanges these for access tokens automatically (client credentials grant) and refreshes them before their 24-hour expiry.

1. In the Dev Dashboard, create an app (the "API-only, no admin UI" path is a good fit).
2. Configure the **Admin API access scopes** you want the server to have:
   - `read_products`, `write_products`
   - `read_orders`
   - `read_customers`
   - `read_inventory`, `write_inventory`
   - `read_discounts`, `write_discounts`
   - `read_locations`

   (Only grant `write_*` scopes if you want Claude to be able to make changes. Scopes lock at install time — changing them later means releasing a new version and reinstalling.)
3. From the app's **Home** panel, use **Install app** to install it on your store.
4. In the app's **Settings**, copy the **Client ID** and **Client secret**. These become the `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` environment variables.

Note: the client credentials grant only works for apps created by your own organization and installed on your own store — which is exactly this setup.

### Legacy admin custom app

If your store still has an app under **Settings → Apps and sales channels → Develop apps** with an Admin API access token (starts with `shpat_`), you can use that instead: set it as `SHOPIFY_ACCESS_TOKEN` and skip the client ID/secret.

## Use from claude.ai (web + mobile)

To always have access without a desktop machine, deploy the server somewhere public and connect it as a custom connector.

### 1. Deploy the server

Any Node.js host works. The repo includes a `Dockerfile`, so container platforms like [Railway](https://railway.app), [Render](https://render.com), or [Fly.io](https://fly.io) can deploy it straight from GitHub with no extra config. Set these environment variables on the host:

| Variable | Value |
| --- | --- |
| `SHOPIFY_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Dev Dashboard app client ID (see above) |
| `SHOPIFY_CLIENT_SECRET` | Dev Dashboard app client secret |
| `MCP_AUTH_TOKEN` | A long random secret, e.g. from `openssl rand -hex 32` |

(For a legacy admin custom app, set `SHOPIFY_ACCESS_TOKEN` instead of the client ID/secret.)

The container listens on `PORT` (default 3000) and serves:

- `/mcp/<MCP_AUTH_TOKEN>` — the MCP endpoint for claude.ai
- `/dashboard/<MCP_AUTH_TOKEN>` — a live dashboard webpage (see below)
- `/healthz` — health check

### Dashboard

`https://your-app.example.com/dashboard/<MCP_AUTH_TOKEN>` is a bookmarkable web dashboard that pulls live data from Shopify on every load: orders and revenue for today and the last 7 days, new customer signups, an orders-per-day chart, and tables of recent orders (with payment/fulfillment status) and recent signups. It auto-refreshes every 2 minutes and supports light/dark mode. The same `MCP_AUTH_TOKEN` protects it — treat the URL as confidential.

To run it directly instead of via Docker: `npm install && npm run build && npm run start:http`.

### 2. Add the connector on claude.ai

1. Go to **claude.ai → Settings → Connectors → Add custom connector** (available on Pro, Max, Team, and Enterprise plans).
2. Name it `Shopify` and set the URL to:
   ```
   https://your-app.example.com/mcp/<your MCP_AUTH_TOKEN>
   ```
3. Save. The Shopify tools now appear in web and mobile chats via the search-and-tools menu.

> **Security:** the `MCP_AUTH_TOKEN` in the URL is the only thing standing between the internet and your store's API, so make it long and random, always use HTTPS (hosts like Railway/Render provide it automatically), and rotate the token if the URL ever leaks. The Shopify token itself stays server-side and is never sent to the browser.

## Run locally (Claude Desktop / Claude Code)

### 1. Build the server

```bash
npm install
npm run build
```

### 2. Connect it to Claude

**Claude Code (CLI):**

```bash
claude mcp add shopify \
  --env SHOPIFY_DOMAIN=your-store.myshopify.com \
  --env SHOPIFY_CLIENT_ID=xxxxxxxxxxxx \
  --env SHOPIFY_CLIENT_SECRET=xxxxxxxxxxxx \
  -- node /absolute/path/to/Shopify-MCP/build/index.js
```

**Claude Desktop** — add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "shopify": {
      "command": "node",
      "args": ["/absolute/path/to/Shopify-MCP/build/index.js"],
      "env": {
        "SHOPIFY_DOMAIN": "your-store.myshopify.com",
        "SHOPIFY_CLIENT_ID": "xxxxxxxxxxxx",
        "SHOPIFY_CLIENT_SECRET": "xxxxxxxxxxxx"
      }
    }
  }
}
```

Then ask Claude things like *"What are my 5 most recent unfulfilled orders?"* or *"Create a 15% discount code called WELCOME15"*.

## Security notes

- The access token grants API access to your store — treat it like a password. Keep it in host environment variables or your MCP client config; never commit it.
- Scope the token minimally: if you only need reporting, grant read-only scopes.
- The server only ever calls your store's `/admin/api` GraphQL endpoint; the Shopify token never leaves the server.
- In remote mode, always set `MCP_AUTH_TOKEN` — without it the endpoint is open to anyone who finds the URL.

## Development

```bash
npm run watch   # recompile on change
```

The server is plain TypeScript using `@modelcontextprotocol/sdk`. Each tool group lives in `src/tools/`, `src/shopify.ts` holds the GraphQL client (API version `2025-07`), and `src/server.ts` assembles the MCP server used by both entry points (`src/index.ts` for stdio, `src/http.ts` for HTTP).
