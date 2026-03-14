import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';
import { ActionRecentChange } from '../types.js';

export function registerActivityTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'get-recent-changes',
    'Get a feed of recent edits, page creations, and log events across wikis. Returns timestamps, change types, page titles, authors, size deltas, and edit summaries. Useful for monitoring wiki activity.',
    {
      wiki: z.string().optional().describe('Wiki name (omit to get changes from all wikis)'),
      limit: z.number().optional().default(20).describe('Maximum number of changes'),
      namespace: z.number().optional().describe('Filter by namespace number'),
      type: z.enum(['edit', 'new', 'log']).optional().describe('Filter by change type'),
      continue_from: z.string().optional().describe('Continuation token for pagination'),
    },
    async ({ wiki, limit, namespace, type, continue_from }) => {
      const result = await orchestrator.getRecentChanges({
        wiki,
        limit,
        namespace,
        type,
        continueFrom: continue_from,
      });

      const parts: string[] = [];
      const multiWiki = result.results.length > 1;

      // Collect all changes, optionally merging across wikis by timestamp
      interface LabeledChange {
        wiki: string;
        change: ActionRecentChange;
      }

      const allChanges: LabeledChange[] = [];
      for (const wikiResult of result.results) {
        for (const change of wikiResult.items) {
          allChanges.push({ wiki: wikiResult.wiki, change });
        }
      }

      // Sort by timestamp descending when merging multiple wikis
      if (multiWiki) {
        allChanges.sort((a, b) => b.change.timestamp.localeCompare(a.change.timestamp));
      }

      if (allChanges.length === 0) {
        parts.push('No recent changes found.');
      } else {
        for (const { wiki: wikiName, change } of allChanges) {
          const prefix = multiWiki ? `[${wikiName}] ` : '';
          const delta = change.newlen - change.oldlen;
          const deltaStr = delta >= 0 ? `+${delta}` : String(delta);
          parts.push(`${prefix}${change.timestamp} | ${change.type} | ${change.title} | ${change.user} | ${deltaStr} bytes | ${change.comment || '(no comment)'}`);
        }
      }

      // Pagination footer for single-wiki requests
      if (wiki && result.results.length === 1) {
        const wikiResult = result.results[0] as any;
        if (wikiResult.continueFrom) {
          parts.push('', `More results available. Use continue_from="${wikiResult.continueFrom}" to get the next page.`);
        }
      }

      if (result.warnings.length > 0) {
        parts.push('');
        parts.push('Warnings:');
        for (const warning of result.warnings) {
          parts.push(`  - ${warning}`);
        }
      }

      return {
        content: [{ type: 'text' as const, text: parts.join('\n') }],
      };
    }
  );
}
