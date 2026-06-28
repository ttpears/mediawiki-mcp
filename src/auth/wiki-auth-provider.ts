import { WikiAuthProvider } from '../wiki-orchestrator.js';
import { TokenStore } from './token-store.js';
import { MediaWikiOAuthClient } from './mediawiki-oauth.js';

/** Refresh the access token when it expires within this window (ms). */
const REFRESH_SKEW_MS = 60_000;

/**
 * Builds a WikiAuthProvider bound to one user (`sub`). It returns the user's
 * current wiki access token, transparently refreshing it via the stored refresh
 * token when it is expired or about to expire, and persisting the rotated tokens.
 */
export function createWikiAuthProvider(
  sub: string,
  store: TokenStore,
  upstream: MediaWikiOAuthClient
): WikiAuthProvider {
  return {
    async getAccessToken(_wikiName: string): Promise<string> {
      const rec = await store.getWikiToken(sub);
      if (!rec) {
        throw new Error(`No wiki authorization on file for user ${sub}`);
      }

      if (rec.expiresAt - Date.now() > REFRESH_SKEW_MS) {
        return rec.accessToken;
      }

      const refreshed = await upstream.refresh(rec.refreshToken);
      const updated = {
        ...rec,
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: Date.now() + refreshed.expiresIn * 1000,
      };
      await store.saveWikiToken(updated);
      return updated.accessToken;
    },
  };
}
