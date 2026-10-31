# Documentation

[Project overview](../README.md)

## Connect an assistant

Choose the guide that matches where the assistant runs:

1. **On your computer:** [Claude Desktop, Claude Code, and local MCP clients](getting-started.md).
2. **On a private server:** [Docker and LibreChat](docker.md).
3. **Through a public HTTPS connector:** [Microsoft Entra OAuth](oauth.md).

Each guide ends with a connection check. Start with one wiki; add more after the
first connection works.

## Configure and use it

| Task | Guide |
| --- | --- |
| Pick the correct API URL and create a bot password | [Wiki configuration](configuration.md#wiki-urls) |
| Configure several wikis or look up an environment variable | [Configuration reference](configuration.md) |
| Find, read, and edit pages; see all tool inputs | [Tools and examples](tools.md) |
| Understand permissions and the 2.5.4 security changes | [Security behavior](operations.md#permissions-and-session-behavior) |
| Upgrade or roll back an existing installation | [Operations](operations.md#upgrade) |
| Diagnose an error or a missing image | [Troubleshooting](operations.md#troubleshooting) |

## Develop and maintain

- [Contributing](../CONTRIBUTING.md): local build, disposable MediaWiki, tests, and architecture.
- [Release guide](releasing.md): versions, validation, required approval, and publication checks.
- [Changelog](../CHANGELOG.md): changes by version.
