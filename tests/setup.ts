import { afterEach, beforeEach, vi } from 'vitest';

// Unit tests must never inherit a developer's wiki credentials or broker config.
// Preserve proxy, CA, and platform authentication settings used by local fixtures.
// Setup runs before test modules are imported, including modules that read env
// at import time. Workers are isolated, so removing these values is local to tests.
for (const name of Object.keys(process.env)) {
  if (name.startsWith('MEDIAWIKI_') || name.startsWith('OAUTH_') || name === 'REDIS_URL') {
    delete process.env[name];
  }
}

beforeEach(() => {
  for (const name of Object.keys(process.env)) {
    if (name.startsWith('MEDIAWIKI_') || name.startsWith('OAUTH_') || name === 'REDIS_URL') {
      vi.stubEnv(name, undefined);
    }
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
