import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WikiRegistry } from './wiki-registry.js';
import { WikiOrchestrator } from './wiki-orchestrator.js';
import { registerAllTools } from './tools/index.js';

export async function createSSEServer(
  registry: WikiRegistry,
  port: number = 8009,
  host: string = 'localhost'
): Promise<void> {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mediawiki-mcp', version: '2.0.0' });
  });

  app.get('/sse', async (req, res) => {
    console.log('New SSE connection');

    const server = new McpServer({
      name: 'mediawiki-mcp',
      version: '2.0.0'
    });

    const orchestrator = new WikiOrchestrator(registry);
    registerAllTools(server, orchestrator);

    const transport = new SSEServerTransport('/message', res);
    await server.connect(transport);

    req.on('close', () => {
      console.log('SSE connection closed');
    });
  });

  app.post('/message', express.json(), async (_req, res) => {
    res.status(202).end();
  });

  app.listen(port, host, () => {
    console.log(`MediaWiki MCP SSE server v2.0.0 on http://${host}:${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const registry = WikiRegistry.fromEnvironment(process.env as Record<string, string>);
  const port = parseInt(process.env.MEDIAWIKI_MCP_PORT || '8009', 10);
  const host = process.env.MEDIAWIKI_MCP_HOST || 'localhost';

  createSSEServer(registry, port, host).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
