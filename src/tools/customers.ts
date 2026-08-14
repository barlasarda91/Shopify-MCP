import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shopifyGraphql, toGid } from "../shopify.js";
import { registerTool } from "../register.js";

export function registerCustomerTools(server: McpServer): void {
  registerTool(
    server,
    "get-customers",
    "List customers, optionally filtered by a search query (name, email, phone, or e.g. 'orders_count:>5').",
    {
      searchQuery: z
        .string()
        .optional()
        .describe("Shopify customer search query, e.g. an email address or name"),
      limit: z.number().int().min(1).max(100).default(10).describe("Maximum number of customers to return"),
    },
    async ({ searchQuery, limit }) => {
      const data = await shopifyGraphql(
        `query getCustomers($first: Int!, $query: String) {
          customers(first: $first, query: $query) {
            nodes {
              id
              displayName
              email
              phone
              createdAt
              numberOfOrders
              amountSpent { amount currencyCode }
              tags
            }
          }
        }`,
        { first: limit, query: searchQuery ?? null }
      );
      return data.customers.nodes;
    }
  );

  registerTool(
    server,
    "get-customer-orders",
    "Get a customer's profile along with their most recent orders.",
    {
      customerId: z.string().describe("Customer ID (numeric ID or gid://shopify/Customer/... form)"),
      limit: z.number().int().min(1).max(50).default(10).describe("Maximum number of orders to return"),
    },
    async ({ customerId, limit }) => {
      const data = await shopifyGraphql(
        `query getCustomerOrders($id: ID!, $first: Int!) {
          customer(id: $id) {
            id
            displayName
            email
            phone
            numberOfOrders
            amountSpent { amount currencyCode }
            tags
            orders(first: $first, sortKey: CREATED_AT, reverse: true) {
              nodes {
                id
                name
                createdAt
                displayFinancialStatus
                displayFulfillmentStatus
                totalPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
        }`,
        { id: toGid(customerId, "Customer"), first: limit }
      );
      if (!data.customer) {
        throw new Error(`No customer found with ID ${customerId}`);
      }
      return data.customer;
    }
  );
}
