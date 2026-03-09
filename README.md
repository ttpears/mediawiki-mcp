# MediaWiki MCP Server

A Model Context Protocol (MCP) server for MediaWiki instances with multi-wiki support. Uses the modern REST API (MediaWiki 1.42+) and Action API for full read/write access across multiple named wikis.

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

- Node.js 18 or higher
- MediaWiki 1.42 or higher

### Local Installation

```bash
git clone https://github.com/ttpears/mediawiki-mcp.git
cd mediawiki-mcp
npm install
npm run build
```

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
   - **Basic rights** — read pages (minimum for read-only access)
   - **Edit existing pages** — for `update-page`
   - **Create, edit, and move pages** — for `create-page`
   - **Delete pages and revisions** — for `delete-page` / `undelete-page`
   - **Upload new files** — for `upload-file` / `upload-file-from-url`
   - **High-volume editing** — recommended if doing bulk operations
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
MEDIAWIKI_WIKIS=Sales:https://wiki.example.com,Dev:https://dev.wiki.example.com,Tech:https://tech.wiki.example.com,Content:https://content.wiki.example.com

# Default wiki when none is specified
MEDIAWIKI_DEFAULT_WIKI=Sales

# Per-wiki bot password credentials (uppercase wiki name)
MEDIAWIKI_USERNAME_SALES=Admin@mcp
MEDIAWIKI_PASSWORD_SALES=your-bot-password-here
MEDIAWIKI_USERNAME_DEV=Admin@mcp
MEDIAWIKI_PASSWORD_DEV=your-bot-password-here
MEDIAWIKI_USERNAME_TECH=Admin@mcp
MEDIAWIKI_PASSWORD_TECH=your-bot-password-here
MEDIAWIKI_USERNAME_CONTENT=Admin@mcp
MEDIAWIKI_PASSWORD_CONTENT=your-bot-password-here
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

### HTTP Mode (Remote / Docker)

```bash
npm run start:http
```

Endpoint: `http://localhost:8009/mcp`

### LibreChat Integration

#### 1. Add wiki credentials to the LibreChat `.env`

Add the `MEDIAWIKI_*` variables to your LibreChat `.env` file (e.g. `/srv/docker/LibreChat/.env`):

```bash
# MediaWiki MCP
MEDIAWIKI_WIKIS=Sales:https://wiki.example.com,Dev:https://dev.wiki.example.com,Tech:https://tech.wiki.example.com,Content:https://content.wiki.example.com
MEDIAWIKI_DEFAULT_WIKI=Sales
MEDIAWIKI_USERNAME_SALES=Admin@mcp
MEDIAWIKI_PASSWORD_SALES=your-bot-password-here
MEDIAWIKI_USERNAME_DEV=Admin@mcp
MEDIAWIKI_PASSWORD_DEV=your-bot-password-here
MEDIAWIKI_USERNAME_TECH=Admin@mcp
MEDIAWIKI_PASSWORD_TECH=your-bot-password-here
MEDIAWIKI_USERNAME_CONTENT=Admin@mcp
MEDIAWIKI_PASSWORD_CONTENT=your-bot-password-here
```

#### 2. Add to `docker-compose.override.yml`

```yaml
services:
  mediawiki-mcp:
    build: /srv/docker/mediawiki-mcp
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

## Tools

All tools that accept a `wiki` parameter will use the default wiki when omitted. Search and listing tools fan out across all registered wikis when `wiki` is not specified.

### Wiki Management

| Tool | Description |
|------|-------------|
| `add-wiki` | Register a new named wiki (name, url, username, password) |
| `remove-wiki` | Remove a registered wiki |
| `list-wikis` | Show all registered wikis |

### Search (Fan-Out)

| Tool | Description |
|------|-------------|
| `search-pages` | Full-text search across wikis |
| `search-pages-by-prefix` | Title prefix search across wikis |

**Parameters:** `query`, `wiki?`, `limit?`

### Page Operations (Single Wiki)

| Tool | Description |
|------|-------------|
| `get-page` | Get page content (wikitext or HTML) and metadata |
| `create-page` | Create a new page |
| `update-page` | Edit an existing page (requires `latest_timestamp` from get-page) |
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
npm run dev        # Watch mode
npm run type-check # Type checking
npm run build      # Build
npm test           # Run tests (85 tests)
npm run test:watch # Watch mode tests
```

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
