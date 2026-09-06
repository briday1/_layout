import type { TextEdit } from './types.js';
/** Apply one atomic transaction of edits against the original UTF-16 source. */
export declare function applyEdits(source: string, edits: readonly TextEdit[]): string;
