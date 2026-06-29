# Changelog

All notable changes to this project are documented here. The format is loosely
based on [Keep a Changelog](https://keepachangelog.com/), and the project follows
semantic versioning.

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
