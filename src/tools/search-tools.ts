import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';
import { FanOutResult, RestSearchResult } from '../types.js';

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

function formatSearchResults(result: FanOutResult<RestSearchResult>): string {
  const parts: string[] = [];
  const multiWiki = result.results.length > 1;

  for (const wikiResult of result.results) {
    if (wikiResult.items.length === 0) {
      if (multiWiki) {
        parts.push(`[${wikiResult.wiki}] No results found.`);
      }
      continue;
    }

    for (const item of wikiResult.items) {
      const prefix = multiWiki ? `[${wikiResult.wiki}] ` : '';
      const excerpt = stripHtml(item.excerpt);
      parts.push(`${prefix}${item.title} (id: ${item.id})\n  ${excerpt}`);
    }
  }

  if (parts.length === 0) {
    parts.push('No results found.');
  }

  if (result.warnings.length > 0) {
    parts.push('');
    parts.push('Warnings:');
    for (const warning of result.warnings) {
      parts.push(`  - ${warning}`);
    }
  }

  return parts.join('\n');
}

export function registerSearchTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'search-pages',
    'Search for pages across wikis by content',
    {
      query: z.string().describe('Search query'),
      wiki: z.string().optional().describe('Wiki name (omit to search all wikis)'),
      limit: z.number().optional().default(10).describe('Maximum number of results'),
    },
    async ({ query, wiki, limit }) => {
      const result = await orchestrator.search(query, { wiki, limit });
      return {
        content: [{ type: 'text' as const, text: formatSearchResults(result) }],
      };
    }
  );

  server.tool(
    'search-pages-by-prefix',
    'Search for pages by title prefix',
    {
      query: z.string().describe('Title prefix to search for'),
      wiki: z.string().optional().describe('Wiki name (omit to search all wikis)'),
      limit: z.number().optional().default(10).describe('Maximum number of results'),
    },
    async ({ query, wiki, limit }) => {
      const result = await orchestrator.searchByPrefix(query, { wiki, limit });
      return {
        content: [{ type: 'text' as const, text: formatSearchResults(result) }],
      };
    }
  );
}
