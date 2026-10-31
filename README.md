# MediaWiki MCP Server

A Model Context Protocol (MCP) server for MediaWiki instances with multi-wiki support. Uses the modern REST API (MediaWiki 1.42+) and Action API for full read/write access across multiple named wikis.

Field notes: [MediaWiki MCP: reads worked after login expired](https://hackyourworld.com/mediawiki-mcp-login-expired-docker-port/) covers the expired bot-password session and loopback-only container listener failures behind the current authentication and deployment checks.

## Features

- **Multi-Wiki Support**: Register named wikis, fan-out searches across all of them
- **REST API**: Uses the modern `/rest.php/v1/` endpoints for page CRUD, search, and revisions
- **Bot Password Auth**: Logs in via `Special:BotPasswords` with per-wiki credentials
- **Page Operations**: Read, create, update, delete, and undelete pages
- **Search**: Full-text and prefix search across all registered wikis
- **File Operations**: Get file metadata, upload files from data or URL
- **Category Browsing**: List categories and their members with pagination
- **History & Revisions**: Access revision history, view individual revisions
- **Recent Changes**: Track wiki activity across all wikis
- **Link Analysis**: Explore outgoing links and backlinks
- **Pagination**: All list endpoints support continuation tokens
- **Retry Logic**: Exponential backoff on 429/5xx errors

## Installation

### Prerequisites

- Node.js 20 or higher (Node.js 24 LTS recommended)
- MediaWiki 1.42 or higher

### Local Installation

```bash
git clone https://github.com/ttpears/mediawiki-mcp.git
cd mediawiki-mcp
npm ci
npm run build
```

### Claude Code Installation

Register the published npm package directly with `claude mcp add`. Repeat `--env` for each variable, put all flags **before** the server name, and use `--` to mark the start of the spawned command. `--scope` picks where the entry lives: `local` (default, current project), `user` (every project), or `project` (`.mcp.json` for team check-in).

Single-wiki:

```bash
claude mcp add mediawiki \
  --scope user \
  --env MEDIAWIKI_BASE_URL=https://wiki.example.com \
  --env MEDIAWIKI_USERNAME=Admin@mcp \
  --env MEDIAWIKI_PASSWORD=your-bot-password \
  -- npx -y mediawiki-mcp
```

Multi-wiki — register wikis as `Name:URL` pairs in `MEDIAWIKI_WIKIS`, then provide `MEDIAWIKI_USERNAME_<NAME>` and `MEDIAWIKI_PASSWORD_<NAME>` per wiki (uppercase). `MEDIAWIKI_DEFAULT_WIKI` picks the wiki used when a tool call doesn't specify one:

```bash
claude mcp add mediawiki \
  --scope user \
  --env MEDIAWIKI_WIKIS=Main:https://wiki.example.com,Dev:https://dev.wiki.example.com \
  --env MEDIAWIKI_DEFAULT_WIKI=Main \
  --env MEDIAWIKI_USERNAME_MAIN=Admin@mcp \
  --env MEDIAWIKI_PASSWORD_MAIN=your-bot-password \
  --env MEDIAWIKI_USERNAME_DEV=Admin@mcp \
  --env MEDIAWIKI_PASSWORD_DEV=your-bot-password \
  -- npx -y mediawiki-mcp
```

### Claude Desktop (MCPB bundle)

Each release attaches a one-click `mediawiki-mcp-<version>.mcpb` bundle. Download it
from the [latest release](https://github.com/ttpears/mediawiki-mcp/releases/latest)
and open it with Claude Desktop (Settings → Extensions → install from file, or
double-click). Claude Desktop prompts for the configuration:

- **Wiki API Base URL** — e.g. `https://wiki.example.com` (single-wiki setup).
- **Bot Username** / **Bot Password** — optional; from `Special:BotPasswords`. Leave
  blank for anonymous read-only access. Credentials are stored in your OS keychain.
- **Wikis** / **Default Wiki Name** — optional advanced fields for multi-wiki use.
  Note: per-wiki credentials can't be entered through the bundle UI, so authenticated
  multi-wiki still needs the Docker/env setup below.

To build the bundle locally: `npm run build:mcpb`.

### Docker Installation

```bash
cp .env.example .env
# Edit .env with your wiki URLs and credentials
docker compose up -d
```

## Authentication

This server uses MediaWiki **bot passwords** for API authentication. Bot passwords are scoped credentials that limit what the bot can do, separate from your real account password.

### Creating a Bot Password

1. Log in to your MediaWiki wiki as a user with the permissions you want the bot to have
2. Navigate to **Special:BotPasswords** (e.g., `https://wiki.example.com/wiki/Special:BotPasswords`)
3. Enter a bot name (e.g., `mcp`) and click **Create**
4. Select the grants (permissions) the bot needs:
   - **High-volume (bot) access** — required for API usage
   - **Edit existing pages** — for `update-page`
   - **Edit protected pages** — if the bot needs to edit protected pages
   - **Create, edit, and move pages** — for `create-page`, `update-page`
   - **Delete pages and revisions** — for `delete-page` / `undelete-page`
   - **Upload, replace, and move files** — for `upload-file` / `upload-file-from-url`
   - **Patrol changes to pages** — if using activity monitoring
   - **Rollback changes to pages** — if using rollback features
5. Click **Create** to generate the password

MediaWiki will display credentials in this format:

```
Username: Admin@mcp
Password: your-bot-password-here
```

You need **both** values. The username (`Admin@mcp`) goes in `MEDIAWIKI_USERNAME_*` and the password goes in `MEDIAWIKI_PASSWORD_*`. The server uses these to log in via the Action API (`action=login`) and maintains a cookie-based session for all subsequent requests.

### Repeat for Each Wiki

If you have multiple wikis, create a bot password on each one. You'll have a username/password pair per wiki.

## Configuration

### Multi-Wiki Setup

Create a `.env` file (see `.env.example`):

```bash
# Register multiple wikis (Name:URL pairs, comma-separated)
MEDIAWIKI_WIKIS=Main:https://wiki.example.com,Dev:https://dev.wiki.example.com

# Default wiki when none is specified
MEDIAWIKI_DEFAULT_WIKI=Main

# Per-wiki bot password credentials (uppercase wiki name)
MEDIAWIKI_USERNAME_MAIN=Admin@mcp
MEDIAWIKI_PASSWORD_MAIN=your-bot-password-here
MEDIAWIKI_USERNAME_DEV=Admin@mcp
MEDIAWIKI_PASSWORD_DEV=your-bot-password-here
```

### Single-Wiki Setup

```bash
MEDIAWIKI_BASE_URL=https://wiki.example.com
MEDIAWIKI_USERNAME=Admin@mcp
MEDIAWIKI_PASSWORD=your-bot-password-here
```

### HTTP Transport

```bash
MEDIAWIKI_MCP_PORT=8009
MEDIAWIKI_MCP_HOST=0.0.0.0
```

## Usage

### Stdio Mode (Local)

```bash
npm start
```

This reads environment variables inherited from the MCP client or shell. For a
source checkout configured with a local `.env`, use Node.js 24 LTS and load the
file explicitly:

```bash
node --env-file=.env dist/index.js
```

`npm start` and `npm run start:http` do not load `.env` themselves. Docker Compose
loads it through the service's `env_file` setting.

### HTTP Mode (Remote / Docker)

```bash
npm run start:http
```

For a source checkout with `.env`:

```bash
node --env-file=.env dist/http-transport.js
```

Endpoint: `http://localhost:8009/mcp`

Check the running service and its version with:

```bash
curl --fail http://localhost:8009/health
```

The health response includes `status`, `version`, and `auth`; it checks the server,
not connectivity or credentials for each wiki. Call `list-wikis` through your MCP
client to inspect wiki authentication. The default HTTP mode has no inbound
authentication; use it on a private network for LibreChat, or configure OAuth
below for a public connector. The local HTTP default is loopback; the container
sets `MEDIAWIKI_MCP_HOST=0.0.0.0` so its published port is reachable.

### LibreChat Integration

#### 1. Add wiki credentials to the LibreChat `.env`

Add the `MEDIAWIKI_*` variables to your LibreChat host's `.env` file:

```bash
# MediaWiki MCP
MEDIAWIKI_WIKIS=Main:https://wiki.example.com,Dev:https://dev.wiki.example.com
MEDIAWIKI_DEFAULT_WIKI=Main
MEDIAWIKI_USERNAME_MAIN=Admin@mcp
MEDIAWIKI_PASSWORD_MAIN=your-bot-password-here
MEDIAWIKI_USERNAME_DEV=Admin@mcp
MEDIAWIKI_PASSWORD_DEV=your-bot-password-here
```

#### 2. Add to `docker-compose.override.yml`

```yaml
services:
  mediawiki-mcp:
    build: ./mediawiki-mcp
    container_name: mediawiki-mcp
    env_file:
      - .env
    environment:
      - MEDIAWIKI_MCP_HOST=0.0.0.0
    restart: unless-stopped
    networks:
      - default
```

This builds the container from source and starts it alongside LibreChat. No need to install Node.js on the host — Docker handles the build.

#### 3. Configure in `librechat.yaml`

```yaml
mcpServers:
  mediawiki:
    type: streamable-http
    url: http://mediawiki-mcp:8009/mcp
```

> If you have `allowedDomains` configured in LibreChat, add `mediawiki-mcp` to the list.

### Use as a Claude.ai Connector (OAuth)

The HTTP transport can run as a public remote connector for claude.ai,
authenticated with **Microsoft Entra (OIDC)** — no MediaWiki extensions required.
The server is an OAuth 2.1 broker: it presents authorization-server metadata and
Dynamic Client Registration to Claude, runs the Entra sign-in flow, and issues its
own audience-bound access tokens. **Entra decides who can connect**; wiki reads and
edits run on the existing **per-wiki bot accounts** (`MEDIAWIKI_USERNAME_<WIKI>` /
`MEDIAWIKI_PASSWORD_<WIKI>`), attributed to the Entra user in edit summaries. Only
broker session state lives in **Redis** (namespaced by host); no wiki credentials
or Entra tokens are stored. The stdio and LibreChat header paths are unaffected.

The connector serves the whole farm in `MEDIAWIKI_WIKIS` (cross-wiki fan-out). Any
tenant member can **read**; **write** tools (create/update/delete/upload) are gated
by an Entra **app role** (`OAUTH_WRITE_ROLE`, default `Writer`) — members without
it get read-only.

**1. Register / reuse an Entra app**

- Reuse an existing Entra app (e.g. the bookstack connector's) or register a new one.
- Add the redirect URI `https://<your-public-url>/callback`.
- Define an app role for write access (e.g. `Writer`) and assign it to the users
  who should be able to edit. (Reading needs no role.)

**2. Configure the connector environment**

```bash
MEDIAWIKI_MCP_AUTH=oauth
MEDIAWIKI_MCP_PUBLIC_URL=https://wiki-mcp.example.com    # public HTTPS base URL
# the farm to serve, and per-wiki bot credentials for the actual API calls:
MEDIAWIKI_WIKIS=itops:https://itops.wiki.example.com,tech:https://tech.wiki.example.com
MEDIAWIKI_DEFAULT_WIKI=itops
MEDIAWIKI_USERNAME_ITOPS=Bot@mcp
MEDIAWIKI_PASSWORD_ITOPS=<bot password>
MEDIAWIKI_USERNAME_TECH=Bot@mcp
MEDIAWIKI_PASSWORD_TECH=<bot password>
# Entra app (OIDC):
OAUTH_TENANT_ID=<entra tenant id>
OAUTH_CLIENT_ID=<entra app client id>
OAUTH_CLIENT_SECRET=<entra app client secret>
OAUTH_WRITE_ROLE=Writer                                  # app role granting write
# broker infra:
REDIS_URL=redis://:<password>@redis:6379                 # shared broker state
MEDIAWIKI_MCP_JWT_SECRET=<random secret>
MEDIAWIKI_MCP_HOST=0.0.0.0
MEDIAWIKI_MCP_TRUST_PROXY=1                               # behind a reverse proxy
# MEDIAWIKI_MCP_ALLOWED_HOSTS=wiki-mcp.example.com        # optional Host allowlist
```

Terminate TLS at your reverse proxy and forward to the server; it must be reachable
at `MEDIAWIKI_MCP_PUBLIC_URL`. Run the published image `ghcr.io/ttpears/mediawiki-mcp`
(the `npm run start:http` entrypoint) or locally with `npm run start:http`.

**3. Add the connector in claude.ai**

Add a custom connector pointing at `https://<your-public-url>/mcp`. Claude discovers
the auth server via `/.well-known/oauth-protected-resource/mcp`, registers itself
via DCR, and signs the user in through Entra. One sign-in covers the whole farm.

## Tools

All tools that accept a `wiki` parameter will use the default wiki when omitted. Search and listing tools fan out across all registered wikis when `wiki` is not specified.

### Wiki Management

| Tool | Description |
|------|-------------|
| `add-wiki` | Register a new named wiki (name, url, username, password) |
| `remove-wiki` | Remove a registered wiki |
| `set-wiki` | Set the default wiki for this session |
| `list-wikis` | Show all registered wikis |

### Search (Fan-Out)

| Tool | Description |
|------|-------------|
| `find-page` | Locate a page by exact title, redirect, prefix, then full-text match |
| `search-pages` | Full-text search across wikis |
| `search-pages-by-prefix` | Title prefix search across wikis |

**Parameters:** `query`, `wiki?`, `limit?`

### Page Operations (Single Wiki)

| Tool | Description |
|------|-------------|
| `get-page` | Get page content (wikitext or HTML) and metadata |
| `create-page` | Create a new page |
| `update-page` | Edit with a unified diff, section and content, append, prepend, or full replacement |
| `delete-page` | Delete a page |
| `undelete-page` | Restore a deleted page |

### History (Single Wiki)

| Tool | Description |
|------|-------------|
| `get-page-history` | Paginated revision list for a page |
| `get-revision` | Get details of a specific revision by ID |

### Categories

| Tool | Description |
|------|-------------|
| `list-categories` | List categories with member counts (fan-out) |
| `get-category-members` | List pages in a category (single wiki, paginated) |

### Files (Single Wiki)

| Tool | Description |
|------|-------------|
| `get-file` | Get file metadata, dimensions, and URLs |
| `upload-file` | Upload from base64-encoded data |
| `upload-file-from-url` | Upload from a remote URL |

### Activity (Fan-Out)

| Tool | Description |
|------|-------------|
| `get-recent-changes` | Recent edits, creations, and deletions across wikis |

### Links (Single Wiki)

| Tool | Description |
|------|-------------|
| `get-page-links` | Get outgoing links or backlinks for a page |

## Development

```bash
npm run dev        # Compile and watch; does not start a server
npm run type-check # Type checking
npm run build      # Build
npm test           # Run the current test suite
npm run test:watch # Watch mode tests
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for a disposable wiki setup and
[the release guide](docs/releasing.md) for version bumps, publication, and
verification across npm, Docker, and Claude Desktop.

## Upgrading and troubleshooting

Use a versioned package or image for repeatable deployments. After a release is
published, `npx -y mediawiki-mcp@2.5.3` selects that exact stdio package. Update the
command in your MCP client and restart the server process; an existing process
does not upgrade itself. The MCP `initialize` response reports the running
version. Claude Desktop users install the new release's `.mcpb` asset.

For this repository's Compose file, which builds from source:

```bash
git pull --ff-only
docker compose up -d --build mediawiki-mcp
curl --fail http://localhost:8009/health
```

Deployments using the published image should pin
`ghcr.io/ttpears/mediawiki-mcp:2.5.3`, pull it, and recreate their service instead
of using the source-build command. Keep the previous version available for
rollback. Version tags become available only after release approval and successful
publication; a Git tag alone does not mean npm or the image has been published.

| Symptom | What to check |
|---------|---------------|
| Missing wiki configuration | Export `MEDIAWIKI_*`, load `.env` explicitly for Node, or check Compose `env_file`. |
| Reads work but writes fail | Call `list-wikis` and check the bot username, password, and MediaWiki grants. Expired bot sessions are retried on writes; revoked credentials still need replacing. |
| HTTP 404 with `Session not found` | Reconnect or re-initialize the MCP client. Sessions expire after 30 minutes idle by default and are lost on restart. |
| HTTP 503 on a new connection | The session cap was reached; inspect `MEDIAWIKI_MAX_SESSIONS` and idle-session settings in `.env.example`. |
| HTTP 421 in OAuth mode | Check the public hostname against `MEDIAWIKI_MCP_ALLOWED_HOSTS`. |
| Container is unreachable | Check the port mapping, `/health`, and the bind host. Inside a container, loopback is not reachable through a published port. |

## Architecture

```
src/
├── index.ts                # Entry point (stdio)
├── stdio.ts                # Stdio transport
├── http-transport.ts       # Streamable HTTP transport
├── wiki-registry.ts        # Named wiki storage and env parsing
├── wiki-orchestrator.ts    # Fan-out routing and client management
├── types.ts                # TypeScript types
├── clients/
│   ├── rest-client.ts      # REST API (/rest.php/v1/)
│   └── action-client.ts    # Action API (/api.php) + bot password login
└── tools/
    ├── index.ts            # Tool registration barrel
    ├── wiki-tools.ts       # Wiki management
    ├── search-tools.ts     # Search (fan-out)
    ├── page-tools.ts       # Page CRUD
    ├── history-tools.ts    # Revision history
    ├── category-tools.ts   # Categories
    ├── link-tools.ts       # Links and backlinks
    ├── file-tools.ts       # File operations
    └── activity-tools.ts   # Recent changes
```

```
Transport Layer (stdio.ts, http-transport.ts)
         ↓
   WikiOrchestrator (fan-out / routing)
     ↓              ↓
RestClient      ActionClient
(/rest.php/v1)  (/api.php)
     ↑              ↑
     └── shared session cookies (bot password login)
```

## License

MIT

## Contributing

Contributions welcome! Please open issues or pull requests.
