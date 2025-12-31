import axios, { AxiosInstance } from 'axios';
import type {
  MediaWikiConfig,
  SearchResult,
  PageContent,
  Revision,
  Category,
  CategoryMember,
  RecentChange
} from './types.js';

/**
 * MediaWiki API Client
 * Handles all HTTP interactions with MediaWiki API
 */
export class MediaWikiClient {
  private axios: AxiosInstance;
  private baseUrl: string;
  private apiEndpoint: string;

  constructor(config: MediaWikiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.apiEndpoint = `${this.baseUrl}/api.php`;

    this.axios = axios.create({
      baseURL: this.apiEndpoint,
      timeout: 30000,
      headers: {
        'User-Agent': 'MediaWiki-MCP/1.0.0',
        'Accept': 'application/json'
      }
    });

    // Future: Add authentication if credentials provided
    if (config.apiToken) {
      this.axios.defaults.headers.common['Authorization'] =
        `Bearer ${config.apiToken}`;
    }
  }

  /**
   * Helper method to make API requests
   */
  private async apiRequest<T>(params: Record<string, any>): Promise<T> {
    try {
      const response = await this.axios.get('', {
        params: {
          format: 'json',
          formatversion: 2, // Use modern format
          ...params
        }
      });
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        throw new Error(
          `MediaWiki API error: ${error.response?.data?.error?.info || error.message}`
        );
      }
      throw error;
    }
  }

  /**
   * Search for pages
   */
  async searchPages(
    query: string,
    limit: number = 10,
    namespace?: number
  ): Promise<SearchResult[]> {
    const params: any = {
      action: 'query',
      list: 'search',
      srsearch: query,
      srlimit: limit,
      srprop: 'snippet|timestamp|wordcount|size'
    };

    if (namespace !== undefined) {
      params.srnamespace = namespace;
    }

    const data = await this.apiRequest<any>(params);
    return data.query?.search || [];
  }

  /**
   * Get page content and metadata
   */
  async getPage(title: string): Promise<PageContent | null> {
    const data = await this.apiRequest<any>({
      action: 'query',
      titles: title,
      prop: 'revisions|info|categories',
      rvprop: 'content|timestamp|user|comment',
      rvslots: 'main',
      rvlimit: 1
    });

    const pages = data.query?.pages;
    if (!pages || pages.length === 0) return null;

    const page = pages[0];
    if (page.missing) return null;

    const revision = page.revisions?.[0];
    const content = revision?.slots?.main?.content || '';

    return {
      pageid: page.pageid,
      title: page.title,
      content: content,
      timestamp: revision?.timestamp || '',
      user: revision?.user || '',
      comment: revision?.comment || '',
      categories: page.categories?.map((c: any) => c.title) || [],
      size: page.length || 0
    };
  }

  /**
   * Get parsed HTML for a page
   */
  async getParsedPage(title: string): Promise<string> {
    const data = await this.apiRequest<any>({
      action: 'parse',
      page: title,
      prop: 'text'
    });

    return data.parse?.text || '';
  }

  /**
   * Get page revision history
   */
  async getPageHistory(title: string, limit: number = 20): Promise<Revision[]> {
    const data = await this.apiRequest<any>({
      action: 'query',
      titles: title,
      prop: 'revisions',
      rvlimit: limit,
      rvprop: 'ids|timestamp|user|comment|size|flags'
    });

    const pages = data.query?.pages;
    if (!pages || pages.length === 0) return [];

    const page = pages[0];
    return page.revisions || [];
  }

  /**
   * List all categories
   */
  async listCategories(prefix?: string, limit: number = 20): Promise<Category[]> {
    const params: any = {
      action: 'query',
      list: 'allcategories',
      aclimit: limit,
      acprop: 'size'
    };

    if (prefix) {
      params.acprefix = prefix;
    }

    const data = await this.apiRequest<any>(params);
    return data.query?.allcategories || [];
  }

  /**
   * Get category members
   */
  async getCategoryMembers(
    category: string,
    limit: number = 50,
    type?: string
  ): Promise<CategoryMember[]> {
    const categoryTitle = category.startsWith('Category:')
      ? category
      : `Category:${category}`;

    const params: any = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: categoryTitle,
      cmlimit: limit,
      cmprop: 'ids|title|timestamp'
    };

    if (type) {
      params.cmtype = type;
    }

    const data = await this.apiRequest<any>(params);
    return data.query?.categorymembers || [];
  }

  /**
   * Get recent changes
   */
  async getRecentChanges(
    limit: number = 20,
    namespace?: number,
    type?: string
  ): Promise<RecentChange[]> {
    const params: any = {
      action: 'query',
      list: 'recentchanges',
      rclimit: limit,
      rcprop: 'title|ids|sizes|flags|user|timestamp|comment'
    };

    if (namespace !== undefined) {
      params.rcnamespace = namespace;
    }

    if (type) {
      params.rctype = type;
    }

    const data = await this.apiRequest<any>(params);
    return data.query?.recentchanges || [];
  }

  /**
   * Get links from a page
   */
  async getPageLinks(title: string, limit: number = 50): Promise<string[]> {
    const data = await this.apiRequest<any>({
      action: 'query',
      titles: title,
      prop: 'links',
      pllimit: limit
    });

    const pages = data.query?.pages;
    if (!pages || pages.length === 0) return [];

    const page = pages[0];
    return page.links?.map((l: any) => l.title) || [];
  }

  /**
   * Get backlinks to a page
   */
  async getBacklinks(title: string, limit: number = 50): Promise<string[]> {
    const data = await this.apiRequest<any>({
      action: 'query',
      list: 'backlinks',
      bltitle: title,
      bllimit: limit
    });

    return data.query?.backlinks?.map((b: any) => b.title) || [];
  }

  /**
   * Helper to generate page URL
   */
  getPageUrl(title: string): string {
    const encodedTitle = encodeURIComponent(title.replace(/ /g, '_'));
    return `${this.baseUrl}/index.php/${encodedTitle}`;
  }

  /**
   * Helper to format timestamp
   */
  formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  }
}
