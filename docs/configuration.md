# Configuration reference

[Documentation](README.md) · [Local clients](getting-started.md) · [Docker](docker.md) · [OAuth](oauth.md)

Configuration comes from the **server process's environment**. A `.env` file is a
convenient way to supply it, but Node does not load that file automatically.

| How you run the server | Where to put configuration |
| --- | --- |
| Claude Code or another stdio client | The client's environment-variable settings |
| Claude Desktop MCPB extension | Its configuration dialog |
| Docker Compose | The service's `env_file` and `environment` settings |
| Source checkout | Export variables, or launch Node with `--env-file=.env` |

Start with one of the complete setup guides above. Use this page to look up a
setting or extend a working setup. The repository's [.env.example](../.env.example)
is a reference template, not a usable wiki configuration until edited.

[Wiki URLs](#wiki-urls) · [Bot passwords](#bot-passwords) · [Multiple wikis](#multiple-wikis) · [HTTP](#http-server-and-sessions) · [Images](#inline-image-downloads) · [OAuth](#oauth-settings)

## Wiki URLs

Set the base directory that contains both `api.php` and `rest.php`:

| Your Action API URL | Base URL to configure |
| --- | --- |
| `https://wiki.example.com/api.php` | `https://wiki.example.com` |
| `https://example.com/w/api.php` | `https://example.com/w` |

Do not supply a page URL such as `/wiki/Main_Page`, or include `/api.php` or
`/rest.php/v1` at the end. The server appends the API paths. The wiki must be
MediaWiki 1.42 or later and expose the REST endpoints used by the server.

## Bot passwords

Bot passwords authenticate **the server to MediaWiki**. They are separate from
Microsoft sign-in, which authenticates a person to a public OAuth connector.

1. Sign in to the wiki with the account whose permissions the server should use.
2. Open `Special:BotPasswords`. If a pretty URL fails, use
   `https://wiki.example.com/index.php?title=Special:BotPasswords` (adjust the
   directory if the wiki is installed under `/w`).
3. Create a bot name, for example `mcp`, and select the grants needed for your work.
4. Copy the complete generated username and password into the server's settings.

For example, a bot named `mcp` under `YourUser` produces the username
`YourUser@mcp`. A normal account password will not work in its place.

| Work you want to allow | Wiki account rights and bot grants needed |
| --- | --- |
| Read a private wiki | Read/API access to that wiki |
| Create or update pages | Create/edit rights and corresponding bot grants |
| Upload files | Upload rights and corresponding bot grants |
| Delete or restore pages | Delete/undelete rights and corresponding bot grants |

A bot grant cannot give the account rights it does not already have. Grant names
can vary by MediaWiki version and language. High-volume bot access is not a
prerequisite for every API request. Create credentials independently on each wiki.

A bot password does not add a separate read-only mode to stdio or private HTTP:
the server attempts operations using the account's actual rights. Use an account
with only read rights when that is the intended access.

## One wiki

```dotenv
MEDIAWIKI_BASE_URL=https://wiki.example.com
MEDIAWIKI_USERNAME=YourUser@mcp
MEDIAWIKI_PASSWORD=REPLACE_WITH_BOT_PASSWORD
```

Omit **both** credential variables for anonymous access. The wiki is named
`default` internally. Private wikis may refuse anonymous reads.

| Variable | Required | Default / behavior |
| --- | --- | --- |
| `MEDIAWIKI_BASE_URL` | For the single-wiki form | Base URL described above |
| `MEDIAWIKI_USERNAME` | With a bot password | Complete `User@BotName` username |
| `MEDIAWIKI_PASSWORD` | With a bot username | Generated bot password |

## Multiple wikis

```dotenv
MEDIAWIKI_WIKIS=Main:https://wiki.example.com,Dev:https://dev.example.com
MEDIAWIKI_DEFAULT_WIKI=Main
MEDIAWIKI_USERNAME_MAIN=YourUser@mcp
MEDIAWIKI_PASSWORD_MAIN=REPLACE_WITH_MAIN_BOT_PASSWORD
MEDIAWIKI_USERNAME_DEV=YourUser@mcp
MEDIAWIKI_PASSWORD_DEV=REPLACE_WITH_DEV_BOT_PASSWORD
```

- `MEDIAWIKI_WIKIS` takes precedence over the single-wiki variables. Choose one
  form; do not leave a template multi-wiki value enabled when configuring one wiki.
- Use simple names such as `Main` and `Dev`. Credential suffixes use the wiki name
  in uppercase: `Main` → `MEDIAWIKI_USERNAME_MAIN` and `MEDIAWIKI_PASSWORD_MAIN`.
- Both credential values must be present for a wiki to use them. If either is
  missing or empty, that wiki is registered without credentials.
- Wiki names are matched without regard to case; duplicate names are rejected.
- The first wiki is the default unless `MEDIAWIKI_DEFAULT_WIKI` selects another
  registered name. The default variable applies to this multi-wiki form.
- `find-page`, `search-page`, `search-page-by-prefix`, `list-categories`, and
  `get-recent-changes` search/list across all configured wikis when `wiki` is
  omitted. Other wiki operations use the default. Pass `wiki` to be explicit.

## HTTP server and sessions

These settings apply to the HTTP server, including Docker and OAuth deployments.

| Variable | Default | Meaning |
| --- | --- | --- |
| `MEDIAWIKI_MCP_HOST` | `localhost` from Node; `0.0.0.0` in the published container | Address to listen on |
| `MEDIAWIKI_MCP_PORT` | `8009` | Port inside the server/container |
| `MEDIAWIKI_SESSION_IDLE_TTL_MS` | `1800000` (30 minutes) | Idle HTTP sessions are reclaimed after this interval |
| `MEDIAWIKI_MAX_SESSIONS` | `1000` | Maximum sessions; new connections get HTTP 503 when full |

Use positive integers for the session limits. Port `0` requests an ephemeral port
for local testing; use a fixed port for deployment. Changing the container's
internal port also requires matching the service mapping and health check; the
provided image is set up for port 8009.

## Inline image downloads

`get-file` always returns available file metadata. It also attempts to embed
supported images, subject to these rules:

| Setting or limit | Behavior |
| --- | --- |
| Trusted origins | Origins of configured wikis, including deliberately private wiki origins |
| `MEDIAWIKI_IMAGE_ALLOWED_ORIGINS` | Optional comma-separated exact extra origins for trusted CDNs |
| Size | At most 5 MiB after decompression |
| Time | 15 seconds total |
| Redirects | At most three, all within trusted origins |
| Content types | PNG, JPEG, GIF, WebP, or SVG |

Example:

```dotenv
MEDIAWIKI_IMAGE_ALLOWED_ORIGINS=https://images.example.com,https://cdn.example.com
```

An origin is `scheme://host[:port]`, with no path, credentials, or wildcard.
Approve only hosts you trust. A denied or failed inline download leaves a metadata
response with its URLs; it does not mean the file is missing from the wiki.

## OAuth settings

OAuth is enabled only when `MEDIAWIKI_MCP_AUTH=oauth`. These settings authenticate
users through Entra; wiki credentials above are still needed for wiki operations.
For the complete deployment sequence, see [the OAuth guide](oauth.md).

| Variable | Required in OAuth mode | Meaning / default |
| --- | --- | --- |
| `MEDIAWIKI_MCP_AUTH` | Yes | Set exactly `oauth`; otherwise private/header HTTP mode is used |
| `MEDIAWIKI_MCP_PUBLIC_URL` | Yes | Public HTTPS base URL, without `/mcp` or a trailing slash |
| `OAUTH_TENANT_ID` | Yes | Entra tenant ID |
| `OAUTH_CLIENT_ID` | Yes | Entra app client ID |
| `OAUTH_CLIENT_SECRET` | Yes | Entra app client secret |
| `MEDIAWIKI_MCP_JWT_SECRET` | Yes | Random secret for broker access-token signing |
| `OAUTH_WRITE_ROLE` | No | Entra role granting writes; default `Writer` |
| `REDIS_URL` | Recommended for hosted use | Broker state; omitted means one-process in-memory state |
| `MEDIAWIKI_MCP_TRUST_PROXY` | Behind a trusted proxy | `1` or `true` trusts one proxy hop for client-IP handling |
| `MEDIAWIKI_MCP_ALLOWED_HOSTS` | No | Comma-separated accepted hostnames; local health-check hosts remain allowed |

Redis can share broker authorization state across instances. MCP transport
sessions themselves remain in process memory; see [replica and session behavior](operations.md#permissions-and-session-behavior).
