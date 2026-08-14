#!/usr/bin/env node
import express from "express";
import type { Request, Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";
import { renderDashboard, renderErrorPage } from "./dashboard.js";

/**
 * Remote (web-accessible) entry point. Exposes the MCP server over the
 * Streamable HTTP transport so it can be added to claude.ai as a custom
 * connector. Each request is handled statelessly, which is what claude.ai
 * expects and keeps the server safe to run behind load balancers.
 *
 * Authentication: set MCP_AUTH_TOKEN to a long random secret. Requests must
 * then either include it as a Bearer token or use the /mcp/<token> path
 * (claude.ai custom connectors can't send custom headers, so the secret-path
 * form is the one to paste into the connector URL).
 */

const PORT = Number(process.env.PORT ?? 3000);
const AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

if (!AUTH_TOKEN) {
  console.warn(
    "WARNING: MCP_AUTH_TOKEN is not set — the /mcp endpoint is unauthenticated. " +
      "Anyone who finds the URL can use your Shopify tools. Set MCP_AUTH_TOKEN in production."
  );
}

const app = express();
app.use(express.json({ limit: "4mb" }));

function isAuthorized(req: Request): boolean {
  if (!AUTH_TOKEN) return true;
  const header = req.headers.authorization;
  if (header === `Bearer ${AUTH_TOKEN}`) return true;
  if (req.params.token === AUTH_TOKEN) return true;
  return false;
}

async function handleMcpRequest(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
    return;
  }

  // Stateless mode: a fresh server + transport per request.
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
}

function methodNotAllowed(_req: Request, res: Response): void {
  // Stateless servers have no SSE stream to resume and no session to delete.
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed" },
    id: null,
  });
}

app.post("/mcp", handleMcpRequest);
app.post("/mcp/:token", handleMcpRequest);
app.get(["/mcp", "/mcp/:token"], methodNotAllowed);
app.delete(["/mcp", "/mcp/:token"], methodNotAllowed);

async function handleDashboard(req: Request, res: Response): Promise<void> {
  if (!isAuthorized(req)) {
    res.status(401).send("Unauthorized");
    return;
  }
  try {
    res.type("html").send(await renderDashboard());
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Error rendering dashboard:", error);
    res.status(500).type("html").send(renderErrorPage(message));
  }
}

app.get("/dashboard", handleDashboard);
app.get("/dashboard/:token", handleDashboard);

app.get("/healthz", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Shopify MCP server listening on port ${PORT}`);
  console.log(
    AUTH_TOKEN
      ? `Connector URL path: /mcp/<your MCP_AUTH_TOKEN>`
      : `Connector URL path: /mcp (unauthenticated!)`
  );
});
