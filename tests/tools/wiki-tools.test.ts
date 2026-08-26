import { describe, it, expect, vi } from 'vitest';
import { registerWikiTools } from '../../src/tools/wiki-tools.js';

type ToolHandler = (args: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;

function captureTools(orchestrator: unknown): Map<string, ToolHandler> {
  const handlers = new Map<string, ToolHandler>();
  const server = {
    tool: (name: string, _desc: string, _schema: unknown, handler: ToolHandler) => {
      handlers.set(name, handler);
    },
  };
  registerWikiTools(server as any, orchestrator as any);
  return handlers;
}

describe('list-wikis', () => {
  function createOrchestrator(statuses: Record<string, { status: string; user?: string; detail?: string }>) {
    return {
      getRegistry: () => ({
        getAllWikis: () => [
          { name: 'Docs', baseUrl: 'https://docs.example.com', username: 'bot' },
          { name: 'Public', baseUrl: 'https://pub.example.com' },
        ],
        getDefaultWiki: () => ({ name: 'Docs' }),
      }),
      getAuthStatus: vi.fn(async (name: string) => ({ wiki: name, ...statuses[name] })),
    };
  }

  it('reports live session state, not configured credentials', async () => {
    const orchestrator = createOrchestrator({
      Docs: { status: 'authenticated', user: 'BotUser' },
      Public: { status: 'anonymous' },
    });
    const handlers = captureTools(orchestrator);

    const result = await handlers.get('list-wikis')!({});
    const text = result.content[0].text;

    expect(text).toContain('Docs (default): https://docs.example.com [authenticated as BotUser]');
    expect(text).toContain('Public: https://pub.example.com [anonymous]');
    expect(orchestrator.getAuthStatus).toHaveBeenCalledWith('Docs');
    expect(orchestrator.getAuthStatus).toHaveBeenCalledWith('Public');
  });

  it('surfaces an auth error when credentials are configured but the session is broken', async () => {
    const orchestrator = createOrchestrator({
      Docs: { status: 'error', detail: 'credentials configured but session is anonymous' },
      Public: { status: 'anonymous' },
    });
    const handlers = captureTools(orchestrator);

    const result = await handlers.get('list-wikis')!({});
    const text = result.content[0].text;

    expect(text).toContain('[auth error: credentials configured but session is anonymous]');
  });
});
