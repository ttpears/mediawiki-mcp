# Public connector with Microsoft Entra sign-in

[Documentation](README.md) · [Configuration reference](configuration.md#oauth-settings) · [Operations](operations.md)

Use this guide to expose a connector to clients such as claude.ai through a
public HTTPS URL. Complete the steps in order. The private HTTP setup in the
[Docker guide](docker.md) does not require these OAuth settings.

## Understand the two sets of credentials

| Connection | Credentials | What they decide |
| --- | --- | --- |
| Person → connector | Microsoft Entra sign-in | Whether the person can connect and has the write role |
| Connector → wiki | Per-wiki bot username and password | Which pages and operations the wiki account can access |

Entra users do not log in to MediaWiki as themselves. Wiki requests use the
configured bot accounts, and edits are attributed to the connecting user in edit
summaries. No MediaWiki OAuth extension is needed for this model.

Access to the configured wiki farm is shared: anyone allowed to sign in can read
what those bot accounts can read. Writers also need the Entra app role and the
bot account's wiki rights. This is not per-user MediaWiki permission delegation.

## Before you start

Have these ready:

- A host running the published container or the built Node server.
- A public hostname, such as `wiki-mcp.example.com`, with HTTPS terminated by your
  reverse proxy and forwarded to the connector's HTTP port.
- An Entra tenant and permission to configure an app registration and app roles.
- Working wiki API URLs and [bot passwords](configuration.md#bot-passwords).
- Redis for a hosted deployment, recommended for broker state. A single-process
  trial can omit Redis, but broker state is lost on restart.

## 1. Configure the Entra app

Create or reuse an app registration in your tenant:

1. Add a **Web** redirect URI of `https://wiki-mcp.example.com/callback`.
2. Record the tenant ID, application/client ID, and a client secret's **value**.
3. Define a user app role whose value is `Writer` (or choose another value and set
   `OAUTH_WRITE_ROLE` to match).
4. Assign the write role to people who should edit. Configure the enterprise
   application's assignment policy to control who may sign in.

The redirect URI is `/callback`, not `/mcp`. Use the same public hostname in all
of the settings below.

## 2. Create the connector environment

Create `.env` beside your deployment's Compose file. Replace every `REPLACE_*`
value before starting:

```dotenv
MEDIAWIKI_MCP_AUTH=oauth
MEDIAWIKI_MCP_PUBLIC_URL=https://wiki-mcp.example.com
MEDIAWIKI_MCP_HOST=0.0.0.0
MEDIAWIKI_MCP_PORT=8009
MEDIAWIKI_MCP_ALLOWED_HOSTS=wiki-mcp.example.com

OAUTH_TENANT_ID=REPLACE_WITH_TENANT_ID
OAUTH_CLIENT_ID=REPLACE_WITH_CLIENT_ID
OAUTH_CLIENT_SECRET=REPLACE_WITH_CLIENT_SECRET_VALUE
OAUTH_WRITE_ROLE=Writer
MEDIAWIKI_MCP_JWT_SECRET=REPLACE_WITH_RANDOM_SECRET

MEDIAWIKI_WIKIS=Main:https://wiki.example.com,Dev:https://dev.example.com
MEDIAWIKI_DEFAULT_WIKI=Main
MEDIAWIKI_USERNAME_MAIN=YourUser@mcp
MEDIAWIKI_PASSWORD_MAIN=REPLACE_WITH_MAIN_BOT_PASSWORD
MEDIAWIKI_USERNAME_DEV=YourUser@mcp
MEDIAWIKI_PASSWORD_DEV=REPLACE_WITH_DEV_BOT_PASSWORD

REDIS_URL=redis://redis:6379
```

Generate a signing secret locally, for example with `openssl rand -hex 32`, and
paste its output as `MEDIAWIKI_MCP_JWT_SECRET`. Keep it consistent across replicas
that should accept the same broker tokens. Do not use the literal placeholder.

If requests arrive through **one trusted reverse proxy**, also set:

```dotenv
MEDIAWIKI_MCP_TRUST_PROXY=1
```

Leave this unset for direct connections. It controls forwarded client-IP handling
for rate limits, not which users are authorized.

## 3. Start the server and Redis

A single-host example, with a reverse proxy on the same host:

```yaml
services:
  mediawiki-mcp:
    image: ghcr.io/ttpears/mediawiki-mcp:2.5.4
    env_file:
      - .env
    ports:
      - "127.0.0.1:8009:8009"
    depends_on:
      - redis
    restart: unless-stopped
  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes"]
    volumes:
      - broker-state:/data
    restart: unless-stopped
volumes:
  broker-state:
```

This Redis service is available only on the Compose network and has no host port.
Use your existing protected Redis service instead if you have one, changing
`REDIS_URL` accordingly. If the proxy itself is a container, attach it to the
connector's network and forward to `http://mediawiki-mcp:8009` instead of using
the proxy container's `localhost`.

```bash
docker compose up -d
curl --fail http://127.0.0.1:8009/health
```

Expected health fields include `"status":"ok"` and `"auth":"oauth"`. Configure
TLS forwarding so the same service is reachable at the public hostname.

For a source checkout, build first and run
`node --env-file=.env dist/http-transport.js`; see [Contributing](../CONTRIBUTING.md#build-and-run).

## 4. Check the public endpoints

```bash
curl --fail https://wiki-mcp.example.com/health
curl --fail https://wiki-mcp.example.com/.well-known/oauth-protected-resource/mcp
curl --fail https://wiki-mcp.example.com/.well-known/oauth-authorization-server
```

Health should report `auth: oauth`. The metadata documents should name the public
connector address. An unauthenticated MCP request must get HTTP 401 with a
`WWW-Authenticate` challenge:

```bash
curl -i https://wiki-mcp.example.com/mcp
```

If it connects without authentication, check that `MEDIAWIKI_MCP_AUTH=oauth`
reached the server process. If it returns 421, check the public host allowlist.

## 5. Add the connector to your client

In claude.ai, add a custom connector whose URL is:

```text
https://wiki-mcp.example.com/mcp
```

The client discovers the authorization metadata, registers itself, and opens the
Entra sign-in flow. After signing in, ask it to list wikis and read a known page.
A user without `Writer` should see read tools but no page-edit or upload tools.
A writer also needs a bot account that can perform the requested edit on the wiki.

## What users should expect

- Authorization lasts at most **one hour after sign-in**, including refresh
  rotations. Signing in again rechecks Entra roles; removing a role can take up
  to the remaining hour to take effect.
- Wiki-management tools are unavailable in OAuth mode. Configure the farm on the
  server and pass `wiki` in tool calls to choose a wiki.
- A change of user, OAuth client, or write permission requires a new MCP session.
- Redis shares broker state, not the active MCP transport session. Multiple
  replicas need session-aware routing; a reconnect may be required after restart
  or when a request reaches a different replica.

Next: [full setting reference](configuration.md#oauth-settings) or
[sign-in and session troubleshooting](operations.md#troubleshooting).
