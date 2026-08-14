const API_VERSION = "2025-07";

export class ShopifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShopifyError";
  }
}

function getDomain(): string {
  const domain = process.env.SHOPIFY_DOMAIN ?? process.env.MYSHOPIFY_DOMAIN;
  if (!domain) {
    throw new ShopifyError(
      "Missing SHOPIFY_DOMAIN environment variable (e.g. your-store.myshopify.com)."
    );
  }
  return domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

// Cached token from the client credentials grant (Dev Dashboard apps).
// Those tokens expire after ~24h, so we refresh shortly before expiry.
let cachedToken: { token: string; expiresAtMs: number } | null = null;
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

async function fetchClientCredentialsToken(
  domain: string,
  clientId: string,
  clientSecret: string
): Promise<string> {
  const response = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new ShopifyError(
      `Failed to get an access token via the client credentials grant (HTTP ${response.status}): ` +
        `${body.slice(0, 300)}. Check SHOPIFY_CLIENT_ID / SHOPIFY_CLIENT_SECRET and make sure ` +
        `the app is installed on ${domain}.`
    );
  }

  const json = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) {
    throw new ShopifyError("Client credentials response did not include an access_token.");
  }
  const expiresInMs = (json.expires_in ?? 86399) * 1000;
  cachedToken = {
    token: json.access_token,
    expiresAtMs: Date.now() + expiresInMs - EXPIRY_MARGIN_MS,
  };
  return json.access_token;
}

async function getAccessToken(domain: string): Promise<string> {
  // Static token from a legacy admin custom app takes precedence if provided.
  const staticToken = process.env.SHOPIFY_ACCESS_TOKEN;
  if (staticToken) return staticToken;

  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  if (clientId && clientSecret) {
    if (cachedToken && Date.now() < cachedToken.expiresAtMs) {
      return cachedToken.token;
    }
    return fetchClientCredentialsToken(domain, clientId, clientSecret);
  }

  throw new ShopifyError(
    "Missing Shopify credentials. Set either SHOPIFY_ACCESS_TOKEN (legacy admin custom app token) " +
      "or SHOPIFY_CLIENT_ID and SHOPIFY_CLIENT_SECRET (Dev Dashboard app credentials) " +
      "alongside SHOPIFY_DOMAIN."
  );
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function shopifyGraphql<T = any>(
  query: string,
  variables: Record<string, unknown> = {}
): Promise<T> {
  const domain = getDomain();
  const accessToken = await getAccessToken(domain);
  const url = `https://${domain}/admin/api/${API_VERSION}/graphql.json`;

  const doRequest = (token: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    });

  let response = await doRequest(accessToken);

  // A 401 with client credentials likely means the cached token was revoked
  // early (e.g. app reinstalled) — refresh once and retry.
  if (response.status === 401 && !process.env.SHOPIFY_ACCESS_TOKEN && cachedToken) {
    cachedToken = null;
    response = await doRequest(await getAccessToken(domain));
  }

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
