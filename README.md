# MediaWiki MCP

Connect an AI assistant to your MediaWiki sites. Ask it to find and summarize
pages, compare revisions, or prepare edits. One connection can serve several
wikis; writing uses the permissions of the wiki account you configure.

## Choose your setup

Start with one guide. You do not need to follow all four.

| Where you want to use it | Start here | What you need |
| --- | --- | --- |
| Claude Desktop on your computer | [Install the Desktop bundle](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/getting-started.md#claude-desktop) | Claude Desktop and a wiki URL |
| Claude Code or another local MCP client | [Connect a local client](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/getting-started.md#claude-code) | Node.js 24 LTS recommended; minimum Node.js 20 |
| LibreChat or a private HTTP service | [Run with Docker](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/docker.md) | Docker Compose and access to the wiki |
| A public connector with Microsoft sign-in | [Set up OAuth with Entra](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/oauth.md) | Public HTTPS address, Entra app, and a server |

Your wiki must run **MediaWiki 1.42 or later**, with its REST and Action APIs
reachable. Use the wiki's API base URL, such as `https://wiki.example.com` or
`https://example.com/w`; see [how to choose the URL](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/configuration.md#wiki-urls).
Anonymous access works only where the wiki permits it. For private reads or edits,
[create a bot password](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/configuration.md#bot-passwords).

## Check your connection

After completing your chosen guide, ask your assistant:

> List the connected wikis and their authentication status.

It should call `list-wikis` and show your wiki. Then try:

> Find the page about backups and summarize it. Include the wiki and page title.

The usual workflow is `find-page` → `get-page` → a summary or proposed edit.
For editing, read the page first and review the proposed change before saving.
See [working with pages](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/tools.md#read-and-edit-a-page) for concrete examples.

## What you can do

- Search one wiki or all configured wikis, then read pages and follow links.
- Inspect categories, files, revision history, and recent activity.
- Create or update pages and upload files when your account has the required
  rights. OAuth connections also require the configured write role.

The [tool reference](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/tools.md) lists the exact tool names, inputs, and which
ones are available in each connection mode.

## Find the right reference

| I need to… | Read |
| --- | --- |
| Set wiki URLs, credentials, multiple wikis, or environment variables | [Configuration](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/configuration.md) |
| Understand sign-in, permissions, image restrictions, or session expiry | [Security and operations](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/operations.md) |
| Upgrade, roll back, or diagnose a failed connection | [Upgrade and troubleshooting](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/operations.md#upgrade) |
| Change the code or run a disposable test wiki | [Contributing](https://github.com/ttpears/mediawiki-mcp/blob/main/CONTRIBUTING.md) |
| Prepare or verify a release | [Release guide](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/releasing.md) |

For a full navigation page, open the [documentation index](https://github.com/ttpears/mediawiki-mcp/blob/main/docs/README.md).
Published versions and Desktop bundles are on [GitHub Releases](https://github.com/ttpears/mediawiki-mcp/releases).
Changes are recorded in the [changelog](https://github.com/ttpears/mediawiki-mcp/blob/main/CHANGELOG.md).

## License

[MIT](https://github.com/ttpears/mediawiki-mcp/blob/main/LICENSE).
