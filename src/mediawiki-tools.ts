import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MediaWikiClient } from "./mediawiki-client.js";

/**
 * Register all MediaWiki MCP tools
 */
export function registerMediaWikiTools(
  server: McpServer,
  client: MediaWikiClient
): void {

  // Tool 1: Search Pages
  server.registerTool(
    "search_pages",
    {
      title: "Search Wiki Pages",
      description: "Search for pages in the MediaWiki instance using full-text search. Returns page titles, snippets, and metadata.",
      inputSchema: {
        query: z.string().describe("Search query string"),
        limit: z.number().optional().default(10).describe("Maximum number of results to return (1-50)"),
        namespace: z.number().optional().describe("Namespace ID to search in (0=main, 1=talk, etc.)")
      }
    },
    async ({ query, limit = 10, namespace }) => {
      const results = await client.searchPages(query, limit, namespace);

      if (results.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No results found for "${query}"`
          }]
        };
      }

      let text = `Found ${results.length} results for "${query}":\n\n`;

      results.forEach((result, index) => {
        text += `${index + 1}. **${result.title}**\n`;
        text += `   URL: ${client.getPageUrl(result.title)}\n`;
        text += `   Snippet: ${result.snippet.replace(/<[^>]*>/g, '')}\n`;
        text += `   Size: ${result.size} bytes | Words: ${result.wordcount} | Modified: ${client.formatTimestamp(result.timestamp)}\n\n`;
      });

      return {
        content: [{ type: "text", text }]
      };
    }
  );

  // Tool 2: Get Page
  server.registerTool(
    "get_page",
    {
      title: "Get Page Content",
      description: "Retrieve the full content and metadata of a specific wiki page by title.",
      inputSchema: {
        title: z.string().describe("Page title (e.g., 'Main Page')"),
        include_html: z.boolean().optional().default(false).describe("Include parsed HTML instead of wikitext")
      }
    },
    async ({ title, include_html = false }) => {
      const page = await client.getPage(title);

      if (!page) {
        return {
          content: [{
            type: "text",
            text: `Page "${title}" not found`
          }]
        };
      }

      let content = page.content;
      if (include_html) {
        content = await client.getParsedPage(title);
      }

      const text = `# Page: ${page.title}\n` +
        `URL: ${client.getPageUrl(page.title)}\n\n` +
        `## Metadata\n` +
        `- Page ID: ${page.pageid}\n` +
        `- Last Modified: ${client.formatTimestamp(page.timestamp)} by ${page.user}\n` +
        `- Categories: ${page.categories.join(', ') || 'None'}\n` +
        `- Size: ${page.size} bytes\n` +
        `- Comment: ${page.comment || 'No comment'}\n\n` +
        `## Content\n\n${content}`;

      return {
        content: [{ type: "text", text }]
      };
    }
  );

  // Tool 3: Get Page History
  server.registerTool(
    "get_page_history",
    {
      title: "Get Page History",
      description: "Retrieve the revision history for a specific page, including timestamps, authors, and edit comments.",
      inputSchema: {
        title: z.string().describe("Page title"),
        limit: z.number().optional().default(20).describe("Number of revisions to retrieve (1-50)")
      }
    },
    async ({ title, limit = 20 }) => {
      const revisions = await client.getPageHistory(title, limit);

      if (revisions.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No revision history found for "${title}"`
          }]
        };
      }

      let text = `# Revision History: ${title}\n\n## Recent Changes\n\n`;

      revisions.forEach((rev, index) => {
        const sizeDiff = index < revisions.length - 1
          ? rev.size - revisions[index + 1].size
          : 0;
        const diffText = sizeDiff > 0 ? `(+${sizeDiff})` : sizeDiff < 0 ? `(${sizeDiff})` : '';

        text += `${index + 1}. [Revision ${rev.revid}] ${client.formatTimestamp(rev.timestamp)}${rev.minor ? ' (minor)' : ''}\n`;
        text += `   By: ${rev.user}\n`;
        text += `   Comment: ${rev.comment || 'No comment'}\n`;
        text += `   Size: ${rev.size} bytes ${diffText}\n\n`;
      });

      return {
        content: [{ type: "text", text }]
      };
    }
  );

  // Tool 4: List Categories
  server.registerTool(
    "list_categories",
    {
      title: "List Categories",
      description: "List all categories in the wiki with page counts. Optionally filter by category name prefix.",
      inputSchema: {
        prefix: z.string().optional().describe("Filter categories by name prefix"),
        limit: z.number().optional().default(20).describe("Maximum number of categories to return (1-100)")
      }
    },
    async ({ prefix, limit = 20 }) => {
      const categories = await client.listCategories(prefix, limit);

      if (categories.length === 0) {
        return {
          content: [{
            type: "text",
            text: prefix
              ? `No categories found starting with "${prefix}"`
              : "No categories found"
          }]
        };
      }

      let text = `# Wiki Categories${prefix ? ` (prefix: "${prefix}")` : ''}\n\n`;

      categories.forEach((cat, index) => {
        text += `${index + 1}. **${cat.category}** (${cat.size} total members)\n`;
        text += `   URL: ${client.getPageUrl(`Category:${cat.category}`)}\n`;
        text += `   Pages: ${cat.pages} | Files: ${cat.files} | Subcategories: ${cat.subcats}\n\n`;
      });

      return {
        content: [{ type: "text", text }]
      };
    }
  );

  // Tool 5: Get Category Members
  server.registerTool(
    "get_category_members",
    {
      title: "Get Category Members",
      description: "List all pages in a specific category. Can filter by member type (pages, subcategories, or files).",
      inputSchema: {
        category: z.string().describe("Category name (with or without 'Category:' prefix)"),
        limit: z.number().optional().default(50).describe("Maximum number of members to return (1-500)"),
        type: z.enum(["page", "subcat", "file"]).optional().describe("Filter by member type")
      }
    },
    async ({ category, limit = 50, type }) => {
      const members = await client.getCategoryMembers(category, limit, type);

      if (members.length === 0) {
        return {
          content: [{
            type: "text",
            text: `No members found in category "${category}"`
          }]
        };
      }

      const categoryTitle = category.startsWith('Category:') ? category : `Category:${category}`;
      let text = `# Category: ${categoryTitle}\n`;
      text += `Total members: ${members.length}${type ? ` (type: ${type})` : ''}\n\n`;
      text += `## Members\n\n`;

      members.forEach((member, index) => {
        text += `${index + 1}. **${member.title}**\n`;
        text += `   URL: ${client.getPageUrl(member.title)}\n`;
        text += `   Last modified: ${client.formatTimestamp(member.timestamp)}\n\n`;
      });

      return {
        content: [{ type: "text", text }]
      };
    }
  );

  // Tool 6: Get Recent Changes
  server.registerTool(
    "get_recent_changes",
    {
      title: "Get Recent Changes",
      description: "List recent changes across the wiki, including edits, new pages, and log events.",
      inputSchema: {
        limit: z.number().optional().default(20).describe("Maximum number of changes to return (1-50)"),
        namespace: z.number().optional().describe("Filter by namespace ID"),
        type: z.enum(["edit", "new", "log"]).optional().describe("Filter by change type")
      }
    },
    async ({ limit = 20, namespace, type }) => {
      const changes = await client.getRecentChanges(limit, namespace, type);

      if (changes.length === 0) {
        return {
          content: [{
            type: "text",
            text: "No recent changes found"
          }]
        };
      }

      let text = `# Recent Changes\n\n`;

      changes.forEach((change, index) => {
        const sizeDiff = change.newlen - change.oldlen;
        const diffText = sizeDiff > 0 ? `+${sizeDiff}` : sizeDiff;

        text += `${index + 1}. [${change.type.toUpperCase()}] **${change.title}** - ${client.formatTimestamp(change.timestamp)}\n`;
        text += `   By: ${change.user}\n`;
        text += `   Comment: ${change.comment || 'No comment'}\n`;
        text += `   Size change: ${diffText} bytes\n`;
        text += `   URL: ${client.getPageUrl(change.title)}\n\n`;
      });

      return {
        content: [{ type: "text", text }]
      };
    }
  );

  // Tool 7: Get Page Links
  server.registerTool(
    "get_page_links",
    {
      title: "Get Page Links",
      description: "Get all links from or to a specific page. Useful for understanding page connections and dependencies.",
      inputSchema: {
        title: z.string().describe("Page title"),
        direction: z.enum(["from", "to"]).default("from").describe("Get links from this page or links to this page (backlinks)"),
        limit: z.number().optional().default(50).describe("Maximum number of links to return (1-500)")
      }
    },
    async ({ title, direction = "from", limit = 50 }) => {
      const links = direction === "from"
        ? await client.getPageLinks(title, limit)
        : await client.getBacklinks(title, limit);

      if (links.length === 0) {
        return {
          content: [{
            type: "text",
            text: direction === "from"
              ? `No outgoing links found from "${title}"`
              : `No backlinks found to "${title}"`
          }]
        };
      }

      let text = direction === "from"
        ? `# Links from: ${title}\n\nFound ${links.length} outgoing links:\n\n`
        : `# Links to: ${title}\n\nFound ${links.length} backlinks:\n\n`;

      links.forEach((link, index) => {
        text += `${index + 1}. **${link}**\n`;
        text += `   URL: ${client.getPageUrl(link)}\n\n`;
      });

      return {
        content: [{ type: "text", text }]
      };
    }
  );
}
