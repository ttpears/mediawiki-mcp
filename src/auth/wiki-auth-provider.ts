import { WikiAuthProvider } from '../wiki-orchestrator.js';
import { TokenStore } from './token-store.js';
import { MediaWikiOAuthClient } from './mediawiki-oauth.js';
import { BrokerTokens } from './tokens.js';

/** Refresh the access token when it expires within this window (ms). */
const REFRESH_SKEW_MS = 60_000;

/**
 * Thrown when the user has not yet authorized a given farm wiki. The message
 * carries the authorization URL so it surfaces to the user through normal tool
 * output (tools stay transport-agnostic).
 */
export class WikiAuthorizationRequired extends Error {
  constructor(
    public readonly wiki: string,
    public readonly authorizeUrl: string
  ) {
    super(`Authorization required for wiki "${wiki}". Visit ${authorizeUrl} to grant access, then retry.`);
    this.name = 'WikiAuthorizationRequired';
  }
}

/**
 * Builds a WikiAuthProvider bound to one user (`sub`) across the farm. For each
 * wiki it returns the user's current access token, refreshing it transparently;
 * if the user has not authorized that wiki yet it throws
 * {@link WikiAuthorizationRequired} with a signed, per-wiki consent URL.
 */
export function createWikiAuthProvider(
  sub: string,
  store: TokenStore,
  upstreams: Map<string, MediaWikiOAuthClient>,
  tokens: BrokerTokens,
  publicUrl: string
): WikiAuthProvider {
  return {
    async getAccessToken(wikiName: string): Promise<string> {
      const rec = await store.getWikiToken(sub, wikiName);
      if (!rec) {
        const ticket = await tokens.signWikiTicket(sub, wikiName);
        const url = `${publicUrl}/authorize/wiki?ticket=${encodeURIComponent(ticket)}`;
        throw new WikiAuthorizationRequired(wikiName, url);
      }

      if (rec.expiresAt - Date.now() > REFRESH_SKEW_MS) {
        return rec.accessToken;
      }

      const upstream = upstreams.get(wikiName);
      if (!upstream) {
        throw new Error(`No OAuth consumer configured for wiki "${wikiName}"`);
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
