import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBrokerRouter } from '../../src/auth/broker-router.js';
import { MediaWikiOAuthProvider } from '../../src/auth/broker-provider.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { BrokerTokens } from '../../src/auth/tokens.js';
import type { OAuthConfig } from '../../src/auth/config.js';
import type { MediaWikiOAuthClient } from '../../src/auth/mediawiki-oauth.js';

function makeConfig(): OAuthConfig {
  return {
    publicUrl: 'https://mcp.example.com',
    issuerHost: 'mcp.example.com',
    wikis: [{ name: 'Docs', clientId: 'cid' }],
    primaryWiki: 'Docs',
    redisUrl: 'redis://redis:6379',
    encryptionKey: Buffer.alloc(32, 1),
    jwtSecret: 'secret',
    trustProxy: false,
    scopesSupported: ['mediawiki'],
  };
}

function makeProvider() {
  const upstream = {
    buildAuthorizeUrl: vi.fn(),
    exchangeCode: vi.fn(),
    fetchIdentity: vi.fn(),
    refresh: vi.fn(),
  } as unknown as MediaWikiOAuthClient;
  const provider = new MediaWikiOAuthProvider(
    new InMemoryTokenStore(),
    new Map([['Docs', upstream]]),
    'Docs',
    new BrokerTokens('secret', 'https://mcp.example.com/mcp', ['mediawiki'])
  );
  return provider;
}

function makeApp(provider: MediaWikiOAuthProvider) {
  const app = express();
  const { router } = createBrokerRouter(makeConfig(), provider);
  app.use(router);
  return app;
}

describe('createBrokerRouter', () => {
  it('serves authorization-server metadata', async () => {
    const app = makeApp(makeProvider());
    const res = await request(app).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.authorization_endpoint).toContain('/authorize');
    expect(res.body.token_endpoint).toContain('/token');
    expect(res.body.registration_endpoint).toContain('/register');
  });

  it('serves protected-resource metadata pointing at the auth server', async () => {
    const app = makeApp(makeProvider());
    const res = await request(app).get('/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers).toContain('https://mcp.example.com/');
  });

  it('invokes the provider callback and redirects', async () => {
    const provider = makeProvider();
    vi.spyOn(provider, 'handleUpstreamCallback').mockResolvedValue({
      kind: 'login',
      redirectTo: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s',
    });
    const app = makeApp(provider);
    const res = await request(app).get('/callback?code=wiki-code&state=brokerstate');
    expect(provider.handleUpstreamCallback).toHaveBeenCalledWith('wiki-code', 'brokerstate');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://claude.ai/api/mcp/auth_callback?code=abc&state=s');
  });

  it('returns 400 when callback is missing code/state', async () => {
    const app = makeApp(makeProvider());
    const res = await request(app).get('/callback?code=only');
    expect(res.status).toBe(400);
  });
});
