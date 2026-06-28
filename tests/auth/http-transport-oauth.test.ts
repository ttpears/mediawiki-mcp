import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { createHTTPServer } from '../../src/http-transport.js';
import { WikiRegistry } from '../../src/wiki-registry.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { BrokerTokens } from '../../src/auth/tokens.js';
import type { OAuthConfig } from '../../src/auth/config.js';
import type { MediaWikiOAuthClient } from '../../src/auth/mediawiki-oauth.js';

const JWT_SECRET = 'secret';
const AUD = 'https://mcp.example.com/mcp';

function makeConfig(): OAuthConfig {
  return {
    publicUrl: 'https://mcp.example.com',
    issuerHost: 'mcp.example.com',
    wikis: [{ name: 'Docs', clientId: 'cid' }],
    primaryWiki: 'Docs',
    redisUrl: 'redis://redis:6379',
    encryptionKey: Buffer.alloc(32, 1),
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

describe('HTTP transport OAuth mode', () => {
  let server: Server;
  let store: InMemoryTokenStore;

  beforeEach(async () => {
    const registry = new WikiRegistry();
    registry.addWiki({ name: 'Docs', baseUrl: 'https://docs.example.com' });
    store = new InMemoryTokenStore();
    const upstream = { refresh: vi.fn(), exchangeCode: vi.fn(), fetchIdentity: vi.fn(), buildAuthorizeUrl: vi.fn() } as unknown as MediaWikiOAuthClient;
    const upstreams = new Map([['Docs', upstream]]);
    server = await createHTTPServer(registry, 0, '127.0.0.1', { config: makeConfig(), store, upstreams });
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
    const token = await new BrokerTokens(JWT_SECRET, AUD, ['mediawiki']).signAccessToken('user-1', 'client-1');
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
