import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { createHTTPServer } from '../src/http-transport.js';
import { WikiRegistry } from '../src/wiki-registry.js';
import { InMemoryTokenStore } from '../src/auth/token-store.js';
import { BrokerTokens } from '../src/auth/tokens.js';

let server: Server | undefined;
afterEach(() => { server?.close(); server = undefined; });

function registry() {
  const registry = new WikiRegistry();
  registry.addWiki({ name: 'Docs', baseUrl: 'https://docs.example.com' });
  registry.addWiki({ name: 'Other', baseUrl: 'https://other.example.com' });
  return registry;
}

function rpc(result: request.Response) {
  if (result.body?.result) return result.body;
  return JSON.parse(result.text.split('\n').find(line => line.startsWith('data:'))!.slice(5));
}

async function init(token?: string) {
  const req = request(server!).post('/mcp').set('Accept', 'application/json, text/event-stream');
  if (token) req.set('Authorization', `Bearer ${token}`);
  const res = await req.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
    protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'security-test', version: '1' },
  } });
  expect(res.status).toBe(200);
  return res.headers['mcp-session-id'] as string;
}

async function call(sid: string, method: string, params: unknown, token?: string) {
  const req = request(server!).post('/mcp').set('Accept', 'application/json, text/event-stream').set('Mcp-Session-Id', sid);
  if (token) req.set('Authorization', `Bearer ${token}`);
  return req.send({ jsonrpc: '2.0', id: 2, method, params });
}

async function oauthFixture() {
  const tokens = new BrokerTokens('fixture-secret', 'https://mcp.example.com/mcp', ['mediawiki']);
  const reg = registry();
  server = await createHTTPServer(reg, 0, '127.0.0.1', {
    config: { publicUrl: 'https://mcp.example.com', jwtSecret: 'fixture-secret', scopesSupported: ['mediawiki'], writeRole: 'Writer' } as never,
    store: new InMemoryTokenStore(), entra: {} as never,
  });
  const token = (sub = 'owner', client = 'client-a', canWrite = true) => tokens.signAccessToken(sub, client, { username: sub, canWrite });
  return { reg, token };
}

describe('HTTP session security boundaries', () => {
  it('keeps wiki removal and defaults private to each non-OAuth HTTP session', async () => {
    const reg = registry();
    server = await createHTTPServer(reg, 0, '127.0.0.1');
    const first = await init();
    const second = await init();
    const changed = await call(first, 'tools/call', { name: 'remove-wiki', arguments: { name: 'Docs' } });
    expect(rpc(changed).result.isError).not.toBe(true);
    expect(reg.getDefaultWiki()?.name).toBe('Docs');
    const other = rpc(await call(second, 'tools/call', { name: 'list-wikis', arguments: {} }));
    expect(other.result.content[0].text).toContain('Docs (default)');
  });

  it.each([true, false])('omits remote wiki-management tools for OAuth canWrite=%s', async canWrite => {
    const f = await oauthFixture();
    const token = await f.token('owner', 'client-a', canWrite);
    const sid = await init(token);
    const names = rpc(await call(sid, 'tools/list', {}, token)).result.tools.map((tool: { name: string }) => tool.name);
    expect(names).toContain('list-wikis');
    for (const name of ['add-wiki', 'remove-wiki', 'set-wiki']) expect(names).not.toContain(name);
    const denied = rpc(await call(sid, 'tools/call', { name: 'remove-wiki', arguments: { name: 'Docs' } }, token));
    expect(denied.error || denied.result?.isError).toBeTruthy();
    expect(f.reg.getAllWikis()).toHaveLength(2);
  });

  it.each(['other-user', 'other-client', 'downgraded-role'])('rejects %s on POST, GET and DELETE without destroying the owner session', async kind => {
    const f = await oauthFixture();
    const owner = await f.token();
    const sid = await init(owner);
    const wrong = await f.token(kind === 'other-user' ? 'other' : 'owner', kind === 'other-client' ? 'client-b' : 'client-a', kind !== 'downgraded-role');
    expect((await call(sid, 'ping', {}, wrong)).status).toBe(403);
    for (const method of ['get', 'delete'] as const) {
      const res = await request(server!)[method]('/mcp').set('Authorization', `Bearer ${wrong}`).set('Mcp-Session-Id', sid);
      expect(res.status).toBe(403);
    }
    expect((await call(sid, 'ping', {}, owner)).status).toBe(200);
  });
});
