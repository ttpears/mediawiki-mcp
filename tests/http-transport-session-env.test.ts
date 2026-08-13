import { describe, it, expect } from 'vitest';
import { parsePositiveIntEnv, parsePortEnv } from '../src/http-transport.js';

// Covers the env -> SessionRegistryOptions parsing path for
// MEDIAWIKI_SESSION_IDLE_TTL_MS / MEDIAWIKI_MAX_SESSIONS. A bare
// `env.VAR ? parseInt(env.VAR, 10) : undefined` lets a malformed value
// produce NaN, and `NaN ?? DEFAULT` stays NaN (`??` only rescues
// null/undefined) — silently disabling the idle TTL and the session cap.
describe('parsePositiveIntEnv', () => {
  it('falls back to undefined for a non-numeric value instead of propagating NaN', () => {
    expect(parsePositiveIntEnv('not-a-number')).toBeUndefined();
  });

  it('falls back to undefined when the env var is unset', () => {
    expect(parsePositiveIntEnv(undefined)).toBeUndefined();
  });

  it('falls back to undefined for "0" rather than evicting every session / rejecting every initialize', () => {
    expect(parsePositiveIntEnv('0')).toBeUndefined();
  });

  it('uses a valid positive integer as given', () => {
    expect(parsePositiveIntEnv('5000')).toBe(5000);
  });
});

// MEDIAWIKI_MCP_PORT had no guard at all — `parseInt(env.MEDIAWIKI_MCP_PORT ||
// '8009', 10)` — so a malformed value produced NaN, which reaches
// net.Server.listen() and throws an uncaught RangeError, crashing the
// process at startup. Unlike the session vars, 0 is a valid port (Node
// treats it as "assign any free port"), so it must not be coerced away.
describe('parsePortEnv', () => {
  it('falls back to the given default for a non-numeric value instead of crashing with NaN', () => {
    expect(parsePortEnv('not-a-port', 8009)).toBe(8009);
  });

  it('falls back to the given default when unset', () => {
    expect(parsePortEnv(undefined, 8009)).toBe(8009);
  });

  it('accepts 0 (OS-assigned ephemeral port), unlike parsePositiveIntEnv', () => {
    expect(parsePortEnv('0', 8009)).toBe(0);
  });

  it('falls back to the given default for an out-of-range port', () => {
    expect(parsePortEnv('70000', 8009)).toBe(8009);
  });

  it('uses a valid port as given', () => {
    expect(parsePortEnv('3000', 8009)).toBe(3000);
  });
});
