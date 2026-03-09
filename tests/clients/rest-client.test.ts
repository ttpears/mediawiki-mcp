import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { RestClient } from '../../src/clients/rest-client.js';
import { MediaWikiApiError } from '../../src/types.js';

vi.mock('axios');

const mockAxiosInstance = {
  request: vi.fn(),
  interceptors: {
    request: { use: vi.fn() },
  },
};

vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);

function createClient(): RestClient {
  const client = new RestClient('testwiki', 'https://wiki.example.com');
  client.setRetryDelay(0);
  return client;
}

describe('RestClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(axios.create).mockReturnValue(mockAxiosInstance as any);
  });

  describe('constructor', () => {
    it('creates axios instance with correct config', () => {
      createClient();
      expect(axios.create).toHaveBeenCalledWith({
        baseURL: 'https://wiki.example.com/rest.php/v1',
        timeout: 30000,
        headers: {
          'User-Agent': 'MediaWiki-MCP/2.0.0',
          'Accept': 'application/json',
        },
      });
    });

    it('strips trailing slashes from baseUrl', () => {
      new RestClient('testwiki', 'https://wiki.example.com///');
      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          baseURL: 'https://wiki.example.com/rest.php/v1',
        })
      );
    });
  });

  describe('getPage', () => {
    it('returns page data on success', async () => {
      const pageData = {
        id: 1,
        key: 'Test_Page',
        title: 'Test Page',
        latest: { id: 10, timestamp: '2024-01-01T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: 'https://license.example.com', title: 'CC' },
        source: 'Hello world',
      };
      mockAxiosInstance.request.mockResolvedValueOnce({ data: pageData });

      const client = createClient();
      const result = await client.getPage('Test Page');

      expect(result).toEqual(pageData);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/page/Test%20Page',
        data: undefined,
      });
    });

    it('returns null on 404', async () => {
      const error = {
        response: { status: 404, data: {} },
        message: 'Not found',
        isAxiosError: true,
      };
      mockAxiosInstance.request.mockRejectedValueOnce(error);

      const client = createClient();
      const result = await client.getPage('Nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('getPageHtml', () => {
    it('returns HTML string on success', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({ data: '<p>Hello</p>' });

      const client = createClient();
      const result = await client.getPageHtml('Test Page');

      expect(result).toBe('<p>Hello</p>');
    });

    it('returns null on 404', async () => {
      const error = {
        response: { status: 404, data: {} },
        message: 'Not found',
        isAxiosError: true,
      };
      mockAxiosInstance.request.mockRejectedValueOnce(error);

      const client = createClient();
      const result = await client.getPageHtml('Nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('search', () => {
    it('returns search results', async () => {
      const searchData = {
        pages: [
          {
            id: 1,
            key: 'Test',
            title: 'Test',
            excerpt: 'A test page',
            matched_title: null,
            description: null,
            thumbnail: null,
          },
        ],
      };
      mockAxiosInstance.request.mockResolvedValueOnce({ data: searchData });

      const client = createClient();
      const result = await client.search('test', 10);

      expect(result).toEqual(searchData);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/search/page?q=test&limit=10',
        data: undefined,
      });
    });
  });

  describe('searchByPrefix', () => {
    it('returns prefix search results', async () => {
      const searchData = { pages: [] };
      mockAxiosInstance.request.mockResolvedValueOnce({ data: searchData });

      const client = createClient();
      const result = await client.searchByPrefix('tes', 5);

      expect(result).toEqual(searchData);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/search/title?q=tes&limit=5',
        data: undefined,
      });
    });
  });

  describe('createPage', () => {
    it('creates a page and returns result', async () => {
      const pageData = {
        id: 2,
        key: 'New_Page',
        title: 'New Page',
        latest: { id: 1, timestamp: '2024-01-01T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: 'https://license.example.com', title: 'CC' },
        source: 'Content here',
      };
      mockAxiosInstance.request.mockResolvedValueOnce({ data: pageData });

      const client = createClient();
      const result = await client.createPage('New Page', 'Content here', 'Initial creation');

      expect(result).toEqual(pageData);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'POST',
        url: '/page',
        data: { title: 'New Page', source: 'Content here', comment: 'Initial creation' },
      });
    });
  });

  describe('updatePage', () => {
    it('updates a page and returns result', async () => {
      const pageData = {
        id: 1,
        key: 'Test_Page',
        title: 'Test Page',
        latest: { id: 11, timestamp: '2024-01-02T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: 'https://license.example.com', title: 'CC' },
        source: 'Updated content',
      };
      mockAxiosInstance.request.mockResolvedValueOnce({ data: pageData });

      const client = createClient();
      const result = await client.updatePage(
        'Test Page',
        'Updated content',
        'Editing',
        '2024-01-01T00:00:00Z'
      );

      expect(result).toEqual(pageData);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'PUT',
        url: '/page/Test%20Page',
        data: {
          source: 'Updated content',
          comment: 'Editing',
          latest: { timestamp: '2024-01-01T00:00:00Z' },
        },
      });
    });
  });

  describe('getPageHistory', () => {
    it('returns revision list', async () => {
      const historyData = {
        revisions: [
          {
            id: 10,
            page: { id: 1, key: 'Test', title: 'Test' },
            size: 100,
            minor: false,
            timestamp: '2024-01-01T00:00:00Z',
            user: { id: 1, name: 'Admin' },
            comment: 'edit',
            delta: 100,
          },
        ],
        latest: '10',
      };
      mockAxiosInstance.request.mockResolvedValueOnce({ data: historyData });

      const client = createClient();
      const result = await client.getPageHistory('Test', 20);

      expect(result).toEqual(historyData);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/page/Test/history?limit=20',
        data: undefined,
      });
    });

    it('includes older_than param when provided', async () => {
      mockAxiosInstance.request.mockResolvedValueOnce({
        data: { revisions: [], latest: '1' },
      });

      const client = createClient();
      await client.getPageHistory('Test', 10, '5');

      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/page/Test/history?limit=10&older_than=5',
        data: undefined,
      });
    });
  });

  describe('getRevision', () => {
    it('returns revision data', async () => {
      const revData = {
        id: 10,
        page: { id: 1, key: 'Test', title: 'Test' },
        size: 100,
        minor: false,
        timestamp: '2024-01-01T00:00:00Z',
        user: { id: 1, name: 'Admin' },
        comment: 'edit',
        delta: 100,
      };
      mockAxiosInstance.request.mockResolvedValueOnce({ data: revData });

      const client = createClient();
      const result = await client.getRevision(10);

      expect(result).toEqual(revData);
      expect(mockAxiosInstance.request).toHaveBeenCalledWith({
        method: 'GET',
        url: '/revision/10',
        data: undefined,
      });
    });
  });

  describe('getFile', () => {
    it('returns file info on success', async () => {
      const fileData = {
        title: 'File:Test.png',
        file_description_url: 'https://wiki.example.com/wiki/File:Test.png',
        latest: {
          timestamp: '2024-01-01T00:00:00Z',
          user: { id: 1, name: 'Admin' },
        },
        preferred: {
          mediatype: 'BITMAP',
          size: 1024,
          width: 800,
          height: 600,
          duration: null,
          url: 'https://wiki.example.com/images/test.png',
        },
        original: {
          mediatype: 'BITMAP',
          size: 2048,
          width: 1600,
          height: 1200,
          duration: null,
          url: 'https://wiki.example.com/images/test_original.png',
        },
      };
      mockAxiosInstance.request.mockResolvedValueOnce({ data: fileData });

      const client = createClient();
      const result = await client.getFile('File:Test.png');

      expect(result).toEqual(fileData);
    });

    it('returns null on 404', async () => {
      const error = {
        response: { status: 404, data: {} },
        message: 'Not found',
        isAxiosError: true,
      };
      mockAxiosInstance.request.mockRejectedValueOnce(error);

      const client = createClient();
      const result = await client.getFile('File:Missing.png');

      expect(result).toBeNull();
    });
  });

  describe('retry logic', () => {
    it('retries on 429 and succeeds', async () => {
      const error429 = {
        response: { status: 429, data: {} },
        message: 'Too Many Requests',
        isAxiosError: true,
      };
      const pageData = {
        id: 1,
        key: 'Test',
        title: 'Test',
        latest: { id: 1, timestamp: '2024-01-01T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: '', title: '' },
      };

      mockAxiosInstance.request
        .mockRejectedValueOnce(error429)
        .mockResolvedValueOnce({ data: pageData });

      const client = createClient();
      const result = await client.getPage('Test');

      expect(result).toEqual(pageData);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(2);
    });

    it('retries on 5xx and succeeds', async () => {
      const error500 = {
        response: { status: 500, data: {} },
        message: 'Internal Server Error',
        isAxiosError: true,
      };
      const pageData = {
        id: 1,
        key: 'Test',
        title: 'Test',
        latest: { id: 1, timestamp: '2024-01-01T00:00:00Z' },
        content_model: 'wikitext',
        license: { url: '', title: '' },
      };

      mockAxiosInstance.request
        .mockRejectedValueOnce(error500)
        .mockRejectedValueOnce(error500)
        .mockResolvedValueOnce({ data: pageData });

      const client = createClient();
      const result = await client.getPage('Test');

      expect(result).toEqual(pageData);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3);
    });

    it('throws after exhausting retries on 5xx', async () => {
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
      await expect(client.search('test', 10)).rejects.toThrow(MediaWikiApiError);
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
      await expect(client.createPage('Test', '', 'comment')).rejects.toThrow(MediaWikiApiError);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });

    it('does not retry on 403', async () => {
      const error403 = {
        response: { status: 403, data: {} },
        message: 'Forbidden',
        isAxiosError: true,
      };

      mockAxiosInstance.request.mockRejectedValueOnce(error403);

      const client = createClient();
      await expect(client.search('test', 10)).rejects.toThrow(MediaWikiApiError);
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(1);
    });
  });
});
