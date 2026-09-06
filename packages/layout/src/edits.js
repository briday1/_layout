/** Apply one atomic transaction of edits against the original UTF-16 source. */
export function applyEdits(source, edits) {
    const ordered = edits.map((edit, index) => {
        if (!Number.isInteger(edit.start) || !Number.isInteger(edit.end) ||
            edit.start < 0 || edit.end < edit.start || edit.end > source.length ||
            typeof edit.text !== 'string') {
            throw new RangeError('Invalid text edit');
        }
        return { ...edit, index };
    }).sort((a, b) => a.start - b.start || a.end - b.end || a.index - b.index);
    let cursor = 0;
    const result = [];
    for (const edit of ordered) {
        if (edit.start < cursor)
            throw new RangeError('Text edits overlap');
        result.push(source.slice(cursor, edit.start), edit.text);
        cursor = edit.end;
    }
    result.push(source.slice(cursor));
    return result.join('');
}
