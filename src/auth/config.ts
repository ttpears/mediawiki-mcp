/**
 * OAuth connector configuration, parsed from environment variables.
 *
 * Only used when MEDIAWIKI_MCP_AUTH=oauth. The stdio and LibreChat header-HTTP
 * paths never call loadOAuthConfig.
 *
 * Auth model: the broker authenticates the user via Microsoft Entra (OIDC), then
 * runs wiki actions on the per-wiki bot accounts (MEDIAWIKI_USERNAME_/PASSWORD_ vars),
 * attributed to the Entra user. Any tenant member can read; only users carrying the
 * write app-role can use write tools. No Extension:OAuth needed on the wikis.
 */
export interface OAuthConfig {
  /** Public base URL of this MCP server, no trailing slash (e.g. https://mcp.example.com). */
  publicUrl: string;
  /** Host portion of publicUrl, used to namespace shared-Redis keys. */
  issuerHost: string;
  /** Entra (Azure AD) tenant id. */
  tenantId: string;
  /** Entra app (client) id. */
  clientId: string;
  /** Entra app client secret (confidential web app). */
  clientSecret: string;
  /** Entra app-role name that grants write access (e.g. "Writer"). Read is open to any member. */
  writeRole: string;
  /** Redis URL for shared broker state (redis://[:pass@]host:port). Omit to fall
   *  back to in-memory state (single instance only — like the sibling connectors). */
  redisUrl?: string;
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

  // Entra app (mirrors the bookstack-mcp variable names so the app can be shared).
  const tenantId = required(env, 'OAUTH_TENANT_ID');
  const clientId = required(env, 'OAUTH_CLIENT_ID');
  const clientSecret = required(env, 'OAUTH_CLIENT_SECRET');
  const writeRole = env.OAUTH_WRITE_ROLE?.trim() || 'Writer';

  const redisUrl = env.REDIS_URL?.trim() || undefined;
  const jwtSecret = required(env, 'MEDIAWIKI_MCP_JWT_SECRET');

  const allowedHostsRaw = env.MEDIAWIKI_MCP_ALLOWED_HOSTS?.trim();
  const allowedHosts = allowedHostsRaw
    ? allowedHostsRaw.split(',').map((h) => h.trim()).filter((h) => h.length > 0)
    : undefined;

  return {
    publicUrl,
    issuerHost,
    tenantId,
    clientId,
    clientSecret,
    writeRole,
    redisUrl,
    jwtSecret,
    trustProxy: env.MEDIAWIKI_MCP_TRUST_PROXY === '1' || env.MEDIAWIKI_MCP_TRUST_PROXY === 'true',
    allowedHosts,
    scopesSupported: ['mediawiki'],
  };
}
