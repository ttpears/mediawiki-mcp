import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerHistoryTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'get-page-history',
    'Get revision history for a page',
    {
      title: z.string().describe('Page title'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
      limit: z.number().optional().default(20).describe('Maximum number of revisions'),
      older_than: z.number().optional().describe('Only show revisions older than this revision ID'),
    },
    async ({ title, wiki, limit, older_than }) => {
      const result = await orchestrator.getPageHistory(title, {
        wiki,
        limit,
        olderThan: older_than !== undefined ? String(older_than) : undefined,
      });

      const history = result.history;
      const lines: string[] = [`Revision history for "${title}" on ${result.wiki}:`, ''];

      for (const rev of history.revisions) {
        const delta = rev.delta !== null ? (rev.delta >= 0 ? `+${rev.delta}` : String(rev.delta)) : '?';
        const minor = rev.minor ? ' (minor)' : '';
        lines.push(`  ${rev.id} | ${rev.timestamp} | ${rev.user.name} | ${delta} bytes${minor} | ${rev.comment || '(no comment)'}`);
      }

      if (history.older) {
        lines.push('', `More revisions available. Use older_than to paginate.`);
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }
  );

  server.tool(
    'get-revision',
    'Get details for a specific revision',
    {
      revision_id: z.number().describe('Revision ID'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ revision_id, wiki }) => {
      const result = await orchestrator.getRevision(revision_id, { wiki });
      const rev = result.revision;

      const lines: string[] = [
        `Revision ${rev.id} on ${result.wiki}:`,
        `  Page: ${rev.page.title} (id: ${rev.page.id})`,
        `  Timestamp: ${rev.timestamp}`,
        `  User: ${rev.user.name} (id: ${rev.user.id})`,
        `  Size: ${rev.size} bytes`,
        `  Delta: ${rev.delta !== null ? (rev.delta >= 0 ? `+${rev.delta}` : String(rev.delta)) : 'unknown'}`,
        `  Minor: ${rev.minor ? 'yes' : 'no'}`,
        `  Comment: ${rev.comment || '(no comment)'}`,
      ];

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }
  );
}
