import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shopifyGraphql, checkUserErrors } from "../shopify.js";
import { registerTool } from "../register.js";

export function registerDiscountTools(server: McpServer): void {
  registerTool(
    server,
    "create-discount-code",
    "Create a basic discount code (percentage or fixed amount off the whole order) that customers can enter at checkout.",
    {
      title: z.string().describe("Internal title for the discount, shown in the Shopify admin"),
      code: z.string().describe("The code customers enter at checkout, e.g. 'SUMMER20'"),
      valueType: z
        .enum(["percentage", "fixed_amount"])
        .describe("Whether the discount is a percentage or a fixed amount off"),
      value: z
        .number()
        .positive()
        .describe("Discount value: for percentage use 20 for 20%; for fixed_amount use the amount in store currency"),
      appliesOncePerCustomer: z
        .boolean()
        .default(false)
        .describe("Limit the code to one use per customer"),
      startsAt: z
        .string()
        .optional()
        .describe("ISO 8601 start time; defaults to now"),
      endsAt: z.string().optional().describe("Optional ISO 8601 end time"),
    },
    async ({ title, code, valueType, value, appliesOncePerCustomer, startsAt, endsAt }) => {
      const customerGetsValue =
        valueType === "percentage"
          ? { percentage: value / 100 }
          : { discountAmount: { amount: value, appliesOnEachItem: false } };

      const basicCodeDiscount: Record<string, unknown> = {
        title,
        code,
        startsAt: startsAt ?? new Date().toISOString(),
        appliesOncePerCustomer,
        customerSelection: { all: true },
        customerGets: {
          value: customerGetsValue,
          items: { all: true },
        },
      };
      if (endsAt !== undefined) basicCodeDiscount.endsAt = endsAt;

      const data = await shopifyGraphql(
        `mutation createDiscountCode($basicCodeDiscount: DiscountCodeBasicInput!) {
          discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
            codeDiscountNode {
              id
              codeDiscount {
                ... on DiscountCodeBasic {
                  title
                  status
                  startsAt
                  endsAt
                  codes(first: 1) { nodes { code } }
                }
              }
            }
            userErrors { field message }
          }
        }`,
        { basicCodeDiscount }
      );
      checkUserErrors("create-discount-code", data.discountCodeBasicCreate.userErrors);
      return data.discountCodeBasicCreate.codeDiscountNode;
    }
  );
}
