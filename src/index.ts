#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stdout carries the MCP protocol; log to stderr only.
  console.error("Shopify MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error starting Shopify MCP server:", error);
  process.exit(1);
});
