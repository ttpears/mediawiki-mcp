export const fixtureUsername = 'FixtureAdmin@connector';
// Public fixture-only credential, created inside the disposable wiki container.
export const fixturePassword = '0123456789abcdef0123456789abcdef';

export async function environment() {
  const project = process.env.MW_TEST_PROJECT;
  const wikiUrl = process.env.MW_TEST_WIKI_URL;
  const redisUrl = process.env.MW_TEST_REDIS_URL;
  if (!project || !/^mw-mcp-test-[a-f0-9]{8}-[a-f0-9]{8}$/.test(project) || !wikiUrl || !redisUrl) {
    throw new Error('Start these tests with npm run test:integration, which supplies disposable fixtures');
  }
  for (const [value, protocol] of [[wikiUrl, 'http:'], [redisUrl, 'redis:']]) {
    const url = new URL(value);
    if (url.protocol !== protocol || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password) {
      throw new Error('Integration tests refuse non-fixture service URLs');
    }
  }
  const response = await fetch(`${wikiUrl}/mcp-fixture.json`, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error('Test wiki fixture marker is missing');
  const marker = await response.json();
  if (marker.fixture !== 'mediawiki-mcp' || marker.project !== project) {
    throw new Error('Refusing to test against a wiki not owned by this fixture project');
  }
  return { project, wikiUrl, redisUrl };
}

/** Supply only this fixture's wiki config while retaining proxy/CA settings. */
export function serverEnvironment(wikiUrl: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && !name.startsWith('MEDIAWIKI_') && !name.startsWith('OAUTH_') && name !== 'REDIS_URL') env[name] = value;
  }
  return { ...env, MEDIAWIKI_BASE_URL: wikiUrl, MEDIAWIKI_USERNAME: fixtureUsername, MEDIAWIKI_PASSWORD: fixturePassword };
}
