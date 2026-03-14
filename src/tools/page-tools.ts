import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { applyPatch } from 'diff';
import { WikiOrchestrator } from '../wiki-orchestrator.js';
import { lintWikitext, formatLintWarnings } from '../wikitext-lint.js';

function attributeSummary(summary: string, user?: string): string {
  if (!user) return summary;
  return `${summary} (on behalf of ${user})`;
}

function formatEditResult(
  result: { result: string; title: string; newrevid?: number; nochange?: boolean },
  wikiName: string,
  action: string
): string {
  if (result.nochange) {
    return `No change to "${result.title}" on ${wikiName} — content was already identical.`;
  }
  return `${action} "${result.title}" on ${wikiName} (revision: ${result.newrevid})`;
}

export function registerPageTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'get-page',
    'Retrieve a wiki page\'s full wikitext source and metadata. Returns the page title, ID, content model, latest revision ID/timestamp, and the raw wikitext source. Call this BEFORE update-page to read the current content you want to edit.',
    {
      title: z.string().describe('Page title'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
      include_html: z.boolean().optional().default(false).describe('Include rendered HTML'),
    },
    async ({ title, wiki, include_html }) => {
      const result = await orchestrator.getPage(title, { wiki, includeHtml: include_html });

      if (!result.page) {
        return {
          content: [{ type: 'text' as const, text: `Page "${title}" not found on ${result.wiki}.` }],
        };
      }

      const page = result.page;
      const lines: string[] = [
        `Title: ${page.title}`,
        `Wiki: ${result.wiki}`,
        `Page ID: ${page.id}`,
        `Key: ${page.key}`,
        `Content Model: ${page.content_model}`,
        `Latest Revision: ${page.latest.id} (${page.latest.timestamp})`,
        `License: ${page.license.title}`,
        '',
        '--- Content ---',
        page.source ?? '(no source available)',
      ];

      if (include_html && result.html) {
        lines.push('', '--- HTML ---', result.html);
      }

      // Lint wikitext for legacy patterns
      if (page.source && page.content_model === 'wikitext') {
        const warnings = lintWikitext(page.source);
        const lintOutput = formatLintWarnings(warnings);
        if (lintOutput) {
          lines.push(lintOutput);
        }
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }
  );

  server.tool(
    'create-page',
    'Create a new wiki page with wikitext content. The page must not already exist — use update-page to modify existing pages. Requires the requesting user\'s name for edit attribution.',
    {
      title: z.string().describe('Page title'),
      content: z.string().describe('Page content (wikitext)'),
      summary: z.string().describe('Edit summary'),
      user: z.string().describe('Name of the person requesting this edit (for attribution in edit summary). Ask the user if not known'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, content, summary, user, wiki }) => {
      const result = await orchestrator.createPage(title, content, attributeSummary(summary, user), { wiki });
      return {
        content: [{
          type: 'text' as const,
          text: `Page "${result.page.title}" created on ${result.wiki} (id: ${result.page.id}, revision: ${result.page.latest.id})`,
        }],
      };
    }
  );

  server.tool(
    'update-page',
    `Update an existing wiki page. WORKFLOW: First call get-page to read the current wikitext source, then call this tool with your changes.

EDIT MODES (use exactly one):
• diff: Preferred for targeted edits. Provide a unified diff (with @@ hunk headers and context lines) — the server fetches current content, applies the patch, and saves. Best for surgical changes to large pages.
• section + content: Edit a single section by number (0 = lead section). Only that section is replaced.
• append: Add text to the end of the page without reading current content first.
• prepend: Add text to the beginning of the page without reading current content first.
• content: Full page replacement. Avoid for large pages — use diff instead.

Requires the requesting user's name for edit attribution.

WIKITEXT STYLE GUIDE — when writing or updating wikitext, use modern syntax:
• Tables: {| class="wikitable" with |- row separators (not |---- or border="1" or HTML <table>)
• Bold/italic: '''bold''' and ''italic'' (not <b>/<i>)
• Headings: == Level 2 == through ====== Level 6 ====== (skip level 1)
• Lists: * bullets, # numbered, ; and : for definition lists
• Links: [URL description] for external (not bare URLs)
• Avoid deprecated tags: <center>, <font>, <tt>, <strike>, <big>, <u>
• Avoid deep colon indentation (::), excessive <br>, inline CSS on divs`,
    {
      title: z.string().describe('Page title'),
      content: z.string().optional().describe('Full page content for complete replacement. Avoid for large pages — use diff instead'),
      diff: z.string().optional().describe('Unified diff to apply to the page. Server fetches current content, applies the patch, and submits. Use standard unified diff format with @@ hunk headers. Context lines help match the right location'),
      section: z.number().optional().describe('Section number to edit (0 = lead section). Use with content to replace only that section'),
      append: z.string().optional().describe('Text to append to the end of the page'),
      prepend: z.string().optional().describe('Text to prepend to the beginning of the page'),
      summary: z.string().describe('Edit summary'),
      user: z.string().describe('Name of the person requesting this edit (for attribution in edit summary). Ask the user if not known'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, content, diff, section, append, prepend, summary, user, wiki }) => {
      const attrSummary = attributeSummary(summary, user);
      // Validate that exactly one edit mode is specified
      const modes = [
        content !== undefined && section === undefined ? 'content' : null,
        diff !== undefined ? 'diff' : null,
        content !== undefined && section !== undefined ? 'section' : null,
        append !== undefined ? 'append' : null,
        prepend !== undefined ? 'prepend' : null,
      ].filter(Boolean);

      if (modes.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'Error: Must specify one edit mode: content, diff, section+content, append, or prepend.' }],
          isError: true,
        };
      }
      if (modes.length > 1) {
        return {
          content: [{ type: 'text' as const, text: `Error: Only one edit mode at a time. Got: ${modes.join(', ')}` }],
          isError: true,
        };
      }

      // Unified diff: fetch current content, apply patch, submit
      if (diff) {
        const pageData = await orchestrator.getPageContent(title, { wiki });
        if (!pageData) {
          return {
            content: [{ type: 'text' as const, text: `Error: Page "${title}" not found. Cannot apply diff.` }],
            isError: true,
          };
        }

        const patched = applyPatch(pageData.content, diff, { fuzzFactor: 3 });
        if (patched === false) {
          return {
            content: [{ type: 'text' as const, text: 'Error: Failed to apply diff. The page content may have changed since you last read it, or the diff context lines do not match. Re-read the page and try again.' }],
            isError: true,
          };
        }

        const result = await orchestrator.editPage(title, {
          wiki,
          text: patched,
          summary: attrSummary,
          baseTimestamp: pageData.timestamp,
        });
        return {
          content: [{
            type: 'text' as const,
            text: formatEditResult(result.result, result.wiki, 'Updated'),
          }],
        };
      }

      // Section edit
      if (section !== undefined && content !== undefined) {
        const result = await orchestrator.editPage(title, {
          wiki,
          text: content,
          section,
          summary: attrSummary,
        });
        return {
          content: [{
            type: 'text' as const,
            text: formatEditResult(result.result, result.wiki, `Updated section ${section} of`),
          }],
        };
      }

      // Append
      if (append !== undefined) {
        const result = await orchestrator.editPage(title, {
          wiki,
          appendText: append,
          summary: attrSummary,
        });
        return {
          content: [{
            type: 'text' as const,
            text: formatEditResult(result.result, result.wiki, 'Appended to'),
          }],
        };
      }

      // Prepend
      if (prepend !== undefined) {
        const result = await orchestrator.editPage(title, {
          wiki,
          prependText: prepend,
          summary: attrSummary,
        });
        return {
          content: [{
            type: 'text' as const,
            text: formatEditResult(result.result, result.wiki, 'Prepended to'),
          }],
        };
      }

      // Full replacement (fallback)
      const result = await orchestrator.editPage(title, {
        wiki,
        text: content,
        summary: attrSummary,
      });
      return {
        content: [{
          type: 'text' as const,
          text: formatEditResult(result.result, result.wiki, 'Updated'),
        }],
      };
    }
  );

  server.tool(
    'delete-page',
    'Delete a wiki page permanently. This requires admin/sysop rights on the wiki. Requires the requesting user\'s name for attribution.',
    {
      title: z.string().describe('Page title to delete'),
      reason: z.string().optional().describe('Reason for deletion'),
      user: z.string().describe('Name of the person requesting this deletion (for attribution). Ask the user if not known'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, reason, user, wiki }) => {
      const attrReason = attributeSummary(reason ?? 'Deleted via MCP', user);
      const result = await orchestrator.deletePage(title, { wiki, reason: attrReason });
      return {
        content: [{ type: 'text' as const, text: `Page "${title}" deleted on ${result.wiki}.` }],
      };
    }
  );

  server.tool(
    'undelete-page',
    'Restore a previously deleted wiki page. This requires admin/sysop rights on the wiki. Requires the requesting user\'s name for attribution.',
    {
      title: z.string().describe('Page title to restore'),
      reason: z.string().optional().describe('Reason for restoring the page'),
      user: z.string().describe('Name of the person requesting this restoration (for attribution). Ask the user if not known'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, reason, user, wiki }) => {
      const attrReason = attributeSummary(reason ?? 'Restored via MCP', user);
      const result = await orchestrator.undeletePage(title, attrReason, { wiki });
      return {
        content: [{ type: 'text' as const, text: `Page "${title}" restored on ${result.wiki}.` }],
      };
    }
  );
}
