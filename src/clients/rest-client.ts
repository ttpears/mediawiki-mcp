import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  RestPage,
  RestSearchResponse,
  RestRevision,
  RestRevisionList,
  RestFileInfo,
  MediaWikiApiError,
} from '../types.js';

export class RestClient {
  private readonly client: AxiosInstance;
  private readonly wikiName: string;
  private readonly maxRetries = 3;
  private retryDelayMs = 1000;
  private cookieProvider?: () => string[];

  constructor(wikiName: string, baseUrl: string) {
    this.wikiName = wikiName;

    this.client = axios.create({
      baseURL: `${baseUrl.replace(/\/+$/, '')}/rest.php/v1`,
      timeout: 30000,
      headers: {
        'User-Agent': 'MediaWiki-MCP/2.0.0',
        'Accept': 'application/json',
      },
    });

    // Send cookies with requests (shared from ActionClient login session)
    this.client.interceptors.request.use((config) => {
      if (this.cookieProvider) {
        const cookies = this.cookieProvider();
        if (cookies.length > 0) {
          config.headers['Cookie'] = cookies.join('; ');
        }
      }
      return config;
    });
  }

  /** Set a cookie provider so this client shares the ActionClient's session */
  setCookieProvider(provider: () => string[]): void {
    this.cookieProvider = provider;
  }

  /** Override retry delay for testing */
  setRetryDelay(ms: number): void {
    this.retryDelayMs = ms;
  }

  private async request<T>(method: string, url: string, data?: unknown): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.client.request<T>({ method, url, data });
        return response.data;
      } catch (err) {
        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;

        // Non-retryable 4xx (except 429)
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw new MediaWikiApiError(
            axiosErr.message,
            this.wikiName,
            `${method} ${url}`,
            status,
            (axiosErr.response?.data as Record<string, string>)?.errorKey
          );
        }

        lastError = axiosErr;

        // Retryable: 429 or 5xx
        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt - 1) * this.retryDelayMs;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    const axiosErr = lastError as AxiosError;
    throw new MediaWikiApiError(
      axiosErr?.message ?? 'Unknown error',
      this.wikiName,
      `${method} ${url}`,
      axiosErr?.response?.status,
      (axiosErr?.response?.data as Record<string, string>)?.errorKey
    );
  }

  private async requestOrNull<T>(method: string, url: string): Promise<T | null> {
    try {
      return await this.request<T>(method, url);
    } catch (err) {
      if (err instanceof MediaWikiApiError && err.statusCode === 404) {
        return null;
      }
      throw err;
    }
  }

  async getPage(title: string): Promise<RestPage | null> {
    return this.requestOrNull<RestPage>('GET', `/page/${encodeURIComponent(title)}`);
  }

  async getPageHtml(title: string): Promise<string | null> {
    return this.requestOrNull<string>('GET', `/page/${encodeURIComponent(title)}/html`);
  }

  async search(query: string, limit: number): Promise<RestSearchResponse> {
    return this.request<RestSearchResponse>(
      'GET',
      `/search/page?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  }

  async searchByPrefix(query: string, limit: number): Promise<RestSearchResponse> {
    return this.request<RestSearchResponse>(
      'GET',
      `/search/title?q=${encodeURIComponent(query)}&limit=${limit}`
    );
  }

  async createPage(title: string, source: string, comment: string): Promise<RestPage> {
    return this.request<RestPage>('POST', '/page', { title, source, comment });
  }

  async updatePage(
    title: string,
    source: string,
    comment: string,
    latestTimestamp: string
  ): Promise<RestPage> {
    return this.request<RestPage>('PUT', `/page/${encodeURIComponent(title)}`, {
      source,
      comment,
      latest: { timestamp: latestTimestamp },
    });
  }

  async getPageHistory(
    title: string,
    limit?: number,
    olderThan?: string
  ): Promise<RestRevisionList> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (olderThan) params.set('older_than', olderThan);
    const qs = params.toString();
    const url = `/page/${encodeURIComponent(title)}/history${qs ? `?${qs}` : ''}`;
    return this.request<RestRevisionList>('GET', url);
  }

  async getRevision(revisionId: number): Promise<RestRevision> {
    return this.request<RestRevision>('GET', `/revision/${revisionId}`);
  }

  async getFile(title: string): Promise<RestFileInfo | null> {
    return this.requestOrNull<RestFileInfo>('GET', `/file/${encodeURIComponent(title)}`);
  }
}
