import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { resolveServerConfig, startServerFromEnv } from '../src/http-transport.js';

// Exercises the real env -> config -> server wiring at src/http-transport.ts's
// entry-point guard, which no prior test triggered: tests/http-transport-
// session-env.test.ts only calls parsePositiveIntEnv/parsePortEnv in
// isolation, and tests/http-transport-sessions.test.ts bypasses env parsing
// entirely by hand-constructing the options object passed to
// createHTTPServer.

function baseEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    MEDIAWIKI_WIKIS: 'Docs:https://docs.example.com',
    MEDIAWIKI_MCP_HOST: '127.0.0.1',
    MEDIAWIKI_MCP_PORT: '0',
    ...overrides,
  };
}

function initializeBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  };
}

async function initSession(server: Server): Promise<string> {
  const res = await request(server)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .send(initializeBody());
  expect(res.status).toBe(200);
  return res.headers['mcp-session-id'] as string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('resolveServerConfig (pure env parsing, no network)', () => {
  it('threads MEDIAWIKI_SESSION_IDLE_TTL_MS and MEDIAWIKI_MAX_SESSIONS into sessionOptions', () => {
    const config = resolveServerConfig(
      baseEnv({ MEDIAWIKI_SESSION_IDLE_TTL_MS: '250', MEDIAWIKI_MAX_SESSIONS: '2' })
    );
    expect(config.sessionOptions).toEqual({ idleTtlMs: 250, maxSessions: 2 });
  });

  it('falls back to a finite default port instead of NaN when MEDIAWIKI_MCP_PORT is malformed', () => {
    const config = resolveServerConfig(baseEnv({ MEDIAWIKI_MCP_PORT: 'not-a-port' }));
    expect(config.port).toBe(8009);
    expect(Number.isNaN(config.port)).toBe(false);
  });
});

describe('startServerFromEnv (real bootstrap path, ephemeral port)', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('MEDIAWIKI_MAX_SESSIONS reaches the real SessionRegistry: a second initialize is rejected once the cap is hit', async () => {
    server = await startServerFromEnv(baseEnv({ MEDIAWIKI_MAX_SESSIONS: '1' }));

    await initSession(server);

    const res = await request(server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(initializeBody());

    expect(res.status).toBe(503);
  });

  it('MEDIAWIKI_SESSION_IDLE_TTL_MS reaches the real SessionRegistry: a session idles out and GET reports it gone', async () => {
    server = await startServerFromEnv(baseEnv({ MEDIAWIKI_SESSION_IDLE_TTL_MS: '60' }));

    const sessionId = await initSession(server);
    await wait(150);

    const res = await request(server).get('/mcp').set('mcp-session-id', sessionId);
    expect(res.status).toBe(404);
  });
});
