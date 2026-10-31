# Docker and LibreChat

[Documentation](README.md) · [Configuration](configuration.md) · [Operations](operations.md)

Use this guide for a private HTTP deployment. You need Docker Compose and a
MediaWiki 1.42+ API URL reachable **from the container**. You do not need Node.js
on the Docker host. This mode has no inbound HTTP authentication; for a public
connector, use [OAuth with Entra](oauth.md).

Choose either a standalone service or a LibreChat sidecar. The source-build
option at the end is for running changes from a Git checkout.

[Standalone service](#standalone-service-using-the-published-image) · [LibreChat](#librechat-sidecar) · [Source build](#build-from-this-repository-instead)

## Standalone service using the published image

### 1. Create configuration

Create a new directory for the deployment, outside a source checkout:

```bash
mkdir mediawiki-connector
cd mediawiki-connector
```

Create a file named `.env` in that directory:

```dotenv
MEDIAWIKI_BASE_URL=https://wiki.example.com
MEDIAWIKI_USERNAME=YourUser@mcp
MEDIAWIKI_PASSWORD=REPLACE_WITH_BOT_PASSWORD
```

Replace the URL and credentials. For anonymous reads, omit both credential
lines. For several wikis, replace this block with the
[multi-wiki configuration](configuration.md#multiple-wikis).

### 2. Create `compose.yaml`

```yaml
services:
  mediawiki-mcp:
    image: ghcr.io/ttpears/mediawiki-mcp:2.5.4
    env_file:
      - .env
    ports:
      - "127.0.0.1:8009:8009"
    restart: unless-stopped
```

The published image runs the HTTP server on container port 8009 and binds all
container interfaces. This example publishes it on the host's loopback address,
so `http://localhost:8009` is reachable on that host. Keep port 8009 inside the
container; change the left-hand port if the host's port is already occupied.

### 3. Start and verify

Run these commands from the directory containing `compose.yaml`:

```bash
docker compose pull mediawiki-mcp
docker compose up -d mediawiki-mcp
docker compose ps
docker compose logs --tail=50 mediawiki-mcp
curl --fail http://127.0.0.1:8009/health
```

The health response should include `"status":"ok"`, `"version":"2.5.4"`, and
`"auth":"none"`. It proves the connector is running, not that wiki credentials
work. Configure your MCP client to use **Streamable HTTP** at
`http://127.0.0.1:8009/mcp`, then ask it to run `list-wikis` and read a known page.

A browser visit to `/mcp` is not a connection test: the endpoint expects MCP
messages and session headers. `/health` is the browser-friendly check.

## LibreChat sidecar

Run the connector in the same Compose project/network as LibreChat. A container
must use the service hostname `mediawiki-mcp`, not `localhost`, to reach it.

### 1. Create the wiki environment file

In your LibreChat directory, create `mediawiki-mcp.env` with the wiki variables
from step 1 above, or the [multi-wiki block](configuration.md#multiple-wikis).
Keeping this file separate avoids confusing LibreChat's own settings with the
connector's settings.

### 2. Add the service

Merge this service into your existing `docker-compose.override.yml` rather than
replacing other services:

```yaml
services:
  mediawiki-mcp:
    image: ghcr.io/ttpears/mediawiki-mcp:2.5.4
    env_file:
      - ./mediawiki-mcp.env
    restart: unless-stopped
```

No host port is needed when LibreChat reaches the connector over the shared
Docker network. If your installation uses custom networks, attach both services
to the same one.

### 3. Add the MCP connection

Merge this entry into `librechat.yaml`:

```yaml
mcpServers:
  mediawiki:
    type: streamable-http
    url: http://mediawiki-mcp:8009/mcp
```

If your LibreChat version enforces an MCP domain allowlist, include
`mediawiki-mcp` in its `allowedDomains` setting.

### 4. Start and check

```bash
docker compose up -d mediawiki-mcp
docker compose exec mediawiki-mcp wget -qO- http://127.0.0.1:8009/health
```

Restart the LibreChat app container so it reloads `librechat.yaml`. In a new chat,
select the MediaWiki tools and ask it to list connected wikis, then read a known
page. If LibreChat sends `x-user-username`, that value supplies edit attribution.
The header is not an independent authentication check for this endpoint.

## Build from this repository instead

Use this option when you want source changes rather than a published image:

```bash
git clone https://github.com/ttpears/mediawiki-mcp.git
cd mediawiki-mcp
cp .env.example .env
```

Edit `.env`: replace the example wiki list and credentials with your own. For one
wiki, remove the `MEDIAWIKI_WIKIS`, `MEDIAWIKI_DEFAULT_WIKI`, and per-wiki credential
lines and use the [single-wiki block](configuration.md#one-wiki) instead.

The repository's `docker-compose.yml` uses `build: .`. Start it with:

```bash
docker compose up -d --build mediawiki-mcp
curl --fail http://127.0.0.1:8009/health
```

That Compose file publishes port 8009 on all host interfaces. For a host-only
installation, change its mapping to `127.0.0.1:8009:8009` as in the standalone
example above. The [LibreChat source-build template](../docker-compose.override.example.yml)
is also available; adjust its paths before using it.

Next: [upgrade or roll back](operations.md#upgrade),
[troubleshoot a connection](operations.md#troubleshooting), or
[add public authentication](oauth.md).
