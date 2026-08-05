import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { createHTTPServer } from '../src/http-transport.js';
import { WikiRegistry } from '../src/wiki-registry.js';

function initializeBody() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  };
}

function pingBody(id: number) {
  return { jsonrpc: '2.0', id, method: 'ping' };
}

function registry(): WikiRegistry {
  const reg = new WikiRegistry();
  reg.addWiki({ name: 'Docs', baseUrl: 'https://docs.example.com' });
  return reg;
}

async function initSession(server: Server): Promise<string> {
  const res = await request(server)
    .post('/mcp')
    .set('Accept', 'application/json, text/event-stream')
    .set('Content-Type', 'application/json')
    .send(initializeBody());
  expect(res.status).toBe(200);
  return res.headers['mcp-session-id'] as string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('HTTP transport session idle TTL / capacity (POST, GET, DELETE parity)', () => {
  let server: Server | undefined;

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  it('GET reports 404 once a session has idled past the TTL, same as a fresh unknown id', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1', undefined, {
      idleTtlMs: 60,
      maxSessions: 10,
      sweepIntervalMs: 100_000, // sweep parked far out; only the lazy-expiry backstop can catch this
    });

    const sessionId = await initSession(server);
    await wait(150);

    const res = await request(server).get('/mcp').set('mcp-session-id', sessionId);
    expect(res.status).toBe(404);
  });

  it('DELETE reports 404 once a session has idled past the TTL, same as GET', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1', undefined, {
      idleTtlMs: 60,
      maxSessions: 10,
      sweepIntervalMs: 100_000,
    });

    const sessionId = await initSession(server);
    await wait(150);

    const res = await request(server).delete('/mcp').set('mcp-session-id', sessionId);
    expect(res.status).toBe(404);
  });

  it('repeated POST activity touches the session so it survives past a single idle-TTL window', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1', undefined, {
      idleTtlMs: 120,
      maxSessions: 10,
      sweepIntervalMs: 100_000,
    });

    const sessionId = await initSession(server);

    // Each gap is well under the TTL, so touching on every request must keep it alive
    // even though the cumulative elapsed time exceeds the TTL several times over.
    for (let i = 0; i < 3; i++) {
      await wait(70);
      const res = await request(server)
        .post('/mcp')
        .set('mcp-session-id', sessionId)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(pingBody(i + 2));
      expect(res.status).toBe(200);
    }

    // Now stop touching it and let it idle out for real.
    await wait(200);
    const res = await request(server).get('/mcp').set('mcp-session-id', sessionId);
    expect(res.status).toBe(404);
  });

  it('rejects a new initialize request once the hard session cap is reached', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1', undefined, {
      idleTtlMs: 60_000,
      maxSessions: 1,
      sweepIntervalMs: 100_000,
    });

    await initSession(server);

    const res = await request(server)
      .post('/mcp')
      .set('Accept', 'application/json, text/event-stream')
      .set('Content-Type', 'application/json')
      .send(initializeBody());

    expect(res.status).toBe(503);
    expect(res.body.error.message).toMatch(/capacity/i);
  });
});
