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

/** A token with no delegated scope is app-only (client credentials). */
function isAppOnly(payload: Record<string, unknown>): boolean {
  if (payload.idtyp === 'app') return true;
  return typeof payload.scp !== 'string' || payload.scp.trim() === '';
}

export class EntraServiceTokens {
  private readonly issuers: string[];
  private readonly audiences: Set<string>;
  private readonly keys: JWTVerifyGetKey;

  constructor(private readonly cfg: ServiceTokenConfig, keys?: JWTVerifyGetKey) {
    const base = `https://login.microsoftonline.com/${cfg.tenantId}`;
    this.issuers = [`${base}/v2.0`, `https://sts.windows.net/${cfg.tenantId}/`];
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
    const appId = typeof payload.azp === 'string' ? payload.azp
      : typeof payload.appid === 'string' ? payload.appid : '';
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
