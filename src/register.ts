import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";

/**
 * Register a tool whose handler returns plain data. The result is serialized
 * to JSON text content, and thrown errors become isError tool results instead
 * of crashing the server.
 */
export function registerTool(
  server: McpServer,
  name: string,
  description: string,
  shape: ZodRawShape,
  handler: (args: any) => Promise<unknown>
): void {
  server.registerTool(name, { description, inputSchema: shape }, (async (args: any) => {
    try {
      const result = await handler(args);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true,
      };
    }
  }) as any);
}
