# Testing

[Documentation](README.md) · [Contributing](../CONTRIBUTING.md)

Use Node.js 24 LTS and run `npm ci` before these commands. The default tests need
no wiki, Redis, credentials, or Docker. Integration tests additionally need Docker
Engine with the Compose v2 plugin and enough disk space to pull the fixture images.

## Choose a check

| Command | What it checks |
| --- | --- |
| `npm run type-check` | TypeScript source without emitting build files |
| `npm test` | Unit and in-process HTTP tests with mocked external services |
| `npm run test:watch` | The same tests, rerun as files change |
| `npm run test:coverage` | The default suite plus terminal, HTML, and LCOV coverage reports |
| `npm run test:integration` | Built server against a real disposable MediaWiki and Redis |

Open `coverage/index.html` after a coverage run. Coverage is a diagnostic report;
there is no minimum percentage gate. `npm test` and coverage exclude the Docker
integration suite. Unit tests clear inherited `MEDIAWIKI_*`, `OAUTH_*`, and
`REDIS_URL` values, restore mocks and environment stubs, and reset fake timers.
Proxy and CA settings remain available.

## Run integration tests

```bash
npm run test:integration
```

The runner compiles the server, starts MediaWiki 1.43 and Redis 7 with Compose,
waits for their health checks, and runs `tests/integration/`. MediaWiki installs
itself with SQLite and a bot password; there is no browser installation step.
The checks cover:

- MCP initialization and tool discovery through both stdio and Streamable HTTP.
- Bot-password login, page creation, reading, searching, appending, and history.
- Redis token TTLs, namespace isolation, and atomic single-use redemption.

The runner prints service logs on failure and removes the environment it created
on success or test failure. The initial image pull takes longer than later runs.
These checks supplement the unit suite; they do not exercise a live Entra tenant
or replace OAuth permission tests.

## Keep an environment running

```bash
npm run test:env:up
npm run test:integration
npm run test:env:logs
npm run test:env:down
```

`test:env:up` prints the wiki and Redis URLs. Both use randomly allocated ports
on `127.0.0.1`. A test run reuses an environment started this way and leaves it
running for inspection. `test:env:down` removes its containers, network, and data.
Each checkout has its own Compose project; run one environment command at a time
within a checkout. Repeated test runs create uniquely named pages.

To browse the private wiki, use `FixtureAdmin` with password
`Fixture-admin-only-123`. To connect a development server, use the printed wiki
URL and these **public, fixture-only** bot credentials:

```dotenv
MEDIAWIKI_BASE_URL=http://127.0.0.1:REPLACE_WITH_PRINTED_PORT
MEDIAWIKI_USERNAME=FixtureAdmin@connector
MEDIAWIKI_PASSWORD=0123456789abcdef0123456789abcdef
```

These accounts exist only inside the disposable wiki. Keep real credentials out
of this fixture. Copy the values into your local `.env` only if you want to run
a client manually; the automated tests supply them without reading `.env`.

## Isolation and cleanup

The environment state lives in ignored `.test-env/`. The runner uses an explicit,
empty Compose env file, a project name unique to the checkout, and loopback-only
published ports. Integration tests require a matching project marker from the
wiki before they write. Redis tests use unique key prefixes and remove only
their own keys. No existing database or wiki is needed.

`test:env:down` operates only on the recorded project for this checkout. If a
terminal or CI job is forcibly killed, run it again to remove leftover services.
Keep `.test-env/state.json` until cleanup finishes; it identifies that project.
CI also runs cleanup as a final step, even after a failed test.

`npm run clean` removes `dist/`, `dist-mcpb/`, `coverage/`, and root-level
`mediawiki-mcp-VERSION.mcpb` / `.tgz` bundles. It keeps `node_modules/`, `.env`,
and running fixture state. Rebuild before starting the server afterward.
Generated files and local credentials are ignored by Git and excluded from the
Docker build context.

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Docker or Compose is unavailable | Start Docker and check `docker info` and `docker compose version`. Unit tests still run without Docker. |
| Fixture never becomes healthy | Run `npm run test:env:logs` for a retained environment; a failed automatic start prints logs before cleanup. Check disk space and image pull access. |
| Connection refused after restarting Docker | Run `npm run test:env:up` again to refresh the recorded ports. |
| Fixture ownership or URL error | Run the suite through `npm run test:integration`. Do not point it at an existing wiki or Redis service. |
| Old test data affects an investigation | Run `npm run test:env:down`, then `npm run test:env:up` for a fresh install. |

The runner preserves existing Docker, proxy, and CA configuration. Configure
those through your normal development environment rather than disabling TLS
verification for image pulls or HTTP requests.
