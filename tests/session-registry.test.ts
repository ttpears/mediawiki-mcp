import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SessionRegistry } from '../src/session-registry.js';

function makeSession() {
  return {
    transport: { close: vi.fn().mockResolvedValue(undefined) },
    server: {},
    context: {},
  } as any;
}

describe('SessionRegistry', () => {
  let registry: SessionRegistry | undefined;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    registry?.dispose();
    registry = undefined;
    vi.useRealTimers();
  });

  it('evicts a session that idles past the TTL via the periodic sweep, even though nothing ever fires onclose (the leak scenario)', () => {
    registry = new SessionRegistry({ idleTtlMs: 1000, maxSessions: 10, sweepIntervalMs: 100 });
    registry.startSweep();
    const session = makeSession();
    registry.set('abc', session);
    expect(registry.size).toBe(1);

    // Simulate a crashed/dropped connection: no get()/delete() call ever happens,
    // onclose never fires. Only the periodic sweep can reclaim this entry.
    vi.advanceTimersByTime(1500);

    expect(registry.size).toBe(0);
    expect(session.transport.close).toHaveBeenCalled();
  });

  it('keeps a repeatedly touched session alive across many sweep ticks (TTL margin does not evict live sessions)', () => {
    registry = new SessionRegistry({ idleTtlMs: 200, maxSessions: 10, sweepIntervalMs: 50 });
    registry.startSweep();
    const session = makeSession();
    registry.set('abc', session);

    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(50); // one sweep tick
      expect(registry.get('abc')).toBe(session); // touch on access refreshes lastSeen
    }

    expect(registry.size).toBe(1);
    expect(session.transport.close).not.toHaveBeenCalled();
  });

  it('lazily expires an idle session on access even before the next sweep tick fires (backstop)', () => {
    registry = new SessionRegistry({ idleTtlMs: 100, maxSessions: 10, sweepIntervalMs: 10_000 });
    const session = makeSession();
    registry.set('abc', session);

    vi.advanceTimersByTime(150); // past idle TTL, but sweep interval hasn't ticked

    expect(registry.get('abc')).toBeUndefined();
    expect(registry.has('abc')).toBe(false);
    expect(session.transport.close).toHaveBeenCalled();
  });

  it('enforces a hard cap on session count via atCapacity()', () => {
    registry = new SessionRegistry({ idleTtlMs: 60_000, maxSessions: 2, sweepIntervalMs: 1_000 });
    expect(registry.atCapacity()).toBe(false);
    registry.set('a', makeSession());
    expect(registry.atCapacity()).toBe(false);
    registry.set('b', makeSession());
    expect(registry.atCapacity()).toBe(true);
  });

  it('creates exactly one sweep timer on startSweep and tears it down on dispose', () => {
    registry = new SessionRegistry({ idleTtlMs: 1000, maxSessions: 10, sweepIntervalMs: 100 });
    expect(vi.getTimerCount()).toBe(0);

    registry.startSweep();
    expect(vi.getTimerCount()).toBe(1);

    registry.startSweep(); // idempotent — must not create a second timer
    expect(vi.getTimerCount()).toBe(1);

    registry.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
