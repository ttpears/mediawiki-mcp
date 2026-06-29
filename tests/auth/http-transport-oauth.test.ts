import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { createHTTPServer } from '../../src/http-transport.js';
import { WikiRegistry } from '../../src/wiki-registry.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { BrokerTokens } from '../../src/auth/tokens.js';
import type { OAuthConfig } from '../../src/auth/config.js';
import type { EntraOIDCClient } from '../../src/auth/entra-oidc.js';

const JWT_SECRET = 'secret';
const AUD = 'https://mcp.example.com/mcp';

function makeConfig(): OAuthConfig {
  return {
    publicUrl: 'https://mcp.example.com',
    issuerHost: 'mcp.example.com',
    tenantId: 't',
    clientId: 'cid',
    clientSecret: 'csecret',
    writeRole: 'Writer',
    redisUrl: 'redis://redis:6379',
    jwtSecret: JWT_SECRET,
    trustProxy: false,
    scopesSupported: ['mediawiki'],
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

describe('HTTP transport OAuth mode (Entra)', () => {
  let server: Server;

  beforeEach(async () => {
    const registry = new WikiRegistry();
    registry.addWiki({ name: 'Docs', baseUrl: 'https://docs.example.com' });
    const store = new InMemoryTokenStore();
    const entra = { buildAuthorizeUrl: vi.fn(), exchangeCode: vi.fn() } as unknown as EntraOIDCClient;
    server = await createHTTPServer(registry, 0, '127.0.0.1', { config: makeConfig(), store, entra });
  });

  afterEach(() => {
    server.close();
  });

  it('serves protected-resource metadata', async () => {
    const res = await request(server).get('/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers).toBeTruthy();
  });

  it('rejects /mcp without a bearer token (401 + WWW-Authenticate)', async () => {
    const res = await request(server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .send(initializeBody());
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toContain('oauth-protected-resource');
  });

  it('accepts /mcp initialize with a valid broker token', async () => {
    const token = await new BrokerTokens(JWT_SECRET, AUD, ['mediawiki']).signAccessToken('user-1', 'client-1', {
      username: 'alice@example.com',
      canWrite: true,
    });
    const res = await request(server)
      .post('/mcp')
      .set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(initializeBody());

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
    expect(res.headers['mcp-session-id']).toBeTruthy();
  });

  it('reports auth mode on /health', async () => {
    const res = await request(server).get('/health');
    expect(res.body.auth).toBe('oauth');
  });
});
