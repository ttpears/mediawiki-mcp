import { describe, it, expect, vi } from 'vitest';
import { MediaWikiOAuthClient } from '../../src/auth/mediawiki-oauth.js';

function makeClient(http: { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> }) {
  return new MediaWikiOAuthClient(
    'https://wiki.example.com/',
    'consumer-id',
    'consumer-secret',
    'https://mcp.example.com/callback',
    http as never
  );
}

describe('MediaWikiOAuthClient', () => {
  it('builds an authorize URL with the right path and params', () => {
    const client = makeClient({ get: vi.fn(), post: vi.fn() });
    const url = new URL(client.buildAuthorizeUrl('st4te', 'chal'));
    expect(url.pathname).toBe('/rest.php/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('consumer-id');
    expect(url.searchParams.get('redirect_uri')).toBe('https://mcp.example.com/callback');
    expect(url.searchParams.get('state')).toBe('st4te');
    expect(url.searchParams.get('code_challenge')).toBe('chal');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });

  it('exchanges an authorization code for tokens', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { access_token: 'a', refresh_token: 'r', expires_in: 3600 },
    });
    const client = makeClient({ get: vi.fn(), post });
    const tokens = await client.exchangeCode('the-code', 'verifier');

    expect(tokens).toEqual({ accessToken: 'a', refreshToken: 'r', expiresIn: 3600 });
    const [url, body, config] = post.mock.calls[0];
    expect(url).toBe('https://wiki.example.com/rest.php/oauth2/access_token');
    expect(config.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('code_verifier')).toBe('verifier');
    expect(form.get('client_secret')).toBe('consumer-secret');
  });

  it('refreshes tokens', async () => {
    const post = vi.fn().mockResolvedValue({
      data: { access_token: 'a2', refresh_token: 'r2', expires_in: 3600 },
    });
    const client = makeClient({ get: vi.fn(), post });
    const tokens = await client.refresh('old-refresh');
    expect(tokens.accessToken).toBe('a2');
    const form = new URLSearchParams(post.mock.calls[0][1] as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('old-refresh');
  });

  it('fetches identity with a bearer token', async () => {
    const get = vi.fn().mockResolvedValue({ data: { sub: 42, username: 'Alice' } });
    const client = makeClient({ get, post: vi.fn() });
    const id = await client.fetchIdentity('access-tok');
    expect(id).toEqual({ sub: '42', username: 'Alice' });
    const [url, config] = get.mock.calls[0];
    expect(url).toBe('https://wiki.example.com/rest.php/oauth2/resource/profile');
    expect(config.headers.Authorization).toBe('Bearer access-tok');
  });
});
