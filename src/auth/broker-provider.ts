import { randomBytes, createHash } from 'node:crypto';
import { Response } from 'express';
import { OAuthServerProvider, AuthorizationParams } from '@modelcontextprotocol/sdk/server/auth/provider.js';
import { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  OAuthClientInformationFull,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { TokenStore } from './token-store.js';
import { MediaWikiOAuthClient } from './mediawiki-oauth.js';
import { BrokerTokens } from './tokens.js';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function pkceChallenge(verifier: string): string {
  return base64url(createHash('sha256').update(verifier).digest());
}

/**
 * OAuth broker that fronts one wiki's MediaWiki OAuth. To the MCP client it is a
 * standard OAuth 2.1 authorization server; behind the scenes it runs the upstream
 * authorization-code flow, stores the user's wiki tokens, and issues its own
 * audience-bound JWTs. The Claude-issued token is never forwarded upstream.
 */
export class MediaWikiOAuthProvider implements OAuthServerProvider {
  private readonly genId: () => string;

  constructor(
    private readonly store: TokenStore,
    private readonly upstream: MediaWikiOAuthClient,
    private readonly tokens: BrokerTokens,
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
    const upstreamChallenge = pkceChallenge(upstreamCodeVerifier);

    await this.store.savePendingAuth({
      brokerState,
      clientId: client.client_id,
      clientRedirectUri: params.redirectUri,
      clientState: params.state,
      clientCodeChallenge: params.codeChallenge,
      upstreamCodeVerifier,
      createdAt: Date.now(),
    });

    res.redirect(this.upstream.buildAuthorizeUrl(brokerState, upstreamChallenge));
  }

  /**
   * Called by the custom /callback route once the wiki redirects back. Exchanges
   * the upstream code, persists the user's wiki tokens, and mints a broker
   * authorization code for the MCP client. Returns where to redirect the browser.
   */
  async handleUpstreamCallback(code: string, brokerState: string): Promise<{ redirectTo: string }> {
    const pending = await this.store.takePendingAuth(brokerState);
    if (!pending) {
      throw new Error('Unknown or expired authorization state');
    }

    const upstreamTokens = await this.upstream.exchangeCode(code, pending.upstreamCodeVerifier);
    const identity = await this.upstream.fetchIdentity(upstreamTokens.accessToken);

    await this.store.saveWikiToken({
      sub: identity.sub,
      username: identity.username,
      accessToken: upstreamTokens.accessToken,
      refreshToken: upstreamTokens.refreshToken,
      expiresAt: Date.now() + upstreamTokens.expiresIn * 1000,
    });

    const brokerCode = this.genId();
    await this.store.saveAuthCode({
      code: brokerCode,
      sub: identity.sub,
      clientId: pending.clientId,
      clientCodeChallenge: pending.clientCodeChallenge,
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
    _client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<string> {
    const record = await this.store.peekAuthCode(authorizationCode);
    if (!record) {
      throw new Error('Invalid authorization code');
    }
    return record.clientCodeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string
  ): Promise<OAuthTokens> {
    const record = await this.store.takeAuthCode(authorizationCode);
    if (!record) {
      throw new Error('Invalid authorization code');
    }
    return this.issueTokens(record.sub, client.client_id);
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string
  ): Promise<OAuthTokens> {
    const record = await this.store.takeRefresh(refreshToken);
    if (!record) {
      throw new Error('Invalid refresh token');
    }
    return this.issueTokens(record.sub, client.client_id);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return this.tokens.verifyAccessToken(token);
  }

  private async issueTokens(sub: string, clientId: string): Promise<OAuthTokens> {
    const accessToken = await this.tokens.signAccessToken(sub, clientId);
    const refreshToken = this.genId();
    await this.store.saveRefresh({ token: refreshToken, sub, clientId });
    return {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: 3600,
      refresh_token: refreshToken,
      scope: 'mediawiki',
    };
  }
}
