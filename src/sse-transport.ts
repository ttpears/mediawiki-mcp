import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MediaWikiClient } from "./mediawiki-client.js";
import { registerMediaWikiTools } from "./mediawiki-tools.js";
import type { MediaWikiConfig } from "./types.js";

/**
 * Create and start MediaWiki MCP server with SSE transport
 */
export async function createSSEServer(
  config: MediaWikiConfig,
  port: number = 8009,
  host: string = "localhost"
): Promise<void> {
  const app = express();

  // Health check endpoint
  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "mediawiki-mcp" });
  });

  // SSE endpoint
  app.get("/sse", async (req, res) => {
    console.log("New SSE connection");

    // Create MCP server instance
    const server = new McpServer({
      name: "mediawiki-mcp",
      version: "1.0.0"
    });

    // Create MediaWiki client
    const client = new MediaWikiClient(config);

    // Register all tools
    registerMediaWikiTools(server, client);

    // Create SSE transport
    const transport = new SSEServerTransport("/message", res);
    await server.connect(transport);

    // Handle client disconnect
    req.on("close", () => {
      console.log("SSE connection closed");
    });
  });

  // Message endpoint for SSE
  app.post("/message", express.json(), async (req, res) => {
    // Handle incoming messages
    // Note: SSEServerTransport handles this internally
    res.status(202).end();
  });

  app.listen(port, host, () => {
    console.log(`MediaWiki MCP SSE server listening on http://${host}:${port}`);
    console.log(`SSE endpoint: http://${host}:${port}/sse`);
  });
}

// Run as standalone if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const config: MediaWikiConfig = {
    baseUrl: process.env.MEDIAWIKI_BASE_URL || "",
    username: process.env.MEDIAWIKI_USERNAME,
    password: process.env.MEDIAWIKI_PASSWORD,
    apiToken: process.env.MEDIAWIKI_API_TOKEN
  };

  if (!config.baseUrl) {
    console.error("Error: MEDIAWIKI_BASE_URL environment variable is required");
    process.exit(1);
  }

  const port = parseInt(process.env.MEDIAWIKI_MCP_PORT || "8009", 10);
  const host = process.env.MEDIAWIKI_MCP_HOST || "localhost";

  createSSEServer(config, port, host).catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
