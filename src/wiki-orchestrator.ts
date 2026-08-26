import {
  WikiConfig,
  RestPage,
  RestSearchResult,
  RestRevision,
  RestRevisionList,
  RestFileInfo,
  ActionCategory,
  ActionCategoryMember,
  ActionRecentChange,
  ActionLink,
  ActionBacklink,
  PaginatedResult,
  FanOutResult,
  WikiLabeledResult,
  FoundPage,
  FoundPageMatchType,
} from './types.js';
import { WikiRegistry } from './wiki-registry.js';
import { RestClient } from './clients/rest-client.js';
import { ActionClient } from './clients/action-client.js';

interface WikiClients {
  config: WikiConfig;
  rest: RestClient;
  action: ActionClient;
}

const MATCH_PRIORITY: Record<FoundPageMatchType, number> = {
  exact: 0,
  redirect: 1,
  prefix: 2,
  fulltext: 3,
};

function rankFoundPages(pages: FoundPage[], limit: number): FoundPage[] {
  // Dedupe across wikis by (wiki, pageid), keeping the strongest match type.
  const best = new Map<string, FoundPage>();
  for (const page of pages) {
    const key = `${page.wiki}:${page.pageid}`;
    const existing = best.get(key);
    if (!existing || MATCH_PRIORITY[page.matchType] < MATCH_PRIORITY[existing.matchType]) {
      best.set(key, page);
    }
  }

  // Stable sort: priority first, insertion order preserved within buckets.
  const sorted = [...best.values()];
  sorted.sort((a, b) => MATCH_PRIORITY[a.matchType] - MATCH_PRIORITY[b.matchType]);
  return sorted.slice(0, limit);
}

/**
 * Supplies a currently-valid wiki access token for OAuth bearer mode. When set on
 * an orchestrator, clients act as the authenticated user instead of a bot account.
 */
export interface WikiAuthProvider {
  getAccessToken(wikiName: string): Promise<string>;
}

export class WikiOrchestrator {
  private readonly registry: WikiRegistry;
  private readonly clients = new Map<string, WikiClients>();
  private readonly authProvider?: WikiAuthProvider;

  constructor(registry: WikiRegistry, authProvider?: WikiAuthProvider) {
    this.registry = registry;
    this.authProvider = authProvider;
  }

  /** Initialize all wiki clients (login where credentials exist) */
  async initialize(): Promise<void> {
    const warnings: string[] = [];
    for (const wiki of this.registry.getAllWikis()) {
      try {
        await this.addClientsForWiki(wiki);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Clients stay registered with their credentials: reads keep working, and
        // writes re-attempt login (ActionClient.withAuthRetry) instead of silently
        // going out anonymous for the life of the process.
        warnings.push(`[${wiki.name}] Login failed (will retry on write operations): ${msg}`);
      }
    }
    if (warnings.length > 0) {
      console.error(warnings.join('\n'));
    }
  }

  async addClientsForWiki(wiki: WikiConfig): Promise<void> {
    const key = wiki.name.toLowerCase();
    const action = new ActionClient(wiki.name, wiki.baseUrl, wiki.username, wiki.password);
    const rest = new RestClient(wiki.name, wiki.baseUrl);

    // OAuth bearer mode: act as the authenticated user (skips bot-password login)
    if (this.authProvider) {
      const tokenFor = (): Promise<string> => this.authProvider!.getAccessToken(wiki.name);
      action.setBearerTokenProvider(tokenFor);
      rest.setBearerTokenProvider(tokenFor);
    }

    // Share session cookies and CSRF token from ActionClient → RestClient
    rest.setCookieProvider(() => action.getCookies());
    rest.setCsrfTokenProvider(() => action.getCsrfToken());

    // Register before logging in so a failed login still leaves a usable,
    // credentialed client (login is retried lazily on writes).
    this.clients.set(key, { config: wiki, rest, action });

    // Login if credentials are provided (no-op in bearer mode)
    await action.login();
  }

  removeClientsForWiki(name: string): void {
    const key = name.toLowerCase();
    this.clients.delete(key);
  }

  getRegistry(): WikiRegistry {
    return this.registry;
  }

