import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

/** Per-user wiki OAuth tokens, keyed by the wiki `sub`. */
export interface WikiTokenRecord {
  sub: string;
  username: string;
  accessToken: string;
  refreshToken: string;
  /** Epoch ms when the access token expires. */
  expiresAt: number;
}

/** In-flight upstream authorization, keyed by the broker-generated state. */
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
  clientId: string;
  clientCodeChallenge: string;
  createdAt: number;
}

/** Opaque broker refresh token, keyed by token. */
export interface RefreshRecord {
  token: string;
  sub: string;
  clientId: string;
}

/**
 * Persistence boundary for the OAuth broker. Implementations: InMemoryTokenStore
 * (tests) and PgTokenStore (production). All `take*` methods are single-use:
 * they return the record and delete it atomically.
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

  // Wiki tokens (keyed by sub)
  saveWikiToken(r: WikiTokenRecord): Promise<void>;
  getWikiToken(sub: string): Promise<WikiTokenRecord | undefined>;

  // Broker refresh tokens (keyed by token)
  saveRefresh(r: RefreshRecord): Promise<void>;
  takeRefresh(token: string): Promise<RefreshRecord | undefined>;
}

export class InMemoryTokenStore implements TokenStore {
  private clients = new Map<string, OAuthClientInformationFull>();
  private pending = new Map<string, PendingAuth>();
  private codes = new Map<string, AuthCodeRecord>();
  private wikiTokens = new Map<string, WikiTokenRecord>();
  private refresh = new Map<string, RefreshRecord>();

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

  async saveWikiToken(r: WikiTokenRecord): Promise<void> {
    this.wikiTokens.set(r.sub, r);
  }
  async getWikiToken(sub: string): Promise<WikiTokenRecord | undefined> {
    return this.wikiTokens.get(sub);
  }

  async saveRefresh(r: RefreshRecord): Promise<void> {
    this.refresh.set(r.token, r);
  }
  async takeRefresh(token: string): Promise<RefreshRecord | undefined> {
    const r = this.refresh.get(token);
    this.refresh.delete(token);
    return r;
  }
}
