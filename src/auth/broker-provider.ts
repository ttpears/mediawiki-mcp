import { randomBytes, createHash } from 'node:crypto';
import { Response } from 'express';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import { OAuthClientInformationFull, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { InvalidGrantError } from '@modelcontextprotocol/sdk/server/auth/errors.js';
import { TokenStore, type AuthCodeRecord } from './token-store.js';
import { EntraOIDCClient } from './entra-oidc.js';
import { BrokerTokens } from './tokens.js';

/** Refresh rotation must never extend the original Entra authorization. */
export const AUTH_SESSION_TTL_MS = 60 * 60 * 1000;
const AUTH_CODE_TTL_MS = 10 * 60 * 1000;

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/**
 * OAuth broker that fronts Microsoft Entra. To the MCP client it is a standard
 * OAuth 2.1 authorization server; behind the scenes it runs the Entra OIDC flow,
 * derives the user's identity + write role, and issues its own audience-bound
 * JWTs. Wiki actions are NOT done with Entra tokens (the bot account is used);
 * the Entra token is never forwarded anywhere.
 */
export class BrokerOAuthProvider implements OAuthServerProvider {
  private readonly genId: () => string;

  /** @param writeRole Entra app-role name that grants write access. */
  constructor(
    private readonly store: TokenStore,
    private readonly entra: EntraOIDCClient,
    private readonly tokens: BrokerTokens,
    private readonly writeRole: string,
    genId?: () => string
  ) {
    this.genId = genId ?? (() => randomBytes(32).toString('hex'));
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return {
      getClient: (clientId) => this.store.getClient(clientId),
      registerClient: async (client) => {
        const full: OAuthClientInformationFull = {
          ...client,
          client_id: this.genId(),
          client_id_issued_at: Math.floor(Date.now() / 1000),
        };
        await this.store.saveClient(full);
        return full;
      },
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response
  ): Promise<void> {
    const brokerState = this.genId();
    const upstreamCodeVerifier = this.genId();
    await this.store.savePendingAuth({
      brokerState,
      clientId: client.client_id,
      clientRedirectUri: params.redirectUri,
      clientState: params.state,
      clientCodeChallenge: params.codeChallenge,
      upstreamCodeVerifier,
      createdAt: Date.now(),
    });
    res.redirect(this.entra.buildAuthorizeUrl(brokerState, pkceChallenge(upstreamCodeVerifier)));
  }

  /**
   * Called by the /callback route once Entra redirects back. Exchanges the code,
   * derives identity + write role, mints a broker authorization code, and returns
   * where to redirect the browser (back to the MCP client).
   */
  async handleUpstreamCallback(code: string, brokerState: string): Promise<{ redirectTo: string }> {
    const pending = await this.store.takePendingAuth(brokerState);
    if (!pending || Date.now() - pending.createdAt >= AUTH_CODE_TTL_MS) {
      throw new Error('Unknown or expired authorization state');
    }

    const identity = await this.entra.exchangeCode(code, pending.upstreamCodeVerifier);
    const canWrite = identity.roles.includes(this.writeRole);

    const brokerCode = this.genId();
    await this.store.saveAuthCode({
      code: brokerCode,
      sub: identity.sub,
      username: identity.username,
      canWrite,
      clientId: pending.clientId,
      clientCodeChallenge: pending.clientCodeChallenge,
      clientRedirectUri: pending.clientRedirectUri,
      authExpiresAt: Date.now() + AUTH_SESSION_TTL_MS,
      createdAt: Date.now(),
    });

    const redirect = new URL(pending.clientRedirectUri);
    redirect.searchParams.set('code', brokerCode);
    if (pending.clientState !== undefined) {
      redirect.searchParams.set('state', pending.clientState);
    }
    return { redirectTo: redirect.toString() };
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const record = await this.store.peekAuthCode(authorizationCode);
    this.validateCode(record, client);
    return record.clientCodeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string
  ): Promise<OAuthTokens> {
    const preview = await this.store.peekAuthCode(authorizationCode);
    this.validateCode(preview, client);
    if (redirectUri !== undefined && redirectUri !== preview.clientRedirectUri) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    const record = await this.store.takeAuthCode(authorizationCode);
    this.validateCode(record, client);
    return this.issueTokens(record.sub, record.username, record.canWrite, client.client_id, record.authExpiresAt!);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string
  ): Promise<OAuthTokens> {
    const preview = await this.store.peekRefresh(refreshToken);
    if (!preview || preview.clientId !== client.client_id || !this.isCurrentAuthorization(preview.authExpiresAt)) {
      throw new InvalidGrantError('Invalid or expired refresh token; sign in again');
    }
    const record = await this.store.takeRefresh(refreshToken);
    if (!record || record.clientId !== client.client_id || !this.isCurrentAuthorization(record.authExpiresAt)) {
      throw new InvalidGrantError('Invalid or expired refresh token; sign in again');
    }
    return this.issueTokens(record.sub, record.username, record.canWrite, client.client_id, record.authExpiresAt!);
  }

  private isCurrentAuthorization(deadline: number | undefined): boolean {
    return typeof deadline === 'number' && Number.isFinite(deadline) && deadline > Date.now();
  }

  private validateCode(record: AuthCodeRecord | undefined, client: OAuthClientInformationFull): asserts record is AuthCodeRecord {
    if (!record || record.clientId !== client.client_id || !record.clientRedirectUri ||
        Date.now() - record.createdAt >= AUTH_CODE_TTL_MS || !this.isCurrentAuthorization(record.authExpiresAt)) {
      throw new InvalidGrantError('Invalid authorization code');
    }
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return this.tokens.verifyAccessToken(token);
  }

  private async issueTokens(
    sub: string,
    username: string,
    canWrite: boolean,
    clientId: string,
    authExpiresAt: number
  ): Promise<OAuthTokens> {
    const ttlSeconds = Math.min(3600, Math.floor((authExpiresAt - Date.now()) / 1000));
    if (ttlSeconds <= 0) throw new InvalidGrantError('Authorization expired; sign in again');
    const accessToken = await this.tokens.signAccessToken(sub, clientId, { username, canWrite }, ttlSeconds);
    const refreshToken = this.genId();
    await this.store.saveRefresh({ token: refreshToken, sub, username, canWrite, clientId, authExpiresAt });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ttlSeconds,
      refresh_token: refreshToken,
      scope: 'mediawiki',
    };
  }
}
