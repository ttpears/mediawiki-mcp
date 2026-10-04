import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { createHTTPServer } from '../src/http-transport.js';
import { WikiRegistry } from '../src/wiki-registry.js';

// MCP spec, Session Management: a request carrying an Mcp-Session-Id the server
// no longer knows MUST get 404, and 404 is the only signal that tells a client to
// re-initialize. 400 is reserved for a non-initialize request with no session id.

const UNKNOWN_SESSION = '00000000-0000-4000-8000-000000000000';

function initializeBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  };
}

function registry(): WikiRegistry {
  const reg = new WikiRegistry();
  reg.addWiki({ name: 'Docs', baseUrl: 'https://docs.example.com' });
  return reg;
}

function post(server: Server) {
  return request(server)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json');
}

async function initSession(server: Server): Promise<string> {
  const res = await post(server).send(initializeBody());
  expect(res.status).toBe(200);
  return res.headers['mcp-session-id'] as string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('HTTP transport: unknown or expired session ids', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('POST with an unknown session id answers 404 with JSON-RPC -32001', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1');
    const res = await post(server)
      .set('mcp-session-id', UNKNOWN_SESSION)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(-32001);
  });

  it('POST with an idle-expired session id answers 404', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1', undefined, {
      idleTtlMs: 60,
      maxSessions: 10,
      sweepIntervalMs: 100_000,
    });
    const sessionId = await initSession(server);
    await wait(150);
    const res = await post(server)
      .set('mcp-session-id', sessionId)
      .send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe(-32001);
  });

  it('a client can re-initialize after a 404 and get a working session', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1');
    const miss = await post(server)
      .set('mcp-session-id', UNKNOWN_SESSION)
      .send({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(miss.status).toBe(404);

    const sessionId = await initSession(server);
    const res = await post(server)
      .set('mcp-session-id', sessionId)
      .send({ jsonrpc: '2.0', id: 3, method: 'ping' });
    expect(res.status).toBe(200);
  });

  it('POST without a session id that is not initialize still answers 400', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1');
    const res = await post(server).send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.status).toBe(400);
  });

  it('GET and DELETE without a session id answer 400', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1');
    expect((await request(server).get('/mcp')).status).toBe(400);
    expect((await request(server).delete('/mcp')).status).toBe(400);
  });

  it('GET and DELETE with an unknown session id answer 404 with JSON-RPC -32001', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1');
    const get = await request(server).get('/mcp').set('mcp-session-id', UNKNOWN_SESSION);
    expect(get.status).toBe(404);
    expect(get.body.error.code).toBe(-32001);
    const del = await request(server).delete('/mcp').set('mcp-session-id', UNKNOWN_SESSION);
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe(-32001);
  });
});
