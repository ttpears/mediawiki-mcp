import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';
import request from 'supertest';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createHTTPServer } from '../src/http-transport.js';
import { WikiRegistry } from '../src/wiki-registry.js';

const initialize = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
};

describe('HTTP transport error responses', () => {
  let server: Server;

  afterEach(() => {
    vi.restoreAllMocks();
    server?.close();
  });

  async function start() {
    const registry = new WikiRegistry();
    registry.addWiki({ name: 'Docs', baseUrl: 'https://docs.example.com' });
    server = await createHTTPServer(registry, 0, '127.0.0.1');
  }

  function post() {
    return request(server).post('/mcp')
      .set('Accept', 'application/json, text/event-stream');
  }

  it('returns a generic JSON-RPC internal error when initialization transport rejects', async () => {
    await start();
    vi.spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest')
      .mockRejectedValueOnce(new Error('private upstream details'));
    const res = await post().send(initialize).timeout(2000);
    expect(res.status).toBe(500);
    expect(res.type).toBe('application/json');
    expect(res.body).toEqual({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: 1 });
  });

  it('forwards a server.connect rejection to the same handler', async () => {
    await start();
    vi.spyOn(McpServer.prototype, 'connect').mockRejectedValueOnce(new Error('connect failed'));
    const res = await post().send(initialize).timeout(2000);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe(-32603);
  });

  it.each(['POST', 'GET', 'DELETE'] as const)('handles a rejecting existing-session %s transport', async (method) => {
    await start();
    const init = await post().send(initialize);
    expect(init.status).toBe(200);
    vi.spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest')
      .mockRejectedValueOnce(new Error('transport failed'));
    const pending = method === 'POST' ? post().send({ jsonrpc: '2.0', id: 'ping-id', method: 'ping' })
      : method === 'GET' ? request(server).get('/mcp') : request(server).delete('/mcp');
    const res = await pending.set('mcp-session-id', init.headers['mcp-session-id']).timeout(2000);
    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' },
      id: method === 'POST' ? 'ping-id' : null,
    });
  });

  it('closes a failed SSE stream after headers are sent without writing a second response', async () => {
    await start();
    const init = await post().send(initialize);
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(StreamableHTTPServerTransport.prototype, 'handleRequest').mockImplementationOnce(async (_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('event: message\ndata: {}\n\n');
      throw new Error('stream failed');
    });
    await expect(request(server).get('/mcp').set('mcp-session-id', init.headers['mcp-session-id'])
      .timeout(2000)).rejects.toThrow(/aborted|socket hang up/);
    expect(errorLog.mock.calls.flat().join(' ')).not.toContain('ERR_HTTP_HEADERS_SENT');
  });

  it('keeps malformed JSON a 400 parse error', async () => {
    await start();
    const res = await post().set('Content-Type', 'application/json').send('{invalid');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
  });

  it('keeps oversized JSON a 413 client error', async () => {
    await start();
    const res = await post().send({ data: 'x'.repeat(110_000) });
    expect(res.status).toBe(413);
    expect(res.body.error.message).toBe('Request body too large');
  });
});
