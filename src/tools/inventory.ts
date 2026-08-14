import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shopifyGraphql, toGid, checkUserErrors } from "../shopify.js";
import { registerTool } from "../register.js";

export function registerInventoryTools(server: McpServer): void {
  registerTool(
    server,
    "get-locations",
    "List the store's inventory locations. Location IDs are needed to adjust inventory.",
    {},
    async () => {
      const data = await shopifyGraphql(
        `query getLocations {
          locations(first: 20) {
            nodes {
              id
              name
              isActive
              address { formatted }
            }
          }
        }`
      );
      return data.locations.nodes;
    }
  );

  registerTool(
    server,
    "adjust-inventory",
    "Adjust the available inventory quantity of a product variant at a location by a delta (positive to add stock, negative to remove). Use get-product-by-id to find the variant's inventoryItem ID and get-locations for the location ID.",
    {
      inventoryItemId: z
        .string()
        .describe("Inventory item ID (numeric ID or gid://shopify/InventoryItem/... form)"),
      locationId: z
        .string()
        .describe("Location ID (numeric ID or gid://shopify/Location/... form)"),
      delta: z
        .number()
        .int()
        .describe("Quantity change: positive to increase available stock, negative to decrease"),
      reason: z
        .string()
        .default("correction")
        .describe("Reason for the adjustment, e.g. 'correction', 'received', 'damaged'"),
    },
    async ({ inventoryItemId, locationId, delta, reason }) => {
      const data = await shopifyGraphql(
        `mutation adjustInventory($input: InventoryAdjustQuantitiesInput!) {
          inventoryAdjustQuantities(input: $input) {
            inventoryAdjustmentGroup {
              reason
              changes { name delta quantityAfterChange }
            }
            userErrors { field message }
          }
        }`,
        {
          input: {
            reason,
            name: "available",
            changes: [
              {
                delta,
                inventoryItemId: toGid(inventoryItemId, "InventoryItem"),
                locationId: toGid(locationId, "Location"),
              },
            ],
          },
        }
      );
      checkUserErrors("adjust-inventory", data.inventoryAdjustQuantities.userErrors);
      return data.inventoryAdjustQuantities.inventoryAdjustmentGroup;
    }
  );
}
