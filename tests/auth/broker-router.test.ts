import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createBrokerRouter } from '../../src/auth/broker-router.js';
import { BrokerOAuthProvider } from '../../src/auth/broker-provider.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { BrokerTokens } from '../../src/auth/tokens.js';
import type { OAuthConfig } from '../../src/auth/config.js';
import type { EntraOIDCClient } from '../../src/auth/entra-oidc.js';

function makeConfig(): OAuthConfig {
  return {
    publicUrl: 'https://mcp.example.com',
    issuerHost: 'mcp.example.com',
    tenantId: 't',
    clientId: 'cid',
    clientSecret: 'csecret',
    writeRole: 'Writer',
    redisUrl: 'redis://redis:6379',
    jwtSecret: 'secret',
    trustProxy: false,
    scopesSupported: ['mediawiki'],
  };
}

function makeProvider() {
  const entra = { buildAuthorizeUrl: vi.fn(), exchangeCode: vi.fn() } as unknown as EntraOIDCClient;
  return new BrokerOAuthProvider(
    new InMemoryTokenStore(),
    entra,
    new BrokerTokens('secret', 'https://mcp.example.com/mcp', ['mediawiki']),
    'Writer'
  );
}

function makeApp(provider: BrokerOAuthProvider) {
  const app = express();
  const { router } = createBrokerRouter(makeConfig(), provider);
  app.use(router);
  return app;
}

describe('createBrokerRouter', () => {
  it('serves authorization-server metadata', async () => {
    const res = await request(makeApp(makeProvider())).get('/.well-known/oauth-authorization-server');
    expect(res.status).toBe(200);
    expect(res.body.authorization_endpoint).toContain('/authorize');
    expect(res.body.token_endpoint).toContain('/token');
    expect(res.body.registration_endpoint).toContain('/register');
  });

  it('serves protected-resource metadata pointing at the auth server', async () => {
    const res = await request(makeApp(makeProvider())).get('/.well-known/oauth-protected-resource/mcp');
    expect(res.status).toBe(200);
    expect(res.body.authorization_servers).toContain('https://mcp.example.com/');
  });

  it('invokes the provider callback and redirects', async () => {
    const provider = makeProvider();
    vi.spyOn(provider, 'handleUpstreamCallback').mockResolvedValue({
      redirectTo: 'https://claude.ai/api/mcp/auth_callback?code=abc&state=s',
    });
    const res = await request(makeApp(provider)).get('/callback?code=entra-code&state=brokerstate');
    expect(provider.handleUpstreamCallback).toHaveBeenCalledWith('entra-code', 'brokerstate');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('https://claude.ai/api/mcp/auth_callback?code=abc&state=s');
  });

  it('returns 400 when callback is missing code/state', async () => {
    const res = await request(makeApp(makeProvider())).get('/callback?code=only');
    expect(res.status).toBe(400);
  });
});
