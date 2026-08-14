import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { shopifyGraphql, toGid, checkUserErrors } from "../shopify.js";
import { registerTool } from "../register.js";

const PRODUCT_FIELDS = `
  id
  title
  handle
  status
  vendor
  productType
  tags
  totalInventory
  createdAt
  updatedAt
  priceRangeV2 {
    minVariantPrice { amount currencyCode }
    maxVariantPrice { amount currencyCode }
  }
  variants(first: 20) {
    nodes {
      id
      title
      sku
      price
      compareAtPrice
      inventoryQuantity
      inventoryItem { id }
    }
  }
`;

export function registerProductTools(server: McpServer): void {
  registerTool(
    server,
    "get-products",
    "List products from the Shopify store, optionally filtered by a search query (e.g. a title, 'status:active', or 'tag:sale').",
    {
      searchQuery: z
        .string()
        .optional()
        .describe("Shopify product search query, e.g. a title fragment or 'status:active'"),
      limit: z.number().int().min(1).max(100).default(10).describe("Maximum number of products to return"),
    },
    async ({ searchQuery, limit }) => {
      const data = await shopifyGraphql(
        `query getProducts($first: Int!, $query: String) {
          products(first: $first, query: $query, sortKey: UPDATED_AT, reverse: true) {
            nodes { ${PRODUCT_FIELDS} }
          }
        }`,
        { first: limit, query: searchQuery ?? null }
      );
      return data.products.nodes;
    }
  );

  registerTool(
    server,
    "get-product-by-id",
    "Get full details for a single product, including description, images, and variants.",
    {
      productId: z.string().describe("Product ID (numeric ID or gid://shopify/Product/... form)"),
    },
    async ({ productId }) => {
      const data = await shopifyGraphql(
        `query getProduct($id: ID!) {
          product(id: $id) {
            ${PRODUCT_FIELDS}
            descriptionHtml
            onlineStoreUrl
            media(first: 10) {
              nodes {
                ... on MediaImage {
                  image { url altText }
                }
              }
            }
          }
        }`,
        { id: toGid(productId, "Product") }
      );
      if (!data.product) {
        throw new Error(`No product found with ID ${productId}`);
      }
      return data.product;
    }
  );

  registerTool(
    server,
    "update-product",
    "Update a product's title, description, or status (ACTIVE, DRAFT, or ARCHIVED).",
    {
      productId: z.string().describe("Product ID (numeric ID or gid://shopify/Product/... form)"),
      title: z.string().optional().describe("New product title"),
      descriptionHtml: z.string().optional().describe("New product description (HTML allowed)"),
      status: z.enum(["ACTIVE", "DRAFT", "ARCHIVED"]).optional().describe("New product status"),
    },
    async ({ productId, title, descriptionHtml, status }) => {
      if (title === undefined && descriptionHtml === undefined && status === undefined) {
        throw new Error("Provide at least one of title, descriptionHtml, or status to update.");
      }
      const product: Record<string, unknown> = { id: toGid(productId, "Product") };
      if (title !== undefined) product.title = title;
      if (descriptionHtml !== undefined) product.descriptionHtml = descriptionHtml;
      if (status !== undefined) product.status = status;

      const data = await shopifyGraphql(
        `mutation updateProduct($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product { id title status descriptionHtml }
            userErrors { field message }
          }
        }`,
        { product }
      );
      checkUserErrors("update-product", data.productUpdate.userErrors);
      return data.productUpdate.product;
    }
  );

  registerTool(
    server,
    "update-variant-price",
    "Update the price (and optionally compare-at price) of a product variant.",
    {
      productId: z.string().describe("Product ID that owns the variant"),
      variantId: z.string().describe("Variant ID (numeric ID or gid://shopify/ProductVariant/... form)"),
      price: z.string().describe("New price as a decimal string, e.g. '19.99'"),
      compareAtPrice: z
        .string()
        .optional()
        .describe("Optional compare-at (strikethrough) price as a decimal string"),
    },
    async ({ productId, variantId, price, compareAtPrice }) => {
      const variant: Record<string, unknown> = {
        id: toGid(variantId, "ProductVariant"),
        price,
      };
      if (compareAtPrice !== undefined) variant.compareAtPrice = compareAtPrice;

      const data = await shopifyGraphql(
        `mutation updateVariantPrice($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id title price compareAtPrice }
            userErrors { field message }
          }
        }`,
        { productId: toGid(productId, "Product"), variants: [variant] }
      );
      checkUserErrors("update-variant-price", data.productVariantsBulkUpdate.userErrors);
      return data.productVariantsBulkUpdate.productVariants;
    }
  );
}
