import { describe, it, expect } from 'vitest';
import { loadOAuthConfig, isOAuthMode } from '../../src/auth/config.js';

const KEY_B64 = Buffer.alloc(32, 7).toString('base64');

function validEnv(): Record<string, string> {
  return {
    MEDIAWIKI_MCP_AUTH: 'oauth',
    MEDIAWIKI_MCP_PUBLIC_URL: 'https://mcp.example.com/',
    MEDIAWIKI_OAUTH_WIKI: 'Docs',
    MEDIAWIKI_OAUTH_CLIENT_ID: 'client-abc',
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
    expect(cfg.wiki).toBe('Docs');
    expect(cfg.clientId).toBe('client-abc');
    expect(cfg.clientSecret).toBeUndefined(); // public PKCE by default
    expect(cfg.redisUrl).toBe('redis://:pass@redis:6379');
    expect(cfg.encryptionKey).toBeInstanceOf(Buffer);
    expect(cfg.encryptionKey).toHaveLength(32);
    expect(cfg.jwtSecret).toBe('jwt-signing-secret');
    expect(cfg.trustProxy).toBe(false);
    expect(cfg.allowedHosts).toBeUndefined();
    expect(cfg.scopesSupported).toEqual(['mediawiki']);
  });

  it('reads optional secret, trust proxy, and allowed hosts', () => {
    const env = validEnv();
    env.MEDIAWIKI_OAUTH_CLIENT_SECRET = 'secret-xyz';
    env.MEDIAWIKI_MCP_TRUST_PROXY = '1';
    env.MEDIAWIKI_MCP_ALLOWED_HOSTS = 'mcp.example.com, localhost';
    const cfg = loadOAuthConfig(env);
    expect(cfg.clientSecret).toBe('secret-xyz');
    expect(cfg.trustProxy).toBe(true);
    expect(cfg.allowedHosts).toEqual(['mcp.example.com', 'localhost']);
  });

  it('throws naming a missing required variable', () => {
    const env = validEnv();
    delete env.MEDIAWIKI_OAUTH_CLIENT_ID;
    expect(() => loadOAuthConfig(env)).toThrow('MEDIAWIKI_OAUTH_CLIENT_ID');
  });

  it('throws when the encryption key is not 32 bytes', () => {
    const env = validEnv();
    env.MEDIAWIKI_MCP_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString('base64');
    expect(() => loadOAuthConfig(env)).toThrow(/32 bytes/);
  });
});
