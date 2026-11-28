import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * Read-only access for service callers: an Entra app-only access token
 * (client credentials) for this connector's app, sent as the bearer token
 * instead of a broker-issued one. It is accepted only when it carries the
 * Application-type app role named in OAUTH_SERVICE_ROLE and its client id is
 * listed in OAUTH_SERVICE_APP_IDS; both are unset by default (off). Service
 * callers never get write tools.
 *
 * Users keep signing in through the broker: a delegated (user) Entra token is
 * refused here, so this path cannot widen what a user can do.
 */
export interface ServiceTokenConfig {
  tenantId: string;
  /** The connector's Entra app (client) id: the token's audience. */
  clientId: string;
  /** App role a service caller must carry (e.g. "Service.Read"). */
  role: string;
  /** Client ids allowed to call as a service. */
  appIds: string[];
}

/** True when the JWT header says it is an Entra token (RS256), not a broker one (HS256). */
export function looksLikeEntraToken(token: string): boolean {
  try {
    return decodeProtectedHeader(token).alg === 'RS256';
  } catch {
    return false;
  }
}

/**
 * App-only (client credentials): no delegated scope at all, and no token type
 * other than "app". Entra omits `idtyp` unless the app asks for it, so its
 * absence is allowed; an `scp` claim in any form means a user token.
 */
function isAppOnly(payload: Record<string, unknown>): boolean {
  if ('scp' in payload) return false;
  return payload.idtyp === undefined || payload.idtyp === 'app';
}

/** The calling app: `appid` in a v1 token, `azp` in a v2 token, by issuer. */
function callerAppId(payload: Record<string, unknown>, v1Issuer: string): string {
  const claim = payload.iss === v1Issuer ? payload.appid : payload.azp;
  return typeof claim === 'string' ? claim : '';
}

export class EntraServiceTokens {
  private readonly issuers: string[];
  private readonly v1Issuer: string;
  private readonly audiences: Set<string>;
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly cfg: ServiceTokenConfig, keys?: JWTVerifyGetKey) {
    const base = `https://login.microsoftonline.com/${cfg.tenantId}`;
    this.v1Issuer = `https://sts.windows.net/${cfg.tenantId}/`;
    this.issuers = [`${base}/v2.0`, this.v1Issuer];
    this.audiences = new Set([cfg.clientId, `api://${cfg.clientId}`]);
    this.keys = keys ?? createRemoteJWKSet(new URL(`${base}/discovery/v2.0/keys`));
  }

  async verify(token: string): Promise<AuthInfo> {
    const { payload } = await jwtVerify(token, this.keys, {
      issuer: this.issuers,
      algorithms: ['RS256'],
      requiredClaims: ['exp', 'iat', 'sub'],
    });
    const aud = payload.aud;
    const audOk = typeof aud === 'string' ? this.audiences.has(aud)
      : Array.isArray(aud) && aud.some((a) => this.audiences.has(a));
    if (!audOk) throw new Error('audience mismatch');
    if (!isAppOnly(payload)) throw new Error('user tokens sign in through the broker');
    const roles = Array.isArray(payload.roles) ? payload.roles.map(String) : [];
    if (!roles.includes(this.cfg.role)) throw new Error('app-only token without the service role');
    const appId = callerAppId(payload, this.v1Issuer);
    if (!appId || !this.cfg.appIds.includes(appId)) {
      throw new Error('app-only token from an app that is not allowed');
    }
    return {
      token,
      clientId: appId,
      scopes: ['mediawiki'],
      expiresAt: payload.exp,
      extra: {
        sub: `app:${payload.sub}`,
        username: `service:${appId}`,
        canWrite: false,
        service: true,
      },
    };
  }
}
