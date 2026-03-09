# MediaWiki MCP Server Modernization Design

## Goal

Full overhaul of the MediaWiki MCP server: migrate to the REST API (1.42+), add intelligent multi-wiki fan-out, proper pagination, retry/error handling, and expanded file operations.

## Architecture

```
┌─────────────────────────────────────────────┐
│                MCP Tools Layer              │
│  19 tools organized by domain              │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────▼──────────────────────────┐
│            WikiOrchestrator                 │
│  - WikiRegistry (named wikis)              │
│  - Fan-out for broad ops, route for narrow │
│  - Pagination wrapper                       │
│  - Retry + error handling                   │
└──────────┬─────────────────┬────────────────┘
           │                 │
┌──────────▼────────┐ ┌─────▼──────────────┐
│    RestClient     │ │   ActionClient     │
│  /rest.php/v1/    │ │   /api.php         │
└───────────────────┘ └────────────────────┘
```

Each registered wiki gets its own RestClient + ActionClient pair.

## File Structure

```
src/
  clients/
    rest-client.ts        # REST API (/rest.php/v1/)
    action-client.ts      # Action API (/api.php)
  wiki-registry.ts        # Named wiki storage + config
  wiki-orchestrator.ts    # Fan-out, routing, pagination, retry
  tools/
    search-tools.ts       # search-pages, search-pages-by-prefix
    page-tools.ts         # get-page, create-page, update-page, delete-page, undelete-page
    history-tools.ts      # get-page-history, get-revision
    category-tools.ts     # list-categories, get-category-members
    file-tools.ts         # get-file, upload-file, upload-file-from-url
    wiki-tools.ts         # add-wiki, remove-wiki, list-wikis
    link-tools.ts         # get-page-links
    activity-tools.ts     # get-recent-changes
  types.ts
  index.ts
  stdio.ts
  sse-transport.ts
```

## Multi-Wiki Behavior

### Wiki Registry

- Wikis configured via env vars or `add-wiki` tool at runtime
- Each wiki: name (label), baseUrl, apiToken (optional)
- One wiki marked as default
- Backwards-compatible: MEDIAWIKI_BASE_URL still works (registered as "default")

### Environment Config

```
MEDIAWIKI_WIKIS=Sales:https://sales.wiki.example.com,Dev:https://dev.wiki.example.com
MEDIAWIKI_DEFAULT_WIKI=Sales
MEDIAWIKI_API_TOKEN_SALES=token123
MEDIAWIKI_API_TOKEN_DEV=token456
```

### Fan-out vs. Single-Wiki Routing

| Operation | No `wiki` param | With `wiki` param |
|-----------|----------------|-------------------|
| search-pages | Fan out to all | Single wiki |
| search-pages-by-prefix | Fan out to all | Single wiki |
| recent-changes | Fan out, merge by timestamp | Single wiki |
| list-categories | Fan out, label by wiki | Single wiki |
| get-page | Default wiki | Specified wiki |
| create/update/delete-page | Default wiki | Specified wiki |
| upload-file | Default wiki | Specified wiki |
| get-page-history | Default wiki | Specified wiki |
| get-page-links | Default wiki | Specified wiki |
| get-file | Default wiki | Specified wiki |

Fan-out results always labeled with wiki name: `[Sales] Product Overview`.

Partial failure on fan-out: return results from healthy wikis + warning about failed ones.

## API Client Split

### RestClient (/rest.php/v1/)

- `GET /page/{title}` — page source + metadata
- `POST /page` — create page
- `PUT /page/{title}` — update page
- `GET /search/page?q=` — search
- `GET /page/{title}/history` — revision list
- `GET /revision/{id}` — single revision
- `GET /file/{title}` — file metadata + URLs

### ActionClient (/api.php)

- `list=allcategories` / `list=categorymembers`
- `list=recentchanges`
- `list=backlinks`
- `prop=links` (outgoing links)
- `action=upload` (file upload)
- `action=delete` / `action=undelete`
- CSRF token acquisition for write ops

### Shared Infrastructure

- Retry: exponential backoff, 3 attempts, on 429/5xx only
- Pagination: generic helper following continuation tokens (REST: offset params; Action: continue object)
- Timeouts: 30s default
- Auth: Bearer token for both APIs

## Tool Inventory (19 tools)

### Wiki Management (3)
1. `add-wiki` — Register wiki by name, URL, token
2. `remove-wiki` — Remove a registered wiki
3. `list-wikis` — Show all registered wikis

### Search (2)
4. `search-pages` — Full-text search, fan-out by default
5. `search-pages-by-prefix` — Title prefix search, fan-out by default

### Page Operations (5)
6. `get-page` — Page content (wikitext or HTML) + metadata
7. `create-page` — Create new page
8. `update-page` — Edit page with summary
9. `delete-page` — Delete a page
10. `undelete-page` — Restore deleted page

### History (2)
11. `get-page-history` — Paginated revision list
12. `get-revision` — Single revision by ID

### Categories (2)
13. `list-categories` — Categories with member counts, fan-out by default
14. `get-category-members` — Pages in a category, paginated

### Links (1)
15. `get-page-links` — Outgoing links or backlinks

### Files (3)
16. `get-file` — File metadata, dimensions, URLs
17. `upload-file` — Upload from base64 data
18. `upload-file-from-url` — Upload from remote URL

### Activity (1)
19. `get-recent-changes` — Recent edits/creations/deletions, fan-out by default

## Pagination

- All list tools accept `limit` and `continue_from` params
- Response includes `has_more` indicator and continuation token
- Footer: `Showing 1-20 of more results. Use continue_from: "abc123" to see more.`

## Error Handling

- Structured errors with wiki name, operation, and cause
- Retry: 429/5xx get exponential backoff (3 attempts, 1s/2s/4s). 4xx fail immediately
- Fan-out partial failure: return healthy results + warning listing failed wikis
- Missing pages: clear "not found on [wiki]" message, not an error
- Auth failures: identify which wiki's token is invalid
