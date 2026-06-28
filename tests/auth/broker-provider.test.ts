import { describe, it, expect, vi } from 'vitest';
import { MediaWikiOAuthProvider } from '../../src/auth/broker-provider.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { BrokerTokens } from '../../src/auth/tokens.js';
import type { MediaWikiOAuthClient } from '../../src/auth/mediawiki-oauth.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

const AUD = 'https://mcp.example.com/mcp';
const CLIENT: OAuthClientInformationFull = {
  client_id: 'c1',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
};

function makeUpstream(overrides: Partial<MediaWikiOAuthClient> = {}): MediaWikiOAuthClient {
  return {
    buildAuthorizeUrl: vi.fn().mockReturnValue('https://wiki.example.com/rest.php/oauth2/authorize?x=1'),
    exchangeCode: vi.fn().mockResolvedValue({ accessToken: 'wiki-a', refreshToken: 'wiki-r', expiresIn: 3600 }),
    fetchIdentity: vi.fn().mockResolvedValue({ sub: 'user-7', username: 'Bob' }),
    refresh: vi.fn(),
    ...overrides,
  } as unknown as MediaWikiOAuthClient;
}

function counterGenId(): () => string {
  let n = 0;
  return () => `id${n++}`;
}

function makeProvider(store = new InMemoryTokenStore(), upstream = makeUpstream()) {
  const tokens = new BrokerTokens('secret', AUD, ['mediawiki']);
  return { provider: new MediaWikiOAuthProvider(store, upstream, tokens, counterGenId()), store, upstream, tokens };
}

describe('MediaWikiOAuthProvider', () => {
  it('registers a client with a generated id', async () => {
    const { provider, store } = makeProvider();
    const full = await provider.clientsStore.registerClient!({ redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] });
    expect(full.client_id).toBe('id0');
    expect(await store.getClient('id0')).toBeDefined();
  });

  it('authorize stores a pending record and redirects to the upstream wiki', async () => {
    const { provider, upstream } = makeProvider();
    const redirect = vi.fn();
    await provider.authorize(CLIENT, { redirectUri: 'https://claude.ai/api/mcp/auth_callback', state: 'cs', codeChallenge: 'claude-chal' } as never, { redirect } as never);
    expect(upstream.buildAuthorizeUrl).toHaveBeenCalledWith('id0', expect.any(String));
    expect(redirect).toHaveBeenCalledWith('https://wiki.example.com/rest.php/oauth2/authorize?x=1');
  });

  it('handles the upstream callback: stores wiki token and redirects with a code', async () => {
    const { provider, store } = makeProvider();
    const redirect = vi.fn();
    await provider.authorize(CLIENT, { redirectUri: 'https://claude.ai/api/mcp/auth_callback', state: 'cs', codeChallenge: 'claude-chal' } as never, { redirect } as never);

    const { redirectTo } = await provider.handleUpstreamCallback('wiki-code', 'id0');
    const url = new URL(redirectTo);
    expect(url.origin + url.pathname).toBe('https://claude.ai/api/mcp/auth_callback');
    expect(url.searchParams.get('state')).toBe('cs');
    const brokerCode = url.searchParams.get('code')!;
    expect(brokerCode).toBeTruthy();

    const wikiTok = await store.getWikiToken('user-7');
    expect(wikiTok?.accessToken).toBe('wiki-a');
    expect(wikiTok?.username).toBe('Bob');

    // challenge round-trips, then code exchanges into a verifiable access token
    expect(await provider.challengeForAuthorizationCode(CLIENT, brokerCode)).toBe('claude-chal');
    const issued = await provider.exchangeAuthorizationCode(CLIENT, brokerCode);
    expect(issued.token_type).toBe('Bearer');
    const info = await provider.verifyAccessToken(issued.access_token);
    expect(info.extra?.sub).toBe('user-7');
    expect(issued.refresh_token).toBeTruthy();
  });

  it('rejects an unknown authorization state', async () => {
    const { provider } = makeProvider();
    await expect(provider.handleUpstreamCallback('x', 'nope')).rejects.toThrow(/expired/);
  });

  it('rotates refresh tokens', async () => {
    const { provider, store } = makeProvider();
    await store.saveRefresh({ token: 'old-rt', sub: 'user-7', clientId: 'c1' });
    const issued = await provider.exchangeRefreshToken(CLIENT, 'old-rt');
    expect(issued.refresh_token).toBeTruthy();
    expect(issued.refresh_token).not.toBe('old-rt');
    // old refresh token is consumed
    await expect(provider.exchangeRefreshToken(CLIENT, 'old-rt')).rejects.toThrow();
  });
});
