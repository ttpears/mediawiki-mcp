import { describe, it, expect, vi } from 'vitest';
import { EntraOIDCClient } from '../../src/auth/entra-oidc.js';

function makeIdToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64({ alg: 'RS256' })}.${b64(claims)}.sig`;
}

function makeClient(post: ReturnType<typeof vi.fn>) {
  return new EntraOIDCClient('tenant-1', 'client-1', 'secret-1', 'https://mcp.example.com/callback', { post } as never);
}

describe('EntraOIDCClient', () => {
  it('builds an authorize URL against the tenant', () => {
    const url = new URL(makeClient(vi.fn()).buildAuthorizeUrl('st4te', 'chal'));
    expect(url.origin + url.pathname).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/authorize');
    expect(url.searchParams.get('client_id')).toBe('client-1');
    expect(url.searchParams.get('redirect_uri')).toBe('https://mcp.example.com/callback');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('scope')).toBe('openid profile email');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('exchanges a code and derives identity + roles from the id_token', async () => {
    const idToken = makeIdToken({
      oid: 'oid-123',
      preferred_username: 'alice@example.com',
      roles: ['Writer', 'Reader'],
    });
    const post = vi.fn().mockResolvedValue({ data: { id_token: idToken, access_token: 'a' } });
    const id = await makeClient(post).exchangeCode('the-code', 'verifier');

    expect(id).toEqual({ sub: 'oid-123', username: 'alice@example.com', roles: ['Writer', 'Reader'] });
    const [url, body] = post.mock.calls[0];
    expect(url).toBe('https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token');
    const form = new URLSearchParams(body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code_verifier')).toBe('verifier');
    expect(form.get('client_secret')).toBe('secret-1');
  });

  it('defaults roles to empty when the token has none', async () => {
    const idToken = makeIdToken({ sub: 'sub-9', email: 'bob@example.com' });
    const post = vi.fn().mockResolvedValue({ data: { id_token: idToken, access_token: 'a' } });
    const id = await makeClient(post).exchangeCode('c', 'v');
    expect(id).toEqual({ sub: 'sub-9', username: 'bob@example.com', roles: [] });
  });
});
