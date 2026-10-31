# Contributing

[Project overview](README.md) · [User documentation](docs/README.md) · [Release guide](docs/releasing.md)

For ordinary installation, follow a [client setup guide](docs/README.md#connect-an-assistant).
This page is for building and changing the repository.

## Build and run

Use **Node.js 24 LTS**, matching CI and the container image. You also need Git;
Docker is optional unless you want the disposable wiki below.

```bash
git clone https://github.com/ttpears/mediawiki-mcp.git
cd mediawiki-mcp
npm ci
npm run build
```

Create `.env` in the repository root with a development wiki:

```dotenv
MEDIAWIKI_BASE_URL=http://127.0.0.1:8080
MEDIAWIKI_USERNAME=YourUser@mcp
MEDIAWIKI_PASSWORD=REPLACE_WITH_DEVELOPMENT_BOT_PASSWORD
```

Use a disposable wiki for development and write tests. To start **stdio**:

```bash
node --env-file=.env dist/index.js
```

It waits for MCP messages on stdin. Connect an MCP client to that command to use
it; starting it in a terminal does not create a chat interface.

To start **HTTP** instead:

```bash
node --env-file=.env dist/http-transport.js
```

Check `http://localhost:8009/health`, then connect a Streamable HTTP client to
`http://localhost:8009/mcp`. See [configuration](docs/configuration.md) for other
ports, multiple wikis, and credentials.

`npm run dev` runs the TypeScript compiler in watch mode. It does not start or
restart either server. `npm start` and `npm run start:http` assume the environment
has already been set; neither loads `.env`.

## Run checks

```bash
npm run type-check
npm run test:coverage
npm run build
```

Vitest tests live in `tests/`. Use the test output for current counts; they change
as coverage grows. For dependency changes, also run:

```bash
npm audit
npm audit --omit=dev
```

Transport, authentication, and shared tool changes must work through **both**
stdio and HTTP. Connect a client, initialize, list tools, and perform a read against
a disposable wiki. Check read-only and writer behavior for OAuth changes. Use
`npm run build:mcpb` when changing bundle inputs or release packaging.

## Test against disposable services

With Docker Engine and the Compose v2 plugin installed:

```bash
npm run test:integration
```

This builds the server, installs a private MediaWiki automatically, starts Redis,
and exercises real bot-password authentication, reads, and writes through stdio
and HTTP. It removes the services it created when the run finishes. No `.env`,
browser installer, or existing wiki is required.

To keep the services running while developing:

```bash
npm run test:env:up
npm run test:integration
npm run test:env:logs
npm run test:env:down
```

The first command prints random loopback URLs. A test run reuses a manually
started environment and leaves it running until `test:env:down`. All test data is
disposable. See [Testing](docs/testing.md) for credentials, coverage, isolation,
and troubleshooting.

Use `npm run clean` to remove generated build directories, coverage reports, and
root-level versioned `.mcpb`/`.tgz` bundles. It keeps dependencies and `.env`.

## Where to make changes

| Area | Source |
| --- | --- |
| Stdio entry and transport | [index.ts](src/index.ts), [stdio.ts](src/stdio.ts) |
| HTTP transport and session lifecycle | [http-transport.ts](src/http-transport.ts), [session-registry.ts](src/session-registry.ts) |
| Wiki configuration and routing | [wiki-registry.ts](src/wiki-registry.ts), [wiki-orchestrator.ts](src/wiki-orchestrator.ts) |
| MediaWiki REST and Action APIs | [clients/](src/clients/) |
| Shared tool definitions and prompts | [tools/](src/tools/) |
| OAuth broker, Entra integration, and token stores | [auth/](src/auth/) |

Tools are shared by both transports. Keep their implementation independent of the
client. The Action client owns bot-password login and session cookies; REST calls
can share those cookies. HTTP sessions use separate wiki registries. OAuth uses
Entra for connection access and bot accounts for wiki operations.

When changing a tool, update [the tool reference](docs/tools.md). When changing an
environment setting, update [configuration](docs/configuration.md) and
[.env.example](.env.example). Keep setup guides focused on completing one task.

## Submit a change

Work on a branch from current `main`, run the relevant checks, and open a PR.
Commit messages should explain why the change is needed. Do not add AI attribution
lines or emoji to commits. Never commit `.env`, tokens, or secrets. The maintainer
reviews and approves PRs before merging.

Documentation changes are visible on GitHub after merge. Published npm/bundle
content changes on a subsequent release. Follow [the release guide](docs/releasing.md)
when a new package version is needed; a merge alone is not publication approval.
