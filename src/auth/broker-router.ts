import express, { Router } from 'express';
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { OAuthConfig } from './config.js';
import { MediaWikiOAuthProvider } from './broker-provider.js';

export interface BrokerSetup {
  router: Router;
  /** URL of the protected-resource metadata document, for WWW-Authenticate hints. */
  resourceMetadataUrl: string;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );
}

/**
 * Builds the broker's HTTP surface: the SDK's standard authorization-server
 * endpoints (metadata, DCR, authorize, token, revoke) plus the upstream
 * redirect handler at /callback. Mount the returned router at the app root.
 */
export function createBrokerRouter(config: OAuthConfig, provider: MediaWikiOAuthProvider): BrokerSetup {
  const router = express.Router();
  const mcpUrl = new URL(`${config.publicUrl}/mcp`);

  router.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(config.publicUrl),
      resourceServerUrl: mcpUrl,
      scopesSupported: config.scopesSupported,
      resourceName: 'MediaWiki MCP',
    })
  );

  // Starts lazy per-wiki consent for an already-signed-in user (ticket binds sub+wiki).
  router.get('/authorize/wiki', async (req, res) => {
    try {
      const ticket = String(req.query.ticket ?? '');
      if (!ticket) {
        res.status(400).json({ error: 'invalid_request', error_description: 'missing ticket' });
        return;
      }
      const { redirectTo } = await provider.beginWikiAuthorization(ticket);
      res.redirect(redirectTo);
    } catch (err) {
      res.status(400).json({
        error: 'invalid_request',
        error_description: err instanceof Error ? err.message : 'invalid ticket',
      });
    }
  });

  // Upstream (wiki) redirects the user's browser here after consent. Handles both
  // the initial Claude login and lazy per-wiki consent.
  router.get('/callback', async (req, res) => {
    try {
      const code = String(req.query.code ?? '');
      const state = String(req.query.state ?? '');
      if (!code || !state) {
        res.status(400).json({ error: 'invalid_request', error_description: 'missing code or state' });
        return;
      }
      const result = await provider.handleUpstreamCallback(code, state);
      if (result.kind === 'login') {
        res.redirect(result.redirectTo);
      } else {
        res
          .status(200)
          .type('html')
          .send(
            `<!doctype html><meta charset="utf-8"><title>Authorized</title>` +
              `<body style="font-family:system-ui;max-width:32rem;margin:4rem auto;text-align:center">` +
              `<h1>Authorized ${escapeHtml(result.wiki)}</h1>` +
              `<p>You can close this tab and return to Claude, then retry your request.</p></body>`
          );
      }
    } catch (err) {
      res.status(400).json({
        error: 'access_denied',
        error_description: err instanceof Error ? err.message : 'callback failed',
      });
    }
  });

  return { router, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) };
}
