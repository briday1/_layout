import { describe, expect, it } from 'vitest';
import { applyEdits } from '../packages/layout/src/edits.js';

describe('applyEdits', () => {
  it('applies unordered edits against the original source without mutation', () => {
    const edits = [{ start: 4, end: 6, text: '!' }, { start: 0, end: 2, text: 'ABC' }];
    expect(applyEdits('abcdef', edits)).toBe('ABCcd!');
    expect(edits[0].start).toBe(4);
    expect(applyEdits('abc', [])).toBe('abc');
  });

  it('supports inserts, deletion, UTF-16 ranges, and adjacent edits', () => {
    expect(applyEdits('a😀b', [
      { start: 1, end: 3, text: 'x' },
      { start: 3, end: 4, text: '' },
      { start: 4, end: 4, text: '!' },
    ])).toBe('ax!');
    expect(applyEdits('', [{ start: 0, end: 0, text: 'new' }])).toBe('new');
  });

  it('keeps equal-position inserts in input order before a replacement', () => {
    expect(applyEdits('abc', [
      { start: 1, end: 2, text: 'B' },
      { start: 1, end: 1, text: '1' },
      { start: 1, end: 1, text: '2' },
    ])).toBe('a12Bc');
  });

  it.each([
    [-1, 0], [0, 4], [2, 1], [0.5, 1], [0, 1.5],
    [NaN, 1], [0, NaN], [Infinity, Infinity], [0, -Infinity],
  ])('rejects invalid offsets %s:%s atomically', (start, end) => {
    expect(() => applyEdits('abc', [
      { start: 0, end: 0, text: 'valid' }, { start, end, text: 'bad' },
    ])).toThrow(RangeError);
  });

  it('rejects overlapping replacements and inserts inside a replacement', () => {
    for (const edit of [{ start: 1, end: 3, text: '' }, { start: 1, end: 1, text: '' }]) {
      expect(() => applyEdits('abc', [{ start: 0, end: 2, text: 'x' }, edit])).toThrow(/overlap/);
    }
  });
});
