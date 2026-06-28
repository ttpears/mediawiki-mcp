import type { Pool } from 'pg';
import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  TokenStore,
  PendingAuth,
  AuthCodeRecord,
  RefreshRecord,
  WikiTokenRecord,
} from './token-store.js';
import { encrypt, decrypt } from './crypto.js';

/**
 * Postgres-backed token store. Wiki access/refresh tokens are encrypted at rest
 * with AES-256-GCM; broker bookkeeping (clients, pending auth, codes) is stored
 * as JSONB. Call {@link init} once at startup to create tables.
 */
export class PgTokenStore implements TokenStore {
  constructor(
    private readonly pool: Pool,
    private readonly encryptionKey: Buffer
  ) {}

  async init(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        data JSONB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_pending (
        broker_state TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        data JSONB NOT NULL,
        created_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_wiki_tokens (
        sub TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        access_enc TEXT NOT NULL,
        refresh_enc TEXT NOT NULL,
        expires_at BIGINT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_refresh (
        token TEXT PRIMARY KEY,
        sub TEXT NOT NULL,
        client_id TEXT NOT NULL
      );
    `);
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const res = await this.pool.query('SELECT data FROM oauth_clients WHERE client_id = $1', [clientId]);
    return res.rows[0]?.data as OAuthClientInformationFull | undefined;
  }
  async saveClient(client: OAuthClientInformationFull): Promise<void> {
    await this.pool.query(
      'INSERT INTO oauth_clients (client_id, data) VALUES ($1, $2) ON CONFLICT (client_id) DO UPDATE SET data = $2',
      [client.client_id, client]
    );
  }

  async savePendingAuth(p: PendingAuth): Promise<void> {
    await this.pool.query(
      'INSERT INTO oauth_pending (broker_state, data, created_at) VALUES ($1, $2, $3) ON CONFLICT (broker_state) DO UPDATE SET data = $2, created_at = $3',
      [p.brokerState, p, p.createdAt]
    );
  }
  async takePendingAuth(brokerState: string): Promise<PendingAuth | undefined> {
    const res = await this.pool.query('DELETE FROM oauth_pending WHERE broker_state = $1 RETURNING data', [brokerState]);
    return res.rows[0]?.data as PendingAuth | undefined;
  }

  async saveAuthCode(c: AuthCodeRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO oauth_codes (code, data, created_at) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET data = $2, created_at = $3',
      [c.code, c, c.createdAt]
    );
  }
  async peekAuthCode(code: string): Promise<AuthCodeRecord | undefined> {
    const res = await this.pool.query('SELECT data FROM oauth_codes WHERE code = $1', [code]);
    return res.rows[0]?.data as AuthCodeRecord | undefined;
  }
  async takeAuthCode(code: string): Promise<AuthCodeRecord | undefined> {
    const res = await this.pool.query('DELETE FROM oauth_codes WHERE code = $1 RETURNING data', [code]);
    return res.rows[0]?.data as AuthCodeRecord | undefined;
  }

  async saveWikiToken(r: WikiTokenRecord): Promise<void> {
    const accessEnc = encrypt(r.accessToken, this.encryptionKey);
    const refreshEnc = encrypt(r.refreshToken, this.encryptionKey);
    await this.pool.query(
      `INSERT INTO oauth_wiki_tokens (sub, username, access_enc, refresh_enc, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (sub) DO UPDATE SET username = $2, access_enc = $3, refresh_enc = $4, expires_at = $5`,
      [r.sub, r.username, accessEnc, refreshEnc, r.expiresAt]
    );
  }
  async getWikiToken(sub: string): Promise<WikiTokenRecord | undefined> {
    const res = await this.pool.query(
      'SELECT sub, username, access_enc, refresh_enc, expires_at FROM oauth_wiki_tokens WHERE sub = $1',
      [sub]
    );
    const row = res.rows[0];
    if (!row) return undefined;
    return {
      sub: row.sub,
      username: row.username,
      accessToken: decrypt(row.access_enc, this.encryptionKey),
      refreshToken: decrypt(row.refresh_enc, this.encryptionKey),
      expiresAt: Number(row.expires_at),
    };
  }

  async saveRefresh(r: RefreshRecord): Promise<void> {
    await this.pool.query(
      'INSERT INTO oauth_refresh (token, sub, client_id) VALUES ($1, $2, $3) ON CONFLICT (token) DO UPDATE SET sub = $2, client_id = $3',
      [r.token, r.sub, r.clientId]
    );
  }
  async takeRefresh(token: string): Promise<RefreshRecord | undefined> {
    const res = await this.pool.query('DELETE FROM oauth_refresh WHERE token = $1 RETURNING token, sub, client_id', [token]);
    const row = res.rows[0];
    if (!row) return undefined;
    return { token: row.token, sub: row.sub, clientId: row.client_id };
  }
}
