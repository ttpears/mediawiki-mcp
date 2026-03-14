import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerCategoryTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'list-categories',
    'List all categories on the wiki with page/subcat/file counts. Use prefix to filter by name prefix. Useful for discovering how content is organized.',
    {
      wiki: z.string().optional().describe('Wiki name (omit to list from all wikis)'),
      prefix: z.string().optional().describe('Filter categories by prefix'),
      limit: z.number().optional().default(50).describe('Maximum number of categories'),
      continue_from: z.string().optional().describe('Continuation token for pagination'),
    },
    async ({ wiki, prefix, limit, continue_from }) => {
      const result = await orchestrator.listCategories({
        wiki,
        prefix,
        limit,
        continueFrom: continue_from,
      });

      const parts: string[] = [];
      const multiWiki = result.results.length > 1;

      for (const wikiResult of result.results) {
        if (wikiResult.items.length === 0) {
          if (multiWiki) {
            parts.push(`[${wikiResult.wiki}] No categories found.`);
          }
          continue;
        }

        for (const cat of wikiResult.items) {
          const prefix_str = multiWiki ? `[${wikiResult.wiki}] ` : '';
          parts.push(`${prefix_str}${cat.category} (${cat.pages} pages, ${cat.subcats} subcats, ${cat.files} files)`);
        }
      }

      if (parts.length === 0) {
        parts.push('No categories found.');
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

  server.tool(
    'get-category-members',
    'List all pages, subcategories, or files within a specific category. Returns member titles and IDs. Use type to filter (page/subcat/file).',
    {
      category: z.string().describe('Category name (with or without "Category:" prefix)'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
      type: z.enum(['page', 'subcat', 'file']).optional().describe('Filter by member type'),
      limit: z.number().optional().default(50).describe('Maximum number of members'),
      continue_from: z.string().optional().describe('Continuation token for pagination'),
    },
    async ({ category, wiki, type, limit, continue_from }) => {
      const result = await orchestrator.getCategoryMembers(category, {
        wiki,
        type,
        limit,
        continueFrom: continue_from,
      });

      const lines: string[] = [`Category members for "${category}" on ${result.wiki}:`, ''];

      if (result.members.length === 0) {
        lines.push('No members found.');
      } else {
        for (const member of result.members) {
          lines.push(`  - ${member.title} (id: ${member.pageid}, ns: ${member.ns})`);
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
