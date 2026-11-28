import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { EntraServiceTokens, looksLikeEntraToken } from '../../src/auth/service-tokens.js';
import { loadOAuthConfig, type OAuthConfig } from '../../src/auth/config.js';
import { BrokerOAuthProvider } from '../../src/auth/broker-provider.js';
import { BrokerTokens } from '../../src/auth/tokens.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { createHTTPServer } from '../../src/http-transport.js';
import { WikiRegistry } from '../../src/wiki-registry.js';
import type { EntraOIDCClient } from '../../src/auth/entra-oidc.js';

const TENANT = 'tenant-1';
const CLIENT = 'connector-app';
const FACTORY = 'factory-app';
const ISS = `https://login.microsoftonline.com/${TENANT}/v2.0`;

let privateKey: CryptoKey;
let keys: JWTVerifyGetKey;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey as CryptoKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  keys = createLocalJWKSet({ keys: [jwk] });
});

async function entraToken(claims: Record<string, unknown>, opts: { iss?: string; aud?: string } = {}) {
  return new SignJWT({ azp: FACTORY, roles: ['Service.Read'], ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(opts.iss ?? ISS)
    .setAudience(opts.aud ?? `api://${CLIENT}`)
    .setSubject('sp-object-id')
    .setIssuedAt()
    .setExpirationTime('10m')
    .sign(privateKey);
}

function verifier() {
  return new EntraServiceTokens({ tenantId: TENANT, clientId: CLIENT, role: 'Service.Read',
    appIds: [FACTORY] }, keys);
}

describe('EntraServiceTokens', () => {
  it('admits an allowed app with the service role, read-only', async () => {
    const info = await verifier().verify(await entraToken({}));
    expect(info.clientId).toBe(FACTORY);
    expect(info.extra).toMatchObject({ sub: 'app:sp-object-id', canWrite: false, service: true });
  });

  it('accepts the v1 issuer and the bare client id as audience', async () => {
    const t = await entraToken({}, { iss: `https://sts.windows.net/${TENANT}/`, aud: CLIENT });
    await expect(verifier().verify(t)).resolves.toBeTruthy();
  });

  it('refuses a user (delegated) token: users sign in through the broker', async () => {
    await expect(verifier().verify(await entraToken({ scp: 'access_as_user' })))
      .rejects.toThrow(/broker/);
  });

  it('refuses an app-only token without the role, or from an app not allowed', async () => {
    await expect(verifier().verify(await entraToken({ roles: [] }))).rejects.toThrow(/service role/);
    await expect(verifier().verify(await entraToken({ roles: ['Writer'] }))).rejects.toThrow(/service role/);
    await expect(verifier().verify(await entraToken({ azp: 'other-app' }))).rejects.toThrow(/not allowed/);
  });

  it('refuses another audience or issuer', async () => {
    await expect(verifier().verify(await entraToken({}, { aud: 'api://other' }))).rejects.toThrow(/audience/);
    await expect(verifier().verify(await entraToken({}, { iss: 'https://login.microsoftonline.com/x/v2.0' })))
      .rejects.toThrow();
  });

  it('tells Entra tokens from broker tokens by algorithm', async () => {
    const broker = await new BrokerTokens('s', 'https://m/mcp', ['mediawiki'])
      .signAccessToken('u', 'c', { username: 'u', canWrite: true });
    expect(looksLikeEntraToken(broker)).toBe(false);
    expect(looksLikeEntraToken(await entraToken({}))).toBe(true);
    expect(looksLikeEntraToken('not a jwt')).toBe(false);
  });
});

describe('service config', () => {
  const base = {
    MEDIAWIKI_MCP_PUBLIC_URL: 'https://m.example.com', OAUTH_TENANT_ID: TENANT,
    OAUTH_CLIENT_ID: CLIENT, OAUTH_CLIENT_SECRET: 'x', MEDIAWIKI_MCP_JWT_SECRET: 'y',
  };

  it('is off by default', () => {
    const cfg = loadOAuthConfig(base);
    expect(cfg.serviceRole).toBeUndefined();
    expect(cfg.serviceAppIds).toEqual([]);
  });

  it('needs the role and the app ids together', () => {
    expect(loadOAuthConfig({ ...base, OAUTH_SERVICE_ROLE: 'Service.Read',
      OAUTH_SERVICE_APP_IDS: `${FACTORY}, b` }).serviceAppIds).toEqual([FACTORY, 'b']);
    expect(() => loadOAuthConfig({ ...base, OAUTH_SERVICE_ROLE: 'Service.Read' })).toThrow(/together/);
    expect(() => loadOAuthConfig({ ...base, OAUTH_SERVICE_APP_IDS: FACTORY })).toThrow(/together/);
  });
});

describe('BrokerOAuthProvider with service tokens', () => {
  const tokens = new BrokerTokens('s', 'https://m/mcp', ['mediawiki']);
  const entra = {} as EntraOIDCClient;

  it('without service config an Entra token still fails as before', async () => {
    const p = new BrokerOAuthProvider(new InMemoryTokenStore(), entra, tokens, 'Writer');
    await expect(p.verifyAccessToken(await entraToken({}))).rejects.toThrow();
  });

  it('a refused service token is an invalid-token error (401), broker tokens unchanged', async () => {
    const p = new BrokerOAuthProvider(new InMemoryTokenStore(), entra, tokens, 'Writer', undefined,
      verifier());
    await expect(p.verifyAccessToken(await entraToken({ roles: [] })))
      .rejects.toMatchObject({ errorCode: 'invalid_token' });
    const user = await tokens.signAccessToken('u', 'c', { username: 'u', canWrite: true });
    expect((await p.verifyAccessToken(user)).extra?.canWrite).toBe(true);
  });
});

describe('HTTP transport: a service caller', () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  function cfg(): OAuthConfig {
    return {
      publicUrl: 'https://mcp.example.com', issuerHost: 'mcp.example.com', tenantId: TENANT,
      clientId: CLIENT, clientSecret: 'x', writeRole: 'Writer', jwtSecret: 's',
      trustProxy: false, scopesSupported: ['mediawiki'], serviceRole: 'Service.Read',
      serviceAppIds: [FACTORY],
    };
  }

  async function post(token: string, body: unknown, sid?: string) {
    const r = request(server!).post('/mcp').set('Authorization', `Bearer ${token}`)
      .set('Accept', 'application/json, text/event-stream').set('Content-Type', 'application/json');
    if (sid) r.set('mcp-session-id', sid).set('mcp-protocol-version', '2024-11-05');
    return r.send(body);
  }

  function parse(res: request.Response) {
    const text = res.text.includes('data:')
      ? res.text.split('\n').filter((l) => l.startsWith('data:')).pop()!.slice(5) : res.text;
    return JSON.parse(text);
  }

  it('gets read tools only; a role-less app token gets 401', async () => {
    const registry = new WikiRegistry();
    registry.addWiki({ name: 'Docs', baseUrl: 'https://docs.example.com' });
    const entra = { buildAuthorizeUrl: vi.fn(), exchangeCode: vi.fn() } as unknown as EntraOIDCClient;
    server = await createHTTPServer(registry, 0, '127.0.0.1',
      { config: cfg(), store: new InMemoryTokenStore(), entra, serviceKeys: keys });

    const refused = await post(await entraToken({ roles: [] }), { jsonrpc: '2.0', id: 1,
      method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {},
        clientInfo: { name: 't', version: '1' } } });
    expect(refused.status).toBe(401);

    const token = await entraToken({});
    const init = await post(token, { jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
    expect(init.status).toBe(200);
    const sid = init.headers['mcp-session-id'];
    await post(token, { jsonrpc: '2.0', method: 'notifications/initialized' }, sid);
    const list = parse(await post(token, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, sid));
    const names: string[] = list.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain('get-page');
    expect(names).not.toContain('update-page');
    expect(names).not.toContain('delete-page');
  });
});
