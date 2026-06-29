import { describe, it, expect } from 'vitest';
import { registerPrompts } from '../../src/tools/prompts.js';
import type { SessionContext } from '../../src/tools/index.js';

function registeredPromptNames(context: SessionContext): Set<string> {
  const names = new Set<string>();
  const server = { registerPrompt: (name: string) => { names.add(name); } } as never;
  registerPrompts(server, context);
  return names;
}

describe('connector prompts', () => {
  it('registers read prompts for everyone', () => {
    const names = registeredPromptNames({ orchestrator: {} as never, canWrite: false });
    expect(names.has('search-wikis')).toBe(true);
    expect(names.has('summarize-page')).toBe(true);
    expect(names.has('recent-activity')).toBe(true);
  });

  it('offers the edit prompt only to writers', () => {
    expect(registeredPromptNames({ orchestrator: {} as never, canWrite: false }).has('draft-page-edit')).toBe(false);
    expect(registeredPromptNames({ orchestrator: {} as never, canWrite: true }).has('draft-page-edit')).toBe(true);
    expect(registeredPromptNames({ orchestrator: {} as never }).has('draft-page-edit')).toBe(true); // stdio default
  });

  it('search-wikis prompt produces a user message containing the query', () => {
    const cbs = new Map<string, (args: Record<string, string>) => { messages: { role: string; content: { text: string } }[] }>();
    const server = { registerPrompt: (name: string, _c: unknown, fn: never) => { cbs.set(name, fn); } } as never;
    registerPrompts(server, { orchestrator: {} as never, canWrite: false });
    const res = cbs.get('search-wikis')!({ query: 'salt rotation' });
    expect(res.messages[0].role).toBe('user');
    expect(res.messages[0].content.text).toContain('salt rotation');
  });
});
