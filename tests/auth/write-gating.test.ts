import { describe, it, expect, vi } from 'vitest';
import { isWriteAllowed, registerAllTools, type SessionContext } from '../../src/tools/index.js';

describe('isWriteAllowed', () => {
  it('allows write unless explicitly disabled', () => {
    expect(isWriteAllowed({} as SessionContext)).toBe(true); // stdio / LibreChat
    expect(isWriteAllowed({ canWrite: true } as SessionContext)).toBe(true);
    expect(isWriteAllowed({ canWrite: false } as SessionContext)).toBe(false);
  });
});

describe('write tool gating', () => {
  function captureTools(context: SessionContext) {
    const handlers = new Map<string, (args: unknown) => Promise<{ isError?: boolean; content: { text: string }[] }>>();
    const server = {
      tool: (name: string, _desc: string, _schema: unknown, handler: (args: unknown) => Promise<never>) => {
        handlers.set(name, handler as never);
      },
    } as never;
    registerAllTools(server, context);
    return handlers;
  }

  it('create-page refuses when the user lacks write access', async () => {
    const orchestrator = { createPage: vi.fn() } as never;
    const handlers = captureTools({ orchestrator, canWrite: false });
    const res = await handlers.get('create-page')!({ title: 'T', content: 'c', summary: 's' });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/Write access denied/);
    expect((orchestrator as { createPage: ReturnType<typeof vi.fn> }).createPage).not.toHaveBeenCalled();
  });
});
