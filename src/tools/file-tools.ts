import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import axios from 'axios';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

const IMAGE_MEDIATYPES = new Set(['BITMAP', 'DRAWING']);
const MIME_MAP: Record<string, string> = {
  BITMAP: 'image/png',   // fallback; prefer from URL extension
  DRAWING: 'image/svg+xml',
};

function mimeFromUrl(url: string, mediatype: string): string {
  const ext = url.split('.').pop()?.toLowerCase();
  const extMap: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp',
  };
  return extMap[ext ?? ''] ?? MIME_MAP[mediatype] ?? 'application/octet-stream';
}

export function registerFileTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'get-file',
    'Get metadata and download URLs for an uploaded file (image, PDF, etc). Returns dimensions, file size, media type, and both original and preferred-format URLs.',
    {
      title: z.string().describe('File title (with or without "File:" prefix)'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, wiki }) => {
      const result = await orchestrator.getFile(title, { wiki });

      if (!result.file) {
        return {
          content: [{ type: 'text' as const, text: `File "${title}" not found on ${result.wiki}.` }],
        };
      }

      const file = result.file;
      const lines: string[] = [
        `File: ${file.title}`,
        `Wiki: ${result.wiki}`,
        `Description URL: ${file.file_description_url}`,
        `Last modified: ${file.latest.timestamp} by ${file.latest.user.name}`,
        '',
        'Original:',
        `  Type: ${file.original.mediatype}`,
        `  Size: ${file.original.size} bytes`,
        `  Dimensions: ${file.original.width}x${file.original.height}`,
        `  URL: ${file.original.url}`,
        '',
        'Preferred:',
        `  Type: ${file.preferred.mediatype}`,
        `  Size: ${file.preferred.size ?? 'N/A'}`,
        `  Dimensions: ${file.preferred.width}x${file.preferred.height}`,
        `  URL: ${file.preferred.url}`,
      ];

      const content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> = [
        { type: 'text' as const, text: lines.join('\n') },
      ];

      // For image files, fetch and return the image data inline
      if (IMAGE_MEDIATYPES.has(file.original.mediatype)) {
        try {
          const imgUrl = file.preferred.url;
          const resp = await axios.get(imgUrl, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: { 'User-Agent': 'MediaWiki-MCP/2.0.0' },
          });
          const base64 = Buffer.from(resp.data).toString('base64');
          const mimeType = mimeFromUrl(imgUrl, file.original.mediatype);
          content.push({ type: 'image' as const, data: base64, mimeType });
        } catch {
          // Image fetch failed — still return metadata
          const first = content[0];
          if (first.type === 'text') {
            first.text += '\n\n(Could not fetch image data for inline display)';
          }
        }
      }

      return { content };
    }
  );

  server.tool(
    'upload-file',
    'Upload a file to the wiki from base64-encoded data. Provide the file content as a base64 string. Requires the requesting user\'s name for attribution.',
    {
      filename: z.string().describe('Target filename on the wiki'),
      data: z.string().describe('Base64-encoded file content'),
      description: z.string().describe('File description (wikitext)'),
      comment: z.string().optional().describe('Upload comment'),
      user: z.string().describe('Name of the person requesting this upload (for attribution). Ask the user if not known'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ filename, data, description, comment, user, wiki }) => {
      const attrComment = comment ? `${comment} (on behalf of ${user})` : `Uploaded via MCP (on behalf of ${user})`;
      const buffer = Buffer.from(data, 'base64');
      const result = await orchestrator.uploadFile(filename, buffer, description, { wiki, comment: attrComment });
      return {
        content: [{
          type: 'text' as const,
          text: `File "${result.filename}" uploaded to ${result.wiki} (result: ${result.result})`,
        }],
      };
    }
  );

  server.tool(
    'upload-file-from-url',
    'Upload a file to the wiki by fetching it from a URL. The wiki server downloads the file directly from the source URL. Requires the requesting user\'s name for attribution.',
    {
      filename: z.string().describe('Target filename on the wiki'),
      url: z.string().url().describe('Source URL to fetch the file from'),
      description: z.string().describe('File description (wikitext)'),
      comment: z.string().optional().describe('Upload comment'),
      user: z.string().describe('Name of the person requesting this upload (for attribution). Ask the user if not known'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ filename, url, description, comment, user, wiki }) => {
      const attrComment = comment ? `${comment} (on behalf of ${user})` : `Uploaded via MCP (on behalf of ${user})`;
      const result = await orchestrator.uploadFromUrl(filename, url, description, { wiki, comment: attrComment });
      return {
        content: [{
          type: 'text' as const,
          text: `File "${result.filename}" uploaded to ${result.wiki} from URL (result: ${result.result})`,
        }],
      };
    }
  );
}
