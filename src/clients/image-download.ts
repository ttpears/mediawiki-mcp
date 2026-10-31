import axios from 'axios';
import { VERSION } from '../version.js';

export const MAX_INLINE_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']);
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

/** Origins are operator trust boundaries; private wiki origins remain supported. */
export function imageOrigins(wikiUrls: string[], extraOrigins = ''): Set<string> {
  const origins = new Set(wikiUrls.map(value => checkedUrl(value).origin));
  for (const value of extraOrigins.split(',').map(value => value.trim()).filter(Boolean)) {
    const url = checkedUrl(value);
    if (url.pathname !== '/' || url.search || url.hash) throw new Error('Image allowlist entries must be origins');
    origins.add(url.origin);
  }
  return origins;
}

function checkedUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('Unsupported image URL');
  }
  return url;
}

export async function downloadInlineImage(value: string, allowedOrigins: ReadonlySet<string>): Promise<{ data: string; mimeType: string }> {
  let url = checkedUrl(value);
  const signal = AbortSignal.timeout(15000);
  for (let redirects = 0; redirects <= 3; redirects++) {
    if (!allowedOrigins.has(url.origin)) throw new Error('Image origin is not allowed');
    // Redirects are handled here so an allowed wiki cannot redirect into the
    // connector's private network. Keep the inherited proxy and TLS settings.
    const response = await axios.get<ArrayBuffer>(url.toString(), {
      responseType: 'arraybuffer',
      maxRedirects: 0,
      maxContentLength: MAX_INLINE_IMAGE_BYTES,
      timeout: 15000,
      signal,
      validateStatus: status => status >= 200 && status < 400,
      headers: { 'User-Agent': `MediaWiki-MCP/${VERSION}` },
    });
    if (REDIRECTS.has(response.status)) {
      const location = response.headers.location;
      if (typeof location !== 'string') throw new Error('Invalid image redirect');
      url = checkedUrl(new URL(location, url).toString());
      continue;
    }
    const mimeType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    const bytes = Buffer.from(response.data);
    if (response.status !== 200 || !IMAGE_TYPES.has(mimeType) || bytes.length > MAX_INLINE_IMAGE_BYTES) {
      throw new Error('Unsupported or oversized image response');
    }
    return { data: bytes.toString('base64'), mimeType };
  }
  throw new Error('Too many image redirects');
}
