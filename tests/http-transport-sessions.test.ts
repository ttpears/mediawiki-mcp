import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

/**
 * Idle age is measured with `Date.now()` in SessionRegistry, so faking *only* Date
 * puts expiry entirely under the test's control while leaving real timers, sockets
 * and the supertest round-trip untouched. Nothing here races the machine: the real
 * wall-clock cost of a request contributes exactly zero to a session's idle age.
 *
 * These tests used to sleep for real against a 60-120ms TTL, which left ~50ms of
 * headroom for the whole HTTP round-trip. Under full-suite parallel load the
 * initialize response alone took 150-290ms after the session was registered, so the
 * session was already idle-expired before the first keep-alive POST landed and the
 * suite failed ~1 run in 5. See issue #11.
 */
const TTL_MS = 1_000;

describe('HTTP transport session idle TTL / capacity (POST, GET, DELETE parity)', () => {
  let server: Server | undefined;
  let clock = 0;

  /** Ages every session by `ms` without spending any real time. */
  function idleFor(ms: number): void {
    clock += ms;
    vi.setSystemTime(clock);
  }

  beforeEach(() => {
    clock = Date.now();
    // Date only — real setTimeout/setInterval keep running so express, node's http
    // server and supertest all behave normally.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(clock);
  });

  afterEach(() => {
    vi.useRealTimers();
    server?.close();
    server = undefined;
  });

  it('GET reports 404 once a session has idled past the TTL, same as a fresh unknown id', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1', undefined, {
      idleTtlMs: TTL_MS,
      maxSessions: 10,
      sweepIntervalMs: 100_000, // sweep parked far out; only the lazy-expiry backstop can catch this
    });

    const sessionId = await initSession(server);
    idleFor(TTL_MS + 1);

    const res = await request(server).get('/mcp').set('mcp-session-id', sessionId);
    expect(res.status).toBe(404);
  });

  it('DELETE reports 404 once a session has idled past the TTL, same as GET', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1', undefined, {
      idleTtlMs: TTL_MS,
      maxSessions: 10,
      sweepIntervalMs: 100_000,
    });

    const sessionId = await initSession(server);
    idleFor(TTL_MS + 1);

    const res = await request(server).delete('/mcp').set('mcp-session-id', sessionId);
    expect(res.status).toBe(404);
  });

  it('repeated POST activity touches the session so it survives past a single idle-TTL window', async () => {
    server = await createHTTPServer(registry(), 0, '127.0.0.1', undefined, {
      idleTtlMs: TTL_MS,
      maxSessions: 10,
      sweepIntervalMs: 100_000,
    });

    const sessionId = await initSession(server);

    // Each gap is well under the TTL, so touching on every request must keep it alive
    // even though the cumulative elapsed time exceeds the TTL several times over.
    const gap = Math.floor(TTL_MS * 0.75);
    for (let i = 0; i < 3; i++) {
      idleFor(gap);
      const res = await request(server)
        .post('/mcp')
        .set('mcp-session-id', sessionId)
        .set('Accept', 'application/json, text/event-stream')
        .set('Content-Type', 'application/json')
        .send(pingBody(i + 2));
      expect(res.status).toBe(200);
    }
    expect(gap * 3).toBeGreaterThan(TTL_MS); // the point of the test: cumulative age outruns the TTL

    // Now stop touching it and let it idle out for real.
    idleFor(TTL_MS + 1);
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
