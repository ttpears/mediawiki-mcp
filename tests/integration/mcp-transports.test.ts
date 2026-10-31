import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHTTPServer } from '../../dist/http-transport.js';
import { WikiRegistry } from '../../dist/wiki-registry.js';
import { environment, serverEnvironment } from './environment.js';

let wikiUrl: string;
let client: Client | undefined;
let server: Server | undefined;
let httpTransport: StreamableHTTPClientTransport | undefined;
beforeAll(async () => { ({ wikiUrl } = await environment()); });
afterEach(async () => {
  await httpTransport?.terminateSession();
  await client?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  client = undefined; server = undefined; httpTransport = undefined;
});

async function call(name: string, args: Record<string, unknown> = {}): Promise<string> {
  const result = await client!.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[]).filter(item => item.type === 'text').map(item => item.text).join('\n');
  expect(result.isError, text).not.toBe(true);
  return text;
}

describe('built MCP server against an automatically installed MediaWiki', () => {
  it.each(['stdio', 'http'])('authenticates, reads and writes through %s', async mode => {
    client = new Client({ name: 'integration-fixture', version: '1' });
    const env = serverEnvironment(wikiUrl);
    if (mode === 'stdio') {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'], env, stderr: 'pipe' }));
    } else {
      server = await createHTTPServer(WikiRegistry.fromEnvironment(env), 0, '127.0.0.1');
      const port = (server.address() as { port: number }).port;
      const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
      expect(health.status).toBe('ok');
      httpTransport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`));
      await client.connect(httpTransport);
    }
    const tools = await client.listTools();
    expect(tools.tools.map(tool => tool.name)).toContain('get-page');
    expect(await call('list-wikis')).toContain('authenticated as FixtureAdmin');
    const title = `MCP fixture ${mode} ${randomUUID().slice(0, 8)}`;
    expect(await call('create-page', { title, content: '== Integration fixture ==\nOriginal content.\n', summary: 'Create disposable fixture' })).toContain(title);
    expect(await call('get-page', { title })).toContain('Original content.');
    expect(await call('find-page', { query: title })).toContain(title);
    await call('update-page', { title, append: '\nVerified append.\n', summary: 'Exercise Action API edit' });
    const updated = await call('get-page', { title });
    expect(updated).toContain('Original content.');
    expect(updated).toContain('Verified append.');
    expect(await call('get-page-history', { title })).toContain('Revision history');
  });
});