  /**
   * Report the wiki's real auth state, verified against the live session
   * (action=query&meta=userinfo) rather than just configuration. Re-establishes
   * an expired bot-password session as a side effect when possible.
   */
  async getAuthStatus(
    wikiName?: string
  ): Promise<{ wiki: string; status: 'authenticated' | 'anonymous' | 'error'; user?: string; detail?: string }> {
    const clients = this.getClients(wikiName);
    const name = clients.config.name;
    const expectsAuth = !!clients.config.username || !!this.authProvider;

    if (!expectsAuth) {
      return { wiki: name, status: 'anonymous' };
    }

    try {
      const check = await clients.action.checkAuthStatus();
      if (check.authenticated) {
        return { wiki: name, status: 'authenticated', user: check.userName };
      }
      return {
        wiki: name,
        status: 'error',
        detail: 'credentials configured but session is anonymous',
      };
    } catch (err) {
      return {
        wiki: name,
        status: 'error',
        detail: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private getClients(wikiName?: string): WikiClients {
    const config = this.registry.resolveWiki(wikiName);
    const key = config.name.toLowerCase();
    const clients = this.clients.get(key);
    if (!clients) {
      throw new Error(`No clients found for wiki "${config.name}"`);
    }
    return clients;
  }

  private async fanOut<T>(
    operation: (clients: WikiClients) => Promise<T[]>,
    wikiName?: string
  ): Promise<FanOutResult<T>> {
    if (wikiName !== undefined) {
      const clients = this.getClients(wikiName);
      const items = await operation(clients);
      return {
        results: [{ wiki: clients.config.name, items }],
        warnings: [],
      };
    }

    const allWikis = this.registry.getAllWikis();
    const settled = await Promise.allSettled(
      allWikis.map(async (wiki) => {
        const clients = this.getClients(wiki.name);
        const items = await operation(clients);
        return { wiki: wiki.name, items } as WikiLabeledResult<T>;
      })
    );

    const results: WikiLabeledResult<T>[] = [];
    const warnings: string[] = [];

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const reason = result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
        warnings.push(reason);
      }
    }

    return { results, warnings };
  }

  // Fan-out methods

  async search(
    query: string,
    opts?: { wiki?: string; limit?: number }
  ): Promise<FanOutResult<RestSearchResult>> {
    const limit = opts?.limit ?? 10;
    return this.fanOut(
      async (clients) => {
        const response = await clients.rest.search(query, limit);
        return response.pages;
      },
      opts?.wiki
    );
  }

  /**
   * Unified page locator: tries exact title (with redirect following), prefix
   * search, and full-text search per wiki, then merges and ranks results so
   * the caller gets a single "best pages for this query" list.
   */
  async findPage(
    query: string,
    opts?: { wiki?: string; limit?: number }
  ): Promise<{ results: FoundPage[]; warnings: string[] }> {
    const limit = opts?.limit ?? 10;
    const targets = opts?.wiki !== undefined
      ? [this.getClients(opts.wiki)]
      : this.registry.getAllWikis().map((w) => this.getClients(w.name));

    const settled = await Promise.allSettled(
      targets.map((clients) => this.findInWiki(clients, query, limit))
    );

    const all: FoundPage[] = [];
    const warnings: string[] = [];
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        all.push(...result.value);
      } else {
        warnings.push(result.reason instanceof Error ? result.reason.message : String(result.reason));
      }
    }

