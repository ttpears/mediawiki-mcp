import { SignJWT, jwtVerify } from 'jose';
import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';

/**
 * Issues and verifies the broker's own access tokens (HS256 JWTs). These are the
 * tokens handed to the MCP client; they are audience-bound to this server so the
 * resource server can reject tokens minted for anyone else. The user's wiki `sub`
 * is carried so requests can look up the stored wiki token.
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

  async signAccessToken(sub: string, clientId: string, ttlSeconds = 3600): Promise<string> {
    return new SignJWT({ client_id: clientId, scope: this.scopes.join(' ') })
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
      extra: { sub: payload.sub },
    };
  }
}
