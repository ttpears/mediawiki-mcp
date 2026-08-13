# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/), and the project follows
semantic versioning.

## [2.4.0] - 2026-08-12

### Added
- **Idle-session TTL and hard session cap.** `SessionRegistry` sweeps sessions
  that have gone idle and rejects new `initialize` requests once the cap is
  reached. Configurable via `MEDIAWIKI_SESSION_IDLE_TTL_MS` (default 30 minutes)
  and `MEDIAWIKI_MAX_SESSIONS` (default 1000); both documented in `.env.example`.
- First `CONTRIBUTING.md` — local throwaway-wiki setup, bot-password creation,
  test and release flow, and the known rough edges hit while writing it.

### Fixed
- **Session leak in the HTTP transport.** The session map had no idle TTL and no
  size cap, and cleanup only ran from `transport.onclose` — which never fires for
  a session abandoned rather than closed (client crash, dropped connection, proxy
  timeout). Each leaked entry pinned an `McpServer` and a `WikiOrchestrator`
  holding a live client per registered wiki. `POST`/`GET`/`DELETE` now all route
  through the same expiry-checked lookup; previously only `POST` consulted any
  guard.
- **`MEDIAWIKI_MCP_PORT` crash on non-numeric input.** `parseInt` returned `NaN`,
  which reached `net.Server.listen()` and aborted startup with an uncaught
  `RangeError`. Invalid or out-of-range values now fall back to the default port.
- Session TTL and cap env vars are parsed through a positive-integer guard, so a
  malformed value falls back to its default instead of propagating `NaN` and
  silently disabling both the sweep and the cap.

### Changed
- `npm publish`, the GHCR image, and the GitHub Release now run behind the
  `release` environment and wait on maintainer approval; merging a version bump
  still auto-tags.

## [2.3.0] - 2026-06-29

### Added
- **Claude Desktop bundle (`.mcpb`).** Releases now build and attach a
  `mediawiki-mcp-<version>.mcpb` one-click bundle, matching the gitlab-mcp and
  bookstack-mcp servers. `npm run build:mcpb` produces it locally.
- `mcpb/manifest.template.json` with `user_config` for the single-wiki setup
  (Base URL + bot username/password) plus optional advanced multi-wiki fields
  (`MEDIAWIKI_WIKIS`, `MEDIAWIKI_DEFAULT_WIKI`).

### Fixed
- Report the real package version at runtime (the unreleased 2.2.1 fix ships here).

## [2.2.0] - 2026-06-28

### Added
- Connector prompts for the Claude.ai connector menu.

### Fixed
- Token-store fixes for OAuth broker session state.

## [2.1.0] - 2026-06-28

### Added
- Microsoft Entra–authenticated Claude.ai connector (OAuth gate with bot-account
  backend).
- Documented `claude mcp add` install with environment-variable samples.

## [2.0.1] - 2026-04-13

### Added
- Claude Code plugin manifest and release CI.

## [2.0.0]

### Added
- Initial public release: multi-wiki MediaWiki MCP server over the REST and Action
  APIs, with bot-password auth, stdio and streamable-HTTP transports, search,
  categories, page history, files, and link tools.

[2.3.0]: https://github.com/ttpears/mediawiki-mcp/releases/tag/v2.3.0
[2.2.0]: https://github.com/ttpears/mediawiki-mcp/releases/tag/v2.2.0
[2.1.0]: https://github.com/ttpears/mediawiki-mcp/releases/tag/v2.1.0
[2.0.1]: https://github.com/ttpears/mediawiki-mcp/releases/tag/v2.0.1
[2.0.0]: https://github.com/ttpears/mediawiki-mcp/releases/tag/v2.0.0
