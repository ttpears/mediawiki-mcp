import { describe, it, expect } from 'vitest';
import { BrokerTokens } from '../../src/auth/tokens.js';
import { SignJWT } from 'jose';

const AUD = 'https://mcp.example.com/mcp';

describe('BrokerTokens', () => {
  it('signs and verifies an access token carrying identity + write flag', async () => {
    const t = new BrokerTokens('secret', AUD, ['mediawiki']);
    const token = await t.signAccessToken('user-1', 'client-1', { username: 'alice@example.com', canWrite: true });
    const info = await t.verifyAccessToken(token);
    expect(info.extra?.sub).toBe('user-1');
    expect(info.extra?.username).toBe('alice@example.com');
    expect(info.extra?.canWrite).toBe(true);
    expect(info.clientId).toBe('client-1');
    expect(info.scopes).toEqual(['mediawiki']);
    expect(info.resource?.toString()).toBe(AUD);
  });

  it('defaults canWrite to false when not granted', async () => {
    const t = new BrokerTokens('secret', AUD, ['mediawiki']);
    const token = await t.signAccessToken('u', 'c', { username: 'bob', canWrite: false });
    const info = await t.verifyAccessToken(token);
    expect(info.extra?.canWrite).toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const signer = new BrokerTokens('secret-a', AUD, ['mediawiki']);
    const verifier = new BrokerTokens('secret-b', AUD, ['mediawiki']);
    const token = await signer.signAccessToken('u', 'c', { username: 'x', canWrite: false });
    await expect(verifier.verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects a token with the wrong audience', async () => {
    const signer = new BrokerTokens('secret', 'https://evil.example.com/mcp', ['mediawiki']);
    const verifier = new BrokerTokens('secret', AUD, ['mediawiki']);
    const token = await signer.signAccessToken('u', 'c', { username: 'x', canWrite: false });
    await expect(verifier.verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const t = new BrokerTokens('secret', AUD, ['mediawiki']);
    const token = await t.signAccessToken('u', 'c', { username: 'x', canWrite: false }, -10);
    await expect(t.verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects a token without an expiration even when its signature is valid', async () => {
    const token = await new SignJWT({ client_id: 'c' }).setProtectedHeader({ alg: 'HS256' })
      .setSubject('u').setAudience(AUD).setIssuedAt().sign(new TextEncoder().encode('secret'));
    await expect(new BrokerTokens('secret', AUD, ['mediawiki']).verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects another HMAC algorithm even when signed with the same secret', async () => {
    const token = await new SignJWT({ client_id: 'c' }).setProtectedHeader({ alg: 'HS384' })
      .setSubject('u').setAudience(AUD).setIssuedAt().setExpirationTime('1h').sign(new TextEncoder().encode('secret'));
    await expect(new BrokerTokens('secret', AUD, ['mediawiki']).verifyAccessToken(token)).rejects.toThrow();
  });
});
