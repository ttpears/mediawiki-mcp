# MediaWiki OAuth Connector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an OAuth broker mode so the MediaWiki MCP server can be added to claude.ai as a remote connector, authenticating each user via the wiki's MediaWiki OAuth extension and acting on the wiki as that user.

**Architecture:** A new `MEDIAWIKI_MCP_AUTH=oauth` mode turns the existing Streamable-HTTP transport into a spec-compliant OAuth 2.1 authorization + resource server. To Claude it publishes discovery metadata, does DCR, and issues its own JWT access tokens. Behind the scenes it brokers to one wiki's `/rest.php/oauth2/*` endpoints, stores each user's wiki access/refresh tokens (AES-GCM encrypted) in Postgres keyed by the wiki `sub`, and on each `/mcp` request builds a per-user `WikiOrchestrator` whose clients call the wiki with that user's bearer token. stdio and the LibreChat header-HTTP path are untouched.

**Tech Stack:** TypeScript (ESM), Express 4, `@modelcontextprotocol/sdk` 1.25.1 (auth helpers: `mcpAuthRouter`, `mcpAuthMetadataRouter`, `requireBearerAuth`, `OAuthServerProvider`), `pg` (Postgres), `jose` (JWT), Node `crypto` (AES-256-GCM), `axios` (existing), `vitest`.

## Global Constraints

- Node >= 18, ESM modules, `.js` extensions on relative imports.
- Do NOT break stdio (`src/index.ts`/`src/stdio.ts`) or the LibreChat header-HTTP path. The dual-deployment rule in CLAUDE.md applies.
- Tool definitions in `src/tools/` stay transport-agnostic — no auth code in tools.
- OAuth mode is single-wiki (`MEDIAWIKI_OAUTH_WIKI` selects which registered wiki).
- `npm run type-check` + `npm test` must pass before any task is complete.
- Commit messages: no emojis, no Claude/Code attribution.
- MCP authorization rules: validate token audience = this server; never pass the Claude-issued token upstream; only the separately stored wiki token is used against the wiki.
- New deps pinned compatible with existing ranges: `pg`, `jose`, `@types/pg` (dev).

## File Structure

- Create `src/auth/config.ts` — parse + validate OAuth env into `OAuthConfig`.
- Create `src/auth/crypto.ts` — AES-256-GCM `encrypt`/`decrypt`.
- Create `src/auth/token-store.ts` — `TokenStore` interface + `InMemoryTokenStore`.
- Create `src/auth/pg-token-store.ts` — `PgTokenStore` (Postgres impl + schema bootstrap).
- Create `src/auth/mediawiki-oauth.ts` — `MediaWikiOAuthClient` (upstream OAuth calls).
- Create `src/auth/tokens.ts` — `BrokerTokens` (sign/verify JWT access tokens).
- Create `src/auth/broker-provider.ts` — `MediaWikiOAuthProvider implements OAuthServerProvider`.
- Create `src/auth/broker-router.ts` — assemble `mcpAuthRouter` + `/callback` + metadata.
- Create `src/auth/wiki-auth-provider.ts` — `WikiAuthProvider` (sub → fresh wiki access token).
- Modify `src/clients/action-client.ts` — optional bearer-token provider.
- Modify `src/clients/rest-client.ts` — optional bearer-token provider.
- Modify `src/wiki-orchestrator.ts` — optional `authProvider` to build clients in bearer mode.
- Modify `src/http-transport.ts` — mount OAuth mode when configured.
- Tests under `tests/auth/*` and additions to `tests/clients/*`, `tests/wiki-orchestrator.test.ts`.
- Update `README.md`, add `.env.example`.

---

## Task 1: OAuth config module

**Files:**
- Create: `src/auth/config.ts`
- Test: `tests/auth/config.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface OAuthConfig {
    publicUrl: string;        // e.g. https://mcp.example.com  (no trailing slash)
    wiki: string;             // registered wiki name to broker for
    clientId: string;         // wiki OAuth consumer id
    clientSecret: string;     // wiki OAuth consumer secret
    databaseUrl: string;      // postgres connection string
    encryptionKey: Buffer;    // 32 bytes, from base64 MEDIAWIKI_MCP_ENCRYPTION_KEY
    jwtSecret: string;        // HS256 signing secret for broker tokens
    scopesSupported: string[];// advertised scopes (default ['mediawiki'])
  }
  export function isOAuthMode(env: Record<string,string|undefined>): boolean; // env.MEDIAWIKI_MCP_AUTH === 'oauth'
  export function loadOAuthConfig(env: Record<string,string|undefined>): OAuthConfig; // throws on missing/invalid
  ```

