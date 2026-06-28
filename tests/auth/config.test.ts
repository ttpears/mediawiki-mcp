import { describe, it, expect } from 'vitest';
import { loadOAuthConfig, isOAuthMode } from '../../src/auth/config.js';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

function validEnv(): Record<string, string> {
  return {
    MEDIAWIKI_MCP_AUTH: 'oauth',
    MEDIAWIKI_MCP_PUBLIC_URL: 'https://mcp.example.com/',
    MEDIAWIKI_OAUTH_WIKIS: 'Docs,Ops',
    MEDIAWIKI_OAUTH_CLIENT_ID_DOCS: 'client-docs',
    MEDIAWIKI_OAUTH_CLIENT_ID_OPS: 'client-ops',
    MEDIAWIKI_OAUTH_PRIMARY_WIKI: 'Docs',
    REDIS_URL: 'redis://:pass@redis:6379',
    MEDIAWIKI_MCP_ENCRYPTION_KEY: KEY_B64,
    MEDIAWIKI_MCP_JWT_SECRET: 'jwt-signing-secret',
  };
}

describe('isOAuthMode', () => {
  it('is true only when MEDIAWIKI_MCP_AUTH is oauth', () => {
    expect(isOAuthMode({ MEDIAWIKI_MCP_AUTH: 'oauth' })).toBe(true);
    expect(isOAuthMode({ MEDIAWIKI_MCP_AUTH: 'none' })).toBe(false);
    expect(isOAuthMode({})).toBe(false);
  });
});

describe('loadOAuthConfig', () => {
  it('parses a valid environment', () => {
    const cfg = loadOAuthConfig(validEnv());
    expect(cfg.publicUrl).toBe('https://mcp.example.com'); // trailing slash stripped
    expect(cfg.issuerHost).toBe('mcp.example.com');
    expect(cfg.wikis).toEqual([
      { name: 'Docs', clientId: 'client-docs', clientSecret: undefined },
      { name: 'Ops', clientId: 'client-ops', clientSecret: undefined },
    ]);
    expect(cfg.primaryWiki).toBe('Docs');
    expect(cfg.redisUrl).toBe('redis://:pass@redis:6379');
    expect(cfg.encryptionKey).toBeInstanceOf(Buffer);
    expect(cfg.encryptionKey).toHaveLength(32);
    expect(cfg.jwtSecret).toBe('jwt-signing-secret');
    expect(cfg.trustProxy).toBe(false);
    expect(cfg.allowedHosts).toBeUndefined();
    expect(cfg.scopesSupported).toEqual(['mediawiki']);
  });

  it('defaults the primary wiki to the first and reads per-wiki secret + proxy + hosts', () => {
    const env = validEnv();
    delete env.MEDIAWIKI_OAUTH_PRIMARY_WIKI;
    env.MEDIAWIKI_OAUTH_CLIENT_SECRET_DOCS = 'secret-xyz';
    env.MEDIAWIKI_MCP_TRUST_PROXY = '1';
    env.MEDIAWIKI_MCP_ALLOWED_HOSTS = 'mcp.example.com, localhost';
    const cfg = loadOAuthConfig(env);
    expect(cfg.primaryWiki).toBe('Docs'); // first listed
    expect(cfg.wikis[0].clientSecret).toBe('secret-xyz');
    expect(cfg.trustProxy).toBe(true);
    expect(cfg.allowedHosts).toEqual(['mcp.example.com', 'localhost']);
  });

  it('throws when the primary wiki is not in the list', () => {
    const env = validEnv();
    env.MEDIAWIKI_OAUTH_PRIMARY_WIKI = 'Nope';
    expect(() => loadOAuthConfig(env)).toThrow('MEDIAWIKI_OAUTH_PRIMARY_WIKI');
  });

  it('throws naming a missing required variable', () => {
    const env = validEnv();
    delete env.MEDIAWIKI_OAUTH_CLIENT_ID_DOCS;
    expect(() => loadOAuthConfig(env)).toThrow('MEDIAWIKI_OAUTH_CLIENT_ID_DOCS');
  });

  it('throws when the encryption key is not 32 bytes', () => {
    const env = validEnv();
    env.MEDIAWIKI_MCP_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => loadOAuthConfig(env)).toThrow(/32 bytes/);
  });
});
