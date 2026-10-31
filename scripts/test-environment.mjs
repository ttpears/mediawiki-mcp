import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const directory = resolve(root, '.test-env');
const statePath = resolve(directory, 'state.json');
const composePath = resolve(root, 'tests/environments/compose.yaml');
const prefix = `mw-mcp-test-${createHash('sha256').update(root).digest('hex').slice(0, 8)}-`;
let activeChild;
let interrupted = false;
process.once('SIGINT', () => { interrupted = true; activeChild?.kill('SIGINT'); });
process.once('SIGTERM', () => { interrupted = true; activeChild?.kill('SIGTERM'); });

async function run(command, args, { capture = false, env = process.env } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd: root, env, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' });
    activeChild = child;
    let output = '';
    child.stdout?.on('data', bytes => { output += bytes; });
    child.once('error', reject);
    child.once('close', code => {
      activeChild = undefined;
      if (code === 0) resolveRun(output.trim());
      else reject(new Error(`${command} exited with ${code ?? 'a signal'}`));
    });
  });
}

async function readState() {
  let state;
  try { state = JSON.parse(await readFile(statePath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
  if (state.version !== 1 || typeof state.project !== 'string' ||
      !state.project.startsWith(prefix) || !/^[a-f0-9]{8}$/.test(state.project.slice(prefix.length))) {
    throw new Error('Unrecognized test environment state; refusing to operate on another Compose project');
  }
  return state;
}

async function saveState(state) {
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

function compose(state, args, options = {}) {
  return run('docker', ['compose', '--env-file', resolve(directory, 'compose.env'),
    '--project-name', state.project, '--file', composePath, ...args], {
    ...options, env: { ...process.env, MW_TEST_PROJECT: state.project },
  });
}

async function down(state) {
  await compose(state, ['down', '--volumes', '--remove-orphans']);
  await rm(statePath, { force: true });
}

async function up(existing) {
  await mkdir(directory, { recursive: true });
  // Avoid Compose discovering a developer's production .env in the checkout.
  await writeFile(resolve(directory, 'compose.env'), '');
  const state = existing ?? { version: 1, project: prefix + randomBytes(4).toString('hex') };
  await saveState(state);
  try {
    await compose(state, ['up', '--detach', '--wait', '--wait-timeout', '180']);
    const wikiAddress = await compose(state, ['port', 'mediawiki', '80'], { capture: true });
    const redisAddress = await compose(state, ['port', 'redis', '6379'], { capture: true });
    if (![wikiAddress, redisAddress].every(address => /^127\.0\.0\.1:\d+$/.test(address))) {
      throw new Error('Test services must be published on loopback only');
    }
    state.wikiUrl = `http://${wikiAddress}`;
    state.redisUrl = `redis://${redisAddress}`;
    await saveState(state);
    return state;
  } catch (error) {
    await compose(state, ['logs', '--no-color', '--tail', '100']).catch(() => {});
    if (!existing) await down(state).catch(cleanupError => console.error(cleanupError.message));
    throw error;
  }
}

async function main() {
  const mode = process.argv[2];
  if (!['up', 'down', 'logs', 'test'].includes(mode)) throw new Error('Use up, down, logs, or test');
  const existing = await readState();
  if (mode === 'down' || mode === 'logs') {
    if (!existing) { console.log('No test environment is running for this checkout.'); return; }
    if (mode === 'down') await down(existing);
    else await compose(existing, ['logs', '--no-color', '--tail', '100']);
    return;
  }
  if (mode === 'test') await run(process.execPath, ['node_modules/typescript/bin/tsc']);
  const state = await up(existing);
  if (mode === 'up') {
    console.log(`Disposable wiki: ${state.wikiUrl}\nDisposable Redis: ${state.redisUrl}`);
    console.log('Run npm run test:env:down when finished.');
    return;
  }
  try {
    const env = { ...process.env, MW_TEST_PROJECT: state.project, MW_TEST_WIKI_URL: state.wikiUrl, MW_TEST_REDIS_URL: state.redisUrl };
    for (const name of Object.keys(env)) {
      if (name.startsWith('MEDIAWIKI_') || name.startsWith('OAUTH_') || name === 'REDIS_URL') delete env[name];
    }
    await run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', 'vitest.integration.config.ts'], { env });
  } catch (error) {
    await compose(state, ['logs', '--no-color', '--tail', '100']).catch(() => {});
    throw error;
  } finally {
    // A manually started development environment remains available after tests.
    if (!existing) await down(state);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = interrupted ? 130 : 1; });
