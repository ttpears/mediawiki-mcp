import axios, { AxiosInstance } from 'axios';

export interface EntraIdentity {
  /** Stable user id (Entra `oid`, falling back to `sub`). */
  sub: string;
  /** Human-readable identity for attribution (preferred_username / email). */
  username: string;
  /** App roles assigned to the user (the `roles` claim), used for write gating. */
  roles: string[];
}

function decodeJwtClaims(jwt: string): Record<string, unknown> {
  const part = jwt.split('.')[1];
  if (!part) return {};
  const json = Buffer.from(part.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
  return JSON.parse(json) as Record<string, unknown>;
}

/**
 * Microsoft Entra (Azure AD) OIDC client. The broker uses it to authenticate the
 * connecting user; their identity + app roles come from the returned ID token.
 * Wiki actions do NOT use Entra tokens — they run on the per-wiki bot account.
 */
export class EntraOIDCClient {
  private readonly http: AxiosInstance;
  private readonly base: string;

  constructor(
    tenantId: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
    http?: AxiosInstance
  ) {
    this.base = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;
    this.http =
      http ??
      axios.create({ timeout: 30000, headers: { Accept: 'application/json' } });
  }

  buildAuthorizeUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      response_mode: 'query',
      scope: 'openid profile email',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${this.base}/authorize?${params.toString()}`;
  }

  /** Exchange the authorization code and return the user's identity + roles. */
  async exchangeCode(code: string, codeVerifier: string): Promise<EntraIdentity> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      code_verifier: codeVerifier,
      scope: 'openid profile email',
    });
    const res = await this.http.post<{ id_token: string; access_token: string }>(
      `${this.base}/token`,
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return this.identityFromToken(res.data.id_token);
  }

  private identityFromToken(idToken: string): EntraIdentity {
    const c = decodeJwtClaims(idToken);
    const sub = String(c.oid ?? c.sub ?? '');
    const username = String(c.preferred_username ?? c.email ?? c.upn ?? sub);
    const roles = Array.isArray(c.roles) ? (c.roles as unknown[]).map(String) : [];
    return { sub, username, roles };
  }
}
