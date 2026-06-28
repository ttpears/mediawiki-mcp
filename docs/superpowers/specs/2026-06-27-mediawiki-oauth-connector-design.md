# MediaWiki MCP — OAuth connector for claude.ai

**Date:** 2026-06-27
**Status:** Approved design, pending implementation plan
**Goal:** Let the existing MediaWiki MCP server be added to claude.ai as a remote **custom connector** over a public HTTPS URL, authenticated with OAuth so each user acts on the wiki **as themselves** with exactly their own wiki permissions.

## Summary

Add a third operating mode to the existing HTTP transport: an **OAuth broker mode** (`MEDIAWIKI_MCP_AUTH=oauth`). In this mode the server is, simultaneously:

- **To Claude:** the OAuth 2.1 authorization server *and* resource server — it publishes discovery metadata, performs Dynamic Client Registration, and issues its own tokens.
- **To the wiki:** a registered OAuth 2.0 consumer that acts on each user's behalf.

The wiki's **MediaWiki OAuth extension** is the only identity source. There is no Entra or other external IdP. Login to the wiki grants the user whatever access they already have on the wiki.

The existing **stdio** path (npx / Claude Code plugin, bot password) and the existing **LibreChat header-HTTP** path (trusted `x-user-username`, no real auth) are unchanged. OAuth mode is **single-wiki**: it serves the one wiki where the OAuth consumer is registered. Multi-wiki fan-out remains a feature of the unauthenticated / bot-password paths only.

## Why a broker (and not pass-through)

The clean idea — Claude holds a raw MediaWiki OAuth token and the server relays it to the wiki — is **not viable** under the MCP authorization spec revisions Claude's connectors use (2025-03-26 / 2025-06-18 / 2025-11-25):

- **Audience binding (MUST):** the MCP server must reject any token not audienced to itself. A raw MediaWiki token is audienced to the wiki.
- **No token passthrough (MUST NOT):** the server must not forward the client's token to an upstream API.
- MediaWiki's OAuth extension **does not** publish RFC 8414 authorization-server metadata and **does not** support RFC 7591 Dynamic Client Registration, both of which Claude's flow expects.

Therefore the server must run its own spec-compliant authorization server (a **broker**) in front of the wiki's OAuth. The broker issues its own audience-bound tokens to Claude and separately holds each user's wiki token to call the wiki. The MCP TypeScript SDK provides building blocks for this (`mcpAuthRouter`, an `OAuthServerProvider` interface / `ProxyOAuthServerProvider`).

## Verified upstream facts (MediaWiki OAuth 2.0 extension)

