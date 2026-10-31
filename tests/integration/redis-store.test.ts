import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient } from 'redis';
import { RedisTokenStore } from '../../src/auth/redis-token-store.js';
import { environment } from './environment.js';

let client: ReturnType<typeof createClient>;
let store: RedisTokenStore;
const prefix = `mcp-test-${randomUUID()}`;

beforeAll(async () => {
  const fixture = await environment();
  client = createClient({ url: fixture.redisUrl, socket: { reconnectStrategy: false, connectTimeout: 5000 } });
  await client.connect();
  store = new RedisTokenStore(client, prefix);
});

afterAll(async () => {
  if (client?.isOpen) {
    const keys = await client.keys(`${prefix}:*`);
    if (keys.length) await client.del(keys);
    await client.quit();
  }
});

describe('Redis token store against a disposable Redis instance', () => {
  it('redeems a refresh token atomically and applies its authorization TTL', async () => {
    const record = { token: 'refresh', sub: 'fixture-user', username: 'fixture', clientId: 'fixture-client', canWrite: true, authExpiresAt: Date.now() + 30000 };
    await store.saveRefresh(record);
    expect(await client.ttl(`${prefix}:refresh:refresh`)).toBeGreaterThan(0);
    expect(await client.ttl(`${prefix}:refresh:refresh`)).toBeLessThanOrEqual(30);
    const results = await Promise.all([store.takeRefresh('refresh'), store.takeRefresh('refresh')]);
    expect(results.filter(Boolean)).toEqual([record]);
    expect(await store.peekRefresh('refresh')).toBeUndefined();
  });

  it('honors server-side expiry and does not expose records across namespaces', async () => {
    await store.saveAuthCode({ code: 'code', sub: 'fixture-user', username: 'fixture', clientId: 'fixture-client', canWrite: false, clientCodeChallenge: 'challenge', createdAt: Date.now() });
    const other = new RedisTokenStore(client, `${prefix}:other`);
    expect(await other.peekAuthCode('code')).toBeUndefined();
    expect((await store.peekAuthCode('code'))?.sub).toBe('fixture-user');
    expect(await client.expire(`${prefix}:code:code`, 0)).toBe(1);
    expect(await store.peekAuthCode('code')).toBeUndefined();
  });
});
