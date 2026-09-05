import { applyEdits } from './edits.js';
import { applyTheme, builtinThemes } from './themes.js';
import type {
  Diagnostic, DocumentContext, LayoutAdapter, ParsedDocument, SourceObject,
  SourceRange, Theme, Workbench, WorkbenchOptions,
} from './types.js';

export function createWorkbench<Model>(
  root: HTMLElement,
  adapter: LayoutAdapter<Model>,
  options: WorkbenchOptions = {},
): Workbench {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const themes: readonly Theme[] = options.themes?.length ? options.themes : builtinThemes;
  const storageKey = options.storageKey === false ? null :
    options.storageKey ?? `layout:${adapter.id}:document`;
  let storage: WorkbenchOptions['storage'];
  if (storageKey) {
    try { storage = options.storage ?? win.localStorage; } catch { /* Storage is optional. */ }
  }
  function read(key: string): Record<string, unknown> | null {
    try {
      const value: unknown = JSON.parse(storage?.getItem(key) ?? 'null');
      return value && typeof value === 'object' && 'version' in value && value.version === 1
        ? value as Record<string, unknown> : null;
    } catch { return null; }
  }
  function persist(key: string | null, value: Record<string, unknown>) {
    if (!key) return;
    try { storage?.setItem(key, JSON.stringify({ version: 1, ...value })); } catch { /* Quota/private mode. */ }
  }
  const saved = storageKey ? read(storageKey) : null;
  const themeKey = storageKey ? `${storageKey}:theme` : null;
  const savedTheme = themeKey ? read(themeKey)?.theme : null;
  let source = options.source ?? (typeof saved?.source === 'string' ? saved.source : adapter.initialSource);
  let theme: Theme = themes.find(item => item.id === (options.theme ?? savedTheme)) ?? themes[0];
  let parsed: ParsedDocument<Model> | null = null;
  let selection: SourceObject | null = null;
  let destroyed = false;
  let revision = 0;
  let renderRevision = 0;
  let parseController: AbortController | null = null;
  let renderController: AbortController | null = null;
  let renderCleanup: (() => void) | undefined;
  let importReader: FileReader | null = null;
  const undo: string[] = [];
  const redo: string[] = [];
  const disposers: (() => void)[] = [];

  function element<K extends keyof HTMLElementTagNameMap>(
    tag: K, className: string, text?: string,
  ): HTMLElementTagNameMap[K] {
    const node = doc.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function listen(target: EventTarget, event: string, handler: EventListener) {
    target.addEventListener(event, handler);
    disposers.push(() => target.removeEventListener(event, handler));
  }
  function button(label: string, parent: HTMLElement, action: () => void) {
    const node = element('button', 'lw-button', label);
    node.type = 'button';
    listen(node, 'click', action);
    parent.append(node);
    return node;
  }
  root.classList.add('lw-workbench');
  root.dataset.mode = 'split';
  const toolbar = element('header', 'lw-toolbar');
  toolbar.append(element('h1', 'lw-title', adapter.title));
  const modes = element('div', 'lw-modes');
  modes.setAttribute('role', 'group');
  modes.setAttribute('aria-label', 'View mode');
  function setMode(mode: string) {
    root.dataset.mode = mode;
    sourcePanel.hidden = mode === 'preview';
    previewPanel.hidden = mode === 'source';
    modeButtons.forEach(item => item.setAttribute('aria-pressed', String(item.dataset.mode === mode)));
  }
  const modeButtons = ['source', 'split', 'preview'].map(mode => {
    const node = button(mode[0].toUpperCase() + mode.slice(1), modes, () => setMode(mode));
    node.dataset.mode = mode;
    node.setAttribute('aria-pressed', String(mode === 'split'));
    return node;
  });
  const themeSelect = element('select', 'lw-theme-select');
  themeSelect.setAttribute('aria-label', 'Theme');
  themes.forEach(item => {
    const option = element('option', '', item.label);
    option.value = item.id;
    themeSelect.append(option);
  });
  toolbar.append(modes, themeSelect);
  const actions = element('div', 'lw-actions');
  toolbar.append(actions);
  const main = element('main', 'lw-main');
  const sourcePanel = element('section', 'lw-source-panel');
  sourcePanel.setAttribute('aria-label', 'Source');
  const editor = element('textarea', 'lw-editor');
  editor.setAttribute('aria-label', 'Source editor');
  editor.spellcheck = false;
  editor.value = source;
  sourcePanel.append(editor);
  const previewPanel = element('section', 'lw-preview-panel');
  previewPanel.setAttribute('aria-label', 'Preview');
  const preview = element('div', 'lw-preview');
  previewPanel.append(preview);
  const sidebar = element('aside', 'lw-sidebar');
  const navigator = element('nav', 'lw-navigator');
  navigator.setAttribute('aria-label', 'Objects');
  const inspector = element('section', 'lw-inspector');
  inspector.setAttribute('aria-label', 'Inspector');
  sidebar.append(navigator, inspector);
  main.append(sourcePanel, previewPanel, sidebar);
  const diagnostics = element('ul', 'lw-diagnostics');
  diagnostics.setAttribute('aria-label', 'Diagnostics');
  const status = element('div', 'lw-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const fileInput = element('input', 'lw-file-input');
  fileInput.type = 'file';
  fileInput.accept = adapter.extension.startsWith('.') ? adapter.extension : `.${adapter.extension}`;
  fileInput.hidden = true;
  root.replaceChildren(toolbar, main, diagnostics, status, fileInput);

  function report(error: unknown) {
    if (!destroyed) status.textContent = error instanceof Error ? error.message : String(error);
  }
  function cleanup(fn: (() => void) | undefined) {
    try { fn?.(); } catch (error) { report(error); }
  }
  function clearRender() {
    renderRevision++;
    renderController?.abort();
    renderController = null;
    const previous = renderCleanup;
    renderCleanup = undefined;
    cleanup(previous);
    preview.replaceChildren();
  }
  function context(): DocumentContext<Model> | null {
    return parsed ? { source, model: parsed.model, selection } : null;
  }
  function validRange(range: SourceRange) {
    return Number.isInteger(range.start) && Number.isInteger(range.end) &&
      range.start >= 0 && range.end >= range.start && range.end <= source.length;
  }
  function focusRange(range: SourceRange) {
    if (!validRange(range)) return;
    if (sourcePanel.hidden) setMode('split');
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(range.start, range.end);
  }
  function showDiagnostics(items: Diagnostic[]) {
    diagnostics.replaceChildren();
    items.forEach(item => {
      const row = element('li', `lw-diagnostic lw-diagnostic-${item.severity}`);
      if (item.range && validRange(item.range)) {
        const range = item.range;
        const node = element('button', 'lw-diagnostic-link', item.message);
        node.type = 'button';
        node.onclick = () => { if (!destroyed) focusRange(range); };
        row.append(node);
      } else row.textContent = item.message;
      diagnostics.append(row);
    });
  }
  function buildNavigator() {
    navigator.replaceChildren(element('h2', 'lw-heading', 'Objects'));
    parsed?.objects.forEach(object => {
      const node = element('button', 'lw-object', object.label);
      node.type = 'button';
      node.dataset.objectId = object.id;
      node.setAttribute('aria-pressed', String(object.id === selection?.id));
      node.onclick = () => select(object.id);
      navigator.append(node);
    });
  }
  function buildInspector() {
    inspector.replaceChildren(element('h2', 'lw-heading', 'Inspector'));
    const current = context();
    if (!current || !selection || !adapter.inspect) {
      inspector.append(element('p', 'lw-empty', 'Select an object to inspect.'));
      return;
    }
    try {
      const fieldRevision = revision;
      const objectId = selection.id;
      adapter.inspect(current).forEach(field => {
        const label = element('label', 'lw-field');
        label.append(element('span', 'lw-field-label', field.label));
        const input = field.type === 'select' ? element('select', 'lw-field-input') : element('input', 'lw-field-input');
        input.setAttribute('aria-label', field.label);
        input.dataset.field = field.id;
        if (input instanceof win.HTMLSelectElement) {
          field.options?.forEach(item => {
            const option = element('option', '', item.label);
            option.value = item.value;
            input.append(option);
          });
          input.value = String(field.value);
        } else {
          input.type = field.type;
          if (field.type === 'checkbox') input.checked = Boolean(field.value);
          else input.value = String(field.value);
          if (field.min !== undefined) input.min = String(field.min);
          if (field.max !== undefined) input.max = String(field.max);
          if (field.step !== undefined) input.step = String(field.step);
        }
        input.disabled = !!field.readOnly || !adapter.update;
        input.onchange = () => {
          const latest = context();
          if (destroyed || fieldRevision !== revision || selection?.id !== objectId ||
              !latest || !adapter.update || input.disabled) return;
          const value = input instanceof win.HTMLInputElement && field.type === 'checkbox' ? input.checked :
            field.type === 'number' ? Number(input.value) : input.value;
          if (field.type === 'number' && (input.value === '' || !Number.isFinite(value))) {
            report('Enter a valid number.');
            return;
          }
          try {
            changeSource(applyEdits(source, adapter.update({ ...latest, field: field.id, value })));
          } catch (error) { report(error); }
        };
        label.append(input);
        inspector.append(label);
      });
    } catch (error) { report(error); }
  }
  function select(id: string | null, focus = true) {
    if (destroyed) return;
    const next = parsed?.objects.find(item => item.id === id) ?? null;
    const changed = next?.id !== selection?.id;
    selection = next;
    buildNavigator();
    buildInspector();
    if (next && focus) focusRange(next.range);
    if (changed) void render();
  }
  async function render() {
    clearRender();
    const current = context();
    if (!current || destroyed) return;
    const currentRevision = revision;
    const currentRender = renderRevision;
    const controller = new AbortController();
    renderController = controller;
    const container = element('div', 'lw-render');
    const isCurrent = () => !destroyed && revision === currentRevision &&
      renderRevision === currentRender && !controller.signal.aborted;
    try {
      const result = await adapter.render({
        ...current, container, theme, signal: controller.signal,
        select: id => { if (isCurrent()) select(id); },
      });
      if (!isCurrent()) {
        cleanup(typeof result === 'function' ? result : undefined);
        container.replaceChildren();
        return;
      }
      renderCleanup = typeof result === 'function' ? result : undefined;
      preview.replaceChildren(container);
      preview.removeAttribute('aria-busy');
    } catch (error) {
      if (isCurrent()) { preview.removeAttribute('aria-busy'); report(error); }
      container.replaceChildren();
    }
  }
  const documentActions: HTMLButtonElement[] = [];
  function updateActions() {
    undoButton.disabled = undo.length === 0;
    redoButton.disabled = redo.length === 0;
    documentActions.forEach(node => { node.disabled = !parsed; });
  }
  async function parse() {
    const currentRevision = ++revision;
    const selectedId = selection?.id;
    parseController?.abort();
    const controller = new AbortController();
    parseController = controller;
    clearRender();
    parsed = null;
    selection = null;
    buildNavigator();
    buildInspector();
    updateActions();
    showDiagnostics([]);
    preview.setAttribute('aria-busy', 'true');
    status.textContent = 'Parsing…';
    try {
      const result = await adapter.parse(source, controller.signal);
      if (destroyed || revision !== currentRevision || controller.signal.aborted) return;
      showDiagnostics(result.diagnostics ?? []);
      if (result.diagnostics?.some(item => item.severity === 'error')) {
        status.textContent = 'Source has errors.';
        preview.removeAttribute('aria-busy');
        return;
      }
      parsed = result;
      selection = result.objects.find(item => item.id === selectedId) ?? null;
      buildNavigator();
      buildInspector();
      updateActions();
      status.textContent = 'Ready';
      await render();
    } catch (error) {
      if (destroyed || revision !== currentRevision || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : String(error);
      showDiagnostics([{ severity: 'error', message }]);
      preview.removeAttribute('aria-busy');
      report(error);
    }
  }
  function notify() {
    persist(storageKey, { source });
    try { options.onChange?.(source); } catch (error) { report(error); }
  }
  function changeSource(value: string, history = true) {
    if (destroyed || value === source) return;
    if (history) { undo.push(source); redo.length = 0; }
    source = value;
    editor.value = source;
    void parse();
    notify();
  }
  function undoSource() {
    if (!undo.length || destroyed) return;
    redo.push(source);
    changeSource(undo.pop()!, false);
  }
  function redoSource() {
    if (!redo.length || destroyed) return;
    undo.push(source);
    changeSource(redo.pop()!, false);
  }
  function download(data: string | Blob, extension: string, mimeType: string) {
    const blob = typeof data === 'string' ? new Blob([data], { type: mimeType }) : data;
    const url = win.URL.createObjectURL(blob);
    const anchor = element('a', 'lw-download');
    anchor.href = url;
    anchor.download = `${adapter.id}.${extension.replace(/^\./, '')}`;
    root.append(anchor);
    try { anchor.click(); } finally {
      anchor.remove();
      win.setTimeout(() => win.URL.revokeObjectURL(url), 0);
    }
  }
  button('New', actions, () => {
    if (win.confirm('Create a new document? This replaces the current source.')) changeSource('');
  });
  button('Reset', actions, () => {
    if (win.confirm('Reset to the example? This replaces the current source.')) changeSource(adapter.initialSource);
  });
  button('Import', actions, () => fileInput.click());
  button('Save source', actions, () => {
    try { download(source, adapter.extension, 'text/plain;charset=utf-8'); } catch (error) { report(error); }
  });
  const undoButton = button('Undo', actions, undoSource);
  const redoButton = button('Redo', actions, redoSource);
  adapter.commands?.forEach(command => {
    const node = button(command.label, actions, () => {
      const current = context();
      if (!current || destroyed) return;
      try { changeSource(applyEdits(source, command.run(current))); } catch (error) { report(error); }
    });
    documentActions.push(node);
  });
  adapter.exports?.forEach(format => {
    const node = button(format.label, actions, () => {
      const current = context();
      if (!current || destroyed) return;
      const exportRevision = revision;
      try {
        void Promise.resolve(format.export({ ...current, theme })).then(data => {
          if (!destroyed && exportRevision === revision) download(data, format.extension, format.mimeType);
        }).catch(error => { if (!destroyed && exportRevision === revision) report(error); });
      } catch (error) { report(error); }
    });
    documentActions.push(node);
  });
  listen(fileInput, 'change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    const importRevision = revision;
    importReader?.abort();
    const reader = new win.FileReader();
    importReader = reader;
    reader.onload = () => {
      if (!destroyed && importRevision === revision && typeof reader.result === 'string') changeSource(reader.result);
    };
    reader.onerror = () => { if (!destroyed) report('Unable to read this file.'); };
    reader.onloadend = () => { if (importReader === reader) importReader = null; };
    reader.readAsText(file);
  });
  listen(editor, 'input', () => changeSource(editor.value));
  const caretSelection = () => {
    if (!parsed || destroyed) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const object = parsed.objects.filter(item => validRange(item.range) &&
      item.range.start <= start && (end > start ? item.range.end >= end :
        start < item.range.end || (item.range.start === start && item.range.end === start)))
      .sort((a, b) => (a.range.end - a.range.start) - (b.range.end - b.range.start))[0];
    select(object?.id ?? null, false);
  };
  listen(editor, 'click', caretSelection);
  listen(editor, 'keyup', caretSelection);
  listen(editor, 'select', caretSelection);
  listen(root, 'keydown', event => {
    const key = event as KeyboardEvent;
    if ((key.ctrlKey || key.metaKey) && !key.altKey && key.key.toLowerCase() === 'z') {
      key.preventDefault();
      if (key.shiftKey) redoSource(); else undoSource();
    }
  });
  function setTheme(id: string) {
    if (destroyed) return;
    const next = themes.find(item => item.id === id);
    if (!next) return;
    theme = next;
    themeSelect.value = theme.id;
    applyTheme(root, theme);
    persist(themeKey, { theme: theme.id });
    if (parsed) void render();
  }
  listen(themeSelect, 'change', () => setTheme(themeSelect.value));
  setTheme(theme.id);
  void parse();
  return {
    getSource: () => source,
    setSource: value => changeSource(value),
    select,
    setTheme,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      revision++;
      parseController?.abort();
      importReader?.abort();
      importReader = null;
      clearRender();
      disposers.forEach(dispose => dispose());
      root.replaceChildren();
      root.classList.remove('lw-workbench');
      delete root.dataset.mode;
      parsed = null;
      selection = null;
    },
  };
}
