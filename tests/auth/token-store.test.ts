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

  it('peekAuthCode does not consume, takeAuthCode does; carries identity + canWrite', async () => {
    const s = new InMemoryTokenStore();
    await s.saveAuthCode({ code: 'ac', sub: 'u1', username: 'alice', canWrite: true, clientId: 'c1', clientCodeChallenge: 'chal', createdAt: 1 });
    expect((await s.peekAuthCode('ac'))?.username).toBe('alice');
    expect((await s.peekAuthCode('ac'))?.canWrite).toBe(true); // still there
    expect((await s.takeAuthCode('ac'))?.sub).toBe('u1');
    expect(await s.peekAuthCode('ac')).toBeUndefined();
  });

  it('takeRefresh is single-use and carries identity + canWrite', async () => {
    const s = new InMemoryTokenStore();
    await s.saveRefresh({ token: 'rt', sub: 'u1', username: 'alice', canWrite: false, clientId: 'c1' });
    const r = await s.takeRefresh('rt');
    expect(r?.sub).toBe('u1');
    expect(r?.canWrite).toBe(false);
    expect(await s.takeRefresh('rt')).toBeUndefined();
  });
});
