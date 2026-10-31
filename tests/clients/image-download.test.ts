import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { gzipSync } from 'node:zlib';
import { downloadInlineImage, imageOrigins, MAX_INLINE_IMAGE_BYTES } from '../../src/clients/image-download.js';
import { registerFileTools } from '../../src/tools/file-tools.js';

let wiki: Server;
let internal: Server;
let wikiOrigin: string;
let internalOrigin: string;
let internalRequests: number;

async function listen(server: Server): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

beforeEach(async () => {
  internalRequests = 0;
  internal = createServer((_req, res) => {
    internalRequests++;
    res.setHeader('Content-Type', 'image/png');
    res.end('private-fixture');
  });
  internalOrigin = await listen(internal);
  wiki = createServer((req, res) => {
    if (req.url === '/redirect-private') {
      res.writeHead(302, { Location: `${internalOrigin}/secret` }).end();
    } else if (req.url === '/relative') {
      res.writeHead(302, { Location: '/image' }).end();
    } else if (req.url === '/loop') {
      res.writeHead(302, { Location: '/loop' }).end();
    } else if (req.url === '/large' || req.url === '/compressed') {
      const bytes = Buffer.alloc(MAX_INLINE_IMAGE_BYTES + 1);
      res.setHeader('Content-Type', 'image/png');
      if (req.url === '/compressed') {
        res.setHeader('Content-Encoding', 'gzip');
        res.end(gzipSync(bytes));
      } else res.end(bytes);
    } else if (req.url === '/html') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html>not an image</html>');
    } else {
      res.setHeader('Content-Type', 'image/png');
      res.end('wiki-image-fixture');
    }
  });
  wikiOrigin = await listen(wiki);
});

afterEach(async () => {
  await Promise.all([wiki, internal].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
});

describe('inline image security policy', () => {
  it('supports explicitly configured private wiki origins and relative redirects', async () => {
    const image = await downloadInlineImage(`${wikiOrigin}/relative`, imageOrigins([`${wikiOrigin}/wiki`]));
    expect(image.mimeType).toBe('image/png');
    expect(Buffer.from(image.data, 'base64').toString()).toBe('wiki-image-fixture');
  });

  it('rejects untrusted internal destinations before making a request', async () => {
    await expect(downloadInlineImage(`${internalOrigin}/secret`, imageOrigins([wikiOrigin]))).rejects.toThrow(/origin/);
    expect(internalRequests).toBe(0);
  });

  it('validates redirect targets before contacting another origin', async () => {
    await expect(downloadInlineImage(`${wikiOrigin}/redirect-private`, imageOrigins([wikiOrigin]))).rejects.toThrow(/origin/);
    expect(internalRequests).toBe(0);
  });

  it('permits an additional origin only when explicitly allowed by the operator', async () => {
    const image = await downloadInlineImage(`${wikiOrigin}/redirect-private`, imageOrigins([wikiOrigin], internalOrigin));
    expect(Buffer.from(image.data, 'base64').toString()).toBe('private-fixture');
    expect(internalRequests).toBe(1);
  });

  it.each(['/large', '/compressed'])('bounds decoded response bytes for %s', async path => {
    await expect(downloadInlineImage(`${wikiOrigin}${path}`, imageOrigins([wikiOrigin]))).rejects.toThrow(/maxContentLength|oversized/);
  });

  it('bounds redirects and refuses non-image responses', async () => {
    await expect(downloadInlineImage(`${wikiOrigin}/loop`, imageOrigins([wikiOrigin]))).rejects.toThrow(/redirects/);
    await expect(downloadInlineImage(`${wikiOrigin}/html`, imageOrigins([wikiOrigin]))).rejects.toThrow(/Unsupported/);
  });

  it.each(['file:///etc/passwd', 'http://user:password@example.com/image', 'ftp://example.com/image'])('rejects unsupported URL %s', async value => {
    await expect(downloadInlineImage(value, imageOrigins([wikiOrigin]))).rejects.toThrow();
  });

  it('compares normalized origins exactly and rejects allowlist paths', async () => {
    await expect(downloadInlineImage('http://wiki.example.com.evil.invalid/image', imageOrigins(['https://wiki.example.com']))).rejects.toThrow(/origin/);
    expect(() => imageOrigins([wikiOrigin], `${internalOrigin}/secret`)).toThrow(/origins/);
  });

  it('get-file retains metadata when a read-only session receives an unsafe image URL', async () => {
    let handler: (args: { title: string }) => Promise<{ content: { type: string; text?: string }[] }>;
    const orchestrator = {
      getRegistry: () => ({ getAllWikis: () => [{ baseUrl: wikiOrigin }] }),
      getFile: async () => ({ wiki: 'Docs', file: {
        title: 'fixture', file_description_url: `${wikiOrigin}/file`, latest: { timestamp: 'now', user: { name: 'fixture' } },
        original: { url: `${wikiOrigin}/image`, mediatype: 'BITMAP', size: 15, width: 1, height: 1 },
        preferred: { url: `${internalOrigin}/secret` },
      } }),
    };
    registerFileTools({ tool: (_name: string, _description: string, _schema: unknown, callback: typeof handler) => { handler = callback; } } as never, {
      orchestrator: orchestrator as never, canWrite: false,
    });
    const result = await handler!({ title: 'fixture' });
    expect(result.content.map(c => c.type)).toEqual(['text']);
    expect(result.content[0].text).toContain('Could not fetch image data');
    expect(internalRequests).toBe(0);
  });
});
