# mediawiki-mcp

Multi-wiki MediaWiki MCP server. Published to npm as `mediawiki-mcp`.

## Dual deployment — do not break either path

This server ships through two channels and both must keep working:

1. **Claude Code plugin marketplace** ([ttpears/claude-plugins](https://github.com/ttpears/claude-plugins))
   - `.claude-plugin/plugin.json` declares `mcpServers.mediawiki` → `npx -y mediawiki-mcp`.
   - Entry point is `dist/index.js` (the `bin` in `package.json`) which runs `src/stdio.ts`.
   - Config comes from env vars inherited from the Claude Code process.
   - Changes here ship via npm publish (see `.github/workflows/release.yml`); the marketplace pulls the new version automatically on next `npx` spawn.
   - Keep `plugin.json` `version` in sync with `package.json` `version` when releasing.

2. **LibreChat** (<https://www.librechat.ai/docs/features/mcp>)
   - Runs as a sidecar container via `docker-compose.override.yml`, started with `npm run start:http` → `src/http-transport.ts`.
   - LibreChat connects with `type: streamable-http`, `url: http://mediawiki-mcp:8009/mcp`.
   - Reads a LibreChat session user header on every request (see commit 643aeae) for per-user attribution — don't regress this by caching user identity at session init.
   - Host defaults to `0.0.0.0`, port `MEDIAWIKI_MCP_PORT` (default 8009).

**Rule of thumb:** any refactor to transport, auth, or tool registration must be exercised against both `src/stdio.ts` and `src/http-transport.ts`. Tool definitions live in `src/tools/` and are shared — keep them transport-agnostic.

## Architecture

- `src/index.ts` — stdio entry (used by npx / plugin)
- `src/http-transport.ts` — streamable-HTTP entry (used by LibreChat)
- `src/wiki-orchestrator.ts` — routing + fan-out across registered wikis
- `src/wiki-registry.ts` — env parsing (`MEDIAWIKI_WIKIS`, per-wiki creds)
- `src/clients/rest-client.ts` — `/rest.php/v1/` (MW 1.42+)
- `src/clients/action-client.ts` — `/api.php` + bot-password login, shared cookie session
- `src/tools/*.ts` — tool implementations, registered via `src/tools/index.ts`

Fan-out tools (search, recent-changes, list-categories) hit every registered wiki when `wiki` is omitted; single-wiki tools fall back to `MEDIAWIKI_DEFAULT_WIKI`.

## Auth

MediaWiki **bot passwords** only (`Special:BotPasswords`). Creds are per-wiki: `MEDIAWIKI_USERNAME_<WIKI>` / `MEDIAWIKI_PASSWORD_<WIKI>`. The Action client logs in lazily and reuses the cookie jar for REST calls too.

## Dev

```bash
npm run type-check
npm test            # vitest
npm run build
```

Tests live in `tests/`, run with vitest. Don't mark work complete without `type-check` + `test` passing.

## Release flow

1. Bump `package.json` version.
2. Bump `.claude-plugin/plugin.json` version to match.
3. Tag / push — `.github/workflows/release.yml` publishes to npm.
4. Marketplace users pick up the new version on next `npx` invocation; no change needed in `ttpears/claude-plugins` unless the plugin manifest itself changed.
