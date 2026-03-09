# MediaWiki MCP Server Modernization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Overhaul the MediaWiki MCP server to use the REST API (1.42+), support intelligent multi-wiki fan-out with named wikis, proper pagination, retry/error handling, and expanded file operations.

**Architecture:** Dual client (RestClient for `/rest.php/v1/`, ActionClient for `/api.php`) behind a WikiOrchestrator that manages a WikiRegistry of named wikis. Broad operations (search, recent changes) fan out across all wikis; specific operations (get-page, edit) target a single wiki.

**Tech Stack:** TypeScript, Node 18+, axios, @modelcontextprotocol/sdk, zod, vitest (new)

**Design doc:** `docs/plans/2026-03-08-modernization-design.md`

---

### Task 1: Set Up Test Infrastructure

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Create: `tests/helpers/mock-axios.ts`

**Step 1: Install vitest**

Run: `npm install --save-dev vitest`

**Step 2: Create vitest config**

Create `vitest.config.ts`:
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/stdio.ts', 'src/sse-transport.ts']
    }
  }
});
```

**Step 3: Add test scripts to package.json**

Add to `scripts`:
```json
"test": "vitest run",
"test:watch": "vitest"
```

**Step 4: Create mock axios helper**

Create `tests/helpers/mock-axios.ts`:
```typescript
import { vi } from 'vitest';

export function createMockAxiosInstance() {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    defaults: { headers: { common: {} } }
  };
}

export function mockAxiosCreate(mockInstance: ReturnType<typeof createMockAxiosInstance>) {
  return vi.fn().mockReturnValue(mockInstance);
}
```

**Step 5: Verify test infrastructure works**

Create a trivial `tests/setup.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';

describe('test setup', () => {
  it('runs', () => {
    expect(true).toBe(true);
  });
});
```

Run: `npx vitest run`
Expected: PASS

**Step 6: Commit**

```bash
git add vitest.config.ts package.json package-lock.json tests/
git commit -m "feat: add vitest test infrastructure"
```

---

### Task 2: Types Overhaul

**Files:**
- Create: `src/types.ts` (rewrite)
- Create: `tests/types.test.ts`

**Step 1: Write the types file**

Rewrite `src/types.ts` with all new interfaces:
```typescript
// Wiki configuration for a single named wiki
export interface WikiConfig {
  name: string;
  baseUrl: string;
  apiToken?: string;
}

// Parsed from environment or add-wiki calls
export interface WikiRegistryConfig {
  wikis: WikiConfig[];
  defaultWiki?: string;
}

// REST API response types
export interface RestPage {
  id: number;
  key: string;
  title: string;
  latest: {
    id: number;
    timestamp: string;
  };
  content_model: string;
  license: {
    url: string;
    title: string;
  };
  source?: string;
  html?: string;
}

export interface RestSearchResult {
  id: number;
  key: string;
  title: string;
  excerpt: string;
  matched_title: string | null;
  description: string | null;
  thumbnail: {
    mimetype: string;
    width: number;
    height: number;
    url: string;
  } | null;
}

export interface RestSearchResponse {
  pages: RestSearchResult[];
}

export interface RestRevision {
  id: number;
  page: { id: number; key: string; title: string };
  size: number;
  minor: boolean;
  timestamp: string;
  user: { id: number; name: string };
  comment: string;
  delta: number | null;
}

export interface RestRevisionList {
  revisions: RestRevision[];
  latest: string;
  older?: string;
  newer?: string;
}

export interface RestFileInfo {
  title: string;
  file_description_url: string;
  latest: {
    timestamp: string;
    user: { id: number; name: string };
  };
  preferred: {
    mediatype: string;
    size: number | null;
    width: number;
    height: number;
    duration: number | null;
    url: string;
  };
  original: {
    mediatype: string;
    size: number;
    width: number;
    height: number;
    duration: number | null;
    url: string;
  };
}

// Action API response types
export interface ActionCategory {
  category: string;
  size: number;
  pages: number;
  files: number;
  subcats: number;
}

export interface ActionCategoryMember {
  pageid: number;
  ns: number;
  title: string;
  timestamp: string;
}

export interface ActionRecentChange {
  type: string;
  title: string;
  pageid: number;
  revid: number;
  old_revid: number;
  rcid: number;
  user: string;
  timestamp: string;
  comment: string;
  oldlen: number;
  newlen: number;
}

export interface ActionLink {
  ns: number;
  title: string;
}

export interface ActionBacklink {
  pageid: number;
  ns: number;
  title: string;
}

// Pagination
export interface PaginatedResult<T> {
  items: T[];
  hasMore: boolean;
  continueFrom?: string;
}

// Multi-wiki result wrapper
export interface WikiLabeledResult<T> {
  wiki: string;
  items: T[];
  error?: string;
}

export interface FanOutResult<T> {
  results: WikiLabeledResult<T>[];
  warnings: string[];
}

// Error types
export class MediaWikiApiError extends Error {
  constructor(
    message: string,
    public readonly wiki: string,
    public readonly operation: string,
    public readonly statusCode?: number,
    public readonly apiErrorCode?: string
  ) {
    super(`[${wiki}] ${operation}: ${message}`);
    this.name = 'MediaWikiApiError';
  }

  get isRetryable(): boolean {
    if (this.statusCode === 429) return true;
    if (this.statusCode && this.statusCode >= 500) return true;
    return false;
  }
}
```

**Step 2: Write type validation tests**

Create `tests/types.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { MediaWikiApiError } from '../src/types.js';

