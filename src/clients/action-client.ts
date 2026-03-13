import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import {
  ActionCategory,
  ActionCategoryMember,
  ActionRecentChange,
  ActionLink,
  ActionBacklink,
  PaginatedResult,
  MediaWikiApiError,
} from '../types.js';

export class ActionClient {
  private readonly client: AxiosInstance;
  private readonly wikiName: string;
  private readonly maxRetries = 3;
  private retryDelayMs = 1000;
  private csrfToken: string | null = null;
  private cookies: string[] = [];
  private loggedIn = false;
  private readonly username?: string;
  private readonly password?: string;

  constructor(wikiName: string, baseUrl: string, username?: string, password?: string) {
    this.wikiName = wikiName;
    this.username = username;
    this.password = password;

    this.client = axios.create({
      baseURL: `${baseUrl.replace(/\/+$/, '')}/api.php`,
      timeout: 30000,
      headers: {
        'User-Agent': 'MediaWiki-MCP/2.0.0',
        'Accept': 'application/json',
      },
    });

    // Capture cookies from responses
    this.client.interceptors.response.use((response) => {
      const setCookies = response.headers['set-cookie'];
      if (setCookies) {
        for (const cookie of setCookies) {
          const name = cookie.split('=')[0];
          // Replace existing cookie with same name, or add new
          this.cookies = this.cookies.filter(c => !c.startsWith(name + '='));
          this.cookies.push(cookie.split(';')[0]);
        }
      }
      return response;
    });

    // Send cookies with requests
    this.client.interceptors.request.use((config) => {
      if (this.cookies.length > 0) {
        config.headers['Cookie'] = this.cookies.join('; ');
      }
      return config;
    });
  }

