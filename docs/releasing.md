# Releasing mediawiki-mcp

The server ships as an npm package, a GHCR container, and a Claude Desktop MCPB
bundle attached to a GitHub Release. The Claude Code plugin launches the npm
package; its manifest version must match the package version.

## Prepare a version

Use Node.js 24 LTS and start a branch from current `main`. Choose a patch version
for fixes and documentation, a minor version for compatible features, and a major
version for incompatible public behavior. Never move an existing release tag or
reuse a published npm version.

1. Run `npm version <version> --no-git-tag-version --ignore-scripts` to update
   `package.json` and the root versions in `package-lock.json`.
2. Set `.claude-plugin/plugin.json` to the same version.
3. Add a dated entry to `CHANGELOG.md`, including user-visible changes since the
   previous release. Update installation and upgrade examples if needed.
4. Leave `mcpb/manifest.template.json`'s `__VERSION__` placeholder intact. The build
   script fills it from `package.json`; the server also reads its version there.

## Validate before merging

```bash
npm ci
npm run type-check
npm test
npm run build
npm audit
npm audit --omit=dev
npm run build:mcpb
npm pack --dry-run
```

Inspect audit findings rather than applying forced major upgrades. The npm
tarball should include `dist/index.js`, `dist/http-transport.js`, README, and
LICENSE; it should not contain `.env`, tests, or `node_modules`.

For transport or dependency changes, use MCP clients to initialize both stdio
and HTTP servers, list tools, and call a read tool against a disposable wiki.
Confirm the MCP `serverInfo.version` and HTTP `/health` version. For bundle
changes, check `manifest.json` and the embedded package version too.

Open a PR and wait for both the build/test job and Docker preview job. Preview
images use `branch-<slug>` tags and are not releases. Fork PRs validate the image
without publishing a preview tag.

## Publish through GitHub Actions

After the version PR merges, the CI workflow on `main` creates an annotated
`v<version>` tag if one does not already exist. Its tag push triggers the
[Release workflow](../.github/workflows/release.yml).

Both publication jobs target the protected `release` environment. Review the
commit and successful CI run, then approve that environment in GitHub Actions
when publication is authorized. A tag or merged PR alone does not publish.

The two jobs publish independently:

- `release` builds and publishes npm with OIDC provenance, builds the MCPB bundle,
  then creates the GitHub Release with the `.mcpb` asset.
- `docker` builds and pushes `ghcr.io/ttpears/mediawiki-mcp:<version>` and `latest`.

An integration can have repository write access while lacking deployment-review
permission. If approval returns HTTP 403, a maintainer must approve the pending
environment in GitHub; do not remove the protection to get a release through.

## Verify all channels

Replace `2.5.4` below with the version being released:

```bash
npm view mediawiki-mcp version
npm view mediawiki-mcp@2.5.4 dist.integrity dist.attestations
gh release view v2.5.4 --repo ttpears/mediawiki-mcp
docker buildx imagetools inspect ghcr.io/ttpears/mediawiki-mcp:2.5.4
```

Check that the GitHub Release includes `mediawiki-mcp-2.5.4.mcpb`, both workflow
jobs succeeded, the versioned image exists, and `latest` points to that image's
digest. Updating registries does not restart deployed MCP clients or containers;
follow the README's upgrade steps to roll out the release.

If one job fails, inspect its logs and check which artifacts were already
published before retrying. npm versions are immutable: if npm succeeded but a
later step failed, rerunning the entire release job will try to publish that
version again. Recover only the missing artifact from the exact tagged commit,
or prepare a new patch release when the source must change.