- [ ] **Step 1: Write the failing test** (`tests/auth/config.test.ts`): valid env → populated `OAuthConfig` with a 32-byte `encryptionKey`; missing `MEDIAWIKI_OAUTH_CLIENT_ID` throws with a message naming the var; a non-32-byte key throws.
- [ ] **Step 2: Run `npx vitest run tests/auth/config.test.ts`** — expect FAIL (module missing).
- [ ] **Step 3: Implement `loadOAuthConfig`** reading: `MEDIAWIKI_MCP_PUBLIC_URL` (strip trailing `/`), `MEDIAWIKI_OAUTH_WIKI`, `MEDIAWIKI_OAUTH_CLIENT_ID`, `MEDIAWIKI_OAUTH_CLIENT_SECRET`, `DATABASE_URL`, `MEDIAWIKI_MCP_ENCRYPTION_KEY` (base64-decode, assert 32 bytes), `MEDIAWIKI_MCP_JWT_SECRET`. Each missing required var throws `Error('Missing required env: <NAME>')`.
- [ ] **Step 4: Run the test** — expect PASS.
- [ ] **Step 5: Commit** `feat(auth): add OAuth config loader`.

## Task 2: AES-256-GCM crypto helper

**Files:**
- Create: `src/auth/crypto.ts`
- Test: `tests/auth/crypto.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function encrypt(plaintext: string, key: Buffer): string; // returns base64(iv|tag|ciphertext)
  export function decrypt(payload: string, key: Buffer): string;   // inverse; throws on tamper
  ```

