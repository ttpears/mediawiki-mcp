import { readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const generated = ['dist', 'dist-mcpb', 'coverage'];
for (const name of await readdir(root)) {
  if (/^mediawiki-mcp-\d+\.\d+\.\d+(?:-[\w.-]+)?\.(mcpb|tgz)$/.test(name)) generated.push(name);
}
for (const name of generated) await rm(resolve(root, name), { recursive: true, force: true });
console.log('Removed generated builds, coverage, and package archives.');
