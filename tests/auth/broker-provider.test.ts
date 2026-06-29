import { describe, it, expect, vi } from 'vitest';
import { BrokerOAuthProvider } from '../../src/auth/broker-provider.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { BrokerTokens } from '../../src/auth/tokens.js';
import type { EntraOIDCClient } from '../../src/auth/entra-oidc.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

const AUD = 'https://mcp.example.com/mcp';
const WRITE_ROLE = 'Writer';
const CLIENT: OAuthClientInformationFull = {
  client_id: 'c1',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
};

function makeEntra(roles: string[] = ['Writer']): EntraOIDCClient {
  return {
    buildAuthorizeUrl: vi.fn().mockReturnValue('https://login.microsoftonline.com/t/oauth2/v2.0/authorize?x=1'),
    exchangeCode: vi.fn().mockResolvedValue({ sub: 'user-7', username: 'bob@example.com', roles }),
  } as unknown as EntraOIDCClient;
}

function counterGenId(): () => string {
  let n = 0;
  return () => `id${n++}`;
}

function makeProvider(roles: string[] = ['Writer'], store = new InMemoryTokenStore()) {
  const tokens = new BrokerTokens('secret', AUD, ['mediawiki']);
  const entra = makeEntra(roles);
  return { provider: new BrokerOAuthProvider(store, entra, tokens, WRITE_ROLE, counterGenId()), store, entra, tokens };
}

const authzParams = { redirectUri: 'https://claude.ai/api/mcp/auth_callback', state: 'cs', codeChallenge: 'claude-chal' };

describe('BrokerOAuthProvider', () => {
  it('registers a client with a generated id', async () => {
    const { provider, store } = makeProvider();
    const full = await provider.clientsStore.registerClient!({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(full.client_id).toBe('id0');
    expect(await store.getClient('id0')).toBeDefined();
  });

  it('authorize stores a pending record and redirects to Entra', async () => {
    const { provider, entra } = makeProvider();
    const redirect = vi.fn();
    await provider.authorize(CLIENT, authzParams as never, { redirect } as never);
    expect(entra.buildAuthorizeUrl).toHaveBeenCalledWith('id0', expect.any(String));
    expect(redirect).toHaveBeenCalledWith('https://login.microsoftonline.com/t/oauth2/v2.0/authorize?x=1');
  });

  it('callback issues a write-capable token for a user with the write role', async () => {
    const { provider } = makeProvider(['Writer', 'OtherRole']);
    const redirect = vi.fn();
    await provider.authorize(CLIENT, authzParams as never, { redirect } as never);

    const { redirectTo } = await provider.handleUpstreamCallback('entra-code', 'id0');
    const url = new URL(redirectTo);
    expect(url.origin + url.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(url.searchParams.get('state')).toBe('cs');
    const brokerCode = url.searchParams.get('code')!;

    expect(await provider.challengeForAuthorizationCode(CLIENT, brokerCode)).toBe('claude-chal');
    const issued = await provider.exchangeAuthorizationCode(CLIENT, brokerCode);
    const info = await provider.verifyAccessToken(issued.access_token);
    expect(info.extra?.sub).toBe('user-7');
    expect(info.extra?.username).toBe('bob@example.com');
    expect(info.extra?.canWrite).toBe(true);
  });

  it('issues a read-only token when the user lacks the write role', async () => {
    const { provider } = makeProvider(['SomeOtherRole']);
    const redirect = vi.fn();
    await provider.authorize(CLIENT, authzParams as never, { redirect } as never);
    const { redirectTo } = await provider.handleUpstreamCallback('entra-code', 'id0');
    const brokerCode = new URL(redirectTo).searchParams.get('code')!;
    const issued = await provider.exchangeAuthorizationCode(CLIENT, brokerCode);
    const info = await provider.verifyAccessToken(issued.access_token);
    expect(info.extra?.canWrite).toBe(false);
  });

  it('rejects an unknown authorization state', async () => {
    const { provider } = makeProvider();
    await expect(provider.handleUpstreamCallback('x', 'nope')).rejects.toThrow(/expired/);
  });

  it('rotates refresh tokens and preserves write capability', async () => {
    const { provider, store } = makeProvider();
    await store.saveRefresh({ token: 'old-rt', sub: 'user-7', username: 'bob', canWrite: true, clientId: 'c1' });
    const issued = await provider.exchangeRefreshToken(CLIENT, 'old-rt');
    expect(issued.refresh_token).toBeTruthy();
    expect(issued.refresh_token).not.toBe('old-rt');
    const info = await provider.verifyAccessToken(issued.access_token);
    expect(info.extra?.canWrite).toBe(true);
    await expect(provider.exchangeRefreshToken(CLIENT, 'old-rt')).rejects.toThrow();
  });
});
