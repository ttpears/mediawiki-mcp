import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WikiOrchestrator } from '../src/wiki-orchestrator.js';
import { WikiRegistry } from '../src/wiki-registry.js';
import { RestClient } from '../src/clients/rest-client.js';
import { ActionClient } from '../src/clients/action-client.js';

// Mock both client modules
vi.mock('../src/clients/rest-client.js');
vi.mock('../src/clients/action-client.js');

function createRegistry(...wikis: Array<{ name: string; baseUrl: string }>): WikiRegistry {
  const registry = new WikiRegistry();
  for (const wiki of wikis) {
    registry.addWiki(wiki);
  }
  return registry;
}

function getRestMock(orchestrator: WikiOrchestrator, wikiName: string): any {
  // Access through a fan-out or single-wiki call; we'll use the mock instances directly
  // Since RestClient is mocked, each `new RestClient(...)` returns a mock instance
  // We track them via the mock's calls
  const calls = (RestClient as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const instances = (RestClient as unknown as ReturnType<typeof vi.fn>).mock.results;
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] === wikiName) {
      return instances[i].value;
    }
  }
  throw new Error(`No RestClient mock found for wiki "${wikiName}"`);
}

function getActionMock(orchestrator: WikiOrchestrator, wikiName: string): any {
  const calls = (ActionClient as unknown as ReturnType<typeof vi.fn>).mock.calls;
  const instances = (ActionClient as unknown as ReturnType<typeof vi.fn>).mock.results;
  for (let i = 0; i < calls.length; i++) {
    if (calls[i][0] === wikiName) {
      return instances[i].value;
    }
  }
  throw new Error(`No ActionClient mock found for wiki "${wikiName}"`);
}

