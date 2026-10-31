# Operations and troubleshooting

[Documentation](README.md) · [Configuration](configuration.md) · [Release process](releasing.md)

[Health checks](#check-a-running-installation) · [Permissions](#permissions-and-session-behavior) · [Upgrades](#upgrade) · [Troubleshooting](#troubleshooting)

## Check a running installation

For HTTP deployments, query the server from somewhere that can reach its port:

```bash
curl --fail http://127.0.0.1:8009/health
```

A healthy response includes the service, version, and `auth` mode. `/health` does
not test wiki credentials or API access. For that, connect an MCP client, call
`list-wikis`, and read a known page with `get-page`.

For stdio clients, inspect the MCP connection status and the server version in
the MCP initialization response. A terminal running the stdio server simply
waits for protocol messages; it is not a command-line wiki browser.

## Permissions and session behavior

| Mode | Access behavior |
| --- | --- |
| Stdio/local client | The local client launches the process; wiki account rights govern operations |
| Private HTTP/LibreChat | No inbound OAuth authentication; keep the endpoint on the intended private network |
| Public OAuth | Entra controls sign-in; the write app role gates editing; wiki account rights still apply |

In OAuth mode, users share the configured bot accounts' read access. Their own
MediaWiki accounts are not used to filter pages. Session user identity controls
edit attribution, not the wiki account used for API requests.

HTTP wiki registries and default choices are private to each MCP session. OAuth
sessions cannot add, remove, or change the default wiki; operators configure the
farm through environment variables. Pass `wiki` to select a configured wiki.

An OAuth authorization has a fixed one-hour lifetime. Refreshes cannot extend
it; the next sign-in rechecks roles. Existing tokens can retain their original
permissions until that deadline. A session's user, OAuth client, and write
permission must match on POST, GET, and DELETE, so changed permissions require
reconnection.

HTTP transport sessions are held in memory, expire after 30 minutes idle by
default, and disappear on restart. Redis preserves broker state such as pending
authorizations and refresh grants; it does **not** make MCP transport sessions
portable across replicas. Use session-aware routing when deploying multiple
instances, and expect clients to re-initialize when a session no longer exists.

Inline images are fetched only from configured wiki origins or
`MEDIAWIKI_IMAGE_ALLOWED_ORIGINS`. Private origins are allowed when deliberately
configured. The download is limited to 5 MiB decoded bytes, 15 seconds total,
and three redirects within the trusted origins. A blocked download still returns
metadata; see [image configuration](configuration.md#inline-image-downloads).

## Upgrade

Choose the procedure matching how the server was installed. Updating a registry
or downloading an image does not replace a running process.

### Local clients

For a client pinned to `mediawiki-mcp@2.5.4`, change that version in its launch
command when you choose a newer published release, then restart/reconnect the MCP
server from the client. An unpinned `npx -y mediawiki-mcp` command requests the
current npm release on startup, subject to npm's local cache. Pinning a version
makes the selected version explicit.

Claude Desktop users download and install the new `.mcpb` asset from
[GitHub Releases](https://github.com/ttpears/mediawiki-mcp/releases). Keep the old
bundle if you need to roll back.

### Published Docker image

In your Compose file, set the selected published image tag, for example
`ghcr.io/ttpears/mediawiki-mcp:2.5.4`, then:

```bash
docker compose pull mediawiki-mcp
docker compose up -d mediawiki-mcp
curl --fail http://127.0.0.1:8009/health
```

If the service has no host port, run the health check inside it instead:

```bash
docker compose exec mediawiki-mcp wget -qO- http://127.0.0.1:8009/health
```

Confirm the expected version, reconnect the client, then call `list-wikis` and
read a page. To roll back, restore the previous image tag and repeat the pull and
recreate steps. Transport sessions will be lost when the container is recreated.

### Source-built service

From a clean repository checkout whose `main` branch you intend to deploy:

```bash
git switch main
git pull --ff-only
docker compose up -d --build mediawiki-mcp
curl --fail http://127.0.0.1:8009/health
```

For a Node installation, use `npm ci` and `npm run build`, then restart the Node
process using the same environment/`.env` launch command as before. The repository
Compose file builds source; `docker compose pull` alone does not rebuild it.

### Upgrading from a version older than 2.5.4

Reconnect OAuth clients and complete a fresh sign-in. Legacy refresh grants do
not carry the new authorization deadline and will be rejected. If wiki images
use another origin, add the trusted CDN explicitly with
`MEDIAWIKI_IMAGE_ALLOWED_ORIGINS`. These restrictions do not change wiki API
reads or writes.

## Troubleshooting

Start with the layer that failed: server startup, HTTP reachability, MCP session,
then wiki access. Avoid changing wiki credentials to fix a transport error.

| Symptom | Check or action |
| --- | --- |
| `No wiki configuration found` | Confirm variables reached the server. For local Node, use `--env-file=.env`; for Docker, check `env_file`; for stdio, check the MCP client's environment settings. |
| The wrong/example wikis appear | `MEDIAWIKI_WIKIS` overrides the single-wiki form. Remove the template list if you intend to use `MEDIAWIKI_BASE_URL`. |
| A private wiki reports `anonymous` | Both username and password must be set. In multi-wiki mode, check the uppercase name suffix on each variable. |
| Reads work, writes fail | Check `list-wikis`, wiki rights, and bot grants. In OAuth mode, also check the Entra write role. Bot-session expiry is retried automatically, but revoked credentials need replacing. |
| `/health` works but wiki tools fail | Test the wiki API base URL and reachability from the connector/container. Health does not contact the wiki. |
| A container cannot reach `localhost` on the host | Container `localhost` is the container itself. Use the other service's Docker hostname or an address reachable from that network. |
| A host cannot reach a container | Check its host port mapping and bind host. The image binds `0.0.0.0` inside the container; a manually run Node server defaults to loopback. |
| HTTP 401 at `/mcp` in OAuth mode | Complete sign-in again. Confirm public URL, tenant/app settings, secret, and proxy routing if a fresh sign-in also fails. |
| HTTP 403 with changed session identity/permissions | Reconnect/re-initialize the MCP session after a client or role change. |
| HTTP 404 with `Session not found` | The MCP session expired, the server restarted, or another replica received the request. Re-initialize; do not keep retrying the old session ID. |
| HTTP 421 | Match the request hostname to `MEDIAWIKI_MCP_ALLOWED_HOSTS`; check the proxy's Host header. |
| HTTP 503 when initializing | The session cap is full. Inspect session usage and idle expiry before adjusting `MEDIAWIKI_MAX_SESSIONS`. |
| File metadata appears without an image | Check the preferred image URL's origin, MIME type, size, redirects, and the configured CDN allowlist. |
| Published version is not visible yet | Check both release jobs. A tag alone does not publish; npm may also report that a newly accepted package is still being processed. |

For recent logs in Docker:

```bash
docker compose logs --tail=100 mediawiki-mcp
```

A 404 from a **wiki page API** is different from `Session not found` at the MCP
endpoint. Verify the page title and wiki selection for the former; reconnect the
MCP client for the latter.

Historical field notes:
[reads worked after bot login expired, and Docker bound loopback](https://hackyourworld.com/mediawiki-mcp-login-expired-docker-port/).
