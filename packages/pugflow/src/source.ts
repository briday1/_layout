import type { SourceRange, TextEdit } from '@briday1/layout';

export interface SourceLine { text: string; start: number; end: number }

export function sourceLines(source: string): SourceLine[] {
  let start = 0;
  return source.split('\n').map((text) => {
    const line = { text: text.replace(/\r$/, ''), start, end: start + text.length };
    start += text.length + 1;
    return line;
  });
}

/**
 * Whole-declaration range: the keyword line plus every indented child line.
 * Pugflow tracks `lineNumber` at the label/id line inside a declaration, so
 * walk up to the nearest shallower structural keyword line.
 */
export function declarationRange(source: string, lineNumber: number): SourceRange {
  const lines = sourceLines(source);
  const keywords = /^#(?:canvas|diagram)(?:\s|$)|^\.(?:node|flow|image|graph)$|^(?:graph|node|image|flow|stage)(?:\s|$)/;
  let index = Math.max(0, Math.min(lineNumber - 1, lines.length - 1));
  while (index > 0 && !keywords.test(lines[index].text.trim())) index--;
  const indent = lines[index].text.match(/^\s*/)?.[0].length ?? 0;
  let end = index + 1;
  while (end < lines.length) {
    const text = lines[end].text;
    if (text.trim() && !text.trim().startsWith('//') &&
        (text.match(/^\s*/)?.[0].length ?? 0) <= indent) break;
    end++;
  }
  return { start: lines[index].start, end: lines[end]?.start ?? source.length };
}

function depthOf(text: string): number {
  return [...text.match(/^\s*/)![0]].reduce((n, c) => n + (c === '\t' ? 2 : 1), 0);
}

/**
 * Replace one dotted field inside a declaration, preserving all other lines.
 * The declaration is the keyword line at the start of `range`; when the range
 * begins on a dotted field line, the enclosing keyword line is located first.
 */
export function fieldEdit(
  source: string, range: SourceRange, field: string, value: string,
): TextEdit {
  if (!/^[a-z][\w-]*$/.test(field) || /[\r\n]/.test(value)) {
    throw new Error('Fields must contain a single line.');
  }
  const lines = sourceLines(source);
  const keywords = /^#(?:canvas|diagram)(?:\s|$)|^\.(?:node|flow|image|graph)$|^(?:graph|node|image|flow|stage)(?:\s|$)/;
  let declaration = lines.findIndex(line => line.start === range.start);
  if (declaration < 0) declaration = lines.findIndex(line => range.start >= line.start && range.start <= line.end);
  while (declaration > 0 && !keywords.test(lines[declaration].text.trim())) declaration--;
  const expectedDepth = declaration >= 0 ? depthOf(lines[declaration].text) + 2 : 0;
  const from = declaration >= 0 ? declaration + 1 : 0;
  const pattern = new RegExp(`^\\s*\\.${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
  const found = lines.findIndex((line, index) =>
    index >= from && line.start < range.end &&
    depthOf(line.text) === expectedDepth && pattern.test(line.text));
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  if (found >= 0) {
    let next = found + 1;
    while (next < lines.length && lines[next].start < range.end &&
      (!lines[next].text.trim() || depthOf(lines[next].text) > expectedDepth)) next++;
    const end = lines[next]?.start ?? source.length;
    const trailing = end < source.length || source.endsWith('\n') ? newline : '';
    const indent = lines[found].text.match(/^\s*/)![0];
    return { start: lines[found].start, end, text: value === '' ? '' : `${indent}.${field} ${value}${trailing}` };
  }
  const indent = declaration >= 0
    ? lines[declaration].text.match(/^\s*/)![0] +
      (lines[declaration].text.match(/^\s*/)![0].includes('\t') ? '\t' : '  ')
    : '';
  const start = declaration >= 0 ? Math.min(lines[declaration].end + 1, source.length) : 0;
  const leading = start > 0 && source[start - 1] !== '\n' ? newline : '';
  return { start, end: start, text: value === '' ? '' : `${leading}${indent}.${field} ${value}${newline}` };
}

/**
 * Replace (or append) a root-level canvas setting such as `.background`.
 * Settings live at root or directly inside a single `#canvas` block.
 */
export function canvasFieldEdit(source: string, field: string, value: string): TextEdit {
  const lines = sourceLines(source);
  const canvasIndex = lines.findIndex(line => /^#(?:canvas|diagram)(?:\s|$)/.test(line.text));
  const canvasDepth = canvasIndex >= 0 ? depthOf(lines[canvasIndex].text) + 2 : 0;
  const pattern = new RegExp(`^\\s*\\.${field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s|$)`);
  const canvasEnd = canvasIndex >= 0 ? declarationRange(source, canvasIndex + 1).end : source.length;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const found = lines.findIndex(line =>
    line.start >= (canvasIndex >= 0 ? lines[canvasIndex].end : 0) &&
    line.start < canvasEnd && depthOf(line.text) === canvasDepth && pattern.test(line.text));
  if (found >= 0) {
    const line = lines[found];
    return { start: line.start, end: line.end, text: value === '' ? '' : `${line.text.match(/^\s*/)![0]}.${field} ${value}` };
  }
  const indent = canvasIndex >= 0
    ? lines[canvasIndex].text.match(/^\s*/)![0] +
      (lines[canvasIndex].text.match(/^\s*/)![0].includes('\t') ? '\t' : '  ')
    : '';
  const at = canvasIndex >= 0 ? Math.min(lines[canvasIndex].end + 1, source.length) : 0;
  const leading = at > 0 && source[at - 1] !== '\n' ? newline : '';
  return { start: at, end: at, text: value === '' ? '' : `${leading}${indent}.${field} ${value}${newline}` };
}

/** Append a declaration, inside the `#canvas` block when one exists. */
export function appendDeclaration(source: string, text: string): TextEdit[] {
  const lines = sourceLines(source);
  const canvas = lines.findIndex(line => /^#(?:canvas|diagram)(?:\s|$)/.test(line.text));
  const end = canvas < 0 ? source.length : declarationRange(source, canvas + 1).end;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const body = canvas < 0 ? text : text.split('\n').map(line => line ? `  ${line}` : line).join('\n');
  return [{
    start: end, end,
    text: `${end && source[end - 1] !== '\n' ? newline : ''}${body.replace(/\n/g, newline)}`,
  }];
}
