import { describe, it, expect } from 'vitest';
import { isWriteAllowed, registerAllTools, type SessionContext } from '../../src/tools/index.js';

const WRITE_TOOLS = ['create-page', 'update-page', 'delete-page', 'undelete-page', 'upload-file', 'upload-file-from-url'];
const READ_TOOLS = ['get-page', 'get-file', 'search-page', 'find-page'];

function registeredToolNames(context: SessionContext): Set<string> {
  const names = new Set<string>();
  const server = {
    tool: (name: string) => { names.add(name); },
    registerPrompt: () => {},
  } as never;
  registerAllTools(server, context);
  return names;
}

describe('isWriteAllowed', () => {
  it('allows write unless explicitly disabled', () => {
    expect(isWriteAllowed({} as SessionContext)).toBe(true); // stdio / LibreChat
    expect(isWriteAllowed({ canWrite: true } as SessionContext)).toBe(true);
    expect(isWriteAllowed({ canWrite: false } as SessionContext)).toBe(false);
  });
});

describe('conditional write-tool registration', () => {
  it('omits write tools for read-only sessions (canWrite=false), keeps read tools', () => {
    const names = registeredToolNames({ orchestrator: {} as never, canWrite: false });
    for (const w of WRITE_TOOLS) expect(names.has(w), `should NOT register ${w}`).toBe(false);
    for (const r of READ_TOOLS) expect(names.has(r), `should register ${r}`).toBe(true);
  });

  it('registers write tools for writers (canWrite=true)', () => {
    const names = registeredToolNames({ orchestrator: {} as never, canWrite: true });
    for (const w of WRITE_TOOLS) expect(names.has(w), `should register ${w}`).toBe(true);
  });

  it('registers write tools when canWrite is undefined (stdio / LibreChat)', () => {
    const names = registeredToolNames({ orchestrator: {} as never });
    for (const w of WRITE_TOOLS) expect(names.has(w)).toBe(true);
  });
});
