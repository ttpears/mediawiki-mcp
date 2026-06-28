/**
 * OAuth connector configuration, parsed from environment variables.
 *
 * Only used when MEDIAWIKI_MCP_AUTH=oauth. The stdio and LibreChat header-HTTP
 * paths never call loadOAuthConfig.
 */
/** One farm wiki's OAuth consumer. */
export interface WikiOAuthConsumer {
  /** Registered wiki name (matches MEDIAWIKI_WIKIS). */
  name: string;
  /** Wiki OAuth consumer client id. */
  clientId: string;
  /** Consumer client secret. Omitted for public PKCE consumers. */
  clientSecret?: string;
}

export interface OAuthConfig {
  /** Public base URL of this MCP server, no trailing slash (e.g. https://mcp.example.com). */
  publicUrl: string;
  /** Host portion of publicUrl, used to namespace shared-Redis keys. */
  issuerHost: string;
  /** OAuth-enabled farm wikis, each with its own consumer. */
  wikis: WikiOAuthConsumer[];
  /** Wiki used for the initial Claude login (must be one of `wikis`). */
  primaryWiki: string;
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

  // OAuth-enabled wikis: MEDIAWIKI_OAUTH_WIKIS=itops,tech,... each with a
  // MEDIAWIKI_OAUTH_CLIENT_ID_<WIKI> (+ optional _SECRET_<WIKI>).
  const wikiNames = required(env, 'MEDIAWIKI_OAUTH_WIKIS')
    .split(',').map((w) => w.trim()).filter((w) => w.length > 0);
  if (wikiNames.length === 0) {
    throw new Error('MEDIAWIKI_OAUTH_WIKIS must list at least one wiki');
  }
  const wikis: WikiOAuthConsumer[] = wikiNames.map((name) => {
    const upper = name.toUpperCase();
    return {
      name,
      clientId: required(env, `MEDIAWIKI_OAUTH_CLIENT_ID_${upper}`),
      clientSecret: env[`MEDIAWIKI_OAUTH_CLIENT_SECRET_${upper}`]?.trim() || undefined,
    };
  });

  const primaryWiki = env.MEDIAWIKI_OAUTH_PRIMARY_WIKI?.trim() || wikiNames[0];
  if (!wikis.some((w) => w.name === primaryWiki)) {
    throw new Error(`MEDIAWIKI_OAUTH_PRIMARY_WIKI "${primaryWiki}" is not in MEDIAWIKI_OAUTH_WIKIS`);
  }

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
    wikis,
    primaryWiki,
    redisUrl,
    encryptionKey,
    jwtSecret,
    trustProxy: env.MEDIAWIKI_MCP_TRUST_PROXY === '1' || env.MEDIAWIKI_MCP_TRUST_PROXY === 'true',
    allowedHosts,
    scopesSupported: ['mediawiki'],
  };
}
