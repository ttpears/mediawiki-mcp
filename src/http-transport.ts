import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { WikiRegistry } from './wiki-registry.js';
import { WikiOrchestrator } from './wiki-orchestrator.js';
import { registerAllTools, SessionContext } from './tools/index.js';
import { OAuthConfig, isOAuthMode, loadOAuthConfig } from './auth/config.js';
import { TokenStore } from './auth/token-store.js';
import { MediaWikiOAuthClient } from './auth/mediawiki-oauth.js';
import { MediaWikiOAuthProvider } from './auth/broker-provider.js';
import { BrokerTokens } from './auth/tokens.js';
import { createBrokerRouter } from './auth/broker-router.js';
import { createWikiAuthProvider } from './auth/wiki-auth-provider.js';

/** Dependencies that enable OAuth broker mode. When omitted, the server runs the
 *  unauthenticated header-based path used by LibreChat. */
export interface OAuthDeps {
  config: OAuthConfig;
  store: TokenStore;
  upstream: MediaWikiOAuthClient;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  context: SessionContext;
  /** Wiki `sub` that initialized this session (OAuth mode only). */
  sub?: string;
}

export async function createHTTPServer(
  registry: WikiRegistry,
  port: number = 8009,
  host: string = 'localhost',
  oauth?: OAuthDeps
): Promise<Server> {
  const app = express();

  // Behind traefik: trust X-Forwarded-* so the OAuth rate limiter keys on the real
  // client IP, not the proxy's (otherwise all clients share one IP). Must be set
  // before the rate-limited auth router is mounted.
  if (oauth?.config.trustProxy) {
    app.set('trust proxy', true);
  }

  // Restrict accepted Host headers (localhost always allowed for healthchecks).
  if (oauth?.config.allowedHosts && oauth.config.allowedHosts.length > 0) {
    const allowed = new Set([...oauth.config.allowedHosts, 'localhost', '127.0.0.1']);
    app.use((req, res, next) => {
      const host = (req.headers.host ?? '').split(':')[0];
      if (!allowed.has(host)) {
        res.status(421).json({ error: 'misdirected_request' });
        return;
      }
      next();
    });
  }

  app.use(express.json());

  const sessions = new Map<string, Session>();

  // OAuth broker mode: mount auth-server endpoints and protect /mcp with bearer auth.
  if (oauth) {
    const tokens = new BrokerTokens(
      oauth.config.jwtSecret,
      `${oauth.config.publicUrl}/mcp`,
      oauth.config.scopesSupported
    );
    const provider = new MediaWikiOAuthProvider(oauth.store, oauth.upstream, tokens);
    const { router, resourceMetadataUrl } = createBrokerRouter(oauth.config, provider);
    app.use(router);
    app.use('/mcp', requireBearerAuth({ verifier: provider, resourceMetadataUrl }));
  }

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mediawiki-mcp', version: '2.0.0', auth: oauth ? 'oauth' : 'none' });
  });

  /** Build the per-session SessionContext (per-user orchestrator in OAuth mode). */
  async function buildContext(req: express.Request): Promise<{ context: SessionContext; sub?: string }> {
    if (oauth) {
      const sub = req.auth?.extra?.sub as string | undefined;
      if (!sub) {
        throw new Error('Authenticated request is missing a subject');
      }
      // Single-wiki: serve only the OAuth-enabled wiki, acting as this user.
      const wikiConfig = registry.resolveWiki(oauth.config.wiki);
      const userRegistry = new WikiRegistry();
      userRegistry.addWiki(wikiConfig);
      const orchestrator = new WikiOrchestrator(
        userRegistry,
        createWikiAuthProvider(sub, oauth.store, oauth.upstream)
      );
      await orchestrator.initialize();
      return { context: { orchestrator, sessionUser: sub }, sub };
    }

    const orchestrator = new WikiOrchestrator(registry);
    await orchestrator.initialize();
    const rawUser = req.headers['x-user-username'] as string | undefined;
    return { context: { orchestrator, sessionUser: rawUser?.trim() || undefined } };
  }

  app.post('/mcp', async (req, res) => {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    // Existing session — route to its transport
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      if (oauth) {
        // Reject if a different authenticated user reuses this session id.
        const sub = req.auth?.extra?.sub as string | undefined;
        if (session.sub && sub && session.sub !== sub) {
          res.status(403).json({
            jsonrpc: '2.0',
            error: { code: -32000, message: 'Session does not belong to this user' },
            id: null,
          });
          return;
        }
      } else {
        const rawUser = req.headers['x-user-username'] as string | undefined;
        if (rawUser?.trim()) {
          session.context.sessionUser = rawUser.trim();
        }
      }
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — must be an initialize request
    if (!sessionId && isInitializeRequest(req.body)) {
      let built: { context: SessionContext; sub?: string };
      try {
        built = await buildContext(req);
      } catch (err) {
        res.status(401).json({
          jsonrpc: '2.0',
          error: { code: -32000, message: err instanceof Error ? err.message : 'Unauthorized' },
          id: null,
        });
        return;
      }
      const { context, sub } = built;

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { transport, server, context, sub });
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

  return new Promise<Server>((resolve) => {
    const server = app.listen(port, host, () => {
      console.log(`MediaWiki MCP server v2.0.0 on http://${host}:${port}/mcp (auth: ${oauth ? 'oauth' : 'none'})`);
      resolve(server);
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    const env = process.env as Record<string, string | undefined>;
    const registry = WikiRegistry.fromEnvironment(env);
    const port = parseInt(env.MEDIAWIKI_MCP_PORT || '8009', 10);
    const host = env.MEDIAWIKI_MCP_HOST || 'localhost';

    try {
      if (isOAuthMode(env)) {
        const config = loadOAuthConfig(env);
        const { createClient } = await import('redis');
        const redis = createClient({ url: config.redisUrl });
        redis.on('error', (err) => console.error('Redis error:', err));
        await redis.connect();
        const { RedisTokenStore } = await import('./auth/redis-token-store.js');
        const store = new RedisTokenStore(redis, config.encryptionKey, config.issuerHost);
        const wikiConfig = registry.resolveWiki(config.wiki);
        const upstream = new MediaWikiOAuthClient(
          wikiConfig.baseUrl,
          config.clientId,
          config.clientSecret,
          `${config.publicUrl}/callback`
        );
        await createHTTPServer(registry, port, host, { config, store, upstream });
      } else {
        await createHTTPServer(registry, port, host);
      }
    } catch (error) {
      console.error('Fatal error:', error);
      process.exit(1);
    }
  })();
}