- Endpoints (under the wiki REST base): `GET /rest.php/oauth2/authorize`, `POST /rest.php/oauth2/access_token`, `GET /rest.php/oauth2/resource/profile` (identity: `sub`, username, groups, rights).
- An issued access token used as `Authorization: Bearer <token>` authenticates ordinary `api.php` / `rest.php` requests **as that user** (via the extension's SessionProvider), so edits work — subject to grants.
- Supports confidential + public clients, PKCE (`S256`), and refresh tokens. Default lifetimes: access token 1h (`$wgOAuth2GrantExpirationInterval = PT1H`), refresh token 1 month (`$wgOAuth2RefreshTokenTTL = P1M`).
- **Grants are an intersection:** effective access = (grants the consumer was registered with) ∩ (the user's real rights). To honor "the user's own permissions are the ceiling," the consumer is registered with a **broad** grant set.
- Consumers are registered manually at `Special:OAuthConsumerRegistration/propose/oauth2`; a consumer that acts on behalf of other users requires OAuth-admin approval.

## Verified client facts (claude.ai connector / MCP spec)

- MCP server **MUST** serve RFC 9728 Protected Resource Metadata at `/.well-known/oauth-protected-resource` with an `authorization_servers` entry, and **MUST** return `WWW-Authenticate` on 401.
- The authorization server **MUST** publish RFC 8414 metadata (`/.well-known/oauth-authorization-server`); the client discovers endpoints from it.
- DCR (RFC 7591) is **SHOULD**; manual `client_id`/`client_secret` entry is also supported by claude.ai for non-DCR servers.
- The MCP server **MUST** validate token audience = itself and **MUST NOT** pass the client's token upstream.
- Transport must be **Streamable HTTP** over **HTTPS**. Claude's hosted callback is `https://claude.ai/api/mcp/auth_callback`.

## Components

| Component | Responsibility |
|---|---|
| `src/auth/broker-router.ts` | Express router mounting broker endpoints; built on the MCP SDK auth helpers + a custom `OAuthServerProvider`. |
| `src/auth/mediawiki-oauth.ts` | Upstream OAuth client: build authorize redirect, exchange code at `/access_token`, fetch identity at `/resource/profile`, refresh access tokens. |
| `src/auth/token-store.ts` | Postgres-backed, AES-GCM-encrypted store for per-user wiki tokens + broker sessions + pending-auth records. Interface-first so tests use an in-memory implementation. |
| `src/auth/bearer-middleware.ts` | Validates the broker token on `/mcp` (audience = this server, not expired); loads/refreshes the user's wiki token; attaches user + wiki-token to the per-request context; 401 + `WWW-Authenticate` otherwise. |
| client layer change | `ActionClient` / `RestClient` gain a "use this bearer token" mode so a per-request client acts as the OAuth user instead of bot-password login. Tools stay transport-agnostic. |

## Endpoints (OAuth mode, public HTTPS)

- `GET /.well-known/oauth-protected-resource` → RFC 9728 PRMD: `resource` = public MCP URL, `authorization_servers` = [this server].
- `GET /.well-known/oauth-authorization-server` → RFC 8414 metadata: authorize/token/register endpoints, `code_challenge_methods_supported = ["S256"]`.
- `POST /register` → RFC 7591 DCR shim (also accepts a pre-provisioned client_id path).
- `GET /authorize` → mint broker state + upstream PKCE, persist a pending-auth record, redirect the user to the wiki's authorize endpoint.
- `GET /callback` → registered as the consumer's redirect URI. Exchange the wiki code for wiki access+refresh, fetch identity, store tokens, mint a broker authorization code bound to Claude's PKCE challenge, redirect to Claude's callback.
- `POST /token` → Claude exchanges the broker code (with its PKCE verifier) for a broker access+refresh token audienced to this server.
- `POST/GET/DELETE /mcp` → behind `bearer-middleware`; tools execute as the resolved wiki user.

## Data flow & state

The full OAuth dance happens **at connector setup**, so there is no mid-tool-call consent problem. Postgres holds:

- per-user encrypted wiki access + refresh tokens, keyed by wiki `sub` / username;
- broker refresh sessions;
- short-lived pending-auth records (state + PKCE).

Wiki access tokens (1h) are refreshed on demand from the stored refresh token (~1mo); when the refresh token expires the user re-authenticates. Broker access tokens are signed JWTs carrying the user `sub` (used as the store lookup key) and audienced to this server.

## Access model

Access = **anyone who can log into the wiki**. There is no separate group gate. The consumer is registered with a **broad** grant set so each user's own wiki rights are the actual ceiling (editor edits, sysop deletes, etc.). A group/membership gate can be added later by inspecting the `groups` claim from `/resource/profile`, but is out of scope for this design.

## Operator setup (one-time, documented)

1. Install/enable the MediaWiki OAuth extension (OAuth 2.0) on the target wiki (MW ≥ ~1.35; current extension master requires 1.47).
2. Register a **confidential** OAuth 2.0 consumer via `Special:OAuthConsumerRegistration/propose/oauth2` with a broad grant set and redirect URI `<public-url>/callback`; get it admin-approved.
3. Configure env on the connector instance:
   - `MEDIAWIKI_MCP_AUTH=oauth`
   - `MEDIAWIKI_MCP_PUBLIC_URL` (used for metadata documents + redirect URIs)
   - `MEDIAWIKI_OAUTH_CLIENT_ID` / `MEDIAWIKI_OAUTH_CLIENT_SECRET`
   - `MEDIAWIKI_OAUTH_WIKI` (which registered wiki this connector serves)
   - `DATABASE_URL` (Postgres)
   - `MEDIAWIKI_MCP_ENCRYPTION_KEY` (AES-GCM key for token columns)
4. TLS is terminated at the existing reverse proxy; the server runs HTTP behind it but must know its public URL.

## Error handling & security

- Validate token audience on every `/mcp` request; reject tokens not issued for this server.
- Never forward the broker's Claude-token upstream — only the separately stored wiki token is used against the wiki.
- Encrypt wiki tokens at rest (AES-GCM, app-level).
- 401 responses carry `WWW-Authenticate` pointing at the PRMD URL.
- Pending-auth records are single-use and time-boxed.

## Testing

Unit tests with mocked wiki OAuth endpoints and an in-memory token store:

- metadata documents (PRMD + AS metadata) shape and contents;
- DCR registration;
- authorize redirect construction (state + PKCE);
- callback code exchange + identity fetch + token persistence;
- broker `/token` exchange and audience binding;
- wiki access-token refresh on expiry;
- audience rejection of foreign tokens;
- encryption round-trip in the token store;
- per-user client wiring (request acts as the OAuth user, not the bot).

Regression: `npm run type-check` + `vitest` stay green; smoke-test that stdio and the existing header-HTTP path still initialize unchanged (the dual-deployment rule in CLAUDE.md).

## Out of scope

- Multi-wiki fan-out under OAuth (single wiki only).
- Group/role-based access gating beyond the wiki's own permissions.
- Migrating the LibreChat path onto OAuth (it keeps its trusted-header model).
- New dependency choices (Postgres driver, JWT lib) are settled during the implementation plan.
