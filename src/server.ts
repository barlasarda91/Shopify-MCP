import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerProductTools } from "./tools/products.js";
import { registerOrderTools } from "./tools/orders.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerInventoryTools } from "./tools/inventory.js";
import { registerDiscountTools } from "./tools/discounts.js";
import { registerShopTools } from "./tools/shop.js";

export function createServer(): McpServer {
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

  return server;
}
