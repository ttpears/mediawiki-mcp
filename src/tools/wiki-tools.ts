import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerWikiTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'add-wiki',
    'Register a new MediaWiki instance so you can read and edit its pages. Provide the wiki base URL and optional bot credentials. After adding, use the wiki name in other tools\' "wiki" parameter.',
    {
      name: z.string().describe('Unique name for the wiki'),
      url: z.string().url().describe('Base URL of the MediaWiki instance'),
      username: z.string().optional().describe('Bot username (e.g. User@BotName)'),
      password: z.string().optional().describe('Bot password'),
    },
    async ({ name, url, username, password }) => {
      const registry = orchestrator.getRegistry();
      registry.addWiki({ name, baseUrl: url, username, password });
      await orchestrator.addClientsForWiki({ name, baseUrl: url, username, password });
      return {
        content: [{ type: 'text' as const, text: `Wiki "${name}" added successfully (${url})` }],
      };
    }
  );

  server.tool(
    'remove-wiki',
    'Unregister a wiki so it is no longer accessible. Does not affect the wiki itself — only removes it from this session.',
    {
      name: z.string().describe('Name of the wiki to remove'),
    },
    async ({ name }) => {
      const registry = orchestrator.getRegistry();
      registry.removeWiki(name);
      orchestrator.removeClientsForWiki(name);
      return {
        content: [{ type: 'text' as const, text: `Wiki "${name}" removed successfully` }],
      };
    }
  );

  server.tool(
    'set-wiki',
    'Set the default wiki. When multiple wikis are registered, this determines which wiki is used when the "wiki" parameter is omitted from other tool calls.',
    {
      name: z.string().describe('Name of the registered wiki to set as default'),
    },
    async ({ name }) => {
      const registry = orchestrator.getRegistry();
      registry.setDefault(name);
      return {
        content: [{ type: 'text' as const, text: `Default wiki set to "${name}"` }],
      };
    }
  );

  server.tool(
    'list-wikis',
    'List all registered wikis with their URLs, auth status, and which is the default. Call this first if you\'re unsure which wikis are available.',
    {},
    async () => {
      const registry = orchestrator.getRegistry();
      const wikis = registry.getAllWikis();
      const defaultWiki = registry.getDefaultWiki();

      if (wikis.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No wikis registered.' }],
        };
      }

      const lines = wikis.map((wiki) => {
        const isDefault = defaultWiki && wiki.name === defaultWiki.name ? ' (default)' : '';
        const authStatus = wiki.username ? 'authenticated' : 'anonymous';
        return `- ${wiki.name}${isDefault}: ${wiki.baseUrl} [${authStatus}]`;
      });

      return {
        content: [{ type: 'text' as const, text: `Registered wikis:\n${lines.join('\n')}` }],
      };
    }
  );
}
