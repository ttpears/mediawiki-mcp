import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { WikiRegistry } from './wiki-registry.js';
import { WikiOrchestrator } from './wiki-orchestrator.js';
import { registerAllTools, SessionContext } from './tools/index.js';

export async function createHTTPServer(
  registry: WikiRegistry,
  port: number = 8009,
  host: string = 'localhost'
): Promise<void> {
  const app = express();
  app.use(express.json());

  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: McpServer; context: SessionContext }>();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mediawiki-mcp', version: '2.0.0' });
  });

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Existing session — update user from header and route to transport
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      const rawUser = req.headers['x-user-username'] as string | undefined;
      if (rawUser?.trim()) {
        session.context.sessionUser = rawUser.trim();
      }
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — must be an initialize request
    if (!sessionId && isInitializeRequest(req.body)) {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, context });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };

      const server = new McpServer({
        name: 'mediawiki-mcp',
        version: '2.0.0',
      });

      const orchestrator = new WikiOrchestrator(registry);
      await orchestrator.initialize();

      // Extract session user from LibreChat header (if present)
      const rawUser = req.headers['x-user-username'] as string | undefined;
      const context: SessionContext = { orchestrator, sessionUser: rawUser?.trim() || undefined };

      registerAllTools(server, context);

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad request: missing or invalid session' },
      id: null,
    });
  });

  // GET — optional SSE stream for server-initiated notifications
  app.get('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string;
    const session = sessions.get(sessionId);
    if (session) {
      await session.transport.handleRequest(req, res);
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  // DELETE — session termination
  app.delete('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string;
    const session = sessions.get(sessionId);
    if (session) {
      await session.transport.handleRequest(req, res);
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  });

  app.listen(port, host, () => {
    console.log(`MediaWiki MCP server v2.0.0 on http://${host}:${port}/mcp`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const registry = WikiRegistry.fromEnvironment(process.env as Record<string, string>);
  const port = parseInt(process.env.MEDIAWIKI_MCP_PORT || '8009', 10);
  const host = process.env.MEDIAWIKI_MCP_HOST || 'localhost';

  createHTTPServer(registry, port, host).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
