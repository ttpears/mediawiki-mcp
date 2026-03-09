import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerPageTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'get-page',
    'Get page content and metadata',
    {
      title: z.string().describe('Page title'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
      include_html: z.boolean().optional().default(false).describe('Include rendered HTML'),
    },
    async ({ title, wiki, include_html }) => {
      const result = await orchestrator.getPage(title, { wiki, includeHtml: include_html });

      if (!result.page) {
        return {
          content: [{ type: 'text' as const, text: `Page "${title}" not found on ${result.wiki}.` }],
        };
      }

      const page = result.page;
      const lines: string[] = [
        `Title: ${page.title}`,
        `Wiki: ${result.wiki}`,
        `Page ID: ${page.id}`,
        `Key: ${page.key}`,
        `Content Model: ${page.content_model}`,
        `Latest Revision: ${page.latest.id} (${page.latest.timestamp})`,
        `License: ${page.license.title}`,
        '',
        '--- Content ---',
        page.source ?? '(no source available)',
      ];

      if (include_html && result.html) {
        lines.push('', '--- HTML ---', result.html);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }
  );

  server.tool(
    'create-page',
    'Create a new wiki page',
    {
      title: z.string().describe('Page title'),
      content: z.string().describe('Page content (wikitext)'),
      summary: z.string().describe('Edit summary'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, content, summary, wiki }) => {
      const result = await orchestrator.createPage(title, content, summary, { wiki });
      return {
        content: [{
          type: 'text' as const,
          text: `Page "${result.page.title}" created on ${result.wiki} (id: ${result.page.id}, revision: ${result.page.latest.id})`,
        }],
      };
    }
  );

  server.tool(
    'update-page',
    'Update an existing wiki page',
    {
      title: z.string().describe('Page title'),
      content: z.string().describe('New page content (wikitext)'),
      summary: z.string().describe('Edit summary'),
      latest_timestamp: z.string().describe('Timestamp of the latest revision (for conflict detection)'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, content, summary, latest_timestamp, wiki }) => {
      const result = await orchestrator.updatePage(title, content, summary, latest_timestamp, { wiki });
      return {
        content: [{
          type: 'text' as const,
          text: `Page "${result.page.title}" updated on ${result.wiki} (revision: ${result.page.latest.id})`,
        }],
      };
    }
  );

  server.tool(
    'delete-page',
    'Delete a wiki page',
    {
      title: z.string().describe('Page title to delete'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, wiki }) => {
      const result = await orchestrator.deletePage(title, { wiki });
      return {
        content: [{ type: 'text' as const, text: `Page "${title}" deleted on ${result.wiki}.` }],
      };
    }
  );

  server.tool(
    'undelete-page',
    'Restore a deleted wiki page',
    {
      title: z.string().describe('Page title to restore'),
      reason: z.string().optional().describe('Reason for restoring the page'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, reason, wiki }) => {
      const result = await orchestrator.undeletePage(title, reason, { wiki });
      return {
        content: [{ type: 'text' as const, text: `Page "${title}" restored on ${result.wiki}.` }],
      };
    }
  );
}
