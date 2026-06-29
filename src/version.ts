import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Package version, read from package.json at runtime so it always reflects the
 * released version (no hardcoded strings to keep in sync). Resolves package.json
 * relative to this module: dist/version.js -> ../package.json (and src/version.ts
 * -> ../package.json under vitest), both the package root.
 */
export const VERSION: string = (() => {
  try {
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
  } catch {
    return '0.0.0';
  }
})();
