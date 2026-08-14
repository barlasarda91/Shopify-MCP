#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerProductTools } from "./tools/products.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerDiscountTools } from "./tools/discounts.js";
import { registerShopTools } from "./tools/shop.js";

const server = new McpServer({
  name: "shopify-mcp",
  version: "1.0.0",
});

registerShopTools(server);
registerProductTools(server);
registerOrderTools(server);
registerCustomerTools(server);
registerInventoryTools(server);
registerDiscountTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries the MCP protocol; log to stderr only.
  console.error("Shopify MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting Shopify MCP server:", error);
  process.exit(1);
});
