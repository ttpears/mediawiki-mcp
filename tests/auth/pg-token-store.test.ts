import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import { PgTokenStore } from '../../src/auth/pg-token-store.js';

const DATABASE_URL = process.env.DATABASE_URL;
const KEY = Buffer.alloc(32, 5);

// Contract test against a real Postgres. Skipped unless DATABASE_URL is set.
describe.skipIf(!DATABASE_URL)('PgTokenStore', () => {
  let pool: Pool;
  let store: PgTokenStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PgTokenStore(pool, KEY);
    await store.init();
    // Clean slate for the keys this test uses.
    await pool.query("DELETE FROM oauth_wiki_tokens WHERE sub = 'u1'");
    await pool.query("DELETE FROM oauth_refresh WHERE token = 'rt'");
  });

  afterAll(async () => {
    await pool.end();
  });

  it('encrypts wiki tokens at rest and decrypts on read', async () => {
    await store.saveWikiToken({ sub: 'u1', username: 'Alice', accessToken: 'plain-access', refreshToken: 'plain-refresh', expiresAt: 123 });

    const raw = await pool.query('SELECT access_enc FROM oauth_wiki_tokens WHERE sub = $1', ['u1']);
    expect(raw.rows[0].access_enc).not.toContain('plain-access');

    const rec = await store.getWikiToken('u1');
    expect(rec?.accessToken).toBe('plain-access');
    expect(rec?.refreshToken).toBe('plain-refresh');
    expect(rec?.expiresAt).toBe(123);
  });

  it('takeRefresh is single-use', async () => {
    await store.saveRefresh({ token: 'rt', sub: 'u1', clientId: 'c1' });
    expect((await store.takeRefresh('rt'))?.sub).toBe('u1');
    expect(await store.takeRefresh('rt')).toBeUndefined();
  });
});
