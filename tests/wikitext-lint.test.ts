import { describe, it, expect } from 'vitest';
import { lintWikitext, formatLintWarnings } from '../src/wikitext-lint.js';

describe('lintWikitext', () => {
  it('returns empty for clean modern wikitext', () => {
    const source = `== Heading ==
'''Bold''' and ''italic'' text.

{| class="wikitable"
|-
! Header
|-
| Cell
|}

* Bullet list
# Numbered list`;

    expect(lintWikitext(source)).toEqual([]);
  });

  it('detects deprecated HTML tags', () => {
    const source = `<center>centered</center>
<font color="red">red</font>
<tt>monospace</tt>
<strike>struck</strike>
<big>large</big>`;

    const warnings = lintWikitext(source);
    const ids = warnings.map(w => w.pattern);
    expect(ids).toContain('<center>');
    expect(ids).toContain('<font>');
    expect(ids).toContain('<tt>');
    expect(ids).toContain('<strike>');
    expect(ids).toContain('<big>');
  });

  it('detects HTML bold/italic instead of wikitext', () => {
    const source = `<b>bold</b> and <i>italic</i>`;
    const warnings = lintWikitext(source);
    const ids = warnings.map(w => w.pattern);
    expect(ids).toContain('<b> (HTML bold)');
    expect(ids).toContain('<i> (HTML italic)');
  });

  it('detects HTML tables', () => {
    const source = `<table border="1"><tr><td>cell</td></tr></table>`;
    const warnings = lintWikitext(source);
    expect(warnings.map(w => w.pattern)).toContain('<table> (HTML table)');
  });

  it('detects legacy table border attribute', () => {
    const source = `{| border="1"
|-
| cell
|}`;
    const warnings = lintWikitext(source);
    expect(warnings.map(w => w.pattern)).toContain('{| border="1"');
  });

  it('detects extra dashes in table row separators', () => {
    const source = `{| class="wikitable"
|----
| cell
|}`;
    const warnings = lintWikitext(source);
    expect(warnings.map(w => w.pattern)).toContain('|---- (extra dashes)');
  });

  it('detects deep colon indentation', () => {
    const source = `:: indented text
::: more indented`;
    const warnings = lintWikitext(source);
    expect(warnings.map(w => w.pattern)).toContain(':: (colon indentation)');
  });

  it('only warns about br tags when excessive (>5)', () => {
    const fewBr = `line1<br>line2<br>line3`;
    expect(lintWikitext(fewBr).map(w => w.pattern)).not.toContain('<br> tags');

    const manyBr = `a<br>b<br>c<br>d<br>e<br>f<br>g`;
    expect(lintWikitext(manyBr).map(w => w.pattern)).toContain('<br> tags');
  });

  it('includes line numbers in warnings', () => {
    const source = `line 1
<center>centered</center>
line 3
<center>more</center>`;

    const warnings = lintWikitext(source);
    const centerWarning = warnings.find(w => w.pattern === '<center>');
    expect(centerWarning).toBeDefined();
    expect(centerWarning!.lines).toEqual([2, 4]);
    expect(centerWarning!.count).toBe(2);
  });
});

describe('formatLintWarnings', () => {
  it('returns empty string for no warnings', () => {
    expect(formatLintWarnings([])).toBe('');
  });

  it('formats warnings with counts and line numbers', () => {
    const output = formatLintWarnings([
      { pattern: '<center>', message: 'Deprecated.', count: 2, lines: [5, 10] },
    ]);
    expect(output).toContain('Legacy Syntax Warnings');
    expect(output).toContain('<center>');
    expect(output).toContain('×2');
    expect(output).toContain('lines: 5, 10');
    expect(output).toContain('Consider modernizing');
  });
});
