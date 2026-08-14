import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shopifyGraphql } from "../shopify.js";
import { registerTool } from "../register.js";

export function registerShopTools(server: McpServer): void {
  registerTool(
    server,
    "get-shop-info",
    "Get basic information about the connected Shopify store (name, domain, currency, plan).",
    {},
    async () => {
      const data = await shopifyGraphql(
        `query getShop {
          shop {
            name
            email
            myshopifyDomain
            primaryDomain { url }
            currencyCode
            ianaTimezone
            plan { displayName shopifyPlus }
            billingAddress { formatted }
          }
        }`
      );
      return data.shop;
    }
  );
}
