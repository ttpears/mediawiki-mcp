import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WikiOrchestrator } from '../wiki-orchestrator.js';
import { registerWikiTools } from './wiki-tools.js';
import { registerSearchTools } from './search-tools.js';
import { registerPageTools } from './page-tools.js';
import { registerHistoryTools } from './history-tools.js';
import { registerCategoryTools } from './category-tools.js';
import { registerLinkTools } from './link-tools.js';
import { registerFileTools } from './file-tools.js';
import { registerActivityTools } from './activity-tools.js';

export interface SessionContext {
  orchestrator: WikiOrchestrator;
  /** Username from HTTP header (populated in streamable-http mode, undefined in stdio) */
  sessionUser?: string;
}

export function registerAllTools(server: McpServer, context: SessionContext): void {
  registerWikiTools(server, context.orchestrator);
  registerSearchTools(server, context.orchestrator);
  registerPageTools(server, context);
  registerHistoryTools(server, context.orchestrator);
  registerCategoryTools(server, context.orchestrator);
  registerLinkTools(server, context.orchestrator);
  registerFileTools(server, context);
  registerActivityTools(server, context.orchestrator);
}
