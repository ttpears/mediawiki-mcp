import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';
import { FanOutResult, RestSearchResult } from '../types.js';

function stripHtml(html: string | null | undefined): string {
  return html ? html.replace(/<[^>]*>/g, '') : '';
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
    'search-page',
    'Full-text search across wiki pages. Returns matching page titles, IDs, and text excerpts. Use this to find pages when you don\'t know the exact title.',
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
    'search-page-by-prefix',
    'Search for pages by title prefix (autocomplete-style). Returns matching page titles and IDs. Faster than full-text search when you know the beginning of the page title.',
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