  async login(): Promise<void> {
    if (!this.username || !this.password) return;
    if (this.loggedIn) return;

    // Step 1: Get login token
    const tokenResponse = await this.client.request<{
      query: { tokens: { logintoken: string } };
    }>({
      method: 'GET',
      params: { action: 'query', meta: 'tokens', type: 'login', format: 'json', formatversion: 2 },
    });

    const loginToken = tokenResponse.data.query.tokens.logintoken;

    // Step 2: Login with bot password credentials
    const params = new URLSearchParams();
    params.set('action', 'login');
    params.set('lgname', this.username);
    params.set('lgpassword', this.password);
    params.set('lgtoken', loginToken);
    params.set('format', 'json');
    params.set('formatversion', '2');

    const loginResponse = await this.client.request<{
      login: { result: string; reason?: string };
    }>({
      method: 'POST',
      data: params.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    if (loginResponse.data.login.result !== 'Success') {
      throw new MediaWikiApiError(
        `Login failed: ${loginResponse.data.login.result} — ${loginResponse.data.login.reason ?? 'unknown reason'}`,
        this.wikiName,
        'POST action=login',
      );
    }

    this.loggedIn = true;
    // Clear cached CSRF token so it's fetched with the new session
    this.csrfToken = null;
  }

  /** Get current session cookies (for sharing with RestClient) */
  getCookies(): string[] {
    return this.cookies;
  }

  /** Override retry delay for testing */
  setRetryDelay(ms: number): void {
    this.retryDelayMs = ms;
  }

  private async request<T>(
    method: string,
    params: Record<string, string | number | undefined>,
    data?: Record<string, string> | FormData
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        const queryParams: Record<string, string | number> = {
          format: 'json',
          formatversion: 2,
          ...Object.fromEntries(
            Object.entries(params).filter(([, v]) => v !== undefined)
          ),
        };

        const config: Record<string, unknown> = {
          method,
          params: method === 'GET' ? queryParams : { format: 'json', formatversion: 2 },
        };

        if (method === 'POST') {
          if (data instanceof FormData) {
            // For multipart form data, merge action params into form
            for (const [key, value] of Object.entries(params)) {
              if (value !== undefined) {
                (data as FormData).append(key, String(value));
              }
            }
            config.data = data;
            config.headers = (data as FormData).getHeaders();
          } else {
            // URL-encoded form data
            const formParams = new URLSearchParams();
            for (const [key, value] of Object.entries(queryParams)) {
              if (key !== 'format' && key !== 'formatversion') {
                formParams.set(key, String(value));
              }
            }
            if (data) {
              for (const [key, value] of Object.entries(data)) {
                formParams.set(key, value);
              }
            }
            config.data = formParams.toString();
            config.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
          }
        }

        const response = await this.client.request<T>(config);

        // Check for MediaWiki API-level errors (HTTP 200 with error payload)
        const responseData = response.data as any;
        if (responseData?.error) {
          throw new MediaWikiApiError(
            responseData.error.info || responseData.error.code || 'Unknown API error',
            this.wikiName,
            `${method} action=${params.action ?? 'unknown'}`,
            undefined,
            responseData.error.code
          );
        }

        return response.data;
      } catch (err) {
        // API-level errors (from our own throw above) are not retryable
        if (err instanceof MediaWikiApiError) {
          throw err;
        }

        const axiosErr = err as AxiosError;
        const status = axiosErr.response?.status;

        // Non-retryable 4xx (except 429)
        if (status && status >= 400 && status < 500 && status !== 429) {
          throw new MediaWikiApiError(
            axiosErr.message,
            this.wikiName,
            `${method} action=${params.action ?? 'unknown'}`,
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
      `${method} action=${params.action ?? 'unknown'}`,
      axiosErr?.response?.status,
      (axiosErr?.response?.data as Record<string, string>)?.errorKey
    );
  }

  async getCsrfToken(): Promise<string> {
    if (this.csrfToken) {
      return this.csrfToken;
    }

    const response = await this.request<{
      query: { tokens: { csrftoken: string } };
    }>('GET', {
      action: 'query',
      meta: 'tokens',
      type: 'csrf',
    });

    this.csrfToken = response.query.tokens.csrftoken;
    return this.csrfToken;
  }

  async listCategories(
    prefix?: string,
    limit: number = 10,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionCategory>> {
    const items: ActionCategory[] = [];
    let continueToken = continueFrom;
    let hasMore = false;

    while (items.length < limit) {
      const params: Record<string, string | number | undefined> = {
        action: 'query',
        list: 'allcategories',
        aclimit: Math.min(limit - items.length, 500),
        acprefix: prefix,
        acprop: 'size',
        accontinue: continueToken,
      };

      const response = await this.request<{
        query: {
          allcategories: Array<{
            category: string;
            size: number;
            pages: number;
            files: number;
            subcats: number;
          }>;
        };
        continue?: { accontinue: string };
      }>('GET', params);

      const categories = response.query.allcategories;
      items.push(...categories);

      if (response.continue?.accontinue) {
        continueToken = response.continue.accontinue;
        hasMore = true;
      } else {
        hasMore = false;
        break;
      }
    }

    return {
      items: items.slice(0, limit),
      hasMore,
      continueFrom: hasMore ? continueToken : undefined,
    };
  }

  async getCategoryMembers(
    category: string,
    limit: number = 10,
    type?: string,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionCategoryMember>> {
    const fullCategory = category.startsWith('Category:') ? category : `Category:${category}`;

    const params: Record<string, string | number | undefined> = {
      action: 'query',
      list: 'categorymembers',
      cmtitle: fullCategory,
      cmlimit: limit,
      cmtype: type,
      cmprop: 'ids|title|timestamp',
      cmcontinue: continueFrom,
    };

    const response = await this.request<{
      query: { categorymembers: ActionCategoryMember[] };
      continue?: { cmcontinue: string };
    }>('GET', params);

    return {
      items: response.query.categorymembers,
      hasMore: !!response.continue?.cmcontinue,
      continueFrom: response.continue?.cmcontinue,
    };
  }

  async getRecentChanges(
    limit: number = 10,
    namespace?: number,
    type?: string,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionRecentChange>> {
    const params: Record<string, string | number | undefined> = {
      action: 'query',
      list: 'recentchanges',
      rclimit: limit,
      rcnamespace: namespace,
      rctype: type,
      rcprop: 'title|ids|user|timestamp|comment|sizes',
      rccontinue: continueFrom,
    };

    const response = await this.request<{
      query: { recentchanges: ActionRecentChange[] };
      continue?: { rccontinue: string };
    }>('GET', params);

    return {
      items: response.query.recentchanges,
      hasMore: !!response.continue?.rccontinue,
      continueFrom: response.continue?.rccontinue,
    };
  }

  async getPageLinks(
    title: string,
    limit: number = 10,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionLink>> {
    const params: Record<string, string | number | undefined> = {
      action: 'query',
      titles: title,
      prop: 'links',
      pllimit: limit,
      plcontinue: continueFrom,
    };

    const response = await this.request<{
      query: { pages: Array<{ links?: ActionLink[] }> };
      continue?: { plcontinue: string };
    }>('GET', params);

    const pages = response.query.pages;
    const links = pages[0]?.links ?? [];

    return {
      items: links,
      hasMore: !!response.continue?.plcontinue,
      continueFrom: response.continue?.plcontinue,
    };
  }

  async getBacklinks(
    title: string,
    limit: number = 10,
    continueFrom?: string
  ): Promise<PaginatedResult<ActionBacklink>> {
    const params: Record<string, string | number | undefined> = {
      action: 'query',
      list: 'backlinks',
      bltitle: title,
      bllimit: limit,
      blcontinue: continueFrom,
    };

    const response = await this.request<{
      query: { backlinks: ActionBacklink[] };
      continue?: { blcontinue: string };
    }>('GET', params);

    return {
      items: response.query.backlinks,
      hasMore: !!response.continue?.blcontinue,
      continueFrom: response.continue?.blcontinue,
    };
  }

  async deletePage(title: string): Promise<void> {
    const token = await this.getCsrfToken();

    await this.request<{ delete: { title: string } }>('POST', {
      action: 'delete',
      title,
      token,
    });
  }

  async undeletePage(title: string, reason?: string): Promise<void> {
    const token = await this.getCsrfToken();

    await this.request<{ undelete: { title: string } }>('POST', {
      action: 'undelete',
      title,
      reason,
      token,
    });
  }

  async editPage(
    title: string,
    opts: {
      text?: string;
      section?: number | 'new';
      sectionTitle?: string;
      appendText?: string;
      prependText?: string;
      summary?: string;
      baseTimestamp?: string;
    }
  ): Promise<{ result: string; pageid: number; title: string; newrevid?: number; newtimestamp?: string; nochange?: boolean }> {
    const token = await this.getCsrfToken();

    const params: Record<string, string | number | undefined> = {
      action: 'edit',
      title,
      token,
      summary: opts.summary,
      basetimestamp: opts.baseTimestamp,
    };

    if (opts.text !== undefined) {
      params.text = opts.text;
    }
    if (opts.section !== undefined) {
      params.section = opts.section === 'new' ? 'new' : opts.section;
    }
    if (opts.sectionTitle !== undefined) {
      params.sectiontitle = opts.sectionTitle;
    }
    if (opts.appendText !== undefined) {
      params.appendtext = opts.appendText;
    }
    if (opts.prependText !== undefined) {
      params.prependtext = opts.prependText;
    }

    const response = await this.request<{
      edit: { result: string; pageid: number; title: string; newrevid?: number; newtimestamp?: string; nochange?: string };
    }>('POST', params);

    return {
      ...response.edit,
      nochange: response.edit.nochange !== undefined,
    };
  }

  async getPageContent(title: string): Promise<{ content: string; timestamp: string } | null> {
    const response = await this.request<{
      query: {
        pages: Array<{
          missing?: boolean;
          revisions?: Array<{ content: string; timestamp: string }>;
        }>;
      };
    }>('GET', {
      action: 'query',
      titles: title,
      prop: 'revisions',
      rvprop: 'content|timestamp',
      rvslots: 'main',
      rvlimit: 1,
    });

    const page = response.query.pages[0];
    if (page?.missing || !page?.revisions?.length) {
      return null;
    }

    const rev = page.revisions[0];
    // formatversion=2 puts content directly; formatversion=1 nests in slots
    const content = (rev as any).slots?.main?.content ?? (rev as any).content ?? rev.content;
    const timestamp = rev.timestamp;
    return { content, timestamp };
  }

  async uploadFromUrl(
    filename: string,
    url: string,
    text: string,
    comment?: string
  ): Promise<{ result: string; filename: string }> {
    const token = await this.getCsrfToken();

    const response = await this.request<{
      upload: { result: string; filename: string };
    }>('POST', {
      action: 'upload',
      filename,
      url,
      text,
      comment,
      token,
    });

    return response.upload;
  }

  async uploadFile(
    filename: string,
    fileContent: Buffer,
    text: string,
    comment?: string
  ): Promise<{ result: string; filename: string }> {
    const token = await this.getCsrfToken();

    const form = new FormData();
    form.append('action', 'upload');
    form.append('filename', filename);
    form.append('text', text);
    form.append('token', token);
    if (comment) {
      form.append('comment', comment);
    }
    form.append('file', fileContent, { filename });

    const response = await this.request<{
      upload: { result: string; filename: string };
    }>('POST', {}, form);

    return response.upload;
  }
}
