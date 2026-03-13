/**
 * Detects legacy/deprecated MediaWiki syntax patterns and suggests modern alternatives.
 * Used by get-page to help LLMs understand when content needs modernization.
 */

interface LintWarning {
  pattern: string;
  message: string;
  count: number;
  lines: number[];
}

const LINT_RULES: Array<{
  pattern: RegExp;
  id: string;
  message: string;
}> = [
  // Deprecated HTML tags
  {
    pattern: /<center\b[^>]*>/gi,
    id: '<center>',
    message: 'Deprecated. Use {{center}} template or <div class="center"> instead.',
  },
  {
    pattern: /<font\b[^>]*>/gi,
    id: '<font>',
    message: 'Deprecated. Use <span style="..."> or CSS classes instead.',
  },
  {
    pattern: /<tt\b[^>]*>/gi,
    id: '<tt>',
    message: 'Deprecated. Use <code> for inline code.',
  },
  {
    pattern: /<strike\b[^>]*>/gi,
    id: '<strike>',
    message: 'Deprecated. Use <s> or <del> instead.',
  },
  {
    pattern: /<big\b[^>]*>/gi,
    id: '<big>',
    message: 'Deprecated. Use <span style="font-size:large"> or CSS classes.',
  },
  {
    pattern: /<u\b[^>]*>/gi,
    id: '<u>',
    message: 'Deprecated. Underline is discouraged; use <em> for emphasis or CSS if needed.',
  },

  // HTML markup that should be wikitext
  {
    pattern: /<b\b[^>]*>(?!ot)/gi,  // exclude <bot, <blockquote etc
    id: '<b> (HTML bold)',
    message: "Use '''bold''' wikitext markup instead of HTML <b> tags.",
  },
  {
    pattern: /<i\b[^>]*>(?!mg|nput|frame)/gi,  // exclude <img, <input, <iframe
    id: '<i> (HTML italic)',
    message: "Use ''italic'' wikitext markup instead of HTML <i> tags.",
  },

  // HTML tables instead of wikitext tables
  {
    pattern: /<table\b[^>]*>/gi,
    id: '<table> (HTML table)',
    message: 'Use wikitext table markup {| class="wikitable" instead of HTML <table> tags.',
  },

  // Legacy table formatting
  {
    pattern: /^\{\|[^}]*border\s*=\s*["']?1["']?/gm,
    id: '{| border="1"',
    message: 'Use {| class="wikitable" instead of border="1" for proper styling.',
  },
  {
    pattern: /^\|----+\s*$/gm,
    id: '|---- (extra dashes)',
    message: 'Use |- for table row separators. Extra dashes (|----) are unnecessary.',
  },

  // Inline styles on divs (common legacy pattern)
  {
    pattern: /<div\s+style\s*=\s*["'][^"']*(?:float|margin|padding|background|color|font-size|text-align)[^"']*["']/gi,
    id: '<div style="...">',
    message: 'Inline CSS on divs is fragile. Prefer templates or CSS classes where available.',
  },

  // Bare URLs (not inside [] or template)
  {
    pattern: /(?<!\[)https?:\/\/[^\s\]}<|]+(?=[.\s,;)\]}]|$)/gm,
    id: 'Bare URL',
    message: 'Use [URL description] for external links instead of bare URLs.',
  },

  // Deprecated magic words / formatting
  {
    pattern: /<br\s*\/?>/gi,
    id: '<br> tags',
    message: 'Excessive <br> tags may indicate content should use proper list, paragraph, or template markup.',
  },

  // Colon indentation (accessibility issue)
  {
    pattern: /^:{2,}[^:*#;]/gm,
    id: ':: (colon indentation)',
    message: 'Deep colon indentation (::) produces invalid HTML. Use proper list markup or {{indent}} template.',
  },
];

export function lintWikitext(source: string): LintWarning[] {
  const warnings: LintWarning[] = [];
  const lines = source.split('\n');

  for (const rule of LINT_RULES) {
    const matchLines: number[] = [];
    let count = 0;

    for (let i = 0; i < lines.length; i++) {
      const lineMatches = lines[i].match(rule.pattern);
      if (lineMatches) {
        count += lineMatches.length;
        if (matchLines.length < 5) {
          matchLines.push(i + 1);
        }
      }
    }

    // Reset global regex lastIndex
    rule.pattern.lastIndex = 0;

    if (count > 0) {
      // Skip <br> warnings unless excessive (>5)
      if (rule.id === '<br> tags' && count <= 5) continue;

      warnings.push({
        pattern: rule.id,
        message: rule.message,
        count,
        lines: matchLines,
      });
    }
  }

  return warnings;
}

export function formatLintWarnings(warnings: LintWarning[]): string {
  if (warnings.length === 0) return '';

  const lines = ['', '--- Legacy Syntax Warnings ---'];
  for (const w of warnings) {
    const lineRef = w.lines.length > 0
      ? ` (lines: ${w.lines.join(', ')}${w.count > w.lines.length ? ', ...' : ''})`
      : '';
    lines.push(`• ${w.pattern} ×${w.count}${lineRef}: ${w.message}`);
  }
  lines.push('');
  lines.push('Consider modernizing these patterns when editing this page.');
  return lines.join('\n');
}
