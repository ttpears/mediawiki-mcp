/**
 * OAuth connector configuration, parsed from environment variables.
 *
 * Only used when MEDIAWIKI_MCP_AUTH=oauth. The stdio and LibreChat header-HTTP
 * paths never call loadOAuthConfig.
 */
export interface OAuthConfig {
  /** Public base URL of this MCP server, no trailing slash (e.g. https://mcp.example.com). */
  publicUrl: string;
  /** Registered wiki name this connector brokers OAuth for. */
  wiki: string;
  /** Wiki OAuth consumer client id. */
  clientId: string;
  /** Wiki OAuth consumer client secret (confidential client). */
  clientSecret: string;
  /** Postgres connection string. */
  databaseUrl: string;
  /** 32-byte key for AES-256-GCM encryption of stored wiki tokens. */
  encryptionKey: Buffer;
  /** HS256 signing secret for broker-issued access tokens. */
  jwtSecret: string;
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
  const wiki = required(env, 'MEDIAWIKI_OAUTH_WIKI');
  const clientId = required(env, 'MEDIAWIKI_OAUTH_CLIENT_ID');
  const clientSecret = required(env, 'MEDIAWIKI_OAUTH_CLIENT_SECRET');
  const databaseUrl = required(env, 'DATABASE_URL');
  const jwtSecret = required(env, 'MEDIAWIKI_MCP_JWT_SECRET');

  const encryptionKey = Buffer.from(required(env, 'MEDIAWIKI_MCP_ENCRYPTION_KEY'), 'base64');
  if (encryptionKey.length !== 32) {
    throw new Error(
      `MEDIAWIKI_MCP_ENCRYPTION_KEY must decode to 32 bytes (got ${encryptionKey.length})`
    );
  }

  return {
    publicUrl,
    wiki,
    clientId,
    clientSecret,
    databaseUrl,
    encryptionKey,
    jwtSecret,
    scopesSupported: ['mediawiki'],
  };
}
