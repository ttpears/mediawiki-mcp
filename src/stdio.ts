import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WikiRegistry } from './wiki-registry.js';
import { WikiOrchestrator } from './wiki-orchestrator.js';
import { registerAllTools } from './tools/index.js';

export async function createStdioServer(registry: WikiRegistry): Promise<void> {
  const server = new McpServer({
    name: 'mediawiki-mcp',
    version: '2.0.0'
  });

  const orchestrator = new WikiOrchestrator(registry);
  await orchestrator.initialize();
  registerAllTools(server, orchestrator);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MediaWiki MCP server v2.0.0 running on stdio');
}
