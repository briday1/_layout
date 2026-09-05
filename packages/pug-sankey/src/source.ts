import type { SourceRange, TextEdit } from '@briday1/layout';

export function sourceLines(source: string) {
  let start = 0;
  return source.split('\n').map((text) => {
    const line = { text: text.replace(/\r$/, ''), start, end: start + text.length };
    start += text.length + 1;
    return line;
  });
}

export function declarationRange(source: string, lineNumber: number, kind: string): SourceRange {
  const lines = sourceLines(source);
  let index = Math.max(0, Math.min(lineNumber - 1, lines.length - 1));
  while (index > 0 && lines[index].text.trim() !== kind) index--;
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

/** Replace just one direct field, leaving other fields and declarations intact. */
export function fieldEdit(source: string, range: SourceRange, field: string, value: string, root = false): TextEdit {
  if (!/^[a-z-]+$/.test(field) || /[\r\n]/.test(value)) throw new Error('Fields must contain a single line.');
  const lines = sourceLines(source);
  const first = lines.findIndex(line => line.start === range.start);
  const canvas = root ? lines.findIndex(line => /^#canvas(?:\s|$)/.test(line.text)) : -1;
  const declaration = root ? canvas : first;
  const prefix = declaration >= 0 ? lines[declaration].text.match(/^\s*/)![0] : '';
  const childPrefix = declaration >= 0 ? prefix + (prefix.includes('\t') ? '\t' : '  ') : '';
  const depth = (text: string) => [...text.match(/^\s*/)![0]].reduce((n, c) => n + (c === '\t' ? 2 : 1), 0);
  const expectedDepth = declaration >= 0 ? depth(lines[declaration].text) + 2 : 0;
  const from = declaration >= 0 ? declaration + 1 : 0;
  const found = lines.findIndex((line, index) =>
    index >= from && line.start < range.end && depth(line.text) === expectedDepth &&
    new RegExp(`^\\s*\\.${field}(?:\\s|$)`).test(line.text));
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  if (found >= 0) {
    let next = found + 1;
    while (next < lines.length && lines[next].start < range.end &&
      (!lines[next].text.trim() || depth(lines[next].text) > expectedDepth)) next++;
    const end = lines[next]?.start ?? source.length;
    const trailing = end < source.length || source.endsWith('\n') ? newline : '';
    return { start: lines[found].start, end, text: value === '' ? '' : `${lines[found].text.match(/^\s*/)![0]}.${field} ${value}${trailing}` };
  }
  const start = declaration >= 0 ? Math.min(lines[declaration].end + 1, source.length) : 0;
  const leading = start > 0 && source[start - 1] !== '\n' ? newline : '';
  return { start, end: start, text: value === '' ? '' : `${leading}${childPrefix}.${field} ${value}${newline}` };
}
