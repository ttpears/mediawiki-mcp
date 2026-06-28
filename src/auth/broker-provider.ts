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

  /**
   * @param upstreams map of wiki name → its MediaWiki OAuth client
   * @param primaryWiki wiki used for the initial Claude login
   */
  constructor(
    private readonly store: TokenStore,
    private readonly upstreams: Map<string, MediaWikiOAuthClient>,
    private readonly primaryWiki: string,
    private readonly tokens: BrokerTokens,
    genId?: () => string
  ) {
    this.genId = genId ?? (() => randomBytes(32).toString('hex'));
  }

  private upstreamFor(wiki: string): MediaWikiOAuthClient {
    const client = this.upstreams.get(wiki);
    if (!client) {
      throw new Error(`No OAuth consumer configured for wiki "${wiki}"`);
    }
    return client;
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
      wiki: this.primaryWiki,
      kind: 'login',
      clientId: client.client_id,
      clientRedirectUri: params.redirectUri,
      clientState: params.state,
      clientCodeChallenge: params.codeChallenge,
      upstreamCodeVerifier,
      createdAt: Date.now(),
    });

    res.redirect(this.upstreamFor(this.primaryWiki).buildAuthorizeUrl(brokerState, upstreamChallenge));
  }

  /**
   * Starts lazy per-wiki consent for an already-authenticated user. Verifies the
   * signed ticket ({ sub, wiki }) and returns the upstream authorize URL to redirect to.
   */
  async beginWikiAuthorization(ticket: string): Promise<{ redirectTo: string }> {
    const { sub, wiki } = await this.tokens.verifyWikiTicket(ticket);
    const upstream = this.upstreamFor(wiki); // throws if wiki unknown
    const brokerState = this.genId();
    const upstreamCodeVerifier = this.genId();
    const upstreamChallenge = pkceChallenge(upstreamCodeVerifier);

    await this.store.savePendingAuth({
      brokerState,
      wiki,
      kind: 'lazy',
      sub,
      upstreamCodeVerifier,
      createdAt: Date.now(),
    });

    return { redirectTo: upstream.buildAuthorizeUrl(brokerState, upstreamChallenge) };
  }

  /**
   * Called by the /callback route once a wiki redirects back. Handles both the
   * initial login flow (mints a broker auth code, redirects to Claude) and lazy
   * per-wiki consent (stores the (sub, wiki) token after verifying the username
   * matches the user's primary identity). The result discriminates the two.
   */
  async handleUpstreamCallback(
    code: string,
    brokerState: string
  ): Promise<{ kind: 'login'; redirectTo: string } | { kind: 'lazy'; wiki: string }> {
    const pending = await this.store.takePendingAuth(brokerState);
    if (!pending) {
      throw new Error('Unknown or expired authorization state');
    }

    const upstream = this.upstreamFor(pending.wiki);
    const upstreamTokens = await upstream.exchangeCode(code, pending.upstreamCodeVerifier);
    const identity = await upstream.fetchIdentity(upstreamTokens.accessToken);

    if (pending.kind === 'lazy') {
      const sub = pending.sub!;
      // Token-fixation guard: the wiki identity must match the user's primary
      // identity (farm wikis are LDAP-backed, so usernames are consistent).
      const primary = await this.store.getWikiToken(sub, this.primaryWiki);
      if (!primary || primary.username !== identity.username) {
        throw new Error('Authorized wiki account does not match your identity');
      }
      await this.persistWikiToken(sub, pending.wiki, identity.username, upstreamTokens);
      return { kind: 'lazy', wiki: pending.wiki };
    }

    // login kind
    await this.persistWikiToken(identity.sub, pending.wiki, identity.username, upstreamTokens);
    const brokerCode = this.genId();
    await this.store.saveAuthCode({
      code: brokerCode,
      sub: identity.sub,
      clientId: pending.clientId!,
      clientCodeChallenge: pending.clientCodeChallenge!,
      createdAt: Date.now(),
    });

    const redirect = new URL(pending.clientRedirectUri!);
    redirect.searchParams.set('code', brokerCode);
    if (pending.clientState !== undefined) {
      redirect.searchParams.set('state', pending.clientState);
    }
    return { kind: 'login', redirectTo: redirect.toString() };
  }

  private async persistWikiToken(
    sub: string,
    wiki: string,
    username: string,
    tokens: { accessToken: string; refreshToken: string; expiresIn: number }
  ): Promise<void> {
    await this.store.saveWikiToken({
      sub,
      wiki,
      username,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: Date.now() + tokens.expiresIn * 1000,
    });
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
