import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SessionContext, isWriteAllowed } from './index.js';

/** Build a single-message user prompt result. */
function userPrompt(text: string) {
  return { messages: [{ role: 'user' as const, content: { type: 'text' as const, text } }] };
}

/**
 * Registers MCP prompts — the starter prompts Claude Desktop surfaces in the
 * connector's "+" / context menu so users have ready-made entry points. They are
 * just templates (no actions); the edit prompt is only offered to users who can write.
 */
export function registerPrompts(server: McpServer, context: SessionContext): void {
  server.registerPrompt(
    'search-wikis',
    {
      title: 'Search the wikis',
      description: 'Find the most relevant pages across all connected wikis and summarize them.',
      argsSchema: { query: z.string().describe('What to search for') },
    },
    ({ query }) =>
      userPrompt(
        `Search the connected MediaWiki wikis for "${query}". Use the find-page tool first to locate the best matches across all wikis, read the top results, then give me a concise summary with each page's title and which wiki it's on.`
      )
  );

  server.registerPrompt(
    'summarize-page',
    {
      title: 'Summarize a wiki page',
      description: 'Fetch a wiki page and summarize its key points.',
      argsSchema: {
        title: z.string().describe('Page title'),
        wiki: z.string().optional().describe('Wiki name (optional; searches all if omitted)'),
      },
    },
    ({ title, wiki }) =>
      userPrompt(
        `Fetch the wiki page "${title}"${wiki ? ` on the "${wiki}" wiki` : ''} with get-page and summarize its key points. Flag anything that looks outdated, contradictory, or incomplete.`
      )
  );

  server.registerPrompt(
    'recent-activity',
    {
      title: 'Recent wiki activity',
      description: 'Summarize what has changed recently across the wikis.',
    },
    () =>
      userPrompt(
        `Using recent-changes, show me what has changed recently across the connected wikis and summarize the notable updates — which page, who changed it, and what changed.`
      )
  );

  // Edit-oriented prompt only for users who can write.
  if (isWriteAllowed(context)) {
    server.registerPrompt(
      'draft-page-edit',
      {
        title: 'Draft a wiki edit',
        description: 'Read a page and propose an edit as a diff before saving.',
        argsSchema: {
          title: z.string().describe('Page to edit'),
          change: z.string().describe('What the edit should accomplish'),
        },
      },
      ({ title, change }) =>
        userPrompt(
          `Read the wiki page "${title}" with get-page, then propose an edit that accomplishes: ${change}. Show me the result as a unified diff and wait for my confirmation before calling update-page.`
        )
    );
  }
}
