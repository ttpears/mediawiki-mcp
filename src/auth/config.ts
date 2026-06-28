/**
 * OAuth connector configuration, parsed from environment variables.
 *
 * Only used when MEDIAWIKI_MCP_AUTH=oauth. The stdio and LibreChat header-HTTP
 * paths never call loadOAuthConfig.
 */
export interface OAuthConfig {
  /** Public base URL of this MCP server, no trailing slash (e.g. https://mcp.example.com). */
  publicUrl: string;
  /** Host portion of publicUrl, used to namespace shared-Redis keys. */
  issuerHost: string;
  /** Registered wiki name this connector brokers OAuth for. */
  wiki: string;
  /** Wiki OAuth consumer client id. */
  clientId: string;
  /** Wiki OAuth consumer client secret. Omitted for public PKCE consumers. */
  clientSecret?: string;
  /** Redis connection URL for shared broker state (redis://[:pass@]host:port). */
  redisUrl: string;
  /** 32-byte key for AES-256-GCM encryption of stored wiki tokens. */
  encryptionKey: Buffer;
  /** HS256 signing secret for broker-issued access tokens. */
  jwtSecret: string;
  /** Trust X-Forwarded-* (set when running behind traefik) so rate limiting keys on the real IP. */
  trustProxy: boolean;
  /** If set, only these Host headers are accepted on /mcp (plus localhost). */
  allowedHosts?: string[];
  /** Scopes advertised in authorization-server metadata. */
  scopesSupported: string[];
}

export function isOAuthMode(env: Record<string, string | undefined>): boolean {
  return env.MEDIAWIKI_MCP_AUTH === 'oauth';
}

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env: ${name}`);
  }
  return value.trim();
}

export function loadOAuthConfig(env: Record<string, string | undefined>): OAuthConfig {
  const publicUrl = required(env, 'MEDIAWIKI_MCP_PUBLIC_URL').replace(/\/+$/, '');
  const issuerHost = new URL(publicUrl).host;
  const wiki = required(env, 'MEDIAWIKI_OAUTH_WIKI');
  const clientId = required(env, 'MEDIAWIKI_OAUTH_CLIENT_ID');
  const clientSecret = env.MEDIAWIKI_OAUTH_CLIENT_SECRET?.trim() || undefined;
  const redisUrl = required(env, 'REDIS_URL');
  const jwtSecret = required(env, 'MEDIAWIKI_MCP_JWT_SECRET');

  const encryptionKey = Buffer.from(required(env, 'MEDIAWIKI_MCP_ENCRYPTION_KEY'), 'base64');
  if (encryptionKey.length !== 32) {
    throw new Error(
      `MEDIAWIKI_MCP_ENCRYPTION_KEY must decode to 32 bytes (got ${encryptionKey.length})`
    );
  }

  const allowedHostsRaw = env.MEDIAWIKI_MCP_ALLOWED_HOSTS?.trim();
  const allowedHosts = allowedHostsRaw
    ? allowedHostsRaw.split(',').map((h) => h.trim()).filter((h) => h.length > 0)
    : undefined;

  return {
    publicUrl,
    issuerHost,
    wiki,
    clientId,
    clientSecret,
    redisUrl,
    encryptionKey,
    jwtSecret,
    trustProxy: env.MEDIAWIKI_MCP_TRUST_PROXY === '1' || env.MEDIAWIKI_MCP_TRUST_PROXY === 'true',
    allowedHosts,
    scopesSupported: ['mediawiki'],
  };
}