    return { results: rankFoundPages(all, limit), warnings };
  }

  private async findInWiki(
    clients: WikiClients,
    query: string,
    limit: number
  ): Promise<FoundPage[]> {
    const wiki = clients.config.name;

    // Run exact-title resolve, prefix search, and full-text search in parallel.
    // Any individual failure is captured locally so the other signals still contribute.
    const [exactRes, prefixRes, fulltextRes] = await Promise.allSettled([
      clients.action.resolveTitle(query),
      clients.rest.searchByPrefix(query, limit),
      clients.rest.search(query, limit),
    ]);

    const found: FoundPage[] = [];
    const seen = new Set<string>();
    const push = (entry: FoundPage): void => {
      const key = `${entry.pageid}`;
      if (seen.has(key)) return;
      seen.add(key);
      found.push(entry);
    };

    if (exactRes.status === 'fulfilled' && exactRes.value) {
      push({
        wiki,
        title: exactRes.value.title,
        pageid: exactRes.value.pageid,
        matchType: exactRes.value.redirectedFrom ? 'redirect' : 'exact',
        redirectedFrom: exactRes.value.redirectedFrom,
      });
    }

    if (prefixRes.status === 'fulfilled') {
      for (const page of prefixRes.value.pages) {
        push({
          wiki,
          title: page.title,
          pageid: page.id,
          matchType: 'prefix',
          excerpt: page.excerpt ?? undefined,
        });
      }
    }

    if (fulltextRes.status === 'fulfilled') {
      for (const page of fulltextRes.value.pages) {
        push({
          wiki,
          title: page.title,
          pageid: page.id,
          matchType: 'fulltext',
          excerpt: page.excerpt ?? undefined,
        });
      }
    }

    return found;
  }

  async searchByPrefix(
    query: string,
    opts?: { wiki?: string; limit?: number }
  ): Promise<FanOutResult<RestSearchResult>> {
    const limit = opts?.limit ?? 10;
    return this.fanOut(
      async (clients) => {
        const response = await clients.rest.searchByPrefix(query, limit);
        return response.pages;
      },
      opts?.wiki
    );
  }

  async getRecentChanges(
    opts?: { wiki?: string; limit?: number; namespace?: number; type?: string; continueFrom?: string }
  ): Promise<FanOutResult<ActionRecentChange>> {
    return this.fanOut(
      async (clients) => {
        const result = await clients.action.getRecentChanges(
          opts?.limit ?? 10,
          opts?.namespace,
          opts?.type,
          opts?.continueFrom
        );
        return result.items;
      },
      opts?.wiki
    );
  }

  async listCategories(
    opts?: { wiki?: string; prefix?: string; limit?: number; continueFrom?: string }
  ): Promise<FanOutResult<ActionCategory>> {
    return this.fanOut(
      async (clients) => {
        const result = await clients.action.listCategories(
          opts?.prefix,
          opts?.limit ?? 10,
          opts?.continueFrom
        );
        return result.items;
      },
      opts?.wiki
    );
  }

  // Single-wiki methods

  async getPage(
    title: string,
    opts?: { wiki?: string; includeHtml?: boolean }
  ): Promise<{ wiki: string; page: RestPage | null; html?: string }> {
    const clients = this.getClients(opts?.wiki);
    const page = await clients.rest.getPage(title);
    let html: string | undefined;
    if (opts?.includeHtml && page) {
      const htmlResult = await clients.rest.getPageHtml(title);
      html = htmlResult ?? undefined;
    }
    return { wiki: clients.config.name, page, html };
  }

  async createPage(
    title: string,
    source: string,
    comment: string,
    opts?: { wiki?: string }
  ): Promise<{ wiki: string; page: RestPage }> {
    const clients = this.getClients(opts?.wiki);
    const page = await clients.rest.createPage(title, source, comment);
    return { wiki: clients.config.name, page };
  }

  async updatePage(
    title: string,
    source: string,
    comment: string,
    latestRevisionId: number,
    opts?: { wiki?: string }
  ): Promise<{ wiki: string; page: RestPage }> {
    const clients = this.getClients(opts?.wiki);
    const page = await clients.rest.updatePage(title, source, comment, latestRevisionId);
    return { wiki: clients.config.name, page };
  }

  async editPage(
    title: string,
    opts: {
      wiki?: string;
      text?: string;
      section?: number | 'new';
      sectionTitle?: string;
      appendText?: string;
      prependText?: string;
      summary?: string;
      baseTimestamp?: string;
    }
  ): Promise<{ wiki: string; result: { result: string; pageid: number; title: string; newrevid?: number; newtimestamp?: string; nochange?: boolean } }> {
    const clients = this.getClients(opts.wiki);
    const result = await clients.action.editPage(title, {
      text: opts.text,
      section: opts.section,
      sectionTitle: opts.sectionTitle,
      appendText: opts.appendText,
      prependText: opts.prependText,
      summary: opts.summary,
      baseTimestamp: opts.baseTimestamp,
    });
    return { wiki: clients.config.name, result };
  }

  async getPageContent(
    title: string,
    opts?: { wiki?: string }
  ): Promise<{ wiki: string; content: string; timestamp: string } | null> {
    const clients = this.getClients(opts?.wiki);
    const result = await clients.action.getPageContent(title);
    if (!result) return null;
    return { wiki: clients.config.name, ...result };
  }

  async deletePage(
    title: string,
    opts?: { wiki?: string; reason?: string }
  ): Promise<{ wiki: string }> {
    const clients = this.getClients(opts?.wiki);
    await clients.action.deletePage(title, opts?.reason);
    return { wiki: clients.config.name };
  }

  async undeletePage(
    title: string,
    reason?: string,
    opts?: { wiki?: string }
  ): Promise<{ wiki: string }> {
    const clients = this.getClients(opts?.wiki);
    await clients.action.undeletePage(title, reason);
    return { wiki: clients.config.name };
  }

  async getPageHistory(
    title: string,
    opts?: { wiki?: string; limit?: number; olderThan?: string }
  ): Promise<{ wiki: string; history: RestRevisionList }> {
    const clients = this.getClients(opts?.wiki);
    const history = await clients.rest.getPageHistory(title, opts?.limit, opts?.olderThan);
    return { wiki: clients.config.name, history };
  }

  async getRevision(
    revisionId: number,
    opts?: { wiki?: string }
  ): Promise<{ wiki: string; revision: RestRevision }> {
    const clients = this.getClients(opts?.wiki);
    const revision = await clients.rest.getRevision(revisionId);
    return { wiki: clients.config.name, revision };
  }

  async getPageLinks(
    title: string,
    direction: 'forward' | 'backlinks',
    opts?: { wiki?: string; limit?: number; continueFrom?: string }
  ): Promise<{ wiki: string; links: (ActionLink | ActionBacklink)[]; hasMore: boolean; continueFrom?: string }> {
    const clients = this.getClients(opts?.wiki);
    const limit = opts?.limit ?? 10;
    let result: PaginatedResult<ActionLink | ActionBacklink>;
    if (direction === 'backlinks') {
      result = await clients.action.getBacklinks(title, limit, opts?.continueFrom);
    } else {
      result = await clients.action.getPageLinks(title, limit, opts?.continueFrom);
    }
    return { wiki: clients.config.name, links: result.items, hasMore: result.hasMore, continueFrom: result.continueFrom };
  }

  async getCategoryMembers(
    category: string,
    opts?: { wiki?: string; type?: string; limit?: number; continueFrom?: string }
  ): Promise<{ wiki: string; members: ActionCategoryMember[]; hasMore: boolean; continueFrom?: string }> {
    const clients = this.getClients(opts?.wiki);
    const result = await clients.action.getCategoryMembers(
      category,
      opts?.limit ?? 10,
      opts?.type,
      opts?.continueFrom
    );
    return { wiki: clients.config.name, members: result.items, hasMore: result.hasMore, continueFrom: result.continueFrom };
  }

  async getFile(
    title: string,
    opts?: { wiki?: string }
  ): Promise<{ wiki: string; file: RestFileInfo | null }> {
    const clients = this.getClients(opts?.wiki);
    const file = await clients.rest.getFile(title);
    return { wiki: clients.config.name, file };
  }

  async uploadFile(
    filename: string,
    fileContent: Buffer,
    text: string,
    opts?: { wiki?: string; comment?: string }
  ): Promise<{ wiki: string; result: string; filename: string }> {
    const clients = this.getClients(opts?.wiki);
    const uploadResult = await clients.action.uploadFile(filename, fileContent, text, opts?.comment);
    return { wiki: clients.config.name, result: uploadResult.result, filename: uploadResult.filename };
  }

  async uploadFromUrl(
    filename: string,
    url: string,
    text: string,
    opts?: { wiki?: string; comment?: string }
  ): Promise<{ wiki: string; result: string; filename: string }> {
    const clients = this.getClients(opts?.wiki);
    const uploadResult = await clients.action.uploadFromUrl(filename, url, text, opts?.comment);
    return { wiki: clients.config.name, result: uploadResult.result, filename: uploadResult.filename };
  }
}
