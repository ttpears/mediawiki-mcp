import { describe, it, expect, vi } from 'vitest';
import { createWikiAuthProvider } from '../../src/auth/wiki-auth-provider.js';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import type { MediaWikiOAuthClient } from '../../src/auth/mediawiki-oauth.js';

function makeUpstream(overrides: Partial<MediaWikiOAuthClient> = {}): MediaWikiOAuthClient {
  return { refresh: vi.fn(), ...overrides } as unknown as MediaWikiOAuthClient;
}

describe('createWikiAuthProvider', () => {
  it('returns the stored access token when it is still valid', async () => {
    const store = new InMemoryTokenStore();
    await store.saveWikiToken({ sub: 'u1', username: 'A', accessToken: 'good', refreshToken: 'r', expiresAt: Date.now() + 600_000 });
    const upstream = makeUpstream();

    const provider = createWikiAuthProvider('u1', store, upstream);
    expect(await provider.getAccessToken('Docs')).toBe('good');
    expect(upstream.refresh).not.toHaveBeenCalled();
  });

  it('refreshes and persists when the token is expired', async () => {
    const store = new InMemoryTokenStore();
    await store.saveWikiToken({ sub: 'u1', username: 'A', accessToken: 'old', refreshToken: 'old-r', expiresAt: Date.now() - 1000 });
    const upstream = makeUpstream({
      refresh: vi.fn().mockResolvedValue({ accessToken: 'new', refreshToken: 'new-r', expiresIn: 3600 }) as never,
    });

    const provider = createWikiAuthProvider('u1', store, upstream);
    expect(await provider.getAccessToken('Docs')).toBe('new');
    expect(upstream.refresh).toHaveBeenCalledWith('old-r');

    const persisted = await store.getWikiToken('u1');
    expect(persisted?.accessToken).toBe('new');
    expect(persisted?.refreshToken).toBe('new-r');
    expect(persisted!.expiresAt).toBeGreaterThan(Date.now());
  });

  it('throws when the user has no stored authorization', async () => {
    const provider = createWikiAuthProvider('nobody', new InMemoryTokenStore(), makeUpstream());
    await expect(provider.getAccessToken('Docs')).rejects.toThrow(/No wiki authorization/);
  });
});
