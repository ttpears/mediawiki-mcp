import axios, { AxiosInstance, AxiosError } from 'axios';
import FormData from 'form-data';
import { VERSION } from '../version.js';
import {
  ActionCategory,
  ActionCategoryMember,
  ActionRecentChange,
  ActionLink,
  ActionBacklink,
  PaginatedResult,
  MediaWikiApiError,
} from '../types.js';

/**
 * MediaWiki API error codes that indicate the request went out without a valid
 * user session (expired bot-password login, stale CSRF token, etc.). These are
 * recoverable by logging in again, unlike genuine rights problems which will
 * simply fail again on retry.
 */
const AUTH_ERROR_CODES = new Set([
  'assertuserfailed',
  'mustbeloggedin',
  'permissiondenied',
  'badtoken',
]);

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
  private bearerTokenProvider?: () => Promise<string>;

  constructor(wikiName: string, baseUrl: string, username?: string, password?: string) {
    this.wikiName = wikiName;
    this.username = username;
    this.password = password;

    this.client = axios.create({
      baseURL: `${baseUrl.replace(/\/+$/, '')}/api.php`,
      timeout: 30000,
      headers: {
        'User-Agent': `MediaWiki-MCP/${VERSION}`,
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

    // OAuth bearer mode: act as the authenticated user via Authorization header
    this.client.interceptors.request.use(async (config) => {
      if (this.bearerTokenProvider) {
        config.headers['Authorization'] = `Bearer ${await this.bearerTokenProvider()}`;
      }
      return config;
    });
  }

  /**
   * Switch this client into OAuth bearer mode: every request carries
   * `Authorization: Bearer <token>` from the provider, and bot-password login is
   * skipped. The provider returns a currently-valid wiki access token (refreshed
   * as needed by the caller).
   */
  setBearerTokenProvider(provider: () => Promise<string>): void {
    this.bearerTokenProvider = provider;
  }

  async login(): Promise<void> {
    if (this.bearerTokenProvider) return; // OAuth handles auth; no bot login
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

  private hasBotCredentials(): boolean {
    return !!this.username && !!this.password && !this.bearerTokenProvider;
  }

  /** Discard the expired session state and log in again. */
  private async refreshLogin(): Promise<void> {
    this.loggedIn = false;
    this.csrfToken = null;
    await this.login();
  }

  private isAuthError(err: unknown): boolean {
    if (!(err instanceof MediaWikiApiError) || !err.apiErrorCode) return false;
    return AUTH_ERROR_CODES.has(err.apiErrorCode) || err.apiErrorCode.startsWith('badaccess');
  }

  /**
   * Run a write operation; if it fails because the login session expired,
   * re-authenticate and retry once. Bot-password sessions expire server-side
   * ($wgObjectCacheSessionExpiry, default 1h), after which requests silently
   * go out anonymous — see issue #12.
   */
  private async withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (!this.hasBotCredentials() || !this.isAuthError(err)) {
        throw err;
      }
      await this.refreshLogin();
      return fn();
    }
  }

  /**
   * Extra params for write requests. With bot credentials, `assert=user` makes
   * an expired session fail with `assertuserfailed` (recoverable, and honest)
   * instead of performing an anonymous edit or a misleading rights error.
   */
  private writeParams(
    params: Record<string, string | number | undefined>
  ): Record<string, string | number | undefined> {
    return this.hasBotCredentials() ? { ...params, assert: 'user' } : params;
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

  /**
   * Resolve a title via the Action API, following redirects and normalization.
   * Returns the canonical page if it exists, or null if the title is missing.
   */
  async resolveTitle(title: string): Promise<{
    title: string;
    pageid: number;
    redirectedFrom?: string;
  } | null> {
    const response = await this.request<{
      query: {
        redirects?: Array<{ from: string; to: string }>;
        normalized?: Array<{ from: string; to: string }>;
        pages: Array<{ pageid?: number; ns: number; title: string; missing?: boolean }>;
      };
    }>('GET', {
      action: 'query',
      titles: title,
      redirects: 1,
      prop: 'info',
    });

    const page = response.query.pages?.[0];
    if (!page || page.missing || page.pageid === undefined) {
      return null;
    }

    // Trace back through redirects + normalization to find the user's original input
    const redirects = response.query.redirects ?? [];
    const normalized = response.query.normalized ?? [];
    const firstHop = normalized[0]?.from ?? redirects[0]?.from;
    const redirectedFrom = redirects.length > 0 ? (firstHop ?? title) : undefined;

    return {
      title: page.title,
      pageid: page.pageid,
      redirectedFrom,
    };
  }

  async deletePage(title: string, reason?: string): Promise<void> {
    await this.withAuthRetry(async () => {
      const token = await this.getCsrfToken();

      return this.request<{ delete: { title: string } }>('POST', this.writeParams({
        action: 'delete',
        title,
        reason,
        token,
      }));
    });
  }

  async undeletePage(title: string, reason?: string): Promise<void> {
    await this.withAuthRetry(async () => {
      const token = await this.getCsrfToken();

      return this.request<{ undelete: { title: string } }>('POST', this.writeParams({
        action: 'undelete',
        title,
        reason,
        token,
      }));
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
    const response = await this.withAuthRetry(async () => {
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

      return this.request<{
        edit: { result: string; pageid: number; title: string; newrevid?: number; newtimestamp?: string; nochange?: string };
      }>('POST', this.writeParams(params));
    });

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
    const response = await this.withAuthRetry(async () => {
      const token = await this.getCsrfToken();

      return this.request<{
        upload: { result: string; filename: string };
      }>('POST', this.writeParams({
        action: 'upload',
        filename,
        url,
        text,
        comment,
        token,
      }));
    });

    return response.upload;
  }

  async uploadFile(
    filename: string,
    fileContent: Buffer,
    text: string,
    comment?: string
  ): Promise<{ result: string; filename: string }> {
    const response = await this.withAuthRetry(async () => {
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

      return this.request<{
        upload: { result: string; filename: string };
      }>('POST', this.writeParams({}), form);
    });

    return response.upload;
  }

  /** Report who the current session is authenticated as (anon=true if nobody). */
  async getUserInfo(): Promise<{ id: number; name: string; anon: boolean }> {
    const response = await this.request<{
      query: { userinfo: { id: number; name: string; anon?: boolean } };
    }>('GET', {
      action: 'query',
      meta: 'userinfo',
    });

    const info = response.query.userinfo;
    return { id: info.id, name: info.name, anon: info.anon === true };
  }

  /**
   * Verify the real session state against the wiki. If the session has gone
   * anonymous but credentials exist, attempt to re-establish it (throws if the
   * login itself fails).
   */
  async checkAuthStatus(): Promise<{ authenticated: boolean; userName?: string }> {
    let info = await this.getUserInfo();

    if (info.anon && this.hasBotCredentials()) {
      await this.refreshLogin();
      info = await this.getUserInfo();
    }

    return info.anon
      ? { authenticated: false }
      : { authenticated: true, userName: info.name };
  }
}
