import express, { Router } from 'express';
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { OAuthConfig } from './config.js';
import { BrokerOAuthProvider } from './broker-provider.js';

export interface BrokerSetup {
  router: Router;
  /** URL of the protected-resource metadata document, for WWW-Authenticate hints. */
  resourceMetadataUrl: string;
}

/**
 * Builds the broker's HTTP surface: the SDK's standard authorization-server
 * endpoints (metadata, DCR, authorize, token, revoke) plus the Entra redirect
 * handler at /callback. Mount the returned router at the app root.
 */
export function createBrokerRouter(config: OAuthConfig, provider: BrokerOAuthProvider): BrokerSetup {
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

  // Entra redirects the user's browser here after sign-in.
  router.get('/callback', async (req, res) => {
    try {
      const code = String(req.query.code ?? '');
      const state = String(req.query.state ?? '');
      if (!code || !state) {
        res.status(400).json({ error: 'invalid_request', error_description: 'missing code or state' });
        return;
      }
      const { redirectTo } = await provider.handleUpstreamCallback(code, state);
      res.redirect(redirectTo);
    } catch (err) {
      res.status(400).json({
        error: 'access_denied',
        error_description: err instanceof Error ? err.message : 'callback failed',
      });
    }
  });

  return { router, resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl) };
}
