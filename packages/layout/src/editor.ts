import type { SourceEditorFactory } from './types.js';

/** Dependency-free fallback; richer editors implement the same host contract. */
export const createTextareaEditor: SourceEditorFactory = context => {
  const { container } = context;
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const editor = doc.createElement('textarea');
  editor.className = 'lw-editor';
  editor.setAttribute('aria-label', 'Source editor');
  editor.spellcheck = false;
  editor.wrap = 'off';
  editor.value = context.source;
  container.append(editor);
  const change = () => context.onChange(editor.value);
  const select = () => context.onSelect({ start: editor.selectionStart, end: editor.selectionEnd });
  editor.addEventListener('input', change);
  for (const event of ['click', 'keyup', 'select']) editor.addEventListener(event, select);
  return {
    setSource(source) {
      if (editor.value !== source) editor.value = source;
    },
    reveal(range) {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(range.start, range.end);
      const style = win.getComputedStyle(editor);
      const fontSize = Number.parseFloat(style.fontSize) || 14;
      const lineHeight = Number.parseFloat(style.lineHeight) || fontSize * 1.2;
      const before = editor.value.slice(0, range.start);
      const line = before.split('\n').length - 1;
      const measure = doc.createElement('span');
      measure.className = 'lw-source-measure';
      measure.textContent = before.slice(before.lastIndexOf('\n') + 1);
      Object.assign(measure.style, {
        position: 'absolute', visibility: 'hidden', whiteSpace: 'pre',
        font: style.font, letterSpacing: style.letterSpacing, tabSize: style.tabSize,
      });
      container.append(measure);
      const columnWidth = measure.getBoundingClientRect().width;
      measure.remove();
      editor.scrollTop = Math.max(0, line * lineHeight + (Number.parseFloat(style.paddingTop) || 0) -
        Math.max(0, (editor.clientHeight - lineHeight) / 2));
      editor.scrollLeft = Math.max(0, columnWidth + (Number.parseFloat(style.paddingLeft) || 0) -
        editor.clientWidth / 2);
    },
    destroy() {
      editor.removeEventListener('input', change);
      for (const event of ['click', 'keyup', 'select']) editor.removeEventListener(event, select);
      editor.remove();
    },
  };
};
