import { SignJWT, jwtVerify } from 'jose';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

export interface BrokerClaims {
  /** Human-readable identity, used for wiki edit attribution. */
  username: string;
  /** Whether the user holds the Entra write role. */
  canWrite: boolean;
}

/**
 * Issues and verifies the broker's own access tokens (HS256 JWTs), handed to the
 * MCP client. Audience-bound to this server. Carries the Entra user id (`sub`),
 * a display `username` for attribution, and the `canWrite` flag from the user's
 * Entra app role.
 */
export class BrokerTokens {
  private readonly key: Uint8Array;

  constructor(
    jwtSecret: string,
    private readonly audience: string,
    private readonly scopes: string[]
  ) {
    this.key = new TextEncoder().encode(jwtSecret);
  }

  async signAccessToken(
    sub: string,
    clientId: string,
    claims: BrokerClaims,
    ttlSeconds = 3600
  ): Promise<string> {
    return new SignJWT({
      client_id: clientId,
      scope: this.scopes.join(' '),
      username: claims.username,
      can_write: claims.canWrite,
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setAudience(this.audience)
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const { payload } = await jwtVerify(token, this.key, { audience: this.audience });
    return {
      token,
      clientId: (payload.client_id as string) ?? '',
      scopes: typeof payload.scope === 'string' && payload.scope.length > 0 ? payload.scope.split(' ') : [],
      expiresAt: payload.exp,
      resource: new URL(this.audience),
      extra: {
        sub: payload.sub,
        username: payload.username as string | undefined,
        canWrite: payload.can_write === true,
      },
    };
  }
}
