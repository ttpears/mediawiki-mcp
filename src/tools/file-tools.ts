import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerFileTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'get-file',
    'Get file metadata and URLs',
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

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }
  );

  server.tool(
    'upload-file',
    'Upload a file from base64-encoded data',
    {
      filename: z.string().describe('Target filename on the wiki'),
      data: z.string().describe('Base64-encoded file content'),
      description: z.string().describe('File description (wikitext)'),
      comment: z.string().optional().describe('Upload comment'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ filename, data, description, comment, wiki }) => {
      const buffer = Buffer.from(data, 'base64');
      const result = await orchestrator.uploadFile(filename, buffer, description, { wiki, comment });
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
    'Upload a file to the wiki from a URL',
    {
      filename: z.string().describe('Target filename on the wiki'),
      url: z.string().url().describe('Source URL to fetch the file from'),
      description: z.string().describe('File description (wikitext)'),
      comment: z.string().optional().describe('Upload comment'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ filename, url, description, comment, wiki }) => {
      const result = await orchestrator.uploadFromUrl(filename, url, description, { wiki, comment });
      return {
        content: [{
          type: 'text' as const,
          text: `File "${result.filename}" uploaded to ${result.wiki} from URL (result: ${result.result})`,
        }],
      };
    }
  );
}
