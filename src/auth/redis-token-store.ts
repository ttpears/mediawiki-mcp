import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';
import {
  TokenStore,
  PendingAuth,
  AuthCodeRecord,
  RefreshRecord,
  WikiTokenRecord,
} from './token-store.js';
import { encrypt, decrypt } from './crypto.js';

/** Minimal subset of the node-redis client this store needs (eases testing). */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { EX?: number }): Promise<unknown>;
  getDel(key: string): Promise<string | null>;
}

const TEN_MINUTES = 600;
const THIRTY_ONE_DAYS = 31 * 24 * 60 * 60;

/**
 * Redis-backed token store for the shared swarm Redis. Keys are namespaced by the
 * issuer host so one Redis serves every connector without collision. Pending auth
 * and authorization codes are short-lived; refresh and wiki tokens live as long as
 * the upstream refresh token. Wiki tokens are AES-256-GCM encrypted at rest.
 */
export class RedisTokenStore implements TokenStore {
  /** @param keyPrefix issuer host, e.g. "mediawiki-mcp.teamgleim.com" */
  constructor(
    private readonly redis: RedisLike,
    private readonly encryptionKey: Buffer,
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
    await this.redis.set(this.key('client', client.client_id), JSON.stringify(client));
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

  async saveWikiToken(r: WikiTokenRecord): Promise<void> {
    const blob = encrypt(JSON.stringify(r), this.encryptionKey);
    await this.redis.set(this.key('wikitoken', `${r.wiki}:${r.sub}`), blob, { EX: THIRTY_ONE_DAYS });
  }
  async getWikiToken(sub: string, wiki: string): Promise<WikiTokenRecord | undefined> {
    const blob = await this.redis.get(this.key('wikitoken', `${wiki}:${sub}`));
    return blob ? (JSON.parse(decrypt(blob, this.encryptionKey)) as WikiTokenRecord) : undefined;
  }

  async saveRefresh(r: RefreshRecord): Promise<void> {
    await this.redis.set(this.key('refresh', r.token), JSON.stringify(r), { EX: THIRTY_ONE_DAYS });
  }
  async takeRefresh(token: string): Promise<RefreshRecord | undefined> {
    const raw = await this.redis.getDel(this.key('refresh', token));
    return raw ? (JSON.parse(raw) as RefreshRecord) : undefined;
  }
}
