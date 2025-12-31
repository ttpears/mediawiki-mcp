# MediaWiki MCP Server

A Model Context Protocol (MCP) server for read-only access to MediaWiki instances. Provides comprehensive tools for searching, reading, browsing categories, and accessing page history.

## Features

- **Search Pages**: Full-text search with snippets and metadata
- **Read Content**: Retrieve page content in wikitext or HTML
- **Page History**: Access revision history with timestamps and authors
- **Category Browsing**: List categories and their members
- **Recent Changes**: Track wiki activity
- **Link Analysis**: Explore page connections and backlinks

## Installation

### Prerequisites

- Node.js 18 or higher
- npm or yarn

### Local Installation

```bash
# Clone repository
git clone <repository-url>
cd mediawiki-mcp

# Install dependencies
npm install

# Build TypeScript
npm run build

# Configure environment
cp .env.example .env
# Edit .env with your MediaWiki URL
```

### Docker Installation

```bash
# Using Docker Compose
docker-compose up -d

# Or build manually
docker build -t mediawiki-mcp .
docker run -e MEDIAWIKI_BASE_URL=https://wiki.example.com -p 8009:8009 mediawiki-mcp
```

## Configuration

Set environment variables in `.env`:

```bash
MEDIAWIKI_BASE_URL=https://wiki.example.com
MEDIAWIKI_MCP_PORT=8009
MEDIAWIKI_MCP_HOST=localhost
```

## Usage

### Stdio Mode (Local)

```bash
# Set environment variable
export MEDIAWIKI_BASE_URL=https://wiki.example.com

# Run server
npm start
```

### SSE Mode (Remote)

```bash
# Set environment variables
export MEDIAWIKI_BASE_URL=https://wiki.example.com
export MEDIAWIKI_MCP_PORT=8009
export MEDIAWIKI_MCP_HOST=0.0.0.0

# Run SSE server
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
      - MEDIAWIKI_BASE_URL=https://wiki.example.com
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
      "description": "Access to your MediaWiki instance"
    }
  }
}
```

## Tools

### 1. search_pages
Search wiki pages with full-text search.

**Parameters:**
- `query` (string): Search query
- `limit` (number, optional): Max results (default: 10)
- `namespace` (number, optional): Namespace filter

**Example:**
```json
{
  "query": "typescript",
  "limit": 5
}
```

### 2. get_page
Retrieve full page content and metadata.

**Parameters:**
- `title` (string): Page title
- `include_html` (boolean, optional): Return HTML instead of wikitext

**Example:**
```json
{
  "title": "Main Page",
  "include_html": false
}
```

### 3. get_page_history
Get revision history for a page.

**Parameters:**
- `title` (string): Page title
- `limit` (number, optional): Number of revisions (default: 20)

**Example:**
```json
{
  "title": "Main Page",
  "limit": 10
}
```

### 4. list_categories
List all wiki categories.

**Parameters:**
- `prefix` (string, optional): Filter by prefix
- `limit` (number, optional): Max results (default: 20)

**Example:**
```json
{
  "prefix": "Doc",
  "limit": 10
}
```

### 5. get_category_members
List pages in a category.

**Parameters:**
- `category` (string): Category name
- `limit` (number, optional): Max results (default: 50)
- `type` (string, optional): Filter by type (page/subcat/file)

**Example:**
```json
{
  "category": "Documentation",
  "type": "page"
}
```

### 6. get_recent_changes
List recent wiki changes.

**Parameters:**
- `limit` (number, optional): Max results (default: 20)
- `namespace` (number, optional): Namespace filter
- `type` (string, optional): Change type (edit/new/log)

**Example:**
```json
{
  "limit": 10,
  "type": "edit"
}
```

### 7. get_page_links
Get links from or to a page.

**Parameters:**
- `title` (string): Page title
- `direction` (string): "from" or "to" (default: "from")
- `limit` (number, optional): Max results (default: 50)

**Example:**
```json
{
  "title": "Main Page",
  "direction": "to"
}
```

## Development

```bash
# Watch mode
npm run dev

# Type checking
npm run type-check

# Build
npm run build

# Test API connection
curl http://localhost:8009/health
```

## Architecture

```
mediawiki-mcp/
├── src/
│   ├── index.ts              # Main entry point
│   ├── stdio.ts              # Stdio transport
│   ├── sse-transport.ts      # SSE transport
│   ├── mediawiki-client.ts   # API client
│   ├── mediawiki-tools.ts    # Tool definitions
│   └── types.ts              # TypeScript types
└── dist/                     # Compiled output
```

### Three-Tier Architecture

```
Transport Layer (stdio.ts, sse-transport.ts)
    ↓
Tools Layer (mediawiki-tools.ts)
    ↓
Client Layer (mediawiki-client.ts)
```

## MediaWiki API

All API calls use: `{baseUrl}/api.php`

Supported MediaWiki API actions:
- `action=query&list=search` - Full-text search
- `action=query&prop=revisions` - Page content and history
- `action=query&list=allcategories` - List categories
- `action=query&list=categorymembers` - Category contents
- `action=query&list=recentchanges` - Recent changes
- `action=query&prop=links` - Page links
- `action=query&list=backlinks` - Backlinks

## License

MIT

## Contributing

Contributions welcome! Please open issues or pull requests.

## Support

For issues or questions, please open an issue on GitHub.