describe('MediaWikiApiError', () => {
  it('formats message with wiki and operation', () => {
    const err = new MediaWikiApiError('not found', 'Sales', 'get-page', 404);
    expect(err.message).toBe('[Sales] get-page: not found');
    expect(err.wiki).toBe('Sales');
    expect(err.operation).toBe('get-page');
    expect(err.statusCode).toBe(404);
  });

  it('is retryable on 429', () => {
    const err = new MediaWikiApiError('rate limited', 'Dev', 'search', 429);
    expect(err.isRetryable).toBe(true);
  });

  it('is retryable on 5xx', () => {
    const err = new MediaWikiApiError('server error', 'Dev', 'search', 502);
    expect(err.isRetryable).toBe(true);
  });

  it('is not retryable on 4xx', () => {
    const err = new MediaWikiApiError('bad request', 'Dev', 'search', 400);
    expect(err.isRetryable).toBe(false);
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: overhaul types for REST API, multi-wiki, and pagination"
```

---

### Task 3: RestClient

**Files:**
- Create: `src/clients/rest-client.ts`
- Create: `tests/clients/rest-client.test.ts`

**Step 1: Write failing tests for RestClient**

Create `tests/clients/rest-client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { RestClient } from '../../src/clients/rest-client.js';

vi.mock('axios');

describe('RestClient', () => {
  let client: RestClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      put: vi.fn(),
      defaults: { headers: { common: {} } }
    };
    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
    client = new RestClient('TestWiki', 'https://wiki.example.com');
  });

  describe('getPage', () => {
    it('fetches page by title', async () => {
      const mockPage = {
        id: 1, key: 'Test', title: 'Test',
        latest: { id: 10, timestamp: '2024-01-01T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: '', title: '' },
        source: '== Hello =='
      };
      mockAxiosInstance.get.mockResolvedValue({ data: mockPage });

      const result = await client.getPage('Test');
      expect(result).toEqual(mockPage);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/page/Test', expect.any(Object));
    });

    it('returns null for missing page (404)', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 404 },
        isAxiosError: true
      });

      const result = await client.getPage('Missing');
      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    it('searches pages with query', async () => {
      const mockResponse = { pages: [{ id: 1, key: 'Test', title: 'Test', excerpt: 'found' }] };
      mockAxiosInstance.get.mockResolvedValue({ data: mockResponse });

      const result = await client.search('test', 10);
      expect(result.pages).toHaveLength(1);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/search/page', {
        params: { q: 'test', limit: 10 }
      });
    });
  });

  describe('createPage', () => {
    it('creates a new page', async () => {
      const mockResponse = { id: 2, key: 'New_Page', title: 'New Page' };
      mockAxiosInstance.post.mockResolvedValue({ data: mockResponse });

      const result = await client.createPage('New Page', '== Content ==', 'Initial create');
      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.post).toHaveBeenCalledWith('/page', {
        title: 'New Page',
        source: '== Content ==',
        comment: 'Initial create'
      });
    });
  });

  describe('updatePage', () => {
    it('updates an existing page', async () => {
      const mockResponse = { id: 1, key: 'Test', title: 'Test' };
      mockAxiosInstance.put.mockResolvedValue({ data: mockResponse });

      const result = await client.updatePage('Test', '== Updated ==', 'Edit summary', '2024-01-01T00:00:00Z');
      expect(result).toEqual(mockResponse);
      expect(mockAxiosInstance.put).toHaveBeenCalledWith('/page/Test', {
        source: '== Updated ==',
        comment: 'Edit summary',
        latest: { timestamp: '2024-01-01T00:00:00Z' }
      });
    });
  });

  describe('getPageHistory', () => {
    it('fetches revision list', async () => {
      const mockResponse = {
        revisions: [{ id: 10, size: 100, timestamp: '2024-01-01T00:00:00Z' }],
        latest: '/page/Test/history',
        older: '/page/Test/history?older_than=10'
      };
      mockAxiosInstance.get.mockResolvedValue({ data: mockResponse });

      const result = await client.getPageHistory('Test');
      expect(result.revisions).toHaveLength(1);
    });
  });

  describe('getRevision', () => {
    it('fetches a single revision', async () => {
      const mockRevision = { id: 10, size: 100, timestamp: '2024-01-01T00:00:00Z' };
      mockAxiosInstance.get.mockResolvedValue({ data: mockRevision });

      const result = await client.getRevision(10);
      expect(result).toEqual(mockRevision);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/revision/10', expect.any(Object));
    });
  });

  describe('getFile', () => {
    it('fetches file info', async () => {
      const mockFile = {
        title: 'File:Test.png',
        preferred: { url: 'https://wiki.example.com/file.png', width: 100, height: 100 }
      };
      mockAxiosInstance.get.mockResolvedValue({ data: mockFile });

      const result = await client.getFile('File:Test.png');
      expect(result).toEqual(mockFile);
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('/file/File%3ATest.png', expect.any(Object));
    });
  });

  describe('retry logic', () => {
    it('retries on 429', async () => {
      mockAxiosInstance.get
        .mockRejectedValueOnce({ response: { status: 429 }, isAxiosError: true })
        .mockResolvedValueOnce({ data: { id: 1, title: 'Test' } });

      const result = await client.getPage('Test');
      expect(result).toBeTruthy();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('retries on 5xx', async () => {
      mockAxiosInstance.get
        .mockRejectedValueOnce({ response: { status: 503 }, isAxiosError: true })
        .mockResolvedValueOnce({ data: { id: 1, title: 'Test' } });

      const result = await client.getPage('Test');
      expect(result).toBeTruthy();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });

    it('does not retry on 400', async () => {
      mockAxiosInstance.get.mockRejectedValue({
        response: { status: 400, data: { detail: 'bad request' } },
        isAxiosError: true
      });

      await expect(client.getPage('Test')).rejects.toThrow();
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(1);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/clients/rest-client.test.ts`
Expected: FAIL — module not found

**Step 3: Implement RestClient**

Create `src/clients/rest-client.ts`:
```typescript
import axios, { AxiosInstance } from 'axios';
import {
  RestPage, RestSearchResponse, RestRevision, RestRevisionList, RestFileInfo,
  MediaWikiApiError
} from '../types.js';

export class RestClient {
  private axios: AxiosInstance;
  private wikiName: string;

  constructor(wikiName: string, baseUrl: string, apiToken?: string) {
    this.wikiName = wikiName;
    const cleanBase = baseUrl.replace(/\/$/, '');

    this.axios = axios.create({
      baseURL: `${cleanBase}/rest.php/v1`,
      timeout: 30000,
      headers: {
        'User-Agent': 'MediaWiki-MCP/2.0.0',
        'Accept': 'application/json'
      }
    });

    if (apiToken) {
      this.axios.defaults.headers.common['Authorization'] = `Bearer ${apiToken}`;
    }
  }

  private async request<T>(
    method: 'get' | 'post' | 'put',
    path: string,
    options?: { params?: Record<string, any>; data?: any },
    retries: number = 3
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        let response;
        if (method === 'get') {
          response = await this.axios.get(path, { params: options?.params });
        } else if (method === 'post') {
          response = await this.axios.post(path, options?.data);
        } else {
          response = await this.axios.put(path, options?.data);
        }
        return response.data;
      } catch (error: any) {
        const status = error?.response?.status;

        // 404 on getPage is not an error — handled by caller
        if (status === 404) {
          throw error;
        }

        const isRetryable = status === 429 || (status && status >= 500);

        if (isRetryable && attempt < retries) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        const message = error?.response?.data?.detail
          || error?.response?.data?.error?.info
          || error?.message
          || 'Unknown error';

        throw new MediaWikiApiError(
          message,
          this.wikiName,
          `REST ${method.toUpperCase()} ${path}`,
          status
        );
      }
    }
    throw new MediaWikiApiError('Max retries exceeded', this.wikiName, `REST ${method} ${path}`);
  }

  async getPage(title: string): Promise<RestPage | null> {
    try {
      return await this.request<RestPage>('get', `/page/${encodeURIComponent(title)}`, {
        params: {}
      });
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }

  async getPageHtml(title: string): Promise<string | null> {
    try {
      return await this.request<string>('get', `/page/${encodeURIComponent(title)}/html`);
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }

  async search(query: string, limit: number = 10): Promise<RestSearchResponse> {
    return this.request<RestSearchResponse>('get', '/search/page', {
      params: { q: query, limit }
    });
  }

  async searchByPrefix(query: string, limit: number = 10): Promise<RestSearchResponse> {
    return this.request<RestSearchResponse>('get', '/search/title', {
      params: { q: query, limit }
    });
  }

  async createPage(title: string, source: string, comment: string): Promise<RestPage> {
    return this.request<RestPage>('post', '/page', {
      data: { title, source, comment }
    });
  }

  async updatePage(
    title: string,
    source: string,
    comment: string,
    latestTimestamp: string
  ): Promise<RestPage> {
    return this.request<RestPage>('put', `/page/${encodeURIComponent(title)}`, {
      data: { source, comment, latest: { timestamp: latestTimestamp } }
    });
  }

  async getPageHistory(
    title: string,
    limit?: number,
    olderThan?: number
  ): Promise<RestRevisionList> {
    const params: Record<string, any> = {};
    if (limit) params.limit = limit;
    if (olderThan) params.older_than = olderThan;

    return this.request<RestRevisionList>(
      'get',
      `/page/${encodeURIComponent(title)}/history`,
      { params }
    );
  }

  async getRevision(revisionId: number): Promise<RestRevision> {
    return this.request<RestRevision>('get', `/revision/${revisionId}`, {
      params: {}
    });
  }

  async getFile(title: string): Promise<RestFileInfo | null> {
    try {
      return await this.request<RestFileInfo>(
        'get',
        `/file/${encodeURIComponent(title)}`,
        { params: {} }
      );
    } catch (error: any) {
      if (error?.response?.status === 404) return null;
      throw error;
    }
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/clients/rest-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/clients/rest-client.ts tests/clients/rest-client.test.ts
git commit -m "feat: add RestClient for MediaWiki REST API with retry logic"
```

---

### Task 4: ActionClient

**Files:**
- Create: `src/clients/action-client.ts`
- Create: `tests/clients/action-client.test.ts`

**Step 1: Write failing tests for ActionClient**

Create `tests/clients/action-client.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ActionClient } from '../../src/clients/action-client.js';

vi.mock('axios');

describe('ActionClient', () => {
  let client: ActionClient;
  let mockAxiosInstance: any;

  beforeEach(() => {
    mockAxiosInstance = {
      get: vi.fn(),
      post: vi.fn(),
      defaults: { headers: { common: {} } }
    };
    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
    client = new ActionClient('TestWiki', 'https://wiki.example.com');
  });

  describe('listCategories', () => {
    it('returns categories', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          query: {
            allcategories: [
              { category: 'Test', size: 5, pages: 3, files: 1, subcats: 1 }
            ]
          }
        }
      });

      const result = await client.listCategories();
      expect(result.items).toHaveLength(1);
      expect(result.items[0].category).toBe('Test');
    });

    it('handles continuation', async () => {
      mockAxiosInstance.get
        .mockResolvedValueOnce({
          data: {
            query: { allcategories: [{ category: 'A', size: 1, pages: 1, files: 0, subcats: 0 }] },
            continue: { accontinue: 'B', continue: '-||' }
          }
        })
        .mockResolvedValueOnce({
          data: {
            query: { allcategories: [{ category: 'B', size: 2, pages: 2, files: 0, subcats: 0 }] }
          }
        });

      const result = await client.listCategories(undefined, 100);
      expect(result.items).toHaveLength(2);
    });
  });

  describe('getCategoryMembers', () => {
    it('prepends Category: prefix if missing', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { query: { categorymembers: [] } }
      });

      await client.getCategoryMembers('Test');
      const call = mockAxiosInstance.get.mock.calls[0];
      expect(call[1].params.cmtitle).toBe('Category:Test');
    });
  });

  describe('getRecentChanges', () => {
    it('returns recent changes', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: {
          query: {
            recentchanges: [
              { type: 'edit', title: 'Test', pageid: 1, revid: 10, timestamp: '2024-01-01' }
            ]
          }
        }
      });

      const result = await client.getRecentChanges();
      expect(result.items).toHaveLength(1);
    });
  });

  describe('getPageLinks', () => {
    it('returns outgoing links', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { query: { pages: [{ pageid: 1, links: [{ ns: 0, title: 'Other' }] }] } }
      });

      const result = await client.getPageLinks('Test');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Other');
    });
  });

  describe('getBacklinks', () => {
    it('returns backlinks', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { query: { backlinks: [{ pageid: 2, ns: 0, title: 'Referrer' }] } }
      });

      const result = await client.getBacklinks('Test');
      expect(result.items).toHaveLength(1);
    });
  });

  describe('CSRF tokens', () => {
    it('fetches token for delete', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { query: { tokens: { csrftoken: 'abc+\\' } } }
      });
      mockAxiosInstance.post.mockResolvedValue({
        data: { delete: { title: 'Test' } }
      });

      await client.deletePage('Test');
      expect(mockAxiosInstance.get).toHaveBeenCalledWith('', expect.objectContaining({
        params: expect.objectContaining({ meta: 'tokens' })
      }));
    });
  });

  describe('upload', () => {
    it('uploads file from URL', async () => {
      mockAxiosInstance.get.mockResolvedValue({
        data: { query: { tokens: { csrftoken: 'abc+\\' } } }
      });
      mockAxiosInstance.post.mockResolvedValue({
        data: { upload: { result: 'Success', filename: 'Test.png' } }
      });

      const result = await client.uploadFromUrl('Test.png', 'https://example.com/test.png', 'desc');
      expect(result.result).toBe('Success');
    });
  });

  describe('retry logic', () => {
    it('retries on 429', async () => {
      mockAxiosInstance.get
        .mockRejectedValueOnce({ response: { status: 429 }, isAxiosError: true })
        .mockResolvedValueOnce({
          data: { query: { allcategories: [] } }
        });

      const result = await client.listCategories();
      expect(result.items).toHaveLength(0);
      expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/clients/action-client.test.ts`
Expected: FAIL — module not found

**Step 3: Implement ActionClient**

Create `src/clients/action-client.ts`:
```typescript
import axios, { AxiosInstance } from 'axios';
import {
  ActionCategory, ActionCategoryMember, ActionRecentChange,
  ActionLink, ActionBacklink, PaginatedResult,
  MediaWikiApiError
} from '../types.js';

export class ActionClient {
  private axios: AxiosInstance;
  private wikiName: string;
  private csrfToken: string | null = null;

  constructor(wikiName: string, baseUrl: string, apiToken?: string) {
    this.wikiName = wikiName;
    const cleanBase = baseUrl.replace(/\/$/, '');

    this.axios = axios.create({
      baseURL: `${cleanBase}/api.php`,
      timeout: 30000,
      headers: {
        'User-Agent': 'MediaWiki-MCP/2.0.0',
        'Accept': 'application/json'
      }
    });

    if (apiToken) {
      this.axios.defaults.headers.common['Authorization'] = `Bearer ${apiToken}`;
    }
  }

  private async apiGet<T>(
    params: Record<string, any>,
    retries: number = 3
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await this.axios.get('', {
          params: { format: 'json', formatversion: 2, ...params }
        });

        if (response.data?.error) {
          throw new MediaWikiApiError(
            response.data.error.info,
            this.wikiName,
            `Action API: ${params.action}`,
            undefined,
            response.data.error.code
          );
        }

        return response.data;
      } catch (error: any) {
        if (error instanceof MediaWikiApiError) throw error;

        const status = error?.response?.status;
        const isRetryable = status === 429 || (status && status >= 500);

        if (isRetryable && attempt < retries) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        const message = error?.response?.data?.error?.info
          || error?.message
          || 'Unknown error';

        throw new MediaWikiApiError(
          message, this.wikiName, `Action API: ${params.action}`, status
        );
      }
    }
    throw new MediaWikiApiError(
      'Max retries exceeded', this.wikiName, `Action API: ${params.action}`
    );
  }

  private async apiPost<T>(
    params: Record<string, any>,
    retries: number = 3
  ): Promise<T> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const formData = new URLSearchParams();
        formData.append('format', 'json');
        formData.append('formatversion', '2');
        for (const [key, value] of Object.entries(params)) {
          if (value !== undefined) formData.append(key, String(value));
        }

        const response = await this.axios.post('', formData);

        if (response.data?.error) {
          throw new MediaWikiApiError(
            response.data.error.info,
            this.wikiName,
            `Action API POST: ${params.action}`,
            undefined,
            response.data.error.code
          );
        }

        return response.data;
      } catch (error: any) {
        if (error instanceof MediaWikiApiError) throw error;

        const status = error?.response?.status;
        const isRetryable = status === 429 || (status && status >= 500);

        if (isRetryable && attempt < retries) {
          const delay = Math.pow(2, attempt - 1) * 1000;
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        throw new MediaWikiApiError(
          error?.message || 'Unknown error',
          this.wikiName,
          `Action API POST: ${params.action}`,
          status
        );
      }
    }
    throw new MediaWikiApiError(
      'Max retries exceeded', this.wikiName, `Action API POST: ${params.action}`
    );
  }

  private async getCsrfToken(): Promise<string> {
    if (this.csrfToken) return this.csrfToken;
    const data = await this.apiGet<any>({
      action: 'query',
      meta: 'tokens',
      type: 'csrf'
    });
    this.csrfToken = data.query.tokens.csrftoken;
    return this.csrfToken!;
  }

  async listCategories(
    prefix?: string,
    limit: number = 50,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionCategory>> {
    const allItems: ActionCategory[] = [];
    let continueParams: Record<string, string> | undefined;

    if (continueFrom) {
      continueParams = { accontinue: continueFrom, continue: '-||' };
    }

    do {
      const params: Record<string, any> = {
        action: 'query',
        list: 'allcategories',
        aclimit: Math.min(limit - allItems.length, 500),
        acprop: 'size',
        ...(prefix ? { acprefix: prefix } : {}),
        ...(continueParams || {})
      };

      const data = await this.apiGet<any>(params);
      const items = data.query?.allcategories || [];
      allItems.push(...items);

      continueParams = data.continue;
    } while (continueParams && allItems.length < limit);

    return {
      items: allItems.slice(0, limit),
      hasMore: !!continueParams || allItems.length > limit,
      continueFrom: continueParams?.accontinue
    };
  }

  async getCategoryMembers(
    category: string,
    limit: number = 50,
    type?: string,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionCategoryMember>> {
    const categoryTitle = category.startsWith('Category:')
      ? category : `Category:${category}`;

    const allItems: ActionCategoryMember[] = [];
    let continueParams: Record<string, string> | undefined;

    if (continueFrom) {
      continueParams = { cmcontinue: continueFrom, continue: '-||' };
    }

    do {
      const params: Record<string, any> = {
        action: 'query',
        list: 'categorymembers',
        cmtitle: categoryTitle,
        cmlimit: Math.min(limit - allItems.length, 500),
        cmprop: 'ids|title|timestamp',
        ...(type ? { cmtype: type } : {}),
        ...(continueParams || {})
      };

      const data = await this.apiGet<any>(params);
      allItems.push(...(data.query?.categorymembers || []));
      continueParams = data.continue;
    } while (continueParams && allItems.length < limit);

    return {
      items: allItems.slice(0, limit),
      hasMore: !!continueParams || allItems.length > limit,
      continueFrom: continueParams?.cmcontinue
    };
  }

  async getRecentChanges(
    limit: number = 50,
    namespace?: number,
    type?: string,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionRecentChange>> {
    const params: Record<string, any> = {
      action: 'query',
      list: 'recentchanges',
      rclimit: limit,
      rcprop: 'title|ids|sizes|flags|user|timestamp|comment',
      ...(namespace !== undefined ? { rcnamespace: namespace } : {}),
      ...(type ? { rctype: type } : {}),
      ...(continueFrom ? { rccontinue: continueFrom, continue: '-||' } : {})
    };

    const data = await this.apiGet<any>(params);
    const items = data.query?.recentchanges || [];

    return {
      items,
      hasMore: !!data.continue,
      continueFrom: data.continue?.rccontinue
    };
  }

  async getPageLinks(
    title: string,
    limit: number = 500,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionLink>> {
    const params: Record<string, any> = {
      action: 'query',
      titles: title,
      prop: 'links',
      pllimit: limit,
      ...(continueFrom ? { plcontinue: continueFrom, continue: '-||' } : {})
    };

    const data = await this.apiGet<any>(params);
    const pages = data.query?.pages;
    const page = pages?.[0];
    const items = page?.links || [];

    return {
      items,
      hasMore: !!data.continue,
      continueFrom: data.continue?.plcontinue
    };
  }

  async getBacklinks(
    title: string,
    limit: number = 500,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionBacklink>> {
    const params: Record<string, any> = {
      action: 'query',
      list: 'backlinks',
      bltitle: title,
      bllimit: limit,
      ...(continueFrom ? { blcontinue: continueFrom, continue: '-||' } : {})
    };

    const data = await this.apiGet<any>(params);
    const items = data.query?.backlinks || [];

    return {
      items,
      hasMore: !!data.continue,
      continueFrom: data.continue?.blcontinue
    };
  }

  async deletePage(title: string): Promise<void> {
    const token = await this.getCsrfToken();
    await this.apiPost({ action: 'delete', title, token });
  }

  async undeletePage(title: string, reason?: string): Promise<void> {
    const token = await this.getCsrfToken();
    await this.apiPost({
      action: 'undelete', title, token,
      ...(reason ? { reason } : {})
    });
  }

  async uploadFromUrl(
    filename: string,
    url: string,
    text: string,
    comment?: string
  ): Promise<{ result: string; filename: string }> {
    const token = await this.getCsrfToken();
    const data = await this.apiPost<any>({
      action: 'upload',
      filename,
      url,
      text,
      token,
      ...(comment ? { comment } : {})
    });
    return data.upload;
  }

  async uploadFile(
    filename: string,
    fileContent: Buffer,
    text: string,
    comment?: string
  ): Promise<{ result: string; filename: string }> {
    const token = await this.getCsrfToken();
    // For binary upload we need multipart form data
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('action', 'upload');
    form.append('format', 'json');
    form.append('formatversion', '2');
    form.append('filename', filename);
    form.append('text', text);
    form.append('token', token);
    if (comment) form.append('comment', comment);
    form.append('file', fileContent, { filename });

    const response = await this.axios.post('', form, {
      headers: form.getHeaders()
    });

    if (response.data?.error) {
      throw new MediaWikiApiError(
        response.data.error.info,
        this.wikiName,
        'upload',
        undefined,
        response.data.error.code
      );
    }

    return response.data.upload;
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/clients/action-client.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/clients/action-client.ts tests/clients/action-client.test.ts
git commit -m "feat: add ActionClient for Action API with CSRF tokens and pagination"
```

---

### Task 5: WikiRegistry

**Files:**
- Create: `src/wiki-registry.ts`
- Create: `tests/wiki-registry.test.ts`

**Step 1: Write failing tests**

Create `tests/wiki-registry.test.ts`:
```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { WikiRegistry } from '../src/wiki-registry.js';

describe('WikiRegistry', () => {
  let registry: WikiRegistry;

  beforeEach(() => {
    registry = new WikiRegistry();
  });

  describe('addWiki', () => {
    it('adds a wiki and returns it', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      expect(registry.getWiki('Sales')).toBeTruthy();
    });

    it('sets first wiki as default', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      expect(registry.getDefaultWiki()?.name).toBe('Sales');
    });

    it('throws on duplicate name', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      expect(() => registry.addWiki({ name: 'Sales', baseUrl: 'https://other.com' }))
        .toThrow('already registered');
    });
  });

  describe('removeWiki', () => {
    it('removes a wiki', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      registry.removeWiki('Sales');
      expect(registry.getWiki('Sales')).toBeUndefined();
    });

    it('reassigns default when removing default wiki', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      registry.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
      registry.removeWiki('Sales');
      expect(registry.getDefaultWiki()?.name).toBe('Dev');
    });

    it('throws on unknown wiki', () => {
      expect(() => registry.removeWiki('Unknown')).toThrow('not found');
    });
  });

  describe('getAllWikis', () => {
    it('returns all registered wikis', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      registry.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
      expect(registry.getAllWikis()).toHaveLength(2);
    });
  });

  describe('resolveWiki', () => {
    it('returns named wiki if specified', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      registry.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
      expect(registry.resolveWiki('Dev')?.name).toBe('Dev');
    });

    it('returns default wiki if not specified', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      expect(registry.resolveWiki()?.name).toBe('Sales');
    });

    it('throws if named wiki not found', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      expect(() => registry.resolveWiki('Unknown')).toThrow('not found');
    });

    it('throws if no wikis registered and no name given', () => {
      expect(() => registry.resolveWiki()).toThrow('No wikis registered');
    });
  });

  describe('case insensitive matching', () => {
    it('matches wiki names case-insensitively', () => {
      registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
      expect(registry.getWiki('sales')).toBeTruthy();
      expect(registry.resolveWiki('SALES')?.name).toBe('Sales');
    });
  });

  describe('fromEnvironment', () => {
    it('parses MEDIAWIKI_WIKIS format', () => {
      const reg = WikiRegistry.fromEnvironment({
        MEDIAWIKI_WIKIS: 'Sales:https://sales.wiki.com,Dev:https://dev.wiki.com',
        MEDIAWIKI_DEFAULT_WIKI: 'Dev',
        MEDIAWIKI_API_TOKEN_SALES: 'token1',
        MEDIAWIKI_API_TOKEN_DEV: 'token2'
      });
      expect(reg.getAllWikis()).toHaveLength(2);
      expect(reg.getDefaultWiki()?.name).toBe('Dev');
      expect(reg.getWiki('Sales')?.apiToken).toBe('token1');
    });

    it('falls back to MEDIAWIKI_BASE_URL', () => {
      const reg = WikiRegistry.fromEnvironment({
        MEDIAWIKI_BASE_URL: 'https://wiki.example.com',
        MEDIAWIKI_API_TOKEN: 'token'
      });
      expect(reg.getAllWikis()).toHaveLength(1);
      expect(reg.getDefaultWiki()?.name).toBe('default');
      expect(reg.getDefaultWiki()?.apiToken).toBe('token');
    });

    it('throws if no wiki config found', () => {
      expect(() => WikiRegistry.fromEnvironment({})).toThrow();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/wiki-registry.test.ts`
Expected: FAIL

**Step 3: Implement WikiRegistry**

Create `src/wiki-registry.ts`:
```typescript
import type { WikiConfig } from './types.js';

export class WikiRegistry {
  private wikis: Map<string, WikiConfig> = new Map();
  private defaultWikiKey: string | null = null;

  private normalizeKey(name: string): string {
    return name.toLowerCase();
  }

  addWiki(config: WikiConfig): void {
    const key = this.normalizeKey(config.name);
    if (this.wikis.has(key)) {
      throw new Error(`Wiki "${config.name}" is already registered`);
    }
    this.wikis.set(key, {
      ...config,
      baseUrl: config.baseUrl.replace(/\/$/, '')
    });
    if (this.wikis.size === 1) {
      this.defaultWikiKey = key;
    }
  }

  removeWiki(name: string): void {
    const key = this.normalizeKey(name);
    if (!this.wikis.has(key)) {
      throw new Error(`Wiki "${name}" not found`);
    }
    this.wikis.delete(key);
    if (this.defaultWikiKey === key) {
      const firstKey = this.wikis.keys().next().value;
      this.defaultWikiKey = firstKey ?? null;
    }
  }

  getWiki(name: string): WikiConfig | undefined {
    return this.wikis.get(this.normalizeKey(name));
  }

  getDefaultWiki(): WikiConfig | undefined {
    if (!this.defaultWikiKey) return undefined;
    return this.wikis.get(this.defaultWikiKey);
  }

  setDefault(name: string): void {
    const key = this.normalizeKey(name);
    if (!this.wikis.has(key)) {
      throw new Error(`Wiki "${name}" not found`);
    }
    this.defaultWikiKey = key;
  }

  getAllWikis(): WikiConfig[] {
    return Array.from(this.wikis.values());
  }

  resolveWiki(name?: string): WikiConfig {
    if (name) {
      const wiki = this.getWiki(name);
      if (!wiki) throw new Error(`Wiki "${name}" not found`);
      return wiki;
    }
    const def = this.getDefaultWiki();
    if (!def) throw new Error('No wikis registered');
    return def;
  }

  static fromEnvironment(env: Record<string, string | undefined>): WikiRegistry {
    const registry = new WikiRegistry();

    // Try MEDIAWIKI_WIKIS format first: "Name1:url1,Name2:url2"
    const wikisStr = env.MEDIAWIKI_WIKIS;
    if (wikisStr) {
      const entries = wikisStr.split(',').map(s => s.trim()).filter(Boolean);
      for (const entry of entries) {
        const colonIdx = entry.indexOf(':');
        if (colonIdx === -1) continue;
        const name = entry.substring(0, colonIdx).trim();
        const baseUrl = entry.substring(colonIdx + 1).trim();
        const tokenKey = `MEDIAWIKI_API_TOKEN_${name.toUpperCase()}`;
        registry.addWiki({ name, baseUrl, apiToken: env[tokenKey] });
      }

      const defaultWiki = env.MEDIAWIKI_DEFAULT_WIKI;
      if (defaultWiki && registry.getWiki(defaultWiki)) {
        registry.setDefault(defaultWiki);
      }

      return registry;
    }

    // Fall back to single MEDIAWIKI_BASE_URL
    const baseUrl = env.MEDIAWIKI_BASE_URL;
    if (baseUrl) {
      registry.addWiki({
        name: 'default',
        baseUrl,
        apiToken: env.MEDIAWIKI_API_TOKEN
      });
      return registry;
    }

    throw new Error(
      'No wiki configuration found. Set MEDIAWIKI_WIKIS or MEDIAWIKI_BASE_URL environment variable.'
    );
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/wiki-registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/wiki-registry.ts tests/wiki-registry.test.ts
git commit -m "feat: add WikiRegistry with named wikis and env parsing"
```

---

### Task 6: WikiOrchestrator

**Files:**
- Create: `src/wiki-orchestrator.ts`
- Create: `tests/wiki-orchestrator.test.ts`

**Step 1: Write failing tests**

Create `tests/wiki-orchestrator.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WikiOrchestrator } from '../src/wiki-orchestrator.js';
import { WikiRegistry } from '../src/wiki-registry.js';

// Mock the client modules
vi.mock('../src/clients/rest-client.js', () => ({
  RestClient: vi.fn().mockImplementation((name: string) => ({
    search: vi.fn().mockResolvedValue({ pages: [{ id: 1, title: 'Test', excerpt: 'found' }] }),
    getPage: vi.fn().mockResolvedValue({ id: 1, title: 'Test', source: '== Hello ==' }),
    createPage: vi.fn().mockResolvedValue({ id: 2, title: 'New' }),
    updatePage: vi.fn().mockResolvedValue({ id: 1, title: 'Test' }),
    getPageHistory: vi.fn().mockResolvedValue({ revisions: [], latest: '' }),
    getRevision: vi.fn().mockResolvedValue({ id: 10 }),
    getFile: vi.fn().mockResolvedValue({ title: 'File:Test.png' }),
    getPageHtml: vi.fn().mockResolvedValue('<p>Hello</p>'),
    searchByPrefix: vi.fn().mockResolvedValue({ pages: [] }),
  }))
}));

vi.mock('../src/clients/action-client.js', () => ({
  ActionClient: vi.fn().mockImplementation((name: string) => ({
    listCategories: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    getCategoryMembers: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    getRecentChanges: vi.fn().mockResolvedValue({ items: [{ type: 'edit', title: 'Test', timestamp: '2024-01-01' }], hasMore: false }),
    getPageLinks: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    getBacklinks: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
    deletePage: vi.fn().mockResolvedValue(undefined),
    undeletePage: vi.fn().mockResolvedValue(undefined),
    uploadFromUrl: vi.fn().mockResolvedValue({ result: 'Success', filename: 'Test.png' }),
    uploadFile: vi.fn().mockResolvedValue({ result: 'Success', filename: 'Test.png' }),
  }))
}));

describe('WikiOrchestrator', () => {
  let orchestrator: WikiOrchestrator;

  beforeEach(() => {
    const registry = new WikiRegistry();
    registry.addWiki({ name: 'Sales', baseUrl: 'https://sales.wiki.com' });
    registry.addWiki({ name: 'Dev', baseUrl: 'https://dev.wiki.com' });
    orchestrator = new WikiOrchestrator(registry);
  });

  describe('fan-out search', () => {
    it('searches all wikis when no wiki specified', async () => {
      const result = await orchestrator.search('test');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].wiki).toBe('Sales');
      expect(result.results[1].wiki).toBe('Dev');
    });

    it('searches single wiki when specified', async () => {
      const result = await orchestrator.search('test', { wiki: 'Dev' });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].wiki).toBe('Dev');
    });
  });

  describe('single-wiki operations', () => {
    it('getPage uses default wiki', async () => {
      const result = await orchestrator.getPage('Test');
      expect(result).toBeTruthy();
    });

    it('getPage uses specified wiki', async () => {
      const result = await orchestrator.getPage('Test', { wiki: 'Dev' });
      expect(result).toBeTruthy();
    });

    it('throws on unknown wiki', async () => {
      await expect(orchestrator.getPage('Test', { wiki: 'Unknown' }))
        .rejects.toThrow('not found');
    });
  });

  describe('fan-out with partial failure', () => {
    it('returns partial results and warnings on failure', async () => {
      // Override one wiki's search to fail
      const clients = (orchestrator as any).restClients;
      const devClient = clients.get('dev');
      devClient.search.mockRejectedValue(new Error('Connection refused'));

      const result = await orchestrator.search('test');
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('Dev');
    });
  });

  describe('fan-out recentChanges', () => {
    it('merges across wikis', async () => {
      const result = await orchestrator.getRecentChanges();
      expect(result.results).toHaveLength(2);
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/wiki-orchestrator.test.ts`
Expected: FAIL

**Step 3: Implement WikiOrchestrator**

Create `src/wiki-orchestrator.ts`:
```typescript
import { WikiRegistry } from './wiki-registry.js';
import { RestClient } from './clients/rest-client.js';
import { ActionClient } from './clients/action-client.js';
import type {
  WikiConfig, RestPage, RestSearchResult, RestSearchResponse,
  RestRevision, RestRevisionList, RestFileInfo,
  ActionCategory, ActionCategoryMember, ActionRecentChange,
  ActionLink, ActionBacklink,
  PaginatedResult, FanOutResult, WikiLabeledResult
} from './types.js';

interface WikiClients {
  rest: RestClient;
  action: ActionClient;
}

interface SingleWikiOpts {
  wiki?: string;
}

interface PaginationOpts {
  limit?: number;
  continueFrom?: string;
}

export class WikiOrchestrator {
  private registry: WikiRegistry;
  private restClients: Map<string, RestClient> = new Map();
  private actionClients: Map<string, ActionClient> = new Map();

  constructor(registry: WikiRegistry) {
    this.registry = registry;
    this.initClients();
  }

  private initClients(): void {
    for (const wiki of this.registry.getAllWikis()) {
      this.addClientsForWiki(wiki);
    }
  }

  addClientsForWiki(wiki: WikiConfig): void {
    const key = wiki.name.toLowerCase();
    this.restClients.set(key, new RestClient(wiki.name, wiki.baseUrl, wiki.apiToken));
    this.actionClients.set(key, new ActionClient(wiki.name, wiki.baseUrl, wiki.apiToken));
  }

  removeClientsForWiki(name: string): void {
    const key = name.toLowerCase();
    this.restClients.delete(key);
    this.actionClients.delete(key);
  }

  private getClients(wikiName?: string): { config: WikiConfig; rest: RestClient; action: ActionClient } {
    const config = this.registry.resolveWiki(wikiName);
    const key = config.name.toLowerCase();
    return {
      config,
      rest: this.restClients.get(key)!,
      action: this.actionClients.get(key)!
    };
  }

  private async fanOut<T>(
    operation: (rest: RestClient, action: ActionClient, wikiName: string) => Promise<T[]>,
    opts?: SingleWikiOpts
  ): Promise<FanOutResult<T>> {
    if (opts?.wiki) {
      const { config, rest, action } = this.getClients(opts.wiki);
      const items = await operation(rest, action, config.name);
      return { results: [{ wiki: config.name, items }], warnings: [] };
    }

    const wikis = this.registry.getAllWikis();
    const results: WikiLabeledResult<T>[] = [];
    const warnings: string[] = [];

    const settled = await Promise.allSettled(
      wikis.map(async (wiki) => {
        const key = wiki.name.toLowerCase();
        const rest = this.restClients.get(key)!;
        const action = this.actionClients.get(key)!;
        const items = await operation(rest, action, wiki.name);
        return { wiki: wiki.name, items };
      })
    );

    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        const wikiName = this.extractWikiFromError(result.reason);
        warnings.push(`${wikiName}: ${result.reason.message}`);
        results.push({ wiki: wikiName, items: [], error: result.reason.message });
      }
    }

    return { results, warnings };
  }

  private extractWikiFromError(error: any): string {
    return error?.wiki || 'Unknown wiki';
  }

  // === Fan-out operations ===

  async search(
    query: string,
    opts?: SingleWikiOpts & { limit?: number }
  ): Promise<FanOutResult<RestSearchResult>> {
    return this.fanOut(
      async (rest) => {
        const response = await rest.search(query, opts?.limit);
        return response.pages;
      },
      opts
    );
  }

  async searchByPrefix(
    query: string,
    opts?: SingleWikiOpts & { limit?: number }
  ): Promise<FanOutResult<RestSearchResult>> {
    return this.fanOut(
      async (rest) => {
        const response = await rest.searchByPrefix(query, opts?.limit);
        return response.pages;
      },
      opts
    );
  }

  async getRecentChanges(
    opts?: SingleWikiOpts & PaginationOpts & { namespace?: number; type?: string }
  ): Promise<FanOutResult<ActionRecentChange>> {
    return this.fanOut(
      async (_rest, action) => {
        const result = await action.getRecentChanges(
          opts?.limit, opts?.namespace, opts?.type, opts?.continueFrom
        );
        return result.items;
      },
      opts
    );
  }

  async listCategories(
    opts?: SingleWikiOpts & PaginationOpts & { prefix?: string }
  ): Promise<FanOutResult<ActionCategory>> {
    return this.fanOut(
      async (_rest, action) => {
        const result = await action.listCategories(opts?.prefix, opts?.limit, opts?.continueFrom);
        return result.items;
      },
      opts
    );
  }

  // === Single-wiki operations ===

  async getPage(
    title: string,
    opts?: SingleWikiOpts & { includeHtml?: boolean }
  ): Promise<{ wiki: string; page: RestPage | null; html?: string | null }> {
    const { config, rest } = this.getClients(opts?.wiki);
    const page = await rest.getPage(title);
    let html: string | null | undefined;
    if (opts?.includeHtml && page) {
      html = await rest.getPageHtml(title);
    }
    return { wiki: config.name, page, html };
  }

  async createPage(
    title: string,
    source: string,
    comment: string,
    opts?: SingleWikiOpts
  ): Promise<{ wiki: string; page: RestPage }> {
    const { config, rest } = this.getClients(opts?.wiki);
    const page = await rest.createPage(title, source, comment);
    return { wiki: config.name, page };
  }

  async updatePage(
    title: string,
    source: string,
    comment: string,
    latestTimestamp: string,
    opts?: SingleWikiOpts
  ): Promise<{ wiki: string; page: RestPage }> {
    const { config, rest } = this.getClients(opts?.wiki);
    const page = await rest.updatePage(title, source, comment, latestTimestamp);
    return { wiki: config.name, page };
  }

  async deletePage(title: string, opts?: SingleWikiOpts): Promise<{ wiki: string }> {
    const { config, action } = this.getClients(opts?.wiki);
    await action.deletePage(title);
    return { wiki: config.name };
  }

  async undeletePage(
    title: string,
    reason?: string,
    opts?: SingleWikiOpts
  ): Promise<{ wiki: string }> {
    const { config, action } = this.getClients(opts?.wiki);
    await action.undeletePage(title, reason);
    return { wiki: config.name };
  }

  async getPageHistory(
    title: string,
    opts?: SingleWikiOpts & { limit?: number; olderThan?: number }
  ): Promise<{ wiki: string; history: RestRevisionList }> {
    const { config, rest } = this.getClients(opts?.wiki);
    const history = await rest.getPageHistory(title, opts?.limit, opts?.olderThan);
    return { wiki: config.name, history };
  }

  async getRevision(
    revisionId: number,
    opts?: SingleWikiOpts
  ): Promise<{ wiki: string; revision: RestRevision }> {
    const { config, rest } = this.getClients(opts?.wiki);
    const revision = await rest.getRevision(revisionId);
    return { wiki: config.name, revision };
  }

  async getPageLinks(
    title: string,
    direction: 'from' | 'to',
    opts?: SingleWikiOpts & PaginationOpts
  ): Promise<{ wiki: string; links: PaginatedResult<ActionLink | ActionBacklink> }> {
    const { config, action } = this.getClients(opts?.wiki);
    const links = direction === 'from'
      ? await action.getPageLinks(title, opts?.limit, opts?.continueFrom)
      : await action.getBacklinks(title, opts?.limit, opts?.continueFrom);
    return { wiki: config.name, links };
  }

  async getCategoryMembers(
    category: string,
    opts?: SingleWikiOpts & PaginationOpts & { type?: string }
  ): Promise<{ wiki: string; members: PaginatedResult<ActionCategoryMember> }> {
    const { config, action } = this.getClients(opts?.wiki);
    const members = await action.getCategoryMembers(
      category, opts?.limit, opts?.type, opts?.continueFrom
    );
    return { wiki: config.name, members };
  }

  async getFile(
    title: string,
    opts?: SingleWikiOpts
  ): Promise<{ wiki: string; file: RestFileInfo | null }> {
    const { config, rest } = this.getClients(opts?.wiki);
    const file = await rest.getFile(title);
    return { wiki: config.name, file };
  }

  async uploadFile(
    filename: string,
    fileContent: Buffer,
    text: string,
    opts?: SingleWikiOpts & { comment?: string }
  ): Promise<{ wiki: string; result: string; filename: string }> {
    const { config, action } = this.getClients(opts?.wiki);
    const upload = await action.uploadFile(filename, fileContent, text, opts?.comment);
    return { wiki: config.name, ...upload };
  }

  async uploadFromUrl(
    filename: string,
    url: string,
    text: string,
    opts?: SingleWikiOpts & { comment?: string }
  ): Promise<{ wiki: string; result: string; filename: string }> {
    const { config, action } = this.getClients(opts?.wiki);
    const upload = await action.uploadFromUrl(filename, url, text, opts?.comment);
    return { wiki: config.name, ...upload };
  }

  // === Wiki management ===

  getRegistry(): WikiRegistry {
    return this.registry;
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/wiki-orchestrator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/wiki-orchestrator.ts tests/wiki-orchestrator.test.ts
git commit -m "feat: add WikiOrchestrator with fan-out and single-wiki routing"
```

---

### Task 7: MCP Tool Registration — Wiki Management Tools

**Files:**
- Create: `src/tools/wiki-tools.ts`
- Create: `tests/tools/wiki-tools.test.ts`

**Step 1: Write failing tests**

Create `tests/tools/wiki-tools.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerWikiTools } from '../../src/tools/wiki-tools.js';
import { WikiOrchestrator } from '../../src/wiki-orchestrator.js';
import { WikiRegistry } from '../../src/wiki-registry.js';

// We test that tools register without error
describe('wiki-tools registration', () => {
  it('registers without error', () => {
    const server = new McpServer({ name: 'test', version: '1.0.0' });
    const registry = new WikiRegistry();
    registry.addWiki({ name: 'Test', baseUrl: 'https://test.wiki.com' });
    const orchestrator = new WikiOrchestrator(registry);

    expect(() => registerWikiTools(server, orchestrator)).not.toThrow();
  });
});
```

**Step 2: Run to verify fail**

Run: `npx vitest run tests/tools/wiki-tools.test.ts`
Expected: FAIL

**Step 3: Implement wiki-tools.ts**

Create `src/tools/wiki-tools.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerWikiTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.registerTool(
    'add-wiki',
    {
      title: 'Add Wiki',
      description: 'Register a new named wiki. Provide a friendly name, the wiki base URL, and an optional API token.',
      inputSchema: {
        name: z.string().describe('Friendly name for this wiki (e.g., "Sales", "Dev")'),
        url: z.string().url().describe('Base URL of the MediaWiki instance (e.g., "https://wiki.example.com")'),
        token: z.string().optional().describe('API bearer token for authentication')
      }
    },
    async ({ name, url, token }) => {
      const registry = orchestrator.getRegistry();
      registry.addWiki({ name, baseUrl: url, apiToken: token });
      orchestrator.addClientsForWiki({ name, baseUrl: url, apiToken: token });

      return {
        content: [{ type: 'text', text: `Wiki "${name}" registered at ${url}` }]
      };
    }
  );

  server.registerTool(
    'remove-wiki',
    {
      title: 'Remove Wiki',
      description: 'Remove a previously registered wiki by name.',
      inputSchema: {
        name: z.string().describe('Name of the wiki to remove')
      }
    },
    async ({ name }) => {
      const registry = orchestrator.getRegistry();
      registry.removeWiki(name);
      orchestrator.removeClientsForWiki(name);

      return {
        content: [{ type: 'text', text: `Wiki "${name}" removed` }]
      };
    }
  );

  server.registerTool(
    'list-wikis',
    {
      title: 'List Wikis',
      description: 'Show all registered wikis with their names and URLs.',
      inputSchema: {}
    },
    async () => {
      const registry = orchestrator.getRegistry();
      const wikis = registry.getAllWikis();
      const defaultWiki = registry.getDefaultWiki();

      if (wikis.length === 0) {
        return {
          content: [{ type: 'text', text: 'No wikis registered. Use add-wiki to register one.' }]
        };
      }

      let text = `Registered wikis (${wikis.length}):\n\n`;
      for (const wiki of wikis) {
        const isDefault = wiki.name === defaultWiki?.name ? ' (default)' : '';
        const hasToken = wiki.apiToken ? ' [authenticated]' : '';
        text += `- **${wiki.name}**${isDefault}${hasToken}: ${wiki.baseUrl}\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );
}
```

**Step 4: Run tests**

Run: `npx vitest run tests/tools/wiki-tools.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/tools/wiki-tools.ts tests/tools/wiki-tools.test.ts
git commit -m "feat: add wiki management tools (add, remove, list)"
```

---

### Task 8: MCP Tool Registration — Search Tools

**Files:**
- Create: `src/tools/search-tools.ts`

**Step 1: Implement search-tools.ts**

Create `src/tools/search-tools.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerSearchTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.registerTool(
    'search-pages',
    {
      title: 'Search Pages',
      description: 'Full-text search across wiki pages. Searches all registered wikis by default, or specify a wiki name to search only one.',
      inputSchema: {
        query: z.string().describe('Search query string'),
        wiki: z.string().optional().describe('Wiki name to search (omit to search all wikis)'),
        limit: z.number().optional().default(10).describe('Max results per wiki (1-50)')
      }
    },
    async ({ query, wiki, limit = 10 }) => {
      const result = await orchestrator.search(query, { wiki, limit });

      const totalItems = result.results.reduce((sum, r) => sum + r.items.length, 0);
      if (totalItems === 0) {
        const scope = wiki ? `on ${wiki}` : 'across all wikis';
        return { content: [{ type: 'text', text: `No results found for "${query}" ${scope}` }] };
      }

      const wikiCount = result.results.filter(r => r.items.length > 0).length;
      let text = `Found ${totalItems} results`;
      if (!wiki && wikiCount > 1) text += ` across ${wikiCount} wikis`;
      text += `:\n\n`;

      for (const wikiResult of result.results) {
        if (wikiResult.error) continue;
        for (const page of wikiResult.items) {
          const label = wiki ? '' : `[${wikiResult.wiki}] `;
          const excerpt = page.excerpt?.replace(/<[^>]*>/g, '') || '';
          text += `- ${label}**${page.title}**\n  ${excerpt}\n\n`;
        }
      }

      if (result.warnings.length > 0) {
        text += `\n---\nWarnings:\n`;
        for (const w of result.warnings) text += `- ${w}\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'search-pages-by-prefix',
    {
      title: 'Search Pages by Prefix',
      description: 'Search for pages by title prefix. Searches all wikis by default.',
      inputSchema: {
        query: z.string().describe('Title prefix to search for'),
        wiki: z.string().optional().describe('Wiki name (omit to search all wikis)'),
        limit: z.number().optional().default(10).describe('Max results per wiki (1-50)')
      }
    },
    async ({ query, wiki, limit = 10 }) => {
      const result = await orchestrator.searchByPrefix(query, { wiki, limit });

      const totalItems = result.results.reduce((sum, r) => sum + r.items.length, 0);
      if (totalItems === 0) {
        return { content: [{ type: 'text', text: `No pages found with prefix "${query}"` }] };
      }

      let text = `Found ${totalItems} pages with prefix "${query}":\n\n`;

      for (const wikiResult of result.results) {
        if (wikiResult.error) continue;
        for (const page of wikiResult.items) {
          const label = wiki ? '' : `[${wikiResult.wiki}] `;
          text += `- ${label}**${page.title}**\n`;
        }
      }

      if (result.warnings.length > 0) {
        text += `\n---\nWarnings:\n`;
        for (const w of result.warnings) text += `- ${w}\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );
}
```

**Step 2: Commit**

```bash
git add src/tools/search-tools.ts
git commit -m "feat: add search tools with multi-wiki fan-out"
```

---

### Task 9: MCP Tool Registration — Page Tools

**Files:**
- Create: `src/tools/page-tools.ts`

**Step 1: Implement page-tools.ts**

Create `src/tools/page-tools.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerPageTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.registerTool(
    'get-page',
    {
      title: 'Get Page',
      description: 'Get the content and metadata of a wiki page. Returns wikitext source by default, or HTML if requested.',
      inputSchema: {
        title: z.string().describe('Page title'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)'),
        include_html: z.boolean().optional().default(false).describe('Return parsed HTML instead of wikitext')
      }
    },
    async ({ title, wiki, include_html = false }) => {
      const result = await orchestrator.getPage(title, { wiki, includeHtml: include_html });

      if (!result.page) {
        return {
          content: [{ type: 'text', text: `Page "${title}" not found on ${result.wiki}` }]
        };
      }

      const p = result.page;
      const content = include_html && result.html ? result.html : (p.source || '');

      let text = `# ${p.title}\n`;
      text += `**Wiki:** ${result.wiki}\n`;
      text += `**Page ID:** ${p.id} | **Last modified:** ${p.latest.timestamp}\n`;
      text += `**Content model:** ${p.content_model}\n\n`;
      text += `---\n\n${content}`;

      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'create-page',
    {
      title: 'Create Page',
      description: 'Create a new wiki page with the given title and wikitext content.',
      inputSchema: {
        title: z.string().describe('Page title'),
        content: z.string().describe('Page content in wikitext format'),
        summary: z.string().describe('Edit summary explaining the creation'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)')
      }
    },
    async ({ title, content, summary, wiki }) => {
      const result = await orchestrator.createPage(title, content, summary, { wiki });

      let text = `Page "${result.page.title}" created on ${result.wiki}\n`;
      text += `Page ID: ${result.page.id}`;

      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'update-page',
    {
      title: 'Update Page',
      description: 'Update an existing wiki page. Requires the latest timestamp to prevent edit conflicts. Get the timestamp from get-page first.',
      inputSchema: {
        title: z.string().describe('Page title'),
        content: z.string().describe('New page content in wikitext format'),
        summary: z.string().describe('Edit summary explaining the change'),
        latest_timestamp: z.string().describe('Timestamp of the latest revision (from get-page) to detect edit conflicts'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)')
      }
    },
    async ({ title, content, summary, latest_timestamp, wiki }) => {
      const result = await orchestrator.updatePage(title, content, summary, latest_timestamp, { wiki });

      return {
        content: [{ type: 'text', text: `Page "${result.page.title}" updated on ${result.wiki}` }]
      };
    }
  );

  server.registerTool(
    'delete-page',
    {
      title: 'Delete Page',
      description: 'Delete a wiki page. Requires appropriate permissions.',
      inputSchema: {
        title: z.string().describe('Page title to delete'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)')
      }
    },
    async ({ title, wiki }) => {
      const result = await orchestrator.deletePage(title, { wiki });
      return {
        content: [{ type: 'text', text: `Page "${title}" deleted from ${result.wiki}` }]
      };
    }
  );

  server.registerTool(
    'undelete-page',
    {
      title: 'Undelete Page',
      description: 'Restore a previously deleted wiki page. Requires appropriate permissions.',
      inputSchema: {
        title: z.string().describe('Page title to restore'),
        reason: z.string().optional().describe('Reason for restoring'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)')
      }
    },
    async ({ title, reason, wiki }) => {
      const result = await orchestrator.undeletePage(title, reason, { wiki });
      return {
        content: [{ type: 'text', text: `Page "${title}" restored on ${result.wiki}` }]
      };
    }
  );
}
```

**Step 2: Commit**

```bash
git add src/tools/page-tools.ts
git commit -m "feat: add page CRUD tools (get, create, update, delete, undelete)"
```

---

### Task 10: MCP Tool Registration — History, Category, Link, File, Activity Tools

**Files:**
- Create: `src/tools/history-tools.ts`
- Create: `src/tools/category-tools.ts`
- Create: `src/tools/link-tools.ts`
- Create: `src/tools/file-tools.ts`
- Create: `src/tools/activity-tools.ts`

**Step 1: Implement history-tools.ts**

Create `src/tools/history-tools.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerHistoryTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.registerTool(
    'get-page-history',
    {
      title: 'Get Page History',
      description: 'Get the revision history for a page. Supports pagination with older_than.',
      inputSchema: {
        title: z.string().describe('Page title'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)'),
        limit: z.number().optional().default(20).describe('Number of revisions to return'),
        older_than: z.number().optional().describe('Revision ID to paginate from (get revisions older than this)')
      }
    },
    async ({ title, wiki, limit = 20, older_than }) => {
      const result = await orchestrator.getPageHistory(title, { wiki, limit, olderThan: older_than });
      const revisions = result.history.revisions;

      if (revisions.length === 0) {
        return {
          content: [{ type: 'text', text: `No revision history found for "${title}" on ${result.wiki}` }]
        };
      }

      let text = `# Revision History: ${title} (${result.wiki})\n\n`;

      for (const rev of revisions) {
        const delta = rev.delta != null ? (rev.delta > 0 ? ` (+${rev.delta})` : ` (${rev.delta})`) : '';
        text += `- **Rev ${rev.id}** — ${rev.timestamp}${rev.minor ? ' (minor)' : ''}\n`;
        text += `  By: ${rev.user.name} | Size: ${rev.size}${delta}\n`;
        text += `  ${rev.comment || 'No comment'}\n\n`;
      }

      if (result.history.older) {
        const lastRevId = revisions[revisions.length - 1].id;
        text += `---\nMore revisions available. Use older_than: ${lastRevId} to see more.\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'get-revision',
    {
      title: 'Get Revision',
      description: 'Get details of a specific revision by ID.',
      inputSchema: {
        revision_id: z.number().describe('Revision ID'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)')
      }
    },
    async ({ revision_id, wiki }) => {
      const result = await orchestrator.getRevision(revision_id, { wiki });
      const rev = result.revision;

      let text = `# Revision ${rev.id}\n`;
      text += `**Wiki:** ${result.wiki}\n`;
      text += `**Page:** ${rev.page.title} (ID: ${rev.page.id})\n`;
      text += `**Timestamp:** ${rev.timestamp}\n`;
      text += `**User:** ${rev.user.name}\n`;
      text += `**Size:** ${rev.size}${rev.delta != null ? ` (${rev.delta > 0 ? '+' : ''}${rev.delta})` : ''}\n`;
      text += `**Comment:** ${rev.comment || 'No comment'}\n`;
      text += `**Minor:** ${rev.minor ? 'Yes' : 'No'}\n`;

      return { content: [{ type: 'text', text }] };
    }
  );
}
```

**Step 2: Implement category-tools.ts**

Create `src/tools/category-tools.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerCategoryTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.registerTool(
    'list-categories',
    {
      title: 'List Categories',
      description: 'List categories across all wikis, or filter to a specific wiki. Supports prefix filtering and pagination.',
      inputSchema: {
        wiki: z.string().optional().describe('Wiki name (omit to list from all wikis)'),
        prefix: z.string().optional().describe('Filter categories by name prefix'),
        limit: z.number().optional().default(50).describe('Max categories to return per wiki'),
        continue_from: z.string().optional().describe('Continuation token for pagination')
      }
    },
    async ({ wiki, prefix, limit = 50, continue_from }) => {
      const result = await orchestrator.listCategories({ wiki, prefix, limit, continueFrom: continue_from });

      const totalItems = result.results.reduce((sum, r) => sum + r.items.length, 0);
      if (totalItems === 0) {
        return { content: [{ type: 'text', text: 'No categories found' }] };
      }

      let text = `Found ${totalItems} categories:\n\n`;

      for (const wikiResult of result.results) {
        if (wikiResult.error) continue;
        for (const cat of wikiResult.items) {
          const label = wiki ? '' : `[${wikiResult.wiki}] `;
          text += `- ${label}**${cat.category}** — ${cat.pages} pages, ${cat.files} files, ${cat.subcats} subcategories\n`;
        }
      }

      if (result.warnings.length > 0) {
        text += `\n---\nWarnings:\n`;
        for (const w of result.warnings) text += `- ${w}\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'get-category-members',
    {
      title: 'Get Category Members',
      description: 'List pages in a specific category. Supports pagination.',
      inputSchema: {
        category: z.string().describe('Category name (with or without "Category:" prefix)'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)'),
        type: z.enum(['page', 'subcat', 'file']).optional().describe('Filter by member type'),
        limit: z.number().optional().default(50).describe('Max members to return'),
        continue_from: z.string().optional().describe('Continuation token for pagination')
      }
    },
    async ({ category, wiki, type, limit = 50, continue_from }) => {
      const result = await orchestrator.getCategoryMembers(category, {
        wiki, type, limit, continueFrom: continue_from
      });

      const members = result.members;
      if (members.items.length === 0) {
        return {
          content: [{ type: 'text', text: `No members found in category "${category}" on ${result.wiki}` }]
        };
      }

      let text = `# Category: ${category} (${result.wiki})\n`;
      text += `Showing ${members.items.length} members:\n\n`;

      for (const member of members.items) {
        text += `- **${member.title}** (modified: ${member.timestamp})\n`;
      }

      if (members.hasMore && members.continueFrom) {
        text += `\n---\nMore results available. Use continue_from: "${members.continueFrom}" to see more.\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );
}
```

**Step 3: Implement link-tools.ts**

Create `src/tools/link-tools.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerLinkTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.registerTool(
    'get-page-links',
    {
      title: 'Get Page Links',
      description: 'Get outgoing links from a page or backlinks to a page. Supports pagination.',
      inputSchema: {
        title: z.string().describe('Page title'),
        direction: z.enum(['from', 'to']).default('from').describe('Get links from this page or links to this page (backlinks)'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)'),
        limit: z.number().optional().default(50).describe('Max links to return'),
        continue_from: z.string().optional().describe('Continuation token for pagination')
      }
    },
    async ({ title, direction = 'from', wiki, limit = 50, continue_from }) => {
      const result = await orchestrator.getPageLinks(title, direction, {
        wiki, limit, continueFrom: continue_from
      });

      const links = result.links;
      if (links.items.length === 0) {
        const dir = direction === 'from' ? 'outgoing links from' : 'backlinks to';
        return {
          content: [{ type: 'text', text: `No ${dir} "${title}" on ${result.wiki}` }]
        };
      }

      const dir = direction === 'from' ? 'Links from' : 'Backlinks to';
      let text = `# ${dir}: ${title} (${result.wiki})\n`;
      text += `Found ${links.items.length} links:\n\n`;

      for (const link of links.items) {
        text += `- **${link.title}**\n`;
      }

      if (links.hasMore && links.continueFrom) {
        text += `\n---\nMore results available. Use continue_from: "${links.continueFrom}" to see more.\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );
}
```

**Step 4: Implement file-tools.ts**

Create `src/tools/file-tools.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerFileTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.registerTool(
    'get-file',
    {
      title: 'Get File Info',
      description: 'Get metadata and URLs for a file (image, document, etc.) on the wiki.',
      inputSchema: {
        title: z.string().describe('File title (e.g., "File:Example.png")'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)')
      }
    },
    async ({ title, wiki }) => {
      const result = await orchestrator.getFile(title, { wiki });

      if (!result.file) {
        return {
          content: [{ type: 'text', text: `File "${title}" not found on ${result.wiki}` }]
        };
      }

      const f = result.file;
      let text = `# ${f.title} (${result.wiki})\n\n`;
      text += `**Last modified:** ${f.latest.timestamp} by ${f.latest.user.name}\n`;

      if (f.original) {
        text += `\n## Original\n`;
        text += `- Type: ${f.original.mediatype}\n`;
        text += `- Size: ${f.original.size} bytes\n`;
        text += `- Dimensions: ${f.original.width}x${f.original.height}\n`;
        text += `- URL: ${f.original.url}\n`;
      }

      if (f.preferred && f.preferred.url !== f.original?.url) {
        text += `\n## Preferred\n`;
        text += `- Type: ${f.preferred.mediatype}\n`;
        text += `- Dimensions: ${f.preferred.width}x${f.preferred.height}\n`;
        text += `- URL: ${f.preferred.url}\n`;
      }

      text += `\n**Description page:** ${f.file_description_url}\n`;

      return { content: [{ type: 'text', text }] };
    }
  );

  server.registerTool(
    'upload-file',
    {
      title: 'Upload File',
      description: 'Upload a file to the wiki from base64-encoded data.',
      inputSchema: {
        filename: z.string().describe('Target filename on the wiki (e.g., "Diagram.png")'),
        data: z.string().describe('Base64-encoded file content'),
        description: z.string().describe('File description page wikitext'),
        comment: z.string().optional().describe('Upload comment'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)')
      }
    },
    async ({ filename, data, description, comment, wiki }) => {
      const buffer = Buffer.from(data, 'base64');
      const result = await orchestrator.uploadFile(filename, buffer, description, { wiki, comment });

      return {
        content: [{ type: 'text', text: `File "${result.filename}" uploaded to ${result.wiki} (${result.result})` }]
      };
    }
  );

  server.registerTool(
    'upload-file-from-url',
    {
      title: 'Upload File from URL',
      description: 'Upload a file to the wiki by providing a remote URL. The wiki server fetches the file directly.',
      inputSchema: {
        filename: z.string().describe('Target filename on the wiki'),
        url: z.string().url().describe('URL of the file to upload'),
        description: z.string().describe('File description page wikitext'),
        comment: z.string().optional().describe('Upload comment'),
        wiki: z.string().optional().describe('Wiki name (uses default wiki if omitted)')
      }
    },
    async ({ filename, url, description, comment, wiki }) => {
      const result = await orchestrator.uploadFromUrl(filename, url, description, { wiki, comment });

      return {
        content: [{ type: 'text', text: `File "${result.filename}" uploaded from URL to ${result.wiki} (${result.result})` }]
      };
    }
  );
}
```

**Step 5: Implement activity-tools.ts**

Create `src/tools/activity-tools.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerActivityTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.registerTool(
    'get-recent-changes',
    {
      title: 'Get Recent Changes',
      description: 'List recent changes across all wikis or a specific wiki. Includes edits, new pages, and deletions.',
      inputSchema: {
        wiki: z.string().optional().describe('Wiki name (omit to see changes from all wikis)'),
        limit: z.number().optional().default(20).describe('Max changes to return per wiki'),
        namespace: z.number().optional().describe('Filter by namespace ID'),
        type: z.enum(['edit', 'new', 'log']).optional().describe('Filter by change type'),
        continue_from: z.string().optional().describe('Continuation token for pagination')
      }
    },
    async ({ wiki, limit = 20, namespace, type, continue_from }) => {
      const result = await orchestrator.getRecentChanges({
        wiki, limit, namespace, type, continueFrom: continue_from
      });

      const totalItems = result.results.reduce((sum, r) => sum + r.items.length, 0);
      if (totalItems === 0) {
        return { content: [{ type: 'text', text: 'No recent changes found' }] };
      }

      let text = `# Recent Changes\n\n`;

      // Collect all changes with wiki labels and sort by timestamp
      const allChanges: Array<{ wiki: string; change: any }> = [];
      for (const wikiResult of result.results) {
        if (wikiResult.error) continue;
        for (const change of wikiResult.items) {
          allChanges.push({ wiki: wikiResult.wiki, change });
        }
      }

      allChanges.sort((a, b) =>
        new Date(b.change.timestamp).getTime() - new Date(a.change.timestamp).getTime()
      );

      for (const { wiki: wikiName, change } of allChanges) {
        const label = wiki ? '' : `[${wikiName}] `;
        const sizeDiff = change.newlen - change.oldlen;
        const diffText = sizeDiff > 0 ? `+${sizeDiff}` : `${sizeDiff}`;

        text += `- ${label}[${change.type.toUpperCase()}] **${change.title}** — ${change.timestamp}\n`;
        text += `  By: ${change.user} | ${diffText} bytes | ${change.comment || 'No comment'}\n\n`;
      }

      if (result.warnings.length > 0) {
        text += `---\nWarnings:\n`;
        for (const w of result.warnings) text += `- ${w}\n`;
      }

      return { content: [{ type: 'text', text }] };
    }
  );
}
```

**Step 6: Commit**

```bash
git add src/tools/history-tools.ts src/tools/category-tools.ts src/tools/link-tools.ts src/tools/file-tools.ts src/tools/activity-tools.ts
git commit -m "feat: add history, category, link, file, and activity tools"
```

---

### Task 11: Wire Up Entry Points

**Files:**
- Modify: `src/index.ts` (rewrite)
- Modify: `src/stdio.ts` (rewrite)
- Modify: `src/sse-transport.ts` (rewrite)

**Step 1: Rewrite index.ts**

```typescript
#!/usr/bin/env node

import { createStdioServer } from './stdio.js';
import { WikiRegistry } from './wiki-registry.js';

const registry = WikiRegistry.fromEnvironment(process.env as Record<string, string>);

createStdioServer(registry).catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
```

**Step 2: Rewrite stdio.ts**

```typescript
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WikiRegistry } from './wiki-registry.js';
import { WikiOrchestrator } from './wiki-orchestrator.js';
import { registerAllTools } from './tools/index.js';

export async function createStdioServer(registry: WikiRegistry): Promise<void> {
  const server = new McpServer({
    name: 'mediawiki-mcp',
    version: '2.0.0'
  });

  const orchestrator = new WikiOrchestrator(registry);
  registerAllTools(server, orchestrator);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  console.error('MediaWiki MCP server v2.0.0 running on stdio');
}
```

**Step 3: Rewrite sse-transport.ts**

```typescript
import express from 'express';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WikiRegistry } from './wiki-registry.js';
import { WikiOrchestrator } from './wiki-orchestrator.js';
import { registerAllTools } from './tools/index.js';

export async function createSSEServer(
  registry: WikiRegistry,
  port: number = 8009,
  host: string = 'localhost'
): Promise<void> {
  const app = express();

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'mediawiki-mcp', version: '2.0.0' });
  });

  app.get('/sse', async (req, res) => {
    console.log('New SSE connection');

    const server = new McpServer({
      name: 'mediawiki-mcp',
      version: '2.0.0'
    });

    const orchestrator = new WikiOrchestrator(registry);
    registerAllTools(server, orchestrator);

    const transport = new SSEServerTransport('/message', res);
    await server.connect(transport);

    req.on('close', () => {
      console.log('SSE connection closed');
    });
  });

  app.post('/message', express.json(), async (_req, res) => {
    res.status(202).end();
  });

  app.listen(port, host, () => {
    console.log(`MediaWiki MCP SSE server v2.0.0 on http://${host}:${port}`);
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const registry = WikiRegistry.fromEnvironment(process.env as Record<string, string>);
  const port = parseInt(process.env.MEDIAWIKI_MCP_PORT || '8009', 10);
  const host = process.env.MEDIAWIKI_MCP_HOST || 'localhost';

  createSSEServer(registry, port, host).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
```

**Step 4: Create tools/index.ts barrel**

Create `src/tools/index.ts`:
```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WikiOrchestrator } from '../wiki-orchestrator.js';
import { registerWikiTools } from './wiki-tools.js';
import { registerSearchTools } from './search-tools.js';
import { registerPageTools } from './page-tools.js';
import { registerHistoryTools } from './history-tools.js';
import { registerCategoryTools } from './category-tools.js';
import { registerLinkTools } from './link-tools.js';
import { registerFileTools } from './file-tools.js';
import { registerActivityTools } from './activity-tools.js';

export function registerAllTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  registerWikiTools(server, orchestrator);
  registerSearchTools(server, orchestrator);
  registerPageTools(server, orchestrator);
  registerHistoryTools(server, orchestrator);
  registerCategoryTools(server, orchestrator);
  registerLinkTools(server, orchestrator);
  registerFileTools(server, orchestrator);
  registerActivityTools(server, orchestrator);
}
```

**Step 5: Commit**

```bash
git add src/index.ts src/stdio.ts src/sse-transport.ts src/tools/index.ts
git commit -m "feat: wire up entry points with WikiOrchestrator and tool registry"
```

---

### Task 12: Delete Old Files and Build Verification

**Files:**
- Delete: `src/mediawiki-client.ts`
- Delete: `src/mediawiki-tools.ts`
- Modify: `package.json` (update description, version)

**Step 1: Remove old files**

```bash
rm src/mediawiki-client.ts src/mediawiki-tools.ts
```

**Step 2: Update package.json**

Change version to `2.0.0` and description to `MediaWiki MCP server with multi-wiki support and REST API`.

**Step 3: Install form-data dependency**

Run: `npm install form-data`

(Used by ActionClient for multipart file uploads.)

**Step 4: Build**

Run: `npm run build`
Expected: Clean compilation, no errors

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Remove trivial setup test**

```bash
rm tests/setup.test.ts
```

**Step 7: Commit**

```bash
git add -A
git commit -m "feat: complete v2.0.0 modernization — remove legacy code, update package"
```

---

## Summary

| Task | Description | Key Files |
|------|------------|-----------|
| 1 | Test infrastructure | vitest.config.ts, package.json |
| 2 | Types overhaul | src/types.ts |
| 3 | RestClient | src/clients/rest-client.ts |
| 4 | ActionClient | src/clients/action-client.ts |
| 5 | WikiRegistry | src/wiki-registry.ts |
| 6 | WikiOrchestrator | src/wiki-orchestrator.ts |
| 7 | Wiki management tools | src/tools/wiki-tools.ts |
| 8 | Search tools | src/tools/search-tools.ts |
| 9 | Page tools | src/tools/page-tools.ts |
| 10 | Remaining tools | src/tools/history,category,link,file,activity |
| 11 | Entry points | src/index.ts, src/stdio.ts, src/sse-transport.ts |
| 12 | Cleanup & build | Remove old files, verify build |
