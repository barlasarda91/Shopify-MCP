import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shopifyGraphql, checkUserErrors, toGid } from "../shopify.js";
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

// ---------------------------------------------------------------------------
// Automatic "amount off products" discounts (DiscountAutomaticBasic)
// ---------------------------------------------------------------------------

const AUTOMATIC_RESULT_FIELDS = `
  automaticDiscountNode {
    id
    automaticDiscount {
      ... on DiscountAutomaticBasic {
        title status summary startsAt endsAt ${COMBINES_WITH} ${MINIMUM_REQUIREMENT} ${CUSTOMER_GETS}
      }
    }
  }
  userErrors { field message }
`;

const combinesWithShape = z
  .object({
    productDiscounts: z.boolean(),
    orderDiscounts: z.boolean(),
    shippingDiscounts: z.boolean(),
  })
  .describe("Which other discount classes this discount may combine with");

const automaticShape = {
  title: z.string().describe("Discount name, shown in the admin and to customers at checkout"),
  valueType: z
    .enum(["percentage", "fixed_amount"])
    .describe("Percentage off or a fixed amount off"),
  value: z
    .number()
    .positive()
    .describe("For percentage use 20 for 20%; for fixed_amount use the amount in store currency, e.g. 2.5"),
  appliesOnEachItem: z
    .boolean()
    .describe(
      "fixed_amount only: true takes the amount off every qualifying item (per unit); false takes it off once per order"
    ),
  productIds: z
    .array(z.string())
    .describe("Products the discount applies to (numeric IDs or gid://shopify/Product/...)"),
  collectionIds: z
    .array(z.string())
    .describe("Collections the discount applies to (numeric IDs or gid://shopify/Collection/...)"),
  minimumQuantity: z
    .number()
    .int()
    .positive()
    .describe("Minimum number of qualifying items in the cart"),
  minimumSubtotal: z
    .number()
    .positive()
    .describe("Minimum subtotal of qualifying items, in store currency"),
  purchaseType: z
    .enum(["one_time", "subscription", "both"])
    .describe("Apply to one-time purchases, subscriptions, or both"),
  combinesWith: combinesWithShape,
  startsAt: z.string().describe("ISO 8601 start time"),
  endsAt: z.string().nullable().describe("ISO 8601 end time, or null for no end date"),
};

function buildValue(valueType: string, value: number, appliesOnEachItem: boolean | undefined) {
  return valueType === "percentage"
    ? { percentage: value / 100 }
    : { discountAmount: { amount: value, appliesOnEachItem: appliesOnEachItem ?? true } };
}

function buildPurchaseType(purchaseType: string) {
  return {
    appliesOnOneTimePurchase: purchaseType !== "subscription",
    appliesOnSubscription: purchaseType !== "one_time",
  };
}

function buildMinimum(minimumQuantity?: number, minimumSubtotal?: number) {
  if (minimumQuantity !== undefined && minimumSubtotal !== undefined) {
    throw new Error("Set either minimumQuantity or minimumSubtotal, not both.");
  }
  if (minimumQuantity !== undefined) {
    return { quantity: { greaterThanOrEqualToQuantity: String(minimumQuantity) }, subtotal: null };
  }
  if (minimumSubtotal !== undefined) {
    return { subtotal: { greaterThanOrEqualToSubtotal: minimumSubtotal }, quantity: null };
  }
  return undefined;
}

