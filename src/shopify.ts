const API_VERSION = "2025-07";

export class ShopifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyError";
  }
}

function getConfig(): { domain: string; accessToken: string } {
  const domain = process.env.SHOPIFY_DOMAIN ?? process.env.MYSHOPIFY_DOMAIN;
  const accessToken = process.env.SHOPIFY_ACCESS_TOKEN;
  if (!domain || !accessToken) {
    throw new ShopifyError(
      "Missing Shopify credentials. Set the SHOPIFY_DOMAIN (e.g. your-store.myshopify.com) " +
        "and SHOPIFY_ACCESS_TOKEN environment variables for this MCP server."
    );
  }
  return { domain: domain.replace(/^https?:\/\//, "").replace(/\/$/, ""), accessToken };
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function shopifyGraphql<T = any>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const { domain, accessToken } = getConfig();
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ShopifyError(
      `Shopify API request failed with HTTP ${response.status}: ${body.slice(0, 500)}`
    );
  }

  const json = (await response.json()) as GraphQLResponse<T>;
  if (json.errors?.length) {
    throw new ShopifyError(
      `Shopify GraphQL error: ${json.errors.map((e) => e.message).join("; ")}`
    );
  }
  if (json.data === undefined) {
    throw new ShopifyError("Shopify GraphQL response contained no data.");
  }
  return json.data;
}

/**
 * Shopify GraphQL IDs look like gid://shopify/Product/123456. Accept either the
 * full gid or a bare numeric ID and normalize to the gid form.
 */
export function toGid(id: string, resource: string): string {
  if (id.startsWith("gid://")) return id;
  return `gid://shopify/${resource}/${id}`;
}

export function checkUserErrors(
  operation: string,
  userErrors: Array<{ field?: string[] | null; message: string }> | undefined
): void {
  if (userErrors?.length) {
    const details = userErrors
      .map((e) => (e.field?.length ? `${e.field.join(".")}: ${e.message}` : e.message))
      .join("; ");
    throw new ShopifyError(`${operation} failed: ${details}`);
  }
}
