# Shopify MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io) server that gives Claude access to your Shopify store through the Shopify Admin GraphQL API.

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

## Setup

### 1. Get a Shopify Admin API access token

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

### 2. Build the server

```bash
npm install
npm run build
```

### 3. Connect it to Claude

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

- The access token grants API access to your store — treat it like a password. Keep it in environment variables or your MCP client config; never commit it.
- Scope the token minimally: if you only need reporting, grant read-only scopes.
- The server talks only to your store's `/admin/api` GraphQL endpoint and runs locally over stdio.

## Development

```bash
npm run watch   # recompile on change
```

The server is plain TypeScript using `@modelcontextprotocol/sdk`. Each tool group lives in `src/tools/`, and `src/shopify.ts` holds the GraphQL client (API version `2025-07`).