export function registerDiscountTools(server: McpServer): void {
  registerTool(
    server,
    "create-automatic-discount",
    "Create an automatic 'amount off products' discount (no code needed). Supports a percentage or fixed amount, " +
      "per-item or once-per-order application, specific products or collections (or all products), a minimum " +
      "quantity or subtotal, one-time vs subscription purchase type, and combination settings.",
    {
      title: automaticShape.title,
      valueType: automaticShape.valueType,
      value: automaticShape.value,
      appliesOnEachItem: automaticShape.appliesOnEachItem.default(true),
      productIds: automaticShape.productIds.optional(),
      collectionIds: automaticShape.collectionIds.optional(),
      minimumQuantity: automaticShape.minimumQuantity.optional(),
      minimumSubtotal: automaticShape.minimumSubtotal.optional(),
      purchaseType: automaticShape.purchaseType.default("both"),
      combinesWith: combinesWithShape.default({
        productDiscounts: false,
        orderDiscounts: false,
        shippingDiscounts: false,
      }),
      startsAt: automaticShape.startsAt.optional().describe("ISO 8601 start time; defaults to now"),
      endsAt: z.string().optional().describe("Optional ISO 8601 end time"),
    },
    async (args) => {
      if (args.productIds?.length && args.collectionIds?.length) {
        throw new Error("Set either productIds or collectionIds, not both.");
      }
      let items: Record<string, unknown> = { all: true };
      if (args.productIds?.length) {
        items = { products: { productsToAdd: args.productIds.map((id: string) => toGid(id, "Product")) } };
      } else if (args.collectionIds?.length) {
        items = { collections: { add: args.collectionIds.map((id: string) => toGid(id, "Collection")) } };
      }

      const automaticBasicDiscount: Record<string, unknown> = {
        title: args.title,
        startsAt: args.startsAt ?? new Date().toISOString(),
        combinesWith: args.combinesWith,
        customerGets: {
          value: buildValue(args.valueType, args.value, args.appliesOnEachItem),
          items,
          ...buildPurchaseType(args.purchaseType),
        },
      };
      if (args.endsAt !== undefined) automaticBasicDiscount.endsAt = args.endsAt;
      const minimum = buildMinimum(args.minimumQuantity, args.minimumSubtotal);
      if (minimum) automaticBasicDiscount.minimumRequirement = minimum;

      const data = await shopifyGraphql(
        `mutation createAutomaticDiscount($automaticBasicDiscount: DiscountAutomaticBasicInput!) {
          discountAutomaticBasicCreate(automaticBasicDiscount: $automaticBasicDiscount) {
            ${AUTOMATIC_RESULT_FIELDS}
          }
        }`,
        { automaticBasicDiscount }
      );
      checkUserErrors("create-automatic-discount", data.discountAutomaticBasicCreate.userErrors);
      return data.discountAutomaticBasicCreate.automaticDiscountNode;
    }
  );

  registerTool(
    server,
    "update-automatic-discount",
    "Update an existing automatic 'amount off products' discount. Only the fields you pass change. " +
      "To change the amount or per-item setting, pass valueType, value and appliesOnEachItem together. " +
      "Use list-discounts to find the discount ID (gid://shopify/DiscountAutomaticNode/...).",
    {
      id: z.string().describe("Automatic discount ID (numeric or gid://shopify/DiscountAutomaticNode/...)"),
      title: automaticShape.title.optional(),
      valueType: automaticShape.valueType.optional(),
      value: automaticShape.value.optional(),
      appliesOnEachItem: automaticShape.appliesOnEachItem.optional(),
      minimumQuantity: automaticShape.minimumQuantity.optional(),
      minimumSubtotal: automaticShape.minimumSubtotal.optional(),
      removeMinimum: z.boolean().optional().describe("true removes any minimum requirement"),
      purchaseType: automaticShape.purchaseType.optional(),
      combinesWith: combinesWithShape.optional(),
      startsAt: automaticShape.startsAt.optional(),
      endsAt: automaticShape.endsAt.optional(),
    },
    async (args) => {
      const input: Record<string, unknown> = {};
      if (args.title !== undefined) input.title = args.title;
      if (args.startsAt !== undefined) input.startsAt = args.startsAt;
      if (args.endsAt !== undefined) input.endsAt = args.endsAt;
      if (args.combinesWith !== undefined) input.combinesWith = args.combinesWith;

      if (args.removeMinimum) {
        input.minimumRequirement = { quantity: null, subtotal: null };
      } else {
        const minimum = buildMinimum(args.minimumQuantity, args.minimumSubtotal);
        if (minimum) input.minimumRequirement = minimum;
      }

      const customerGets: Record<string, unknown> = {};
      const valueFields = [args.valueType, args.value, args.appliesOnEachItem];
      if (valueFields.some((v) => v !== undefined)) {
        if (args.valueType === undefined || args.value === undefined) {
          throw new Error("To change the value, pass valueType and value (and appliesOnEachItem for fixed_amount).");
        }
        customerGets.value = buildValue(args.valueType, args.value, args.appliesOnEachItem);
      }
      if (args.purchaseType !== undefined) Object.assign(customerGets, buildPurchaseType(args.purchaseType));
      if (Object.keys(customerGets).length) input.customerGets = customerGets;

      if (!Object.keys(input).length) throw new Error("Nothing to update.");

      const data = await shopifyGraphql(
        `mutation updateAutomaticDiscount($id: ID!, $automaticBasicDiscount: DiscountAutomaticBasicInput!) {
          discountAutomaticBasicUpdate(id: $id, automaticBasicDiscount: $automaticBasicDiscount) {
            ${AUTOMATIC_RESULT_FIELDS}
          }
        }`,
        { id: toGid(args.id, "DiscountAutomaticNode"), automaticBasicDiscount: input }
      );
      checkUserErrors("update-automatic-discount", data.discountAutomaticBasicUpdate.userErrors);
      return data.discountAutomaticBasicUpdate.automaticDiscountNode;
    }
  );

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
