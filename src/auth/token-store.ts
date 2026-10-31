import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/** In-flight upstream (Entra) authorization, keyed by the broker-generated state. */
export interface PendingAuth {
  brokerState: string;
  clientId: string;
  clientRedirectUri: string;
  clientState?: string;
  clientCodeChallenge: string;
  upstreamCodeVerifier: string;
  createdAt: number;
}

/** Broker authorization code issued to the MCP client, keyed by code. */
export interface AuthCodeRecord {
  code: string;
  sub: string;
  username: string;
  canWrite: boolean;
  clientId: string;
  clientCodeChallenge: string;
  clientRedirectUri?: string;
  /** Absolute deadline inherited by every rotated refresh token. */
  authExpiresAt?: number;
  createdAt: number;
}

/** Opaque broker refresh token, keyed by token. */
export interface RefreshRecord {
  token: string;
  sub: string;
  username: string;
  canWrite: boolean;
  clientId: string;
  authExpiresAt?: number;
}

/**
 * Persistence boundary for the OAuth broker. Implementations: InMemoryTokenStore
 * (tests) and RedisTokenStore (production). All `take*` methods are single-use:
 * they return the record and delete it atomically. No wiki tokens are stored —
 * wiki actions run on the bot account; only broker session state lives here.
 */
export interface TokenStore {
  // Dynamic client registration
  getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;
  saveClient(client: OAuthClientInformationFull): Promise<void>;

  // Pending upstream auth (keyed by brokerState)
  savePendingAuth(p: PendingAuth): Promise<void>;
  takePendingAuth(brokerState: string): Promise<PendingAuth | undefined>;

  // Broker auth codes (keyed by code)
  saveAuthCode(c: AuthCodeRecord): Promise<void>;
  peekAuthCode(code: string): Promise<AuthCodeRecord | undefined>;
  takeAuthCode(code: string): Promise<AuthCodeRecord | undefined>;

  // Broker refresh tokens (keyed by token)
  saveRefresh(r: RefreshRecord): Promise<void>;
  peekRefresh(token: string): Promise<RefreshRecord | undefined>;
  takeRefresh(token: string): Promise<RefreshRecord | undefined>;
}

/** Expire and bound OAuth state when Redis is not configured. */
class ExpiringRecords<T> {
  private records = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  set(key: string, value: T, deadline = Date.now() + this.ttlMs): void {
    for (const [id, entry] of this.records) {
      if (entry.expiresAt <= Date.now()) this.records.delete(id);
    }
    if (!this.records.has(key) && this.records.size >= 10000) throw new Error('OAuth state capacity reached');
    this.records.set(key, { value, expiresAt: Math.min(deadline, Date.now() + this.ttlMs) });
  }

  get(key: string): T | undefined {
    const entry = this.records.get(key);
    if (entry && entry.expiresAt > Date.now()) return entry.value;
    this.records.delete(key);
    return undefined;
  }

  delete(key: string): void { this.records.delete(key); }
}

export class InMemoryTokenStore implements TokenStore {
  private clients = new ExpiringRecords<OAuthClientInformationFull>(90 * 24 * 60 * 60 * 1000);
  private pending = new ExpiringRecords<PendingAuth>(10 * 60 * 1000);
  private codes = new ExpiringRecords<AuthCodeRecord>(10 * 60 * 1000);
  private refresh = new ExpiringRecords<RefreshRecord>(31 * 24 * 60 * 60 * 1000);

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.clients.get(clientId);
  }
  async saveClient(client: OAuthClientInformationFull): Promise<void> {
    this.clients.set(client.client_id, client);
  }

  async savePendingAuth(p: PendingAuth): Promise<void> {
    this.pending.set(p.brokerState, p);
  }
  async takePendingAuth(brokerState: string): Promise<PendingAuth | undefined> {
    const p = this.pending.get(brokerState);
    this.pending.delete(brokerState);
    return p;
  }

  async saveAuthCode(c: AuthCodeRecord): Promise<void> {
    this.codes.set(c.code, c);
  }
  async peekAuthCode(code: string): Promise<AuthCodeRecord | undefined> {
    return this.codes.get(code);
  }
  async takeAuthCode(code: string): Promise<AuthCodeRecord | undefined> {
    const c = this.codes.get(code);
    this.codes.delete(code);
    return c;
  }

  async saveRefresh(r: RefreshRecord): Promise<void> {
    this.refresh.set(r.token, r, r.authExpiresAt);
  }
  async peekRefresh(token: string): Promise<RefreshRecord | undefined> {
    return this.refresh.get(token);
  }
  async takeRefresh(token: string): Promise<RefreshRecord | undefined> {
    const r = this.refresh.get(token);
    this.refresh.delete(token);
    return r;
  }
}
