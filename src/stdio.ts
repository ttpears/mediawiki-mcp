import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MediaWikiClient } from "./mediawiki-client.js";
import { registerMediaWikiTools } from "./mediawiki-tools.js";
import type { MediaWikiConfig } from "./types.js";

/**
 * Create and start MediaWiki MCP server with stdio transport
 */
export async function createStdioServer(config: MediaWikiConfig): Promise<void> {
  // Create MCP server instance
  const server = new McpServer({
    name: "mediawiki-mcp",
    version: "1.0.0"
  });

  // Create MediaWiki client
  const client = new MediaWikiClient(config);

  // Register all tools
  registerMediaWikiTools(server, client);

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error("MediaWiki MCP server running on stdio");
}
