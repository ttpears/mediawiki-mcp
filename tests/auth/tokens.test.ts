import { describe, it, expect } from 'vitest';
import { BrokerTokens } from '../../src/auth/tokens.js';

const AUD = 'https://mcp.example.com/mcp';

describe('BrokerTokens', () => {
  it('signs and verifies an access token', async () => {
    const t = new BrokerTokens('secret', AUD, ['mediawiki']);
    const token = await t.signAccessToken('user-1', 'client-1');
    const info = await t.verifyAccessToken(token);
    expect(info.extra?.sub).toBe('user-1');
    expect(info.clientId).toBe('client-1');
    expect(info.scopes).toEqual(['mediawiki']);
    expect(info.resource?.toString()).toBe(AUD);
  });

  it('rejects a token signed with a different secret', async () => {
    const signer = new BrokerTokens('secret-a', AUD, ['mediawiki']);
    const verifier = new BrokerTokens('secret-b', AUD, ['mediawiki']);
    const token = await signer.signAccessToken('u', 'c');
    await expect(verifier.verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects a token with the wrong audience', async () => {
    const signer = new BrokerTokens('secret', 'https://evil.example.com/mcp', ['mediawiki']);
    const verifier = new BrokerTokens('secret', AUD, ['mediawiki']);
    const token = await signer.signAccessToken('u', 'c');
    await expect(verifier.verifyAccessToken(token)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const t = new BrokerTokens('secret', AUD, ['mediawiki']);
    const token = await t.signAccessToken('u', 'c', -10); // already expired
    await expect(t.verifyAccessToken(token)).rejects.toThrow();
  });

  it('signs and verifies a wiki ticket, isolated from access tokens', async () => {
    const t = new BrokerTokens('secret', AUD, ['mediawiki']);
    const ticket = await t.signWikiTicket('u1', 'Ops');
    expect(await t.verifyWikiTicket(ticket)).toEqual({ sub: 'u1', wiki: 'Ops' });
    // a wiki ticket must not validate as an access token (different audience)...
    await expect(t.verifyAccessToken(ticket)).rejects.toThrow();
    // ...and an access token must not validate as a wiki ticket
    const access = await t.signAccessToken('u1', 'c1');
    await expect(t.verifyWikiTicket(access)).rejects.toThrow();
  });
});
