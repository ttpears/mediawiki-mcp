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

export function registerAllTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  registerWikiTools(server, orchestrator);
  registerSearchTools(server, orchestrator);
  registerPageTools(server, orchestrator);
  registerHistoryTools(server, orchestrator);
  registerCategoryTools(server, orchestrator);
  registerLinkTools(server, orchestrator);
  registerFileTools(server, orchestrator);
  registerActivityTools(server, orchestrator);
}
