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
npm test
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

## Run a disposable MediaWiki

In a separate development directory, create `compose.wiki.yaml`:

```yaml
services:
  wiki-db:
    image: mariadb:11.4
    environment:
      MARIADB_ROOT_PASSWORD: local-dev-only
      MARIADB_DATABASE: mediawiki
      MARIADB_USER: mediawiki
      MARIADB_PASSWORD: local-dev-only
    volumes:
      - wiki-db:/var/lib/mysql
  mediawiki:
    image: mediawiki:lts
    ports:
      - "127.0.0.1:8080:80"
    depends_on:
      - wiki-db
volumes:
  wiki-db:
```

These credentials are for the disposable database. Start it:

```bash
docker compose -f compose.wiki.yaml up -d
```

Open `http://127.0.0.1:8080` and complete the MediaWiki installer:

| Installer field | Value |
| --- | --- |
| Database type | MySQL/MariaDB |
| Database host | `wiki-db` |
| Database name | `mediawiki` |
| Database user | `mediawiki` |
| Database password | `local-dev-only` |

Choose a wiki name and test admin account. When the installer downloads
`LocalSettings.php`, copy that file into the container. From the directory
containing both your Compose file and the downloaded settings file:

```bash
docker compose -f compose.wiki.yaml cp LocalSettings.php mediawiki:/var/www/html/LocalSettings.php
```

Reload the wiki and create a [bot password](docs/configuration.md#bot-passwords)
for the test account. Use the generated username/password in the repository's
`.env`, with `MEDIAWIKI_BASE_URL=http://127.0.0.1:8080` when Node runs on the host.
A connector running in another container needs an address reachable from that
container instead of this loopback URL.

The database volume persists across container restarts. `LocalSettings.php` above
was copied into the container; repeat that copy if you replace the container.

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