- [ ] **Step 1: Failing test** — round-trip `decrypt(encrypt(s,key),key) === s` for a sample secret; two `encrypt` calls of the same input differ (random IV); flipping a byte of the payload makes `decrypt` throw.
- [ ] **Step 2: Run** `npx vitest run tests/auth/crypto.test.ts` — FAIL.
- [ ] **Step 3: Implement** using `crypto.randomBytes(12)` IV, `createCipheriv('aes-256-gcm', key, iv)`, append `getAuthTag()`; layout `Buffer.concat([iv, tag, ciphertext])` base64-encoded; `decrypt` slices 12-byte iv + 16-byte tag, `setAuthTag`, decrypts.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(auth): add AES-256-GCM token encryption`.

## Task 3: Token store interface + in-memory implementation

**Files:**
- Create: `src/auth/token-store.ts`
- Test: `tests/auth/token-store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  import { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js';

  export interface WikiTokenRecord { sub: string; username: string; accessToken: string; refreshToken: string; expiresAt: number; }
  export interface PendingAuth { brokerState: string; clientId: string; clientRedirectUri: string; clientState?: string; clientCodeChallenge: string; upstreamCodeVerifier: string; createdAt: number; }
  export interface AuthCodeRecord { code: string; sub: string; clientId: string; clientCodeChallenge: string; createdAt: number; }
  export interface RefreshRecord { token: string; sub: string; clientId: string; }

  export interface TokenStore {
    // DCR clients
    getClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;
    saveClient(client: OAuthClientInformationFull): Promise<void>;
    // pending upstream auth (keyed by brokerState)
    savePendingAuth(p: PendingAuth): Promise<void>;
    takePendingAuth(brokerState: string): Promise<PendingAuth | undefined>; // single-use
    // broker auth codes (keyed by code)
    saveAuthCode(c: AuthCodeRecord): Promise<void>;
    takeAuthCode(code: string): Promise<AuthCodeRecord | undefined>; // single-use
    // wiki tokens (keyed by sub)
    saveWikiToken(r: WikiTokenRecord): Promise<void>;
    getWikiToken(sub: string): Promise<WikiTokenRecord | undefined>;
    // refresh tokens (keyed by token)
    saveRefresh(r: RefreshRecord): Promise<void>;
    takeRefresh(token: string): Promise<RefreshRecord | undefined>; // single-use (rotation)
  }
  export class InMemoryTokenStore implements TokenStore { /* Maps */ }
  ```

- [ ] **Step 1: Failing test** — exercise `InMemoryTokenStore`: save/get client; `takePendingAuth`/`takeAuthCode`/`takeRefresh` return the record once then `undefined`; `saveWikiToken` then `getWikiToken` returns latest by sub.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with private `Map`s; `take*` deletes on read.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(auth): add token store interface and in-memory impl`.

## Task 4: Postgres token store

**Files:**
- Create: `src/auth/pg-token-store.ts`
- Test: `tests/auth/pg-token-store.test.ts` (contract test, **skipped unless `DATABASE_URL` set**)

**Interfaces:**
- Consumes: `TokenStore`, `encrypt`/`decrypt` (Task 2), `OAuthConfig.encryptionKey`.
- Produces:
  ```ts
  export class PgTokenStore implements TokenStore {
    constructor(pool: import('pg').Pool, encryptionKey: Buffer);
    init(): Promise<void>; // CREATE TABLE IF NOT EXISTS for all 5 tables
  }
  ```

- [ ] **Step 1: Test** — guard with `describe.skipIf(!process.env.DATABASE_URL)`; when run, `init()` then the same contract as Task 3 against a live pool; assert `getWikiToken` returns decrypted plaintext (i.e. column is encrypted: query raw column, assert it is NOT the plaintext).
- [ ] **Step 2: Run** — SKIPPED locally (acceptable); FAIL if `DATABASE_URL` set and unimplemented.
- [ ] **Step 3: Implement** parameterized queries; tables `oauth_clients(client_id pk, data jsonb)`, `oauth_pending(broker_state pk, data jsonb, created_at)`, `oauth_codes(code pk, data jsonb, created_at)`, `oauth_wiki_tokens(sub pk, username, access_enc, refresh_enc, expires_at)`, `oauth_refresh(token pk, sub, client_id)`. Encrypt `accessToken`/`refreshToken` via `encrypt(...)` on write; `decrypt` on read. `take*` = `DELETE ... RETURNING`.
- [ ] **Step 4: Run** — PASS (or SKIPPED). Always run `npm run type-check`.
- [ ] **Step 5: Commit** `feat(auth): add Postgres token store`.

## Task 5: MediaWiki upstream OAuth client

**Files:**
- Create: `src/auth/mediawiki-oauth.ts`
- Test: `tests/auth/mediawiki-oauth.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface UpstreamTokens { accessToken: string; refreshToken: string; expiresIn: number; }
  export interface UpstreamIdentity { sub: string; username: string; }
  export class MediaWikiOAuthClient {
    constructor(baseUrl: string, clientId: string, clientSecret: string, redirectUri: string, http?: AxiosInstance);
    buildAuthorizeUrl(state: string, codeChallenge: string): string; // GET .../rest.php/oauth2/authorize?response_type=code&client_id&redirect_uri&state&code_challenge&code_challenge_method=S256
    exchangeCode(code: string, codeVerifier: string): Promise<UpstreamTokens>; // POST .../oauth2/access_token grant_type=authorization_code
    refresh(refreshToken: string): Promise<UpstreamTokens>; // grant_type=refresh_token
    fetchIdentity(accessToken: string): Promise<UpstreamIdentity>; // GET .../oauth2/resource/profile (Bearer); sub=String(profile.sub), username=profile.username
  }
  ```

- [ ] **Step 1: Failing test** with the existing `tests/helpers/mock-axios.ts` pattern: `buildAuthorizeUrl` contains the right path + query params; `exchangeCode` POSTs form-encoded and maps `{access_token, refresh_token, expires_in}` → `UpstreamTokens`; `fetchIdentity` sends `Authorization: Bearer` and maps profile → `{sub, username}`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with axios; token endpoints use `application/x-www-form-urlencoded`; include `client_id`+`client_secret` (confidential client) and `redirect_uri`; `exchangeCode` also sends `code_verifier`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(auth): add MediaWiki upstream OAuth client`.

## Task 6: Broker JWT tokens

**Files:**
- Create: `src/auth/tokens.ts`
- Test: `tests/auth/tokens.test.ts`

**Interfaces:**
- Consumes: `jose`.
- Produces:
  ```ts
  import { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
  export class BrokerTokens {
    constructor(jwtSecret: string, audience: string, scopes: string[]); // audience = OAuthConfig.publicUrl + '/mcp'
    signAccessToken(sub: string, clientId: string, ttlSeconds?: number): Promise<string>; // default 3600
    verifyAccessToken(token: string): Promise<AuthInfo>; // throws if invalid/expired/aud mismatch; returns { token, clientId, scopes, expiresAt, extra:{ sub } }
  }
  ```

- [ ] **Step 1: Failing test** — `signAccessToken('u1','c1')` then `verifyAccessToken` returns `extra.sub==='u1'`, `clientId==='c1'`, scopes set; a token signed with a different secret throws; a token with wrong audience throws (sign with audience X, verify instance audience Y).
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** with `jose` `SignJWT` (HS256, `setAudience`, `setExpirationTime`, `setSubject`, custom claim `client_id`) and `jwtVerify` (with `audience`). Map to `AuthInfo`.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(auth): add broker JWT issuing/verification`.

## Task 7: OAuthServerProvider implementation

**Files:**
- Create: `src/auth/broker-provider.ts`
- Test: `tests/auth/broker-provider.test.ts`

**Interfaces:**
- Consumes: `TokenStore` (Task 3), `MediaWikiOAuthClient` (Task 5), `BrokerTokens` (Task 6), SDK `OAuthServerProvider`, `OAuthRegisteredClientsStore`.
- Produces:
  ```ts
  export class MediaWikiOAuthProvider implements OAuthServerProvider {
    constructor(store: TokenStore, upstream: MediaWikiOAuthClient, tokens: BrokerTokens, genId?: () => string);
    get clientsStore(): OAuthRegisteredClientsStore; // backed by store.getClient/saveClient
    authorize(client, params, res): Promise<void>;
    challengeForAuthorizationCode(client, code): Promise<string>;
    exchangeAuthorizationCode(client, code, codeVerifier?, redirectUri?, resource?): Promise<OAuthTokens>;
    exchangeRefreshToken(client, refreshToken, scopes?, resource?): Promise<OAuthTokens>;
    verifyAccessToken(token): Promise<AuthInfo>;
    // called by the custom /callback route (Task 8):
    handleUpstreamCallback(code: string, brokerState: string): Promise<{ redirectTo: string }>;
  }
  ```
  Behavior:
  - `authorize`: generate `brokerState` + upstream PKCE (verifier/challenge via S256); `savePendingAuth({brokerState, clientId:client.client_id, clientRedirectUri:params.redirectUri, clientState:params.state, clientCodeChallenge:params.codeChallenge, upstreamCodeVerifier, createdAt})`; `res.redirect(upstream.buildAuthorizeUrl(brokerState, upstreamChallenge))`.
  - `handleUpstreamCallback`: `takePendingAuth(brokerState)`; `upstream.exchangeCode(code, pending.upstreamCodeVerifier)`; `upstream.fetchIdentity(tokens.accessToken)`; `saveWikiToken({sub, username, accessToken, refreshToken, expiresAt: now+expiresIn*1000})`; mint broker `code`; `saveAuthCode({code, sub, clientId, clientCodeChallenge: pending.clientCodeChallenge})`; return `redirectTo = pending.clientRedirectUri?code=<code>&state=<clientState>`.
  - `challengeForAuthorizationCode`: `takeAuthCode`? No — must NOT consume here. Read without deleting via a peek; simplest: `saveAuthCode` keeps it; `challengeForAuthorizationCode` reads it (peek), `exchangeAuthorizationCode` consumes it. Add `peekAuthCode(code)` to store, OR store challenge in code map and only delete in exchange. Implementation: add `peekAuthCode` to `TokenStore` (returns without delete); keep `takeAuthCode` for exchange.
  - `exchangeAuthorizationCode`: `takeAuthCode(code)`; `signAccessToken(rec.sub, client.client_id)`; create opaque refresh (random), `saveRefresh({token, sub, clientId})`; return `{access_token, token_type:'Bearer', expires_in:3600, refresh_token, scope}`.
  - `exchangeRefreshToken`: `takeRefresh(refreshToken)`; new access token; rotate refresh (`saveRefresh` new); return tokens.
  - `verifyAccessToken`: delegate to `tokens.verifyAccessToken`.

**Note:** add `peekAuthCode(code): Promise<AuthCodeRecord|undefined>` to `TokenStore` (Task 3 + Task 4) before this task — update both impls and their tests.

- [ ] **Step 1: Failing test** — with `InMemoryTokenStore` + a stubbed `MediaWikiOAuthClient` (override methods) + real `BrokerTokens`: (a) `authorize` writes a pending record and redirects to the upstream URL; (b) `handleUpstreamCallback` stores a wiki token and returns a redirect to the client with a `code`; (c) `challengeForAuthorizationCode` returns the client's original challenge; (d) `exchangeAuthorizationCode` returns a verifiable access token whose `sub` matches; (e) `exchangeRefreshToken` rotates and returns a new token.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as above. Use injected `genId` for deterministic ids in tests.
- [ ] **Step 4: Run** — PASS. Run `npm run type-check`.
- [ ] **Step 5: Commit** `feat(auth): add MediaWiki OAuth broker provider`.

## Task 8: Broker router (metadata + DCR + callback)

**Files:**
- Create: `src/auth/broker-router.ts`
- Test: `tests/auth/broker-router.test.ts`

**Interfaces:**
- Consumes: `MediaWikiOAuthProvider`, SDK `mcpAuthRouter`, `OAuthConfig`.
- Produces:
  ```ts
  export interface BrokerSetup { router: import('express').Router; provider: MediaWikiOAuthProvider; resourceMetadataUrl: string; }
  export function createBrokerRouter(config: OAuthConfig, provider: MediaWikiOAuthProvider): BrokerSetup;
  ```
  - Mounts `mcpAuthRouter({ provider, issuerUrl: new URL(config.publicUrl), resourceServerUrl: new URL(config.publicUrl + '/mcp'), scopesSupported: config.scopesSupported })`.
  - Adds `GET /callback`: `const { redirectTo } = await provider.handleUpstreamCallback(req.query.code, req.query.state); res.redirect(redirectTo)` with error handling → redirect with `error=` param.
  - `resourceMetadataUrl = getOAuthProtectedResourceMetadataUrl(new URL(config.publicUrl + '/mcp'))`.

- [ ] **Step 1: Failing test** — use `express` + `supertest`-style via `http`/`fetch` against an ephemeral server, OR call handlers directly. Assert: `GET /.well-known/oauth-authorization-server` returns metadata JSON with `authorization_endpoint`, `token_endpoint`, `registration_endpoint`; `GET /callback?...` invokes `provider.handleUpstreamCallback` (spy) and 302-redirects. (Add `supertest` + `@types/supertest` as devDeps if not present, or use Node `http` + `fetch`.)
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** as above.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** `feat(auth): add broker router with metadata, DCR, and callback`.

## Task 9: Per-user wiki auth provider + client bearer mode

**Files:**
- Modify: `src/clients/action-client.ts`, `src/clients/rest-client.ts`, `src/wiki-orchestrator.ts`
- Create: `src/auth/wiki-auth-provider.ts`
- Test: additions to `tests/clients/action-client.test.ts`, `tests/clients/rest-client.test.ts`, `tests/wiki-orchestrator.test.ts`, new `tests/auth/wiki-auth-provider.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // action-client.ts & rest-client.ts:
  setBearerTokenProvider(provider: () => Promise<string>): void;
  // when set: request interceptor sets Authorization: Bearer <await provider()>; ActionClient.login() returns early.

  // wiki-orchestrator.ts: optional constructor arg
  interface WikiAuthProvider { getAccessToken(wikiName: string): Promise<string>; }
  constructor(registry: WikiRegistry, authProvider?: WikiAuthProvider);
  // when authProvider present, getClients() wires setBearerTokenProvider on new ActionClient/RestClient.

  // src/auth/wiki-auth-provider.ts:
  export function createWikiAuthProvider(sub: string, store: TokenStore, upstream: MediaWikiOAuthClient): WikiAuthProvider;
  // getAccessToken: load WikiTokenRecord by sub; if expiresAt within 60s, upstream.refresh(refreshToken), saveWikiToken(updated); return current access token.
  ```

- [ ] **Step 1: Failing tests** — ActionClient with a bearer provider sets the `Authorization` header and does NOT call login token endpoint (assert request headers via mock-axios); RestClient likewise; orchestrator built with an `authProvider` produces clients that send the bearer header; `createWikiAuthProvider` refreshes when `expiresAt` is in the past and returns the new token.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the bearer interceptor (async) in both clients (guard: only when provider set; skip cookie-based login path); orchestrator wiring; `createWikiAuthProvider`.
- [ ] **Step 4: Run full suite** `npm test` — PASS (verify no regression in existing client/orchestrator tests).
- [ ] **Step 5: Commit** `feat(auth): add per-user wiki bearer auth and client bearer mode`.

## Task 10: Wire OAuth mode into the HTTP transport

**Files:**
- Modify: `src/http-transport.ts`
- Test: `tests/auth/http-transport-oauth.test.ts`

**Interfaces:**
- Consumes: everything above.
- Behavior when `isOAuthMode(env)`:
  - Build `config = loadOAuthConfig(env)`, `pool = new Pool({connectionString: config.databaseUrl})`, `store = new PgTokenStore(pool, config.encryptionKey)`, `await store.init()`.
  - `upstream = new MediaWikiOAuthClient(registry.resolveWiki(config.wiki).baseUrl, config.clientId, config.clientSecret, config.publicUrl + '/callback')`.
  - `tokens = new BrokerTokens(config.jwtSecret, config.publicUrl + '/mcp', config.scopesSupported)`.
  - `provider = new MediaWikiOAuthProvider(store, upstream, tokens)`.
  - `const { router, resourceMetadataUrl } = createBrokerRouter(config, provider)`; `app.use(router)`.
  - Protect `/mcp`: `app.use('/mcp', requireBearerAuth({ verifier: provider, resourceMetadataUrl }))` BEFORE the `/mcp` handlers.
  - In the `/mcp` POST init branch, derive `sub = req.auth!.extra!.sub as string`; build a **per-user** orchestrator `new WikiOrchestrator(registry, createWikiAuthProvider(sub, store, upstream))` scoped to `config.wiki`; `SessionContext = { orchestrator, sessionUser: sub }`. (Reuse the existing session map keyed by mcp-session-id; the bearer middleware runs each request so auth is always checked.)
  - When NOT oauth mode: existing behavior unchanged (header-based path).

- [ ] **Step 1: Failing test** — start the HTTP server in oauth mode with a fake env + `InMemoryTokenStore` injected (refactor `createHTTPServer` to accept an optional `{ store, upstream }` override for testability, defaulting to Pg/real). Assert: `GET /.well-known/oauth-protected-resource/mcp` returns metadata; `POST /mcp` without a Bearer token → 401 with `WWW-Authenticate` containing the resource metadata URL; `POST /mcp` with a valid broker token (minted via `BrokerTokens`) reaches initialize.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement** the mode branch + the testability override. Keep the non-oauth code path byte-for-byte behaviorally identical.
- [ ] **Step 4: Run** `npm test` + `npm run type-check` — PASS. Smoke: `node dist/index.js` (stdio) still starts; `MEDIAWIKI_MCP_AUTH` unset → header path unchanged.
- [ ] **Step 5: Commit** `feat(auth): wire OAuth broker mode into HTTP transport`.

## Task 11: Docs, env sample, dependency manifest

**Files:**
- Modify: `README.md`, `package.json` (deps), create `.env.example`
- Modify: `CLAUDE.md` (note the third deployment path) — only if user keeps CLAUDE.md tracked.

**Interfaces:** none (docs).

- [ ] **Step 1:** Add `pg` + `jose` to `dependencies`, `@types/pg` (+ `supertest`/`@types/supertest` if used) to `devDependencies`; run `npm install`; verify `npm run build`.
- [ ] **Step 2:** Write `.env.example` listing every OAuth env var with a comment, plus the existing wiki vars.
- [ ] **Step 3:** README section "Use as a Claude.ai connector (OAuth)": consumer registration steps (`Special:OAuthConsumerRegistration/propose/oauth2`, broad grants, redirect `<public-url>/callback`, admin approval), required env, reverse-proxy/HTTPS note, the discovery URLs Claude will hit.
- [ ] **Step 4:** Run `npm run type-check` + `npm test` — PASS.
- [ ] **Step 5: Commit** `docs: document OAuth connector setup and add env sample`.

---

## Self-Review

- **Spec coverage:** broker vs pass-through (Tasks 7–8, 10) ✓; RFC 9728 PRMD + RFC 8414 metadata + DCR (Task 8, 10 via `mcpAuthRouter`/`mcpAuthMetadataRouter`) ✓; audience validation + no passthrough (Task 6 verify, Task 9 uses stored wiki token only) ✓; Postgres encrypted store (Tasks 2–4) ✓; per-user act-as-user (Tasks 5,7,9,10) ✓; single-wiki (`config.wiki`, Task 1/10) ✓; broad-grants + setup (Task 11) ✓; coexistence as 3rd mode (Task 10 branch) ✓; refresh handling (Task 5,9) ✓; testing strategy (every task) ✓.
- **Placeholder scan:** none — interfaces and behaviors specified per task.
- **Type consistency:** `TokenStore` gains `peekAuthCode` (noted in Task 7, must be added to Tasks 3 & 4 impls); `AuthInfo.extra.sub` is the lookup key used in Tasks 6/10; `getAccessToken(wikiName)` signature consistent across Task 9.

## Open implementation decisions (resolve while coding, low-risk)
- Test HTTP via `supertest` vs Node `http`+`fetch`: prefer `supertest` (add devDep) for clarity.
- Refresh-token storage is opaque-random in Postgres (rotation + revocation) rather than JWT; access tokens are stateless JWTs.
