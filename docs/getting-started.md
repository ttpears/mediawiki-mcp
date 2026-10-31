# Connect a local MCP client

[Documentation](README.md) · [Docker/LibreChat](docker.md) · [Public OAuth connector](oauth.md)

Use this guide when Claude Desktop, Claude Code, or another MCP client will start
the server on your computer. The client manages the server process; you do not
need to start an HTTP service.

Before starting, have your [wiki API base URL](configuration.md#wiki-urls).
A public wiki can be tried without credentials. A private wiki or editing needs
[a bot password](configuration.md#bot-passwords).

[Desktop](#claude-desktop) · [Claude Code](#claude-code) · [Other clients](#other-stdio-clients)

## Claude Desktop

1. Open the [latest GitHub release](https://github.com/ttpears/mediawiki-mcp/releases/latest).
2. Download the asset ending in `.mcpb`, for example `mediawiki-mcp-2.5.4.mcpb`.
3. Open it with Claude Desktop, or install it from **Settings → Extensions**.
4. Enter the configuration below and enable the extension.

| Desktop field | What to enter |
| --- | --- |
| Wiki API Base URL | `https://wiki.example.com` for a single wiki |
| Bot Username | The complete bot username, such as `YourUser@mcp`; leave blank for anonymous access |
| Bot Password | The generated bot password, not your normal login password |
| Wikis | Leave blank for a single wiki; advanced syntax is `Main:https://wiki.example.com,Dev:https://dev.example.com` |
| Default Wiki Name | For a multi-wiki list, the name to use when a tool omits `wiki` |

Desktop stores the password in its credential store. The bundle's advanced
multi-wiki fields do not provide separate bot credentials for each wiki. For
**authenticated multi-wiki access**, use the environment-variable setup with
Claude Code below, a manually configured stdio client, or [Docker](docker.md).

**Check it:** start a chat and ask, “List the connected wikis and their
authentication status.” The `list-wikis` result should contain your wiki. Then
ask it to find and read a page you know exists. If it cannot connect, use
[the troubleshooting guide](operations.md#troubleshooting).

## Claude Code

Install Node.js 24 LTS on the computer running Claude Code. The package supports
Node.js 20 or later; the server and release pipeline are tested on Node.js 24.

Check your installation:

```bash
node --version
npm --version
```

### 1. Add one wiki

On macOS, Linux, or a WSL shell, register a public wiki first:

```bash
claude mcp add --scope user \
  --env 'MEDIAWIKI_BASE_URL=https://wiki.example.com' \
  mediawiki -- npx -y mediawiki-mcp@2.5.4
```

Replace the example URL. `--scope user` makes the connection available in all
projects. Keep Claude's options **before** `mediawiki`; everything after `--`
is the command Claude will launch.

For a private wiki or edits, use this form instead:

```bash
claude mcp add --scope user \
  --env 'MEDIAWIKI_BASE_URL=https://wiki.example.com' \
  --env 'MEDIAWIKI_USERNAME=YourUser@mcp' \
  --env 'MEDIAWIKI_PASSWORD=REPLACE_WITH_BOT_PASSWORD' \
  mediawiki -- npx -y mediawiki-mcp@2.5.4
```

Use one registration form. If `mediawiki` is already registered, remove that entry
with `claude mcp remove --scope user mediawiki` before adding its replacement. Credentials are
stored in the client configuration; avoid sharing a project configuration that
contains a bot password.

On **native Windows**, use a single line in PowerShell and launch npm through
`cmd /c`:

```powershell
claude mcp add --scope user --env "MEDIAWIKI_BASE_URL=https://wiki.example.com" mediawiki -- cmd /c npx -y mediawiki-mcp@2.5.4
```

Add the same `--env` credential flags before `mediawiki` if your wiki needs them.

### 2. Verify the connection

Run `claude mcp list`, then open Claude Code and inspect the connection with
`/mcp`. Ask:

> List the connected wikis, then find and read the page called Main Page.

The single-wiki setup is named `default` in tool results. A successful connection
lists the wiki, reports `anonymous` or `authenticated as …`, and can read the page.
A connected process alone does not prove that its wiki credentials work.

### 3. Add more wikis when needed

Replace the single-wiki registration with:

```bash
claude mcp add --scope user \
  --env 'MEDIAWIKI_WIKIS=Main:https://wiki.example.com,Dev:https://dev.example.com' \
  --env 'MEDIAWIKI_DEFAULT_WIKI=Main' \
  --env 'MEDIAWIKI_USERNAME_MAIN=YourUser@mcp' \
  --env 'MEDIAWIKI_PASSWORD_MAIN=REPLACE_WITH_MAIN_BOT_PASSWORD' \
  --env 'MEDIAWIKI_USERNAME_DEV=YourUser@mcp' \
  --env 'MEDIAWIKI_PASSWORD_DEV=REPLACE_WITH_DEV_BOT_PASSWORD' \
  mediawiki -- npx -y mediawiki-mcp@2.5.4
```

Each wiki needs its own credentials. Omit both credential variables for a wiki
that allows anonymous access. See [multi-wiki rules](configuration.md#multiple-wikis)
for naming, defaults, and which operations search every wiki.

## Other stdio clients

Configure the client to launch `npx -y mediawiki-mcp@2.5.4` and pass the wiki
variables in its environment. Clients that use a Claude-style `mcpServers`
configuration can use:

```json
{
  "mcpServers": {
    "mediawiki": {
      "command": "npx",
      "args": ["-y", "mediawiki-mcp@2.5.4"],
      "env": {
        "MEDIAWIKI_BASE_URL": "https://wiki.example.com"
      }
    }
  }
}
```

On native Windows, use `"command": "cmd"` and
`"args": ["/c", "npx", "-y", "mediawiki-mcp@2.5.4"]` if the client cannot launch
`npx` directly. Your client's configuration-file location may differ.

Launching the server manually produces no chat UI: it waits for MCP messages on
stdin. This is expected. For a source checkout or `.env` file, follow
[Contributing](../CONTRIBUTING.md#build-and-run).

Next: [use the tools](tools.md), [configure credentials](configuration.md), or
[upgrade an existing connection](operations.md#local-clients).
