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
| `create-discount-code` | Create a percentage or fixed-amount discount code |

Read tools accept Shopify search query syntax (e.g. `status:active`, `fulfillment_status:unfulfilled`, `created_at:>2026-01-01`) and IDs may be given as bare numbers or full `gid://shopify/...` IDs.

## Get a Shopify Admin API access token

Both modes need an Admin API token:

1. In your Shopify admin, go to **Settings → Apps and sales channels → Develop apps**.
2. Click **Create an app** (enable custom app development first if prompted) and give it a name like `claude-mcp`.
3. Under **Configuration → Admin API integration**, grant the scopes you want the server to have:
   - `read_products`, `write_products`
   - `read_orders`
   - `read_customers`
   - `read_inventory`, `write_inventory`
   - `read_discounts`, `write_discounts`
   - `read_locations`

   (Only grant `write_*` scopes if you want Claude to be able to make changes. With read-only scopes, the write tools will return permission errors and everything else works.)
4. Click **Install app**, then reveal and copy the **Admin API access token** (starts with `shpat_`). It is shown only once.

## Use from claude.ai (web + mobile)

To always have access without a desktop machine, deploy the server somewhere public and connect it as a custom connector.

### 1. Deploy the server

Any Node.js host works. The repo includes a `Dockerfile`, so container platforms like [Railway](https://railway.app), [Render](https://render.com), or [Fly.io](https://fly.io) can deploy it straight from GitHub with no extra config. Set these environment variables on the host:

| Variable | Value |
| --- | --- |
| `SHOPIFY_DOMAIN` | `your-store.myshopify.com` |
| `SHOPIFY_ACCESS_TOKEN` | Your `shpat_...` Admin API token (see above) |
| `MCP_AUTH_TOKEN` | A long random secret, e.g. from `openssl rand -hex 32` |

The container listens on `PORT` (default 3000) and serves the MCP endpoint at `/mcp/<MCP_AUTH_TOKEN>`, plus a `/healthz` health check.

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
  --env SHOPIFY_ACCESS_TOKEN=shpat_xxxxxxxxxxxx \
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
        "SHOPIFY_ACCESS_TOKEN": "shpat_xxxxxxxxxxxx"
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
