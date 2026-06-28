import { describe, it, expect, vi } from 'vitest';
import { createWikiAuthProvider, WikiAuthorizationRequired } from '../../src/auth/wiki-auth-provider.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import { BrokerTokens } from '../../src/auth/tokens.js';
import type { MediaWikiOAuthClient } from '../../src/auth/mediawiki-oauth.js';

const PUBLIC_URL = 'https://mcp.example.com';

function makeUpstream(overrides: Partial<MediaWikiOAuthClient> = {}): MediaWikiOAuthClient {
  return { refresh: vi.fn(), ...overrides } as unknown as MediaWikiOAuthClient;
}

function tokens() {
  return new BrokerTokens('secret', `${PUBLIC_URL}/mcp`, ['mediawiki']);
}

describe('createWikiAuthProvider', () => {
  it('returns the stored access token when it is still valid', async () => {
    const store = new InMemoryTokenStore();
    await store.saveWikiToken({ sub: 'u1', wiki: 'Docs', username: 'A', accessToken: 'good', refreshToken: 'r', expiresAt: Date.now() + 600_000 });
    const upstream = makeUpstream();
    const provider = createWikiAuthProvider('u1', store, new Map([['Docs', upstream]]), tokens(), PUBLIC_URL);

    expect(await provider.getAccessToken('Docs')).toBe('good');
    expect(upstream.refresh).not.toHaveBeenCalled();
  });

  it('refreshes and persists when the token is expired', async () => {
    const store = new InMemoryTokenStore();
    await store.saveWikiToken({ sub: 'u1', wiki: 'Docs', username: 'A', accessToken: 'old', refreshToken: 'old-r', expiresAt: Date.now() - 1000 });
    const upstream = makeUpstream({
      refresh: vi.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'new-r', expiresIn: 3600 }) as never,
    });
    const provider = createWikiAuthProvider('u1', store, new Map([['Docs', upstream]]), tokens(), PUBLIC_URL);

    expect(await provider.getAccessToken('Docs')).toBe('new');
    expect(upstream.refresh).toHaveBeenCalledWith('old-r');
    const persisted = await store.getWikiToken('u1', 'Docs');
    expect(persisted?.accessToken).toBe('new');
    expect(persisted?.refreshToken).toBe('new-r');
  });

  it('throws WikiAuthorizationRequired with a per-wiki consent URL when not authorized', async () => {
    const t = tokens();
    const provider = createWikiAuthProvider('u1', new InMemoryTokenStore(), new Map([['Ops', makeUpstream()]]), t, PUBLIC_URL);

    const err = await provider.getAccessToken('Ops').catch((e) => e);
    expect(err).toBeInstanceOf(WikiAuthorizationRequired);
    expect(err.wiki).toBe('Ops');
    expect(err.authorizeUrl).toContain('https://mcp.example.com/authorize/wiki?ticket=');

    // the ticket is a valid wiki ticket bound to (sub, wiki)
    const ticket = decodeURIComponent(err.authorizeUrl.split('ticket=')[1]);
    expect(await t.verifyWikiTicket(ticket)).toEqual({ sub: 'u1', wiki: 'Ops' });
  });
});
