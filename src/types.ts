// Wiki configuration for a single named wiki
export interface WikiConfig {
  name: string;
  baseUrl: string;
  username?: string;
  password?: string;
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

// Unified page-finding result
export type FoundPageMatchType = 'exact' | 'redirect' | 'prefix' | 'fulltext';

export interface FoundPage {
  wiki: string;
  title: string;
  pageid: number;
  matchType: FoundPageMatchType;
  excerpt?: string;
  redirectedFrom?: string;
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
