import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerLinkTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'get-page-links',
    'Get links from or to a page',
    {
      title: z.string().describe('Page title'),
      direction: z.enum(['from', 'to']).optional().default('from').describe('Link direction: "from" for outgoing links, "to" for backlinks'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
      limit: z.number().optional().default(50).describe('Maximum number of links'),
      continue_from: z.string().optional().describe('Continuation token for pagination'),
    },
    async ({ title, direction, wiki, limit, continue_from }) => {
      const orchDirection = direction === 'to' ? 'backlinks' : 'forward';
      const result = await orchestrator.getPageLinks(title, orchDirection, {
        wiki,
        limit,
        continueFrom: continue_from,
      });

      const dirLabel = direction === 'to' ? 'Links to' : 'Links from';
      const lines: string[] = [`${dirLabel} "${title}" on ${result.wiki}:`, ''];

      if (result.links.length === 0) {
        lines.push('No links found.');
      } else {
        for (const link of result.links) {
          lines.push(`  - ${link.title} (ns: ${link.ns})`);
        }
      }

      if (result.hasMore && result.continueFrom) {
        lines.push('', `More results available. Use continue_from="${result.continueFrom}" to get the next page.`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }
  );
}
