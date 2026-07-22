import { describe, it, expect } from 'vitest';
import { resolveTrustProxy } from '../src/trust-proxy.js';

describe('resolveTrustProxy', () => {
  it('returns 1 (single proxy hop) when trust proxy is enabled', () => {
    // Must be a number, NOT boolean true — `true` trips express-rate-limit's
    // ERR_ERL_PERMISSIVE_TRUST_PROXY validation.
    expect(resolveTrustProxy(true)).toBe(1);
  });

  it('returns false when trust proxy is disabled', () => {
    expect(resolveTrustProxy(false)).toBe(false);
  });

  it('never returns boolean true', () => {
    expect(resolveTrustProxy(true)).not.toBe(true);
  });
});
