import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shopifyGraphql, toGid } from "../shopify.js";
import { registerTool } from "../register.js";

const ORDER_SUMMARY_FIELDS = `
  id
  name
  createdAt
  displayFinancialStatus
  displayFulfillmentStatus
  totalPriceSet { shopMoney { amount currencyCode } }
  customer { id displayName email }
`;

export function registerOrderTools(server: McpServer): void {
  registerTool(
    server,
    "get-orders",
    "List recent orders, optionally filtered by a Shopify order search query (e.g. 'financial_status:paid', 'fulfillment_status:unfulfilled', 'created_at:>2026-01-01', or an order name like '#1001').",
    {
      searchQuery: z
        .string()
        .optional()
        .describe("Shopify order search query, e.g. 'fulfillment_status:unfulfilled'"),
      limit: z.number().int().min(1).max(100).default(10).describe("Maximum number of orders to return"),
    },
    async ({ searchQuery, limit }) => {
      const data = await shopifyGraphql(
        `query getOrders($first: Int!, $query: String) {
          orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
            nodes { ${ORDER_SUMMARY_FIELDS} }
          }
        }`,
        { first: limit, query: searchQuery ?? null }
      );
      return data.orders.nodes;
    }
  );

  registerTool(
    server,
    "get-order-by-id",
    "Get full details for a single order, including line items, shipping address, and totals.",
    {
      orderId: z.string().describe("Order ID (numeric ID or gid://shopify/Order/... form)"),
    },
    async ({ orderId }) => {
      const data = await shopifyGraphql(
        `query getOrder($id: ID!) {
          order(id: $id) {
            ${ORDER_SUMMARY_FIELDS}
            email
            phone
            note
            tags
            subtotalPriceSet { shopMoney { amount currencyCode } }
            totalShippingPriceSet { shopMoney { amount currencyCode } }
            totalTaxSet { shopMoney { amount currencyCode } }
            shippingAddress { formatted }
            lineItems(first: 50) {
              nodes {
                title
                quantity
                sku
                variantTitle
                originalUnitPriceSet { shopMoney { amount currencyCode } }
                discountedTotalSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }`,
        { id: toGid(orderId, "Order") }
      );
      if (!data.order) {
        throw new Error(`No order found with ID ${orderId}`);
      }
      return data.order;
    }
  );
}
