import { describe, it, expect } from 'vitest';
import { InMemoryTokenStore } from '../../src/auth/token-store.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

const client: OAuthClientInformationFull = {
  client_id: 'c1',
  redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
};

describe('InMemoryTokenStore', () => {
  it('saves and gets a client', async () => {
    const s = new InMemoryTokenStore();
    await s.saveClient(client);
    expect(await s.getClient('c1')).toEqual(client);
    expect(await s.getClient('missing')).toBeUndefined();
  });

  it('takePendingAuth is single-use', async () => {
    const s = new InMemoryTokenStore();
    await s.savePendingAuth({
      brokerState: 'st', clientId: 'c1', clientRedirectUri: 'https://x/cb',
      clientCodeChallenge: 'chal', upstreamCodeVerifier: 'ver', createdAt: 1,
    });
    expect((await s.takePendingAuth('st'))?.clientId).toBe('c1');
    expect(await s.takePendingAuth('st')).toBeUndefined();
  });

  it('peekAuthCode does not consume, takeAuthCode does', async () => {
    const s = new InMemoryTokenStore();
    await s.saveAuthCode({ code: 'ac', sub: 'u1', clientId: 'c1', clientCodeChallenge: 'chal', createdAt: 1 });
    expect((await s.peekAuthCode('ac'))?.sub).toBe('u1');
    expect((await s.peekAuthCode('ac'))?.sub).toBe('u1'); // still there
    expect((await s.takeAuthCode('ac'))?.sub).toBe('u1');
    expect(await s.peekAuthCode('ac')).toBeUndefined();
  });

  it('stores the latest wiki token by sub', async () => {
    const s = new InMemoryTokenStore();
    await s.saveWikiToken({ sub: 'u1', username: 'Alice', accessToken: 'a1', refreshToken: 'r1', expiresAt: 10 });
    await s.saveWikiToken({ sub: 'u1', username: 'Alice', accessToken: 'a2', refreshToken: 'r2', expiresAt: 20 });
    const rec = await s.getWikiToken('u1');
    expect(rec?.accessToken).toBe('a2');
    expect(rec?.expiresAt).toBe(20);
  });

  it('takeRefresh is single-use', async () => {
    const s = new InMemoryTokenStore();
    await s.saveRefresh({ token: 'rt', sub: 'u1', clientId: 'c1' });
    expect((await s.takeRefresh('rt'))?.sub).toBe('u1');
    expect(await s.takeRefresh('rt')).toBeUndefined();
  });
});
