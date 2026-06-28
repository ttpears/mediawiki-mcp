import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';
import { FanOutResult, RestSearchResult, FoundPage } from '../types.js';

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

function formatFindResults(
  query: string,
  result: { results: FoundPage[]; warnings: string[] }
): string {
  const parts: string[] = [];

  if (result.results.length === 0) {
    parts.push(`No pages found for "${query}".`);
  } else {
    for (const hit of result.results) {
      const tag = hit.matchType === 'redirect' && hit.redirectedFrom
        ? `redirect from "${hit.redirectedFrom}"`
        : hit.matchType;
      const line = `[${hit.wiki}] ${hit.title} (id: ${hit.pageid}, match: ${tag})`;
      const excerpt = stripHtml(hit.excerpt);
      parts.push(excerpt ? `${line}\n  ${excerpt}` : line);
    }
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
    'find-page',
    'Unified page locator. Tries exact title (following redirects), then title-prefix match, then full-text search, across all registered wikis by default. Returns a single ranked list where exact/redirect hits come before prefix hits, which come before full-text hits. Use this as the first step whenever you need to locate a specific page — it succeeds regardless of whether the user gave you the exact title, a partial title, or a topic description.',
    {
      query: z.string().describe('Page title, partial title, or topic to locate'),
      wiki: z.string().optional().describe('Wiki name (omit to search all registered wikis)'),
      limit: z.number().optional().default(10).describe('Maximum number of ranked results'),
    },
    async ({ query, wiki, limit }) => {
      const result = await orchestrator.findPage(query, { wiki, limit });
      return {
        content: [{ type: 'text' as const, text: formatFindResults(query, result) }],
      };
    }
  );

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
