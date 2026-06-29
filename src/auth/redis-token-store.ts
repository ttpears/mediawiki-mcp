import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import { TokenStore, PendingAuth, AuthCodeRecord, RefreshRecord } from './token-store.js';

/** Minimal subset of the node-redis client this store needs (eases testing). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  getDel(key: string): Promise<string | null>;
}

const TEN_MINUTES = 600;
const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60;
const NINETY_DAYS = 90 * 24 * 60 * 60;

/**
 * Redis-backed broker state for the shared swarm Redis. Keys are namespaced by the
 * issuer host so one Redis serves every connector without collision. Pending auth
 * and authorization codes are short-lived; refresh tokens live ~a month; DCR
 * client registrations expire after 90 days. No upstream (Entra) tokens or wiki
 * credentials are ever stored — only broker session state, all with TTLs.
 */
export class RedisTokenStore implements TokenStore {
  /** @param keyPrefix issuer host, e.g. "mediawiki-mcp.example.com" */
  constructor(
    private readonly redis: RedisLike,
    private readonly keyPrefix: string
  ) {}

  private key(kind: string, id: string): string {
    return `${this.keyPrefix}:${kind}:${id}`;
  }

  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const raw = await this.redis.get(this.key('client', clientId));
    return raw ? (JSON.parse(raw) as OAuthClientInformationFull) : undefined;
  }
  async saveClient(client: OAuthClientInformationFull): Promise<void> {
    // TTL so DCR registrations don't accumulate forever (Claude re-registers).
    await this.redis.set(this.key('client', client.client_id), JSON.stringify(client), { EX: NINETY_DAYS });
  }

  async savePendingAuth(p: PendingAuth): Promise<void> {
    await this.redis.set(this.key('pending', p.brokerState), JSON.stringify(p), { EX: TEN_MINUTES });
  }
  async takePendingAuth(brokerState: string): Promise<PendingAuth | undefined> {
    const raw = await this.redis.getDel(this.key('pending', brokerState));
    return raw ? (JSON.parse(raw) as PendingAuth) : undefined;
  }

  async saveAuthCode(c: AuthCodeRecord): Promise<void> {
    await this.redis.set(this.key('code', c.code), JSON.stringify(c), { EX: TEN_MINUTES });
  }
  async peekAuthCode(code: string): Promise<AuthCodeRecord | undefined> {
    const raw = await this.redis.get(this.key('code', code));
    return raw ? (JSON.parse(raw) as AuthCodeRecord) : undefined;
  }
  async takeAuthCode(code: string): Promise<AuthCodeRecord | undefined> {
    const raw = await this.redis.getDel(this.key('code', code));
    return raw ? (JSON.parse(raw) as AuthCodeRecord) : undefined;
  }

  async saveRefresh(r: RefreshRecord): Promise<void> {
    await this.redis.set(this.key('refresh', r.token), JSON.stringify(r), { EX: THIRTY_ONE_DAYS });
  }
  async takeRefresh(token: string): Promise<RefreshRecord | undefined> {
    const raw = await this.redis.getDel(this.key('refresh', token));
    return raw ? (JSON.parse(raw) as RefreshRecord) : undefined;
  }
}
