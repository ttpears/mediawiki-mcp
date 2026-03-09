# MediaWiki MCP Server

A Model Context Protocol (MCP) server for MediaWiki instances with multi-wiki support. Uses the modern REST API (MediaWiki 1.42+) and Action API for full read/write access across multiple named wikis.

## Features

- **Multi-Wiki Support**: Register named wikis, fan-out searches across all of them
- **REST API**: Uses the modern `/rest.php/v1/` endpoints for page CRUD, search, and revisions
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
docker-compose up -d

# Or build manually
docker build -t mediawiki-mcp .
docker run -e MEDIAWIKI_WIKIS="Main:https://wiki.example.com" -p 8009:8009 mediawiki-mcp
```

## Authentication

This server uses MediaWiki **bot passwords** for API authentication. Bot passwords are scoped credentials that limit what the bot can do, separate from your real account password.

### Creating a Bot Password

1. Log in to your MediaWiki wiki as a user with the permissions you want the bot to have
2. Navigate to **Special:BotPasswords** (e.g., `https://wiki.example.com/wiki/Special:BotPasswords`)
3. Enter a bot name (e.g., `mcp-server`) and click **Create**
4. Select the grants (permissions) the bot needs:
   - **Basic rights** — read pages (minimum for read-only access)
   - **Edit existing pages** — for `update-page`
   - **Create, edit, and move pages** — for `create-page`
   - **Delete pages and revisions** — for `delete-page` / `undelete-page`
   - **Upload new files** — for `upload-file` / `upload-file-from-url`
   - **High-volume editing** — recommended if doing bulk operations
5. Click **Create** to generate the password

MediaWiki will display a username and password in this format:

```
Username: YourUsername@mcp-server
Password: your-bot-password-here
```

**The token for this server is the password portion only** (the long generated string). The username portion is used with `action=login` which this server handles internally via the bearer token mechanism.

> If your MediaWiki instance uses bearer token authentication (e.g., via OAuth2 or a custom auth extension), use that token directly instead.

### Repeat for Each Wiki

If you have multiple wikis, create a bot password on each one. You'll end up with one token per wiki.

## Configuration

### Multi-Wiki Setup

Create a `.env` file in the project root:

```bash
# .env

# Register multiple wikis with named labels
MEDIAWIKI_WIKIS=Sales:https://sales.wiki.example.com,Dev:https://dev.wiki.example.com

# Set the default wiki (used when no wiki is specified)
MEDIAWIKI_DEFAULT_WIKI=Sales

# Per-wiki API tokens (uppercase wiki name)
# These are the bot passwords from Special:BotPasswords on each wiki
MEDIAWIKI_API_TOKEN_SALES=your-bot-password-here
MEDIAWIKI_API_TOKEN_DEV=your-bot-password-here
```

### Single-Wiki Setup (Backwards Compatible)

```bash
# .env

MEDIAWIKI_BASE_URL=https://wiki.example.com
MEDIAWIKI_API_TOKEN=your-bot-password-here
```

### SSE Transport

```bash
MEDIAWIKI_MCP_PORT=8009
MEDIAWIKI_MCP_HOST=localhost
```

## Usage

### Stdio Mode (Local)

```bash
npm start
```

### SSE Mode (Remote)

```bash
npm run start:sse
```

Access at: `http://localhost:8009/sse`

### LibreChat Integration

#### 1. Create a `.env` file for the MCP container

Create a file at the same level as your LibreChat `docker-compose.yml`, e.g. `mediawiki-mcp.env`:

```bash
# mediawiki-mcp.env

MEDIAWIKI_WIKIS=Sales:https://sales.wiki.example.com,Dev:https://dev.wiki.example.com
MEDIAWIKI_DEFAULT_WIKI=Sales
MEDIAWIKI_API_TOKEN_SALES=your-bot-password-here
MEDIAWIKI_API_TOKEN_DEV=your-bot-password-here
MEDIAWIKI_MCP_PORT=8009
MEDIAWIKI_MCP_HOST=0.0.0.0
```

#### 2. Add to `docker-compose.override.yml`

```yaml
services:
  mediawiki-mcp:
    build: /path/to/mediawiki-mcp
    container_name: mediawiki-mcp
    env_file:
      - mediawiki-mcp.env
    networks:
      - librechat_network
    restart: unless-stopped

networks:
  librechat_network:
    external: true
```

#### 3. Configure in `librechat.yaml`

Add the MCP server to your LibreChat configuration:

```yaml
mcpServers:
  mediawiki:
    type: sse
    url: http://mediawiki-mcp:8009/sse
    title: "MediaWiki"
    description: "Search and edit your MediaWiki instances"
```

> Make sure `mediawiki-mcp` (the container name) is listed in LibreChat's `allowedDomains` if you have domain restrictions configured.

## Tools

All tools that accept a `wiki` parameter will use the default wiki when omitted. Search and listing tools fan out across all registered wikis when `wiki` is not specified.

### Wiki Management

| Tool | Description |
|------|-------------|
| `add-wiki` | Register a new named wiki (name, url, token) |
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
npm test           # Run tests (86 tests)
npm run test:watch # Watch mode tests
```

## Architecture

```
src/
├── index.ts                # Entry point
├── stdio.ts                # Stdio transport
├── sse-transport.ts        # SSE transport
├── wiki-registry.ts        # Named wiki storage and env parsing
├── wiki-orchestrator.ts    # Fan-out routing and client management
├── types.ts                # TypeScript types
├── clients/
│   ├── rest-client.ts      # REST API (/rest.php/v1/)
│   └── action-client.ts    # Action API (/api.php)
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
Transport Layer (stdio.ts, sse-transport.ts)
         ↓
   WikiOrchestrator (fan-out / routing)
     ↓              ↓
RestClient      ActionClient
(/rest.php/v1)  (/api.php)
```

## License

MIT

## Contributing

Contributions welcome! Please open issues or pull requests.
