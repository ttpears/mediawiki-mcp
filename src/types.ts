/**
 * MediaWiki MCP Server Type Definitions
 */

export interface MediaWikiConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  apiToken?: string;
}

export interface SearchResult {
  title: string;
  pageid: number;
  snippet: string;
  wordcount: number;
  size: number;
  timestamp: string;
}

export interface PageContent {
  pageid: number;
  title: string;
  content: string;
  timestamp: string;
  user: string;
  comment: string;
  categories: string[];
  size: number;
}

export interface Revision {
  revid: number;
  parentid: number;
  timestamp: string;
  user: string;
  comment: string;
  size: number;
  minor?: boolean;
}

export interface Category {
  category: string;
  size: number;
  pages: number;
  files: number;
  subcats: number;
}

export interface CategoryMember {
  pageid: number;
  title: string;
  timestamp: string;
}

export interface RecentChange {
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
