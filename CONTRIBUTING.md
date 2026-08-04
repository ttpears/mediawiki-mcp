# Contributing to mediawiki-mcp

## What this server does

`mediawiki-mcp` exposes one or more MediaWiki wikis to an AI assistant (Claude
Code, Cowork, or any MCP-compatible client) as a set of callable tools —
searching pages, reading content, and optionally creating/editing pages. It
supports multiple wikis at once (configured as `Name:URL` pairs), with one
marked as the default when a client doesn't specify which wiki to use.

## Getting it running locally

**Don't point this at a production wiki while developing.** Stand up a
throwaway local MediaWiki first. A minimal `docker-compose.yml`:

```yaml
services:
  wiki-db:
    image: mariadb:11.4
    environment:
      MARIADB_ROOT_PASSWORD: local-dev-only
      MARIADB_DATABASE: mediawiki
      MARIADB_USER: mediawiki
      MARIADB_PASSWORD: local-dev-only
    volumes: [wiki-db:/var/lib/mysql]
  mediawiki:
    image: mediawiki:lts
    ports: ["8080:80"]
    depends_on: [wiki-db]
volumes:
  wiki-db:
```

```bash
docker compose up -d
```

Then, at `http://localhost:8080`, walk through MediaWiki's installer:

- Database type: MySQL, MariaDB, or compatible
- Database host: `wiki-db` (the docker service name, not `localhost` —
  containers reach each other by service name over the compose network)
- Database name / user / password: `mediawiki` / `mediawiki` / `local-dev-only`
- Pick any wiki name, admin username, and admin password.

At the end, the installer generates `LocalSettings.php` and makes you download
it — it does **not** get written into the container automatically unless
you've mounted a config volume. Copy it in manually and reload:

```bash
docker cp LocalSettings.php <mediawiki-container-name>:/var/www/html/LocalSettings.php
```

A couple of things that weren't obvious the first time through:

- Special pages with a colon in the "pretty" URL (`/wiki/Special:BotPasswords`,
  `/wiki/Special:UserLogin`) can redirect to the Main Page instead of loading,
  depending on the server's URL-rewrite setup — a rewrite quirk, not a login
  problem. If that happens, use the non-pretty form instead:
  `http://localhost:8080/index.php?title=Special:BotPasswords`.
- The server authenticates via a **bot password**, not your regular wiki
  login. Create one at `Special:BotPasswords` while logged in as your admin
  account — give it a name (e.g. `mcp`), grant it read/edit permissions, and
  it generates a password shown once. The resulting username is
  `YourUsername@BotName` — note MediaWiki capitalizes the first letter of
  usernames automatically, so double-check the case matches what the wiki
  actually created.
- **`npm run dev` does not run the server at all** — see Gotchas below.

Install and configure:

```bash
npm install
cp .env.example .env
```

Fill in `.env` for your local wiki:

```
MEDIAWIKI_WIKIS=Dev:http://localhost:8080
MEDIAWIKI_DEFAULT_WIKI=Dev
MEDIAWIKI_USERNAME_DEV=YourUsername@mcp
MEDIAWIKI_PASSWORD_DEV=<the generated bot password>
```

Then build and run:

```bash
npm run build
node --env-file=.env dist/index.js
```

## Running the tests

```bash
npm test
```

This runs `vitest`. Passing looks like:

```
Test Files  19 passed (19)
     Tests  158 passed (158)
```

Coverage here is solid — 19 test files across the wiki registry/orchestrator,
REST and Action API clients, auth (OAuth broker, token store, write-gating),
and more.

## Making a change

```bash
git switch main && git pull
git switch -c fix/short-description   # or feat/, ci/, docs/
# ...make your change...
git add -A && git commit
git push -u origin fix/short-description
gh pr create --fill
```

Commit messages explain **why**, not what — the diff already shows what
changed. No AI attribution lines or emoji in commits. Never commit `.env`,
tokens, or secrets. The maintainer reviews and approves PRs; merging is safe
and reversible once approved.

## How it ships

Merging a change that bumps the version in `package.json` cuts a git tag,
which kicks off the release workflow — but that workflow **pauses and waits
for maintainer approval** before anything actually publishes to npm. A merge
never ships anything on its own.

## Gotchas

- **`npm run dev` only compiles — it doesn't run the server.** It's
  `tsc --watch`, so it type-checks and rebuilds on save but never actually
  starts anything. To run the server, use `npm start` (stdio transport) or
  `npm run start:http` (HTTP transport) after building.
- **Neither `start` command loads `.env`.** There's no `dotenv` import
  anywhere in the repo and no `--env-file` flag in the scripts, so filling in
  `.env` per the setup steps silently does nothing unless you load it
  yourself: `node --env-file=.env dist/index.js`. A known issue, not yet
  fixed as of this PR.
- **`npm install` reports a double-digit number of audit vulnerabilities**
  (including one critical) on a fresh install. Worth a look eventually, not a
  blocker for local dev.
- Once running, the server sits in stdio mode (or serves HTTP, if using
  `start:http`) waiting for an MCP client to connect — that's expected
  behavior, not a hang.
