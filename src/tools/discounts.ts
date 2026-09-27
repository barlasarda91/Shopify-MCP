import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shopifyGraphql, checkUserErrors } from "../shopify.js";
import { registerTool } from "../register.js";

// Shared selections for reading discounts. Kept small (first: 5) so a page of
// 25 discounts stays well under Shopify's 1000-point query cost limit.
const COMBINES_WITH = `combinesWith { productDiscounts orderDiscounts shippingDiscounts }`;

const CUSTOMER_GETS = `
  customerGets {
    appliesOnOneTimePurchase
    appliesOnSubscription
    value {
      __typename
      ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
      ... on DiscountPercentage { percentage }
      ... on DiscountOnQuantity {
        quantity { quantity }
        effect {
          __typename
          ... on DiscountPercentage { percentage }
          ... on DiscountAmount { amount { amount currencyCode } appliesOnEachItem }
        }
      }
    }
    items {
      __typename
      ... on AllDiscountItems { allItems }
      ... on DiscountProducts {
        products(first: 5) { nodes { id title handle } }
        productVariants(first: 5) { nodes { id title product { title handle } } }
      }
      ... on DiscountCollections {
        collections(first: 5) { nodes { id title handle } }
      }
    }
  }
`;

const MINIMUM_REQUIREMENT = `
  minimumRequirement {
    __typename
    ... on DiscountMinimumQuantity { greaterThanOrEqualToQuantity }
    ... on DiscountMinimumSubtotal { greaterThanOrEqualToSubtotal { amount currencyCode } }
  }
`;

const COMMON = `title status startsAt endsAt discountClasses asyncUsageCount ${COMBINES_WITH}`;
const CODES = `codes(first: 3) { nodes { code } } codesCount { count }`;

const DISCOUNT_FIELDS = `
  id
  discount {
    __typename
    ... on DiscountAutomaticBasic { ${COMMON} summary ${MINIMUM_REQUIREMENT} ${CUSTOMER_GETS} }
    ... on DiscountCodeBasic { ${COMMON} summary ${CODES} usageLimit appliesOncePerCustomer ${MINIMUM_REQUIREMENT} ${CUSTOMER_GETS} }
    ... on DiscountAutomaticBxgy { ${COMMON} summary }
    ... on DiscountCodeBxgy { ${COMMON} summary ${CODES} usageLimit appliesOncePerCustomer }
    ... on DiscountAutomaticFreeShipping { ${COMMON} summary }
    ... on DiscountCodeFreeShipping { ${COMMON} summary ${CODES} usageLimit appliesOncePerCustomer }
    ... on DiscountAutomaticApp { ${COMMON} appDiscountType { title } }
    ... on DiscountCodeApp { ${COMMON} ${CODES} usageLimit appliesOncePerCustomer appDiscountType { title } }
  }
`;

export function registerDiscountTools(server: McpServer): void {
  registerTool(
    server,
    "list-discounts",
    "List discounts (automatic and code) with their full setup: title, status, dates, method, amount or percentage, " +
      "whether it applies to each item, minimum quantity or subtotal, the products/collections it applies to, " +
      "one-time vs subscription purchase type, combination settings, codes, and usage. Optional Shopify discount " +
      "search query, e.g. 'status:active', 'method:automatic', 'discount_class:product', 'title:Roaster'. " +
      "Returns up to 25 per page; pass pageInfo.endCursor as 'after' for the next page.",
    {
      searchQuery: z
        .string()
        .optional()
        .describe("Shopify discount search query, e.g. 'status:active' or 'method:automatic'"),
      limit: z.number().int().min(1).max(25).default(25).describe("Maximum number of discounts to return"),
      after: z.string().optional().describe("Pagination cursor (pageInfo.endCursor from a previous call)"),
    },
    async ({ searchQuery, limit, after }) => {
      const data = await shopifyGraphql(
        `query listDiscounts($first: Int!, $query: String, $after: String) {
          discountNodes(first: $first, query: $query, after: $after) {
            nodes { ${DISCOUNT_FIELDS} }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { first: limit, query: searchQuery ?? null, after: after ?? null }
      );
      return {
        discounts: data.discountNodes.nodes,
        pageInfo: data.discountNodes.pageInfo,
      };
    }
  );

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
