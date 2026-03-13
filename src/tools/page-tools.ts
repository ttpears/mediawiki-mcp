import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { applyPatch } from 'diff';
import { WikiOrchestrator } from '../wiki-orchestrator.js';

export function registerPageTools(server: McpServer, orchestrator: WikiOrchestrator): void {
  server.tool(
    'get-page',
    'Get page content and metadata',
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

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    }
  );

  server.tool(
    'create-page',
    'Create a new wiki page',
    {
      title: z.string().describe('Page title'),
      content: z.string().describe('Page content (wikitext)'),
      summary: z.string().describe('Edit summary'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, content, summary, wiki }) => {
      const result = await orchestrator.createPage(title, content, summary, { wiki });
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
    'Update a wiki page. Supports multiple edit modes to avoid sending full page content. Use diff (unified diff format) for targeted edits (preferred for large pages), section for editing a specific section, append/prepend for adding content, or content for full replacement.',
    {
      title: z.string().describe('Page title'),
      content: z.string().optional().describe('Full page content for complete replacement. Avoid for large pages — use diff instead'),
      diff: z.string().optional().describe('Unified diff to apply to the page. Server fetches current content, applies the patch, and submits. Use standard unified diff format with @@ hunk headers. Context lines help match the right location'),
      section: z.number().optional().describe('Section number to edit (0 = lead section). Use with content to replace only that section'),
      append: z.string().optional().describe('Text to append to the end of the page'),
      prepend: z.string().optional().describe('Text to prepend to the beginning of the page'),
      summary: z.string().describe('Edit summary'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, content, diff, section, append, prepend, summary, wiki }) => {
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
          summary,
          baseTimestamp: pageData.timestamp,
        });
        return {
          content: [{
            type: 'text' as const,
            text: `Page "${result.result.title}" updated on ${result.wiki} via diff (revision: ${result.result.newrevid})`,
          }],
        };
      }

      // Section edit
      if (section !== undefined && content !== undefined) {
        const result = await orchestrator.editPage(title, {
          wiki,
          text: content,
          section,
          summary,
        });
        return {
          content: [{
            type: 'text' as const,
            text: `Section ${section} of "${result.result.title}" updated on ${result.wiki} (revision: ${result.result.newrevid})`,
          }],
        };
      }

      // Append
      if (append !== undefined) {
        const result = await orchestrator.editPage(title, {
          wiki,
          appendText: append,
          summary,
        });
        return {
          content: [{
            type: 'text' as const,
            text: `Text appended to "${result.result.title}" on ${result.wiki} (revision: ${result.result.newrevid})`,
          }],
        };
      }

      // Prepend
      if (prepend !== undefined) {
        const result = await orchestrator.editPage(title, {
          wiki,
          prependText: prepend,
          summary,
        });
        return {
          content: [{
            type: 'text' as const,
            text: `Text prepended to "${result.result.title}" on ${result.wiki} (revision: ${result.result.newrevid})`,
          }],
        };
      }

      // Full replacement (fallback)
      const result = await orchestrator.editPage(title, {
        wiki,
        text: content,
        summary,
      });
      return {
        content: [{
          type: 'text' as const,
          text: `Page "${result.result.title}" updated on ${result.wiki} (revision: ${result.result.newrevid})`,
        }],
      };
    }
  );

  server.tool(
    'delete-page',
    'Delete a wiki page',
    {
      title: z.string().describe('Page title to delete'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, wiki }) => {
      const result = await orchestrator.deletePage(title, { wiki });
      return {
        content: [{ type: 'text' as const, text: `Page "${title}" deleted on ${result.wiki}.` }],
      };
    }
  );

  server.tool(
    'undelete-page',
    'Restore a deleted wiki page',
    {
      title: z.string().describe('Page title to restore'),
      reason: z.string().optional().describe('Reason for restoring the page'),
      wiki: z.string().optional().describe('Wiki name (uses default if omitted)'),
    },
    async ({ title, reason, wiki }) => {
      const result = await orchestrator.undeletePage(title, reason, { wiki });
      return {
        content: [{ type: 'text' as const, text: `Page "${title}" restored on ${result.wiki}.` }],
      };
    }
  );
}
