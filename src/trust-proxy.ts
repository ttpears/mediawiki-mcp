/**
 * Resolve the Express `trust proxy` setting.
 *
 * The connector sits behind exactly one reverse proxy (traefik), so we trust a
 * single hop. We MUST return a number, not boolean `true`: `express-rate-limit`
 * (used by the MCP SDK's OAuth endpoints) rejects a permissive `true` with
 * ERR_ERL_PERMISSIVE_TRUST_PROXY, which otherwise throws on every request.
 */
export function resolveTrustProxy(trustProxy: boolean): number | false {
  return trustProxy ? 1 : false;
}
