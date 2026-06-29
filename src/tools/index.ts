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
import { registerPrompts } from './prompts.js';

export interface SessionContext {
  orchestrator: WikiOrchestrator;
  /** Username for edit attribution (HTTP header in LibreChat mode, Entra identity in OAuth mode) */
  sessionUser?: string;
  /**
   * Whether write tools (create/update/delete/upload) are permitted. Undefined or
   * true = allowed (stdio + LibreChat). In OAuth mode this reflects the user's
   * Entra write role. Write handlers must check `isWriteAllowed(context)`.
   */
  canWrite?: boolean;
}

/** Write is allowed unless explicitly disabled (OAuth users lacking the write role). */
export function isWriteAllowed(context: SessionContext): boolean {
  return context.canWrite !== false;
}

/** Error payload returned by write tools when the user lacks the write role. */
export const WRITE_FORBIDDEN_RESULT = {
  isError: true as const,
  content: [
    {
      type: 'text' as const,
      text: 'Write access denied: your account does not have the required role to edit. Read operations are still available.',
    },
  ],
};

export function registerAllTools(server: McpServer, context: SessionContext): void {
  registerWikiTools(server, context.orchestrator);
  registerSearchTools(server, context.orchestrator);
  registerPageTools(server, context);
  registerHistoryTools(server, context.orchestrator);
  registerCategoryTools(server, context.orchestrator);
  registerLinkTools(server, context.orchestrator);
  registerFileTools(server, context);
  registerActivityTools(server, context.orchestrator);
  registerPrompts(server, context);
}
