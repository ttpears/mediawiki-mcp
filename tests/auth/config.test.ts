import { describe, it, expect } from 'vitest';
import { loadOAuthConfig, isOAuthMode } from '../../src/auth/config.js';

function validEnv(): Record<string, string> {
  return {
    MEDIAWIKI_MCP_AUTH: 'oauth',
    MEDIAWIKI_MCP_PUBLIC_URL: 'https://mcp.example.com/',
    OAUTH_TENANT_ID: 'tenant-123',
    OAUTH_CLIENT_ID: 'client-abc',
    OAUTH_CLIENT_SECRET: 'secret-xyz',
    REDIS_URL: 'redis://:pass@redis:6379',
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
    expect(cfg.tenantId).toBe('tenant-123');
    expect(cfg.clientId).toBe('client-abc');
    expect(cfg.clientSecret).toBe('secret-xyz');
    expect(cfg.writeRole).toBe('Writer'); // default
    expect(cfg.redisUrl).toBe('redis://:pass@redis:6379');
    expect(cfg.jwtSecret).toBe('jwt-signing-secret');
    expect(cfg.trustProxy).toBe(false);
    expect(cfg.allowedHosts).toBeUndefined();
    expect(cfg.scopesSupported).toEqual(['mediawiki']);
  });

  it('reads write role, trust proxy, and allowed hosts', () => {
    const env = validEnv();
    env.OAUTH_WRITE_ROLE = 'WikiEditor';
    env.MEDIAWIKI_MCP_TRUST_PROXY = '1';
    env.MEDIAWIKI_MCP_ALLOWED_HOSTS = 'mcp.example.com, localhost';
    const cfg = loadOAuthConfig(env);
    expect(cfg.writeRole).toBe('WikiEditor');
    expect(cfg.trustProxy).toBe(true);
    expect(cfg.allowedHosts).toEqual(['mcp.example.com', 'localhost']);
  });

  it('throws naming a missing required variable', () => {
    const env = validEnv();
    delete env.OAUTH_CLIENT_ID;
    expect(() => loadOAuthConfig(env)).toThrow('OAUTH_CLIENT_ID');
  });
});
