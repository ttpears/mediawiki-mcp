import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { createBrokerRouter } from '../../src/auth/broker-router.js';
import { BrokerOAuthProvider, AUTH_SESSION_TTL_MS } from '../../src/auth/broker-provider.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { BrokerTokens } from '../../src/auth/tokens.js';

const verifier = 'v'.repeat(64);
const redirectUri = 'https://client.example/callback';

async function fixture() {
  const store = new InMemoryTokenStore();
  const entra = { exchangeCode: vi.fn(), buildAuthorizeUrl: vi.fn() };
  const tokens = new BrokerTokens('fixture-only-secret', 'https://mcp.example.com/mcp', ['mediawiki']);
  const provider = new BrokerOAuthProvider(store, entra as never, tokens, 'Writer');
  for (const id of ['a', 'b']) {
    await store.saveClient({ client_id: id, redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' });
  }
  await store.saveAuthCode({
    code: 'code-a', sub: 'user', username: 'fixture', canWrite: true,
    clientId: 'a', clientRedirectUri: redirectUri,
    clientCodeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    createdAt: Date.now(), authExpiresAt: Date.now() + AUTH_SESSION_TTL_MS,
  });
  await store.saveRefresh({ token: 'refresh-a', sub: 'user', username: 'fixture', canWrite: true, clientId: 'a', authExpiresAt: Date.now() + AUTH_SESSION_TTL_MS });
  const app = express();
  app.use(createBrokerRouter({ publicUrl: 'https://mcp.example.com', scopesSupported: ['mediawiki'] } as never, provider).router);
  const code = (client = 'a', uri = redirectUri) => request(app).post('/token').type('form').send({
    grant_type: 'authorization_code', client_id: client, code: 'code-a', code_verifier: verifier, redirect_uri: uri,
  });
  const refresh = (client = 'a', token = 'refresh-a') => request(app).post('/token').type('form').send({
    grant_type: 'refresh_token', client_id: client, refresh_token: token,
  });
  return { store, entra, tokens, code, refresh };
}

afterEach(() => vi.useRealTimers());

describe('OAuth grant boundaries through the HTTP token endpoint', () => {
  it('rejects cross-client authorization-code redemption without consuming the legitimate code', async () => {
    const f = await fixture();
    const bad = await f.code('b');
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('invalid_grant');
    expect((await f.code()).status).toBe(200);
    expect((await f.code()).status).toBe(400);
  });

  it('binds redemption to the original redirect URI', async () => {
    const f = await fixture();
    expect((await f.code('a', 'https://other.example/callback')).status).toBe(400);
    expect((await f.code()).status).toBe(200);
  });

  it('rejects cross-client refresh redemption and rotates legitimate refreshes once', async () => {
    const f = await fixture();
    expect((await f.refresh('b')).body.error).toBe('invalid_grant');
    const good = await f.refresh();
    expect(good.status).toBe(200);
    expect((await f.tokens.verifyAccessToken(good.body.access_token)).clientId).toBe('a');
    expect((await f.refresh()).status).toBe(400);
  });

  it('allows only one concurrent redemption of a refresh token', async () => {
    const f = await fixture();
    const responses = await Promise.all([f.refresh(), f.refresh()]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 400]);
  });

  it('never extends the original authorization deadline during rotation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const f = await fixture();
    vi.setSystemTime(start + AUTH_SESSION_TTL_MS / 2);
    const rotated = await f.refresh();
    expect(rotated.status).toBe(200);
    expect(rotated.body.expires_in).toBeLessThanOrEqual(1800);
    expect((await f.store.peekRefresh(rotated.body.refresh_token))?.authExpiresAt).toBe(start + AUTH_SESSION_TTL_MS);
    vi.setSystemTime(start + AUTH_SESSION_TTL_MS + 1);
    expect(await f.store.peekRefresh(rotated.body.refresh_token)).toBeUndefined();
    const expired = await f.refresh('a', rotated.body.refresh_token);
    expect(expired.status).toBe(400);
    expect(expired.body.error).toBe('invalid_grant');
    await expect(f.tokens.verifyAccessToken(rotated.body.access_token)).rejects.toThrow();
  });

  it('requires fresh sign-in for legacy refresh records with no authorization deadline', async () => {
    const f = await fixture();
    await f.store.saveRefresh({ token: 'legacy', sub: 'u', username: 'u', clientId: 'a', canWrite: true });
    expect((await f.refresh('a', 'legacy')).status).toBe(400);
  });

  it('expires in-memory authorization codes and pending sign-ins after ten minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const f = await fixture();
    await f.store.savePendingAuth({ brokerState: 's', clientId: 'a', clientRedirectUri: redirectUri, clientCodeChallenge: 'c', upstreamCodeVerifier: 'v', createdAt: Date.now() });
    vi.setSystemTime(Date.now() + 600001);
    expect((await f.code()).status).toBe(400);
    expect(await f.store.takePendingAuth('s')).toBeUndefined();
  });
});
