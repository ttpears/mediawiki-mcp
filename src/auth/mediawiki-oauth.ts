import axios, { AxiosInstance } from 'axios';

export interface UpstreamTokens {
  accessToken: string;
  refreshToken: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
}

export interface UpstreamIdentity {
  sub: string;
  username: string;
}

/**
 * Client for one wiki's MediaWiki OAuth 2.0 extension endpoints
 * (`/rest.php/oauth2/*`). The broker uses it to drive the upstream
 * authorization-code flow on behalf of each user.
 */
export class MediaWikiOAuthClient {
  private readonly base: string;
  private readonly http: AxiosInstance;

  constructor(
    baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string | undefined,
    private readonly redirectUri: string,
    http?: AxiosInstance
  ) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.http =
      http ??
      axios.create({
        timeout: 30000,
        headers: { 'User-Agent': 'MediaWiki-MCP/2.0.0', Accept: 'application/json' },
      });
  }

  private get authorizeEndpoint(): string {
    return `${this.base}/rest.php/oauth2/authorize`;
  }
  private get tokenEndpoint(): string {
    return `${this.base}/rest.php/oauth2/access_token`;
  }
  private get profileEndpoint(): string {
    return `${this.base}/rest.php/oauth2/resource/profile`;
  }

  buildAuthorizeUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });
    return `${this.authorizeEndpoint}?${params.toString()}`;
  }

  async exchangeCode(code: string, codeVerifier: string): Promise<UpstreamTokens> {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri,
      client_id: this.clientId,
      code_verifier: codeVerifier,
    });
    if (this.clientSecret) body.set('client_secret', this.clientSecret);
    return this.postForTokens(body);
  }

  async refresh(refreshToken: string): Promise<UpstreamTokens> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.clientId,
    });
    if (this.clientSecret) body.set('client_secret', this.clientSecret);
    return this.postForTokens(body);
  }

  private async postForTokens(body: URLSearchParams): Promise<UpstreamTokens> {
    const res = await this.http.post<{ access_token: string; refresh_token: string; expires_in: number }>(
      this.tokenEndpoint,
      body.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return {
      accessToken: res.data.access_token,
      refreshToken: res.data.refresh_token,
      expiresIn: res.data.expires_in,
    };
  }

  async fetchIdentity(accessToken: string): Promise<UpstreamIdentity> {
    const res = await this.http.get<{ sub: number | string; username: string }>(this.profileEndpoint, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return { sub: String(res.data.sub), username: res.data.username };
  }
}
