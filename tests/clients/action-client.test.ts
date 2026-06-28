import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { ActionClient } from '../../src/clients/action-client.js';
import { MediaWikiApiError } from '../../src/types.js';

vi.mock('axios');

const mockAxiosInstance = {
  request: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
    response: { use: vi.fn() },
  },
};

vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);

function createClient(): ActionClient {
  const client = new ActionClient('testwiki', 'https://wiki.example.com');
  client.setRetryDelay(0);
  return client;
}

describe('ActionClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
  });

  describe('constructor', () => {
    it('creates axios instance with correct config', () => {
      createClient();
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://wiki.example.com/api.php',
        timeout: 30000,
        headers: {
          'User-Agent': 'MediaWiki-MCP/2.0.0',
          'Accept': 'application/json',
        },
      });
    });

  });

  describe('listCategories', () => {
    it('returns categories', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            allcategories: [
              { category: 'Animals', size: 10, pages: 8, files: 1, subcats: 1 },
              { category: 'Birds', size: 5, pages: 4, files: 0, subcats: 1 },
            ],
          },
        },
      });

      const client = createClient();
      const result = await client.listCategories(undefined, 10);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].category).toBe('Animals');
      expect(result.hasMore).toBe(false);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'GET',
          params: expect.objectContaining({
            action: 'query',
            list: 'allcategories',
            format: 'json',
            formatversion: 2,
          }),
        })
      );
    });

    it('follows continuation tokens to accumulate results', async () => {
      // First page returns 2 items with continue token
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            allcategories: [
              { category: 'Animals', size: 10, pages: 8, files: 1, subcats: 1 },
              { category: 'Birds', size: 5, pages: 4, files: 0, subcats: 1 },
            ],
          },
          continue: { accontinue: 'Cats' },
        },
      });

      // Second page returns 1 item, no continue
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            allcategories: [
              { category: 'Cats', size: 3, pages: 3, files: 0, subcats: 0 },
            ],
          },
        },
      });

      const client = createClient();
      const result = await client.listCategories(undefined, 5);

      expect(result.items).toHaveLength(3);
      expect(result.items[2].category).toBe('Cats');
      expect(result.hasMore).toBe(false);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });
  });

  describe('getCategoryMembers', () => {
    it('prepends Category: prefix if not present', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            categorymembers: [
              { pageid: 1, ns: 0, title: 'Cat', timestamp: '2024-01-01T00:00:00Z' },
            ],
          },
        },
      });

      const client = createClient();
      await client.getCategoryMembers('Animals', 10);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            cmtitle: 'Category:Animals',
          }),
        })
      );
    });

    it('does not double-prepend Category: prefix', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            categorymembers: [
              { pageid: 1, ns: 0, title: 'Cat', timestamp: '2024-01-01T00:00:00Z' },
            ],
          },
        },
      });

      const client = createClient();
      await client.getCategoryMembers('Category:Animals', 10);

      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          params: expect.objectContaining({
            cmtitle: 'Category:Animals',
          }),
        })
      );
    });

    it('returns paginated result with continue token', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            categorymembers: [
              { pageid: 1, ns: 0, title: 'Cat', timestamp: '2024-01-01T00:00:00Z' },
            ],
          },
          continue: { cmcontinue: 'page|next' },
        },
      });

      const client = createClient();
      const result = await client.getCategoryMembers('Animals', 1);

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(true);
      expect(result.continueFrom).toBe('page|next');
    });
  });

  describe('getRecentChanges', () => {
    it('returns recent changes', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            recentchanges: [
              {
                type: 'edit',
                title: 'Test Page',
                pageid: 1,
                revid: 100,
                old_revid: 99,
                rcid: 200,
                user: 'Admin',
                timestamp: '2024-01-01T00:00:00Z',
                comment: 'edited',
                oldlen: 50,
                newlen: 60,
              },
            ],
          },
        },
      });

      const client = createClient();
      const result = await client.getRecentChanges(10);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Test Page');
      expect(result.hasMore).toBe(false);
    });
  });

  describe('getPageLinks', () => {
    it('returns links for a page', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            pages: [
              {
                links: [
                  { ns: 0, title: 'Linked Page' },
                  { ns: 0, title: 'Another Page' },
                ],
              },
            ],
          },
        },
      });

      const client = createClient();
      const result = await client.getPageLinks('Test Page', 10);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].title).toBe('Linked Page');
      expect(result.hasMore).toBe(false);
    });

    it('returns empty when page has no links', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            pages: [{}],
          },
        },
      });

      const client = createClient();
      const result = await client.getPageLinks('Empty Page', 10);

      expect(result.items).toHaveLength(0);
    });
  });

  describe('getBacklinks', () => {
    it('returns backlinks for a page', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            backlinks: [
              { pageid: 5, ns: 0, title: 'Referring Page' },
            ],
          },
        },
      });

      const client = createClient();
      const result = await client.getBacklinks('Test Page', 10);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Referring Page');
    });
  });

  describe('deletePage (CSRF token)', () => {
    it('fetches CSRF token and deletes page', async () => {
      // First call: fetch CSRF token
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: { tokens: { csrftoken: 'abc123+\\' } },
        },
      });

      // Second call: delete action
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          delete: { title: 'Old Page' },
        },
      });

      const client = createClient();
      await client.deletePage('Old Page');

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);

      // Verify token fetch
      expect(mockAxiosInstance.request).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          method: 'GET',
          params: expect.objectContaining({
            action: 'query',
            meta: 'tokens',
            type: 'csrf',
          }),
        })
      );

      // Verify delete POST includes token in body
      const deleteCall = mockAxiosInstance.request.mock.calls[1][0];
      expect(deleteCall.method).toBe('POST');
      expect(deleteCall.data).toContain('token=abc123');
      expect(deleteCall.data).toContain('title=Old+Page');
    });

    it('caches CSRF token for subsequent calls', async () => {
      // Token fetch
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: { tokens: { csrftoken: 'cached-token+\\' } },
        },
      });
      // First delete
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: { delete: { title: 'Page1' } },
      });
      // Second delete (no token fetch needed)
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: { delete: { title: 'Page2' } },
      });

      const client = createClient();
      await client.deletePage('Page1');
      await client.deletePage('Page2');

      // 1 token fetch + 2 deletes = 3 calls (not 4)
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });
  });

  describe('uploadFromUrl', () => {
    it('uploads file from URL with CSRF token', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: { tokens: { csrftoken: 'upload-token+\\' } },
        },
      });

      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          upload: { result: 'Success', filename: 'Test.png' },
        },
      });

      const client = createClient();
      const result = await client.uploadFromUrl(
        'Test.png',
        'https://example.com/image.png',
        'File description',
        'Upload comment'
      );

      expect(result.result).toBe('Success');
      expect(result.filename).toBe('Test.png');
    });
  });

  describe('uploadFile', () => {
    it('uploads file with multipart form data', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: { tokens: { csrftoken: 'upload-token+\\' } },
        },
      });

      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          upload: { result: 'Success', filename: 'Test.png' },
        },
      });

      const client = createClient();
      const result = await client.uploadFile(
        'Test.png',
        Buffer.from('fake-image-data'),
        'File description',
        'Upload comment'
      );

      expect(result.result).toBe('Success');
      expect(result.filename).toBe('Test.png');

      // Verify the upload call used multipart headers
      const uploadCall = mockAxiosInstance.request.mock.calls[1][0];
      expect(uploadCall.method).toBe('POST');
      expect(uploadCall.headers).toHaveProperty('content-type');
      expect(uploadCall.headers['content-type']).toContain('multipart/form-data');
    });
  });

  describe('undeletePage', () => {
    it('undeletes page with reason', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: { tokens: { csrftoken: 'undelete-token+\\' } },
        },
      });

      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          undelete: { title: 'Restored Page' },
        },
      });

      const client = createClient();
      await client.undeletePage('Restored Page', 'Restoring useful content');

      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
      const undeleteCall = mockAxiosInstance.request.mock.calls[1][0];
      expect(undeleteCall.method).toBe('POST');
      expect(undeleteCall.data).toContain('title=Restored+Page');
      expect(undeleteCall.data).toContain('reason=Restoring+useful+content');
    });
  });

  describe('retry logic', () => {
    it('retries on 429 and succeeds', async () => {
      const error429 = {
        response: { status: 429, data: {} },
        message: 'Too Many Requests',
        isAxiosError: true,
      };

      mockAxiosInstance.request
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({
          data: {
            query: {
              recentchanges: [],
            },
          },
        });

      const client = createClient();
      const result = await client.getRecentChanges(10);

      expect(result.items).toHaveLength(0);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('throws after exhausting retries', async () => {
      const error500 = {
        response: { status: 500, data: {} },
        message: 'Internal Server Error',
        isAxiosError: true,
      };

      mockAxiosInstance.request
        .mockRejectedValueOnce(error500)
        .mockRejectedValueOnce(error500)
        .mockRejectedValueOnce(error500);

      const client = createClient();
      await expect(client.getRecentChanges(10)).rejects.toThrow(MediaWikiApiError);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });

    it('does not retry on 400', async () => {
      const error400 = {
        response: { status: 400, data: { errorKey: 'bad-request' } },
        message: 'Bad Request',
        isAxiosError: true,
      };

      mockAxiosInstance.request.mockRejectedValueOnce(error400);

      const client = createClient();
      await expect(client.getRecentChanges(10)).rejects.toThrow(MediaWikiApiError);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });
  });

  describe('resolveTitle', () => {
    it('returns canonical page for an exact title', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            pages: [{ pageid: 42, ns: 0, title: 'Pricing' }],
          },
        },
      });

      const client = createClient();
      const result = await client.resolveTitle('Pricing');

      expect(result).toEqual({ title: 'Pricing', pageid: 42, redirectedFrom: undefined });
    });

    it('follows redirects and records the original input', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            redirects: [{ from: 'USA', to: 'United States' }],
            pages: [{ pageid: 1, ns: 0, title: 'United States' }],
          },
        },
      });

      const client = createClient();
      const result = await client.resolveTitle('USA');

      expect(result).toEqual({ title: 'United States', pageid: 1, redirectedFrom: 'USA' });
    });

    it('returns null when the page is missing', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: {
          query: {
            pages: [{ ns: 0, title: 'Nonexistent', missing: true }],
          },
        },
      });

      const client = createClient();
      const result = await client.resolveTitle('Nonexistent');

      expect(result).toBeNull();
    });
  });
});
