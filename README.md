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

## Configuration

### Multi-Wiki Setup

```bash
# Register multiple wikis with named labels
MEDIAWIKI_WIKIS=Sales:https://sales.wiki.example.com,Dev:https://dev.wiki.example.com

# Set the default wiki (used when no wiki is specified)
MEDIAWIKI_DEFAULT_WIKI=Sales

# Per-wiki API tokens (uppercase wiki name)
MEDIAWIKI_API_TOKEN_SALES=your-sales-token
MEDIAWIKI_API_TOKEN_DEV=your-dev-token
```

### Single-Wiki Setup (Backwards Compatible)

```bash
MEDIAWIKI_BASE_URL=https://wiki.example.com
MEDIAWIKI_API_TOKEN=your-token
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

Add to LibreChat's `docker-compose.override.yml`:

```yaml
version: '3.8'

services:
  mediawiki-mcp:
    build: /path/to/mediawiki-mcp
    container_name: mediawiki-mcp
    environment:
      - MEDIAWIKI_WIKIS=Sales:https://sales.wiki.com,Dev:https://dev.wiki.com
      - MEDIAWIKI_DEFAULT_WIKI=Sales
      - MEDIAWIKI_API_TOKEN_SALES=token1
      - MEDIAWIKI_API_TOKEN_DEV=token2
      - MEDIAWIKI_MCP_PORT=8009
      - MEDIAWIKI_MCP_HOST=0.0.0.0
    networks:
      - librechat_network
    restart: unless-stopped

networks:
  librechat_network:
    external: true
```

Configure in LibreChat MCP settings:
```json
{
  "mcpServers": {
    "mediawiki": {
      "url": "http://mediawiki-mcp:8009/sse",
      "name": "MediaWiki",
      "description": "Access to your MediaWiki instances"
    }
  }
}
```

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
