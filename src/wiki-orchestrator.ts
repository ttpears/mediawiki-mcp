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
} from './types.js';
import { WikiRegistry } from './wiki-registry.js';
import { RestClient } from './clients/rest-client.js';
import { ActionClient } from './clients/action-client.js';

interface WikiClients {
  config: WikiConfig;
  rest: RestClient;
  action: ActionClient;
}

export class WikiOrchestrator {
  private readonly registry: WikiRegistry;
  private readonly clients = new Map<string, WikiClients>();

  constructor(registry: WikiRegistry) {
    this.registry = registry;
    for (const wiki of registry.getAllWikis()) {
      this.addClientsForWiki(wiki);
    }
  }

  addClientsForWiki(wiki: WikiConfig): void {
    const key = wiki.name.toLowerCase();
    const rest = new RestClient(wiki.name, wiki.baseUrl, wiki.apiToken);
    const action = new ActionClient(wiki.name, wiki.baseUrl, wiki.apiToken);
    this.clients.set(key, { config: wiki, rest, action });
  }

  removeClientsForWiki(name: string): void {
    const key = name.toLowerCase();
    this.clients.delete(key);
  }

  getRegistry(): WikiRegistry {
    return this.registry;
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
    latestTimestamp: string,
    opts?: { wiki?: string }
  ): Promise<{ wiki: string; page: RestPage }> {
    const clients = this.getClients(opts?.wiki);
    const page = await clients.rest.updatePage(title, source, comment, latestTimestamp);
    return { wiki: clients.config.name, page };
  }

  async deletePage(
    title: string,
    opts?: { wiki?: string }
  ): Promise<{ wiki: string }> {
    const clients = this.getClients(opts?.wiki);
    await clients.action.deletePage(title);
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