describe('WikiOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('construction', () => {
    it('creates client pairs for each wiki in the registry', () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      new WikiOrchestrator(registry);

      expect(RestClient).toHaveBeenCalledTimes(2);
      expect(ActionClient).toHaveBeenCalledTimes(2);
      expect(RestClient).toHaveBeenCalledWith('Sales', 'https://sales.wiki.com', undefined);
      expect(RestClient).toHaveBeenCalledWith('Dev', 'https://dev.wiki.com', undefined);
    });

    it('returns the registry via getRegistry()', () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);
      expect(orch.getRegistry()).toBe(registry);
    });
  });

  describe('fan-out search', () => {
    it('searches all wikis when no wiki param specified', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      const salesRest = getRestMock(orch, 'Sales');
      const devRest = getRestMock(orch, 'Dev');

      salesRest.search.mockResolvedValue({
        pages: [{ id: 1, key: 'A', title: 'A', excerpt: '', matched_title: null, description: null, thumbnail: null }],
      });
      devRest.search.mockResolvedValue({
        pages: [{ id: 2, key: 'B', title: 'B', excerpt: '', matched_title: null, description: null, thumbnail: null }],
      });

      const result = await orch.search('test');

      expect(result.results).toHaveLength(2);
      expect(result.warnings).toHaveLength(0);
      expect(result.results.map(r => r.wiki).sort()).toEqual(['Dev', 'Sales']);
      expect(result.results.find(r => r.wiki === 'Sales')!.items).toHaveLength(1);
      expect(result.results.find(r => r.wiki === 'Dev')!.items).toHaveLength(1);
    });

    it('searches only specified wiki when wiki param given', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      const salesRest = getRestMock(orch, 'Sales');
      const devRest = getRestMock(orch, 'Dev');

      salesRest.search.mockResolvedValue({
        pages: [{ id: 1, key: 'A', title: 'A', excerpt: '', matched_title: null, description: null, thumbnail: null }],
      });

      const result = await orch.search('test', { wiki: 'Sales' });

      expect(result.results).toHaveLength(1);
      expect(result.results[0].wiki).toBe('Sales');
      expect(devRest.search).not.toHaveBeenCalled();
    });

    it('handles partial failure on fan-out with warnings', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      const salesRest = getRestMock(orch, 'Sales');
      const devRest = getRestMock(orch, 'Dev');

      salesRest.search.mockResolvedValue({
        pages: [{ id: 1, key: 'A', title: 'A', excerpt: '', matched_title: null, description: null, thumbnail: null }],
      });
      devRest.search.mockRejectedValue(new Error('Connection refused'));

      const result = await orch.search('test');

      expect(result.results).toHaveLength(1);
      expect(result.results[0].wiki).toBe('Sales');
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Connection refused');
    });
  });

  describe('fan-out searchByPrefix', () => {
    it('fans out searchByPrefix across all wikis', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      const salesRest = getRestMock(orch, 'Sales');
      const devRest = getRestMock(orch, 'Dev');

      salesRest.searchByPrefix.mockResolvedValue({ pages: [] });
      devRest.searchByPrefix.mockResolvedValue({ pages: [] });

      const result = await orch.searchByPrefix('test');

      expect(result.results).toHaveLength(2);
      expect(salesRest.searchByPrefix).toHaveBeenCalledWith('test', 10);
      expect(devRest.searchByPrefix).toHaveBeenCalledWith('test', 10);
    });
  });

  describe('single-wiki getPage', () => {
    it('uses default wiki when no wiki param given', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      const salesRest = getRestMock(orch, 'Sales');
      salesRest.getPage.mockResolvedValue({
        id: 1, key: 'Test', title: 'Test',
        latest: { id: 10, timestamp: '2024-01-01T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: '', title: '' },
        source: 'hello',
      });

      const result = await orch.getPage('Test');

      expect(result.wiki).toBe('Sales');
      expect(result.page?.title).toBe('Test');
      expect(salesRest.getPage).toHaveBeenCalledWith('Test');
    });

    it('uses specified wiki when wiki param given', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      const devRest = getRestMock(orch, 'Dev');
      devRest.getPage.mockResolvedValue({
        id: 2, key: 'Test', title: 'Test',
        latest: { id: 20, timestamp: '2024-01-01T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: '', title: '' },
        source: 'world',
      });

      const result = await orch.getPage('Test', { wiki: 'Dev' });

      expect(result.wiki).toBe('Dev');
      expect(result.page?.title).toBe('Test');
    });

    it('includes HTML when includeHtml is true', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      const salesRest = getRestMock(orch, 'Sales');
      salesRest.getPage.mockResolvedValue({
        id: 1, key: 'Test', title: 'Test',
        latest: { id: 10, timestamp: '2024-01-01T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: '', title: '' },
      });
      salesRest.getPageHtml.mockResolvedValue('<p>Hello</p>');

      const result = await orch.getPage('Test', { includeHtml: true });

      expect(result.html).toBe('<p>Hello</p>');
      expect(salesRest.getPageHtml).toHaveBeenCalledWith('Test');
    });
  });

  describe('unknown wiki', () => {
    it('throws when referencing an unknown wiki', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      await expect(() => orch.getPage('Test', { wiki: 'Unknown' })).rejects.toThrow('not registered');
    });
  });

  describe('addClientsForWiki / removeClientsForWiki', () => {
    it('adds clients for a new wiki', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      // Clear mocks from constructor
      vi.clearAllMocks();

      const newWiki = { name: 'New', baseUrl: 'https://new.wiki.com' };
      registry.addWiki(newWiki);
      orch.addClientsForWiki(newWiki);

      expect(RestClient).toHaveBeenCalledTimes(1);
      expect(RestClient).toHaveBeenCalledWith('New', 'https://new.wiki.com', undefined);
      expect(ActionClient).toHaveBeenCalledTimes(1);
    });

    it('removes clients for a wiki', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      registry.removeWiki('Dev');
      orch.removeClientsForWiki('Dev');

      // Dev should no longer be searched in fan-out
      const salesRest = getRestMock(orch, 'Sales');
      salesRest.search.mockResolvedValue({ pages: [] });

      const result = await orch.search('test');
      // Only Sales should remain (Dev was removed from registry)
      expect(result.results).toHaveLength(1);
      expect(result.results[0].wiki).toBe('Sales');
    });
  });

  describe('single-wiki deletePage', () => {
    it('delegates to action client', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      const salesAction = getActionMock(orch, 'Sales');
      salesAction.deletePage.mockResolvedValue(undefined);

      const result = await orch.deletePage('Old Page');

      expect(result.wiki).toBe('Sales');
      expect(salesAction.deletePage).toHaveBeenCalledWith('Old Page');
    });
  });

  describe('single-wiki undeletePage', () => {
    it('delegates to action client with reason', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      const salesAction = getActionMock(orch, 'Sales');
      salesAction.undeletePage.mockResolvedValue(undefined);

      const result = await orch.undeletePage('Old Page', 'restoring');

      expect(result.wiki).toBe('Sales');
      expect(salesAction.undeletePage).toHaveBeenCalledWith('Old Page', 'restoring');
    });
  });

  describe('single-wiki getPageHistory', () => {
    it('delegates to rest client', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      const salesRest = getRestMock(orch, 'Sales');
      const mockHistory = { revisions: [], latest: '123' };
      salesRest.getPageHistory.mockResolvedValue(mockHistory);

      const result = await orch.getPageHistory('Test', { limit: 5 });

      expect(result.wiki).toBe('Sales');
      expect(result.history).toBe(mockHistory);
      expect(salesRest.getPageHistory).toHaveBeenCalledWith('Test', 5, undefined);
    });
  });

  describe('single-wiki getRevision', () => {
    it('delegates to rest client', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      const salesRest = getRestMock(orch, 'Sales');
      const mockRevision = { id: 42, page: { id: 1, key: 'Test', title: 'Test' }, size: 100, minor: false, timestamp: '', user: { id: 1, name: 'Admin' }, comment: '', delta: null };
      salesRest.getRevision.mockResolvedValue(mockRevision);

      const result = await orch.getRevision(42);

      expect(result.wiki).toBe('Sales');
      expect(result.revision).toBe(mockRevision);
    });
  });

  describe('single-wiki getPageLinks', () => {
    it('gets forward links', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      const salesAction = getActionMock(orch, 'Sales');
      salesAction.getPageLinks.mockResolvedValue({ items: [{ ns: 0, title: 'Linked' }], hasMore: false });

      const result = await orch.getPageLinks('Test', 'forward');

      expect(result.links).toEqual([{ ns: 0, title: 'Linked' }]);
      expect(salesAction.getPageLinks).toHaveBeenCalledWith('Test', 10, undefined);
    });

    it('gets backlinks', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      const salesAction = getActionMock(orch, 'Sales');
      salesAction.getBacklinks.mockResolvedValue({ items: [{ pageid: 1, ns: 0, title: 'Linker' }], hasMore: false });

      const result = await orch.getPageLinks('Test', 'backlinks');

      expect(result.links).toEqual([{ pageid: 1, ns: 0, title: 'Linker' }]);
      expect(salesAction.getBacklinks).toHaveBeenCalledWith('Test', 10, undefined);
    });
  });

  describe('single-wiki getCategoryMembers', () => {
    it('delegates to action client', async () => {
      const registry = createRegistry({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      const orch = new WikiOrchestrator(registry);

      const salesAction = getActionMock(orch, 'Sales');
      salesAction.getCategoryMembers.mockResolvedValue({
        items: [{ pageid: 1, ns: 0, title: 'Page1', timestamp: '' }],
        hasMore: false,
      });

      const result = await orch.getCategoryMembers('TestCat');

      expect(result.wiki).toBe('Sales');
      expect(result.members).toHaveLength(1);
      expect(salesAction.getCategoryMembers).toHaveBeenCalledWith('TestCat', 10, undefined, undefined);
    });
  });

  describe('fan-out getRecentChanges', () => {
    it('fans out across all wikis', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      const salesAction = getActionMock(orch, 'Sales');
      const devAction = getActionMock(orch, 'Dev');

      salesAction.getRecentChanges.mockResolvedValue({ items: [{ type: 'edit', title: 'A' }], hasMore: false });
      devAction.getRecentChanges.mockResolvedValue({ items: [{ type: 'edit', title: 'B' }], hasMore: false });

      const result = await orch.getRecentChanges();

      expect(result.results).toHaveLength(2);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('fan-out listCategories', () => {
    it('fans out across all wikis', async () => {
      const registry = createRegistry(
        { name: 'Sales', baseUrl: 'https://sales.wiki.com' },
        { name: 'Dev', baseUrl: 'https://dev.wiki.com' }
      );
      const orch = new WikiOrchestrator(registry);

      const salesAction = getActionMock(orch, 'Sales');
      const devAction = getActionMock(orch, 'Dev');

      salesAction.listCategories.mockResolvedValue({ items: [], hasMore: false });
      devAction.listCategories.mockResolvedValue({ items: [], hasMore: false });

      const result = await orch.listCategories({ prefix: 'Test' });

      expect(result.results).toHaveLength(2);
      expect(salesAction.listCategories).toHaveBeenCalledWith('Test', 10, undefined);
    });
  });
});
