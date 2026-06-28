import { describe, it, expect } from 'vitest';
import { RedisTokenStore, RedisLike } from '../../src/auth/redis-token-store.js';
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/** In-memory fake of the RedisLike subset, recording EX TTLs. */
function fakeRedis() {
  const map = new Map<string, string>();
  const ttls = new Map<string, number>();
  const redis: RedisLike = {
    async get(k) { return map.get(k) ?? null; },
    async set(k, v, opts) { map.set(k, v); if (opts?.EX) ttls.set(k, opts.EX); return 'OK'; },
    async getDel(k) { const v = map.get(k) ?? null; map.delete(k); return v; },
  };
  return { redis, map, ttls };
}

const KEY = Buffer.alloc(32, 3);
const PREFIX = 'mediawiki-mcp.example.com';

const client: OAuthClientInformationFull = { client_id: 'c1', redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] };

describe('RedisTokenStore', () => {
  it('namespaces keys by issuer host', async () => {
    const { redis, map } = fakeRedis();
    const store = new RedisTokenStore(redis, KEY, PREFIX);
    await store.saveClient(client);
    expect([...map.keys()][0]).toBe('mediawiki-mcp.example.com:client:c1');
  });

  it('round-trips a client', async () => {
    const { redis } = fakeRedis();
    const store = new RedisTokenStore(redis, KEY, PREFIX);
    await store.saveClient(client);
    expect(await store.getClient('c1')).toEqual(client);
    expect(await store.getClient('missing')).toBeUndefined();
  });

  it('encrypts wiki tokens at rest and decrypts on read', async () => {
    const { redis, map } = fakeRedis();
    const store = new RedisTokenStore(redis, KEY, PREFIX);
    await store.saveWikiToken({ sub: 'u1', username: 'A', accessToken: 'plain-access', refreshToken: 'plain-refresh', expiresAt: 5 });
    expect(map.get('mediawiki-mcp.example.com:wikitoken:u1')).not.toContain('plain-access');
    const rec = await store.getWikiToken('u1');
    expect(rec?.accessToken).toBe('plain-access');
    expect(rec?.refreshToken).toBe('plain-refresh');
  });

  it('pending/code/refresh are single-use via getDel', async () => {
    const { redis } = fakeRedis();
    const store = new RedisTokenStore(redis, KEY, PREFIX);
    await store.savePendingAuth({ brokerState: 's', clientId: 'c1', clientRedirectUri: 'u', clientCodeChallenge: 'ch', upstreamCodeVerifier: 'v', createdAt: 1 });
    expect((await store.takePendingAuth('s'))?.clientId).toBe('c1');
    expect(await store.takePendingAuth('s')).toBeUndefined();

    await store.saveRefresh({ token: 'rt', sub: 'u1', clientId: 'c1' });
    expect((await store.takeRefresh('rt'))?.sub).toBe('u1');
    expect(await store.takeRefresh('rt')).toBeUndefined();
  });

  it('peekAuthCode does not consume; takeAuthCode does', async () => {
    const { redis } = fakeRedis();
    const store = new RedisTokenStore(redis, KEY, PREFIX);
    await store.saveAuthCode({ code: 'ac', sub: 'u1', clientId: 'c1', clientCodeChallenge: 'ch', createdAt: 1 });
    expect((await store.peekAuthCode('ac'))?.sub).toBe('u1');
    expect((await store.takeAuthCode('ac'))?.sub).toBe('u1');
    expect(await store.peekAuthCode('ac')).toBeUndefined();
  });

  it('applies TTLs to ephemeral records', async () => {
    const { redis, ttls } = fakeRedis();
    const store = new RedisTokenStore(redis, KEY, PREFIX);
    await store.savePendingAuth({ brokerState: 's', clientId: 'c1', clientRedirectUri: 'u', clientCodeChallenge: 'ch', upstreamCodeVerifier: 'v', createdAt: 1 });
    expect(ttls.get('mediawiki-mcp.example.com:pending:s')).toBe(600);
  });
});
