import { applyEdits } from './edits.js';
import { applyTheme, builtinThemes } from './themes.js';
import { createTextareaEditor } from './editor.js';
import { createViewport } from './viewport.js';
import type {
  AdapterCapabilities, Diagnostic, DocumentContext, InspectorField, InspectorSection,
  LayoutAdapter, ParsedDocument, SourceObject, SourceRange, Theme, Workbench,
  WorkbenchOptions, SourceEditor, RenderHandle, TextEdit,
} from './types.js';

/**
 * Capability-first workbench shell. The adapter declares which features exist
 * (navigator, inspector, sections, canvases, companion sources); the shell
 * renders chrome only for enabled capabilities and routes every edit through
 * one atomic source transaction.
 */
export function createWorkbench<Model>(
  root: HTMLElement,
  adapter: LayoutAdapter<Model>,
  options: WorkbenchOptions = {},
): Workbench {
  const doc = root.ownerDocument;
  const win = doc.defaultView!;
  const themes: readonly Theme[] = options.themes?.length ? options.themes : builtinThemes;
  const capabilities: Required<AdapterCapabilities> = {
    navigator: adapter.capabilities?.navigator ?? true,
    inspector: adapter.capabilities?.inspector ?? Boolean(adapter.inspect),
    navigatorGroups: adapter.capabilities?.navigatorGroups ?? false,
    panZoom: adapter.capabilities?.panZoom ?? adapter.preview === 'canvas',
  };
  const companions = adapter.sources ?? [];
  const canvases = adapter.canvases ?? [];
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
  const companionSources: Record<string, string> = {};
  for (const companion of companions) {
    const key = storageKey ? `${storageKey}:${companion.id}` : null;
    const savedCompanion = key ? read(key)?.source : null;
    companionSources[companion.id] =
      options.companionSources?.[companion.id] ??
      (typeof savedCompanion === 'string' ? savedCompanion : companion.initialSource);
  }
  let activeSourceId: string | null = null;
  let canvas = options.canvas && canvases.some(item => item.id === options.canvas)
    ? options.canvas
    : canvases[0]?.id ?? 'preview';
  const preferredScheme = win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  let theme: Theme = themes.find(item => item.id === (options.theme ?? savedTheme)) ??
    themes.find(item => item.id === preferredScheme) ??
    themes.find(item => item.colorScheme === preferredScheme) ?? themes[0];
  let parsed: ParsedDocument<Model> | null = null;
  let selection: SourceObject | null = null;
  let destroyed = false;
  let revision = 0;
  let renderRevision = 0;
  let parseController: AbortController | null = null;
  let renderController: AbortController | null = null;
  let renderCleanup: (() => void) | undefined;
  let renderSelect: RenderHandle['select'];
  let editor: SourceEditor | undefined;
  const exports_ = new Set<AbortController>();
  let importReader: FileReader | null = null;
  /** Undo/redo stacks per source document (primary + each companion). */
  const histories = new Map<string | null, { undo: string[]; redo: string[] }>();
  const historyFor = (id: string | null) => {
    if (!histories.has(id)) histories.set(id, { undo: [], redo: [] });
    return histories.get(id)!;
  };
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
  const sourceTabs = element('div', 'lw-source-tabs');
  sourceTabs.setAttribute('role', 'tablist');
  sourceTabs.setAttribute('aria-label', 'Source documents');
  const editorHost = element('div', 'lw-editor-host');
  sourcePanel.append(sourceTabs, editorHost);
  const previewPanel = element('section', 'lw-preview-panel');
  previewPanel.setAttribute('aria-label', 'Preview');
  const canvasTabs = element('div', 'lw-canvas-tabs');
  canvasTabs.setAttribute('role', 'tablist');
  canvasTabs.setAttribute('aria-label', 'Preview');
  const previewViewport = element('div', 'lw-preview-viewport');
  const preview = element('div', 'lw-preview');
  previewViewport.append(preview);
  const previewControls = element('div', 'lw-preview-controls');
  previewPanel.append(canvasTabs, previewViewport, previewControls);
  const sidebar = element('aside', 'lw-sidebar');
  const navigator = element('nav', 'lw-navigator');
  navigator.setAttribute('aria-label', 'Objects');
  const inspector = element('section', 'lw-inspector');
  inspector.setAttribute('aria-label', 'Inspector');
  if (capabilities.navigator) sidebar.append(navigator);
  if (capabilities.inspector) sidebar.append(inspector);
  if (!capabilities.navigator && !capabilities.inspector) sidebar.hidden = true;
  main.append(sourcePanel, previewPanel, sidebar);
  const diagnostics = element('ul', 'lw-diagnostics');
  diagnostics.setAttribute('aria-label', 'Diagnostics');
  const status = element('div', 'lw-status');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  const fileInput = element('input', 'lw-file-input');
  fileInput.type = 'file';
  const activeExtension = () => activeSourceId
    ? companions.find(item => item.id === activeSourceId)!.extension
    : adapter.extension;
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
    renderSelect = undefined;
    cleanup(previous);
    preview.replaceChildren();
  }
  function context(): DocumentContext<Model> | null {
    return parsed ? { source, model: parsed.model, selection } : null;
  }
  function companionList(): string[] {
    return companions.map(item => companionSources[item.id] ?? item.initialSource);
  }
  function validRange(range: SourceRange) {
    return Number.isInteger(range.start) && Number.isInteger(range.end) &&
      range.start >= 0 && range.end >= range.start && range.end <= source.length;
  }
  function focusRange(range: SourceRange) {
    if (!validRange(range)) return;
    if (sourcePanel.hidden) setMode('split');
    try { editor?.reveal(range); } catch (error) { report(error); }
  }
  function showDiagnostics(items: Diagnostic[]) {
    try { editor?.setDiagnostics?.(items); } catch (error) { report(error); }
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
    if (!capabilities.navigator) return;
    navigator.replaceChildren(element('h2', 'lw-heading', 'Objects'));
    const objects = parsed?.objects ?? [];
    if (!capabilities.navigatorGroups) {
      objects.forEach(object => navigator.append(objectButton(object)));
      return;
    }
    const groups = new Map<string, SourceObject[]>();
    objects.forEach(object => {
      const key = object.kind;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(object);
    });
    groups.forEach((items, kind) => {
      const heading = element('h3', 'lw-navigator-group', kind);
      navigator.append(heading);
      items.forEach(object => navigator.append(objectButton(object)));
    });
  }
  function objectButton(object: SourceObject) {
    const node = element('button', 'lw-object', object.label);
    node.type = 'button';
    node.dataset.objectId = object.id;
    node.setAttribute('aria-pressed', String(object.id === selection?.id));
    if (object.detail) {
      const detail = element('span', 'lw-object-detail', object.detail);
      node.append(detail);
    }
    if (object.hidden) node.classList.add('lw-object-hidden');
    node.onclick = () => select(object.id);
    return node;
  }
  function sectionsOf(fields: InspectorField[] | InspectorSection[]): InspectorSection[] {
    if (!fields.length) return [];
    if ('fields' in (fields[0] as InspectorSection)) return fields as InspectorSection[];
    return [{ id: 'properties', fields: fields as InspectorField[] }];
  }
  function buildInspector() {
    if (!capabilities.inspector) return;
    inspector.replaceChildren(element('h2', 'lw-heading', 'Inspector'));
    const current = context();
    if (!current || !selection || !adapter.inspect) {
      inspector.append(element('p', 'lw-empty', 'Select an object to inspect.'));
      return;
    }
    try {
      const fieldRevision = revision;
      const objectId = selection.id;
      const sections = sectionsOf(adapter.inspect(current));
      sections.forEach(section => {
        if (sections.length > 1 || section.title) {
          inspector.append(element('h3', 'lw-inspector-section', section.title ?? section.id));
        }
        section.fields.forEach(field => {
          const label = element('label', 'lw-field');
          label.append(element('span', 'lw-field-label', field.label));
          const input = field.type === 'select'
            ? element('select', 'lw-field-input')
            : field.type === 'textarea'
              ? element('textarea', 'lw-field-input')
              : element('input', 'lw-field-input');
          input.setAttribute('aria-label', field.label);
          input.dataset.field = field.id;
          if (input instanceof win.HTMLSelectElement) {
            field.options?.forEach(item => {
              const option = element('option', '', item.label);
              option.value = item.value;
              input.append(option);
            });
            input.value = String(field.value);
          } else if (input instanceof win.HTMLTextAreaElement) {
            input.value = String(field.value ?? '');
            input.rows = 3;
            input.spellcheck = false;
          } else {
            input.type = field.type === 'color' ? 'text' : field.type;
            if (field.type === 'checkbox') input.checked = Boolean(field.value);
            else input.value = String(field.value ?? '');
            if (field.placeholder) input.placeholder = field.placeholder;
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
            if (input instanceof win.HTMLInputElement && !input.checkValidity()) {
              report(input.validationMessage);
              return;
            }
            try {
              changeSource(applyEdits(source, adapter.update({ ...latest, field: field.id, value })));
            } catch (error) { report(error); }
          };
          label.append(input);
          if (field.help) label.append(element('span', 'lw-field-help', field.help));
          inspector.append(label);
        });
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
    if (changed) {
      if (renderSelect) {
        try { renderSelect(selection); } catch (error) { report(error); }
      } else void render();
    }
  }
  function objectAt(range: SourceRange): SourceObject | null {
    const objects = parsed?.objects.filter(item => validRange(item.range)) ?? [];
    const containing = objects.filter(item => item.range.start <= range.start &&
      (range.end > range.start ? item.range.end >= range.end :
        range.start < item.range.end || (item.range.start === range.start && item.range.end === range.start)));
    const size = (object: SourceObject) => object.range.end - object.range.start;
    if (containing.length) return containing.sort((a, b) => size(a) - size(b))[0];
    const distance = (object: SourceObject) =>
      Math.max(object.range.start - range.start, range.start - object.range.end, 0);
    return objects.sort((a, b) => distance(a) - distance(b) || size(a) - size(b))[0] ?? null;
  }
  function reveal(range: SourceRange) {
    if (destroyed || !validRange(range)) return;
    select(objectAt(range)?.id ?? null, false);
    focusRange(range);
  }
  function edit(edits: TextEdit[]) {
    if (destroyed) return;
    try { changeSource(applyEdits(source, edits)); } catch (error) { report(error); }
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
    container.style.visibility = 'hidden';
    preview.append(container);
    preview.setAttribute('aria-busy', 'true');
    const isCurrent = () => !destroyed && revision === currentRevision &&
      renderRevision === currentRender && !controller.signal.aborted;
    try {
      const result = await adapter.render({
        ...current, container, theme, canvas, companionSources: companionList(),
        signal: controller.signal,
        select: id => { if (isCurrent()) select(id); },
        reveal: range => { if (isCurrent()) reveal(range); },
        edit: edits => { if (isCurrent()) edit(edits); },
      });
      const dispose = typeof result === 'function' ? result : result ? () => result.destroy() : undefined;
      if (!isCurrent()) {
        cleanup(dispose);
        container.replaceChildren();
        container.remove();
        return;
      }
      renderCleanup = dispose;
      renderSelect = result && typeof result !== 'function' && result.select
        ? selection => result.select!(selection) : undefined;
      container.style.visibility = '';
      preview.removeAttribute('aria-busy');
    } catch (error) {
      if (isCurrent()) { preview.removeAttribute('aria-busy'); report(error); }
      container.replaceChildren();
      container.remove();
    }
  }
  const documentActions: HTMLButtonElement[] = [];
  function updateActions() {
    const history = historyFor(activeSourceId);
    undoButton.disabled = history.undo.length === 0;
    redoButton.disabled = history.redo.length === 0;
    documentActions.forEach(node => { node.disabled = !parsed; });
  }
  async function parse() {
    const currentRevision = ++revision;
    const selectedId = selection?.id;
    parseController?.abort();
    cancelExports();
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
      const result = await adapter.parse(source, controller.signal, companionList());
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
    for (const companion of companions) {
      persist(storageKey ? `${storageKey}:${companion.id}` : null,
        { source: companionSources[companion.id] });
    }
    try { options.onChange?.(source); } catch (error) { report(error); }
  }
  function currentSource(): string {
    return activeSourceId ? companionSources[activeSourceId] : source;
  }
  function setCurrentSource(value: string) {
    if (activeSourceId) companionSources[activeSourceId] = value;
    else source = value;
  }
  function changeSource(value: string, history = true) {
    if (destroyed || value === currentSource()) return;
    if (history) {
      const stack = historyFor(activeSourceId);
      stack.undo.push(currentSource());
      stack.redo.length = 0;
    }
    setCurrentSource(value);
    try { editor?.setSource(currentSource()); } catch (error) { report(error); }
    void parse();
    notify();
  }
  function undoSource() {
    const stack = historyFor(activeSourceId);
    if (!stack.undo.length || destroyed) return;
    stack.redo.push(currentSource());
    changeSource(stack.undo.pop()!, false);
  }
  function redoSource() {
    const stack = historyFor(activeSourceId);
    if (!stack.redo.length || destroyed) return;
    stack.undo.push(currentSource());
    changeSource(stack.redo.pop()!, false);
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
    if (win.confirm('Reset to the example? This replaces the current source.')) {
      if (activeSourceId) {
        changeSource(companions.find(item => item.id === activeSourceId)!.initialSource);
      } else changeSource(adapter.initialSource);
    }
  });
  button('Import', actions, () => fileInput.click());
  button('Save source', actions, () => {
    try { download(currentSource(), activeExtension(), 'text/plain;charset=utf-8'); } catch (error) { report(error); }
  });
  const undoButton = button('Undo', actions, undoSource);
  const redoButton = button('Redo', actions, redoSource);
  const commandGroups = new Map<string, HTMLElement>();
  adapter.commands?.forEach(command => {
    const groupId = command.group ?? '';
    if (!commandGroups.has(groupId)) {
      const group = element('div', 'lw-command-group');
      actions.append(group);
      commandGroups.set(groupId, group);
    }
    const node = button(command.label, commandGroups.get(groupId)!, () => {
      const current = context();
      if (!current || destroyed) return;
      try { changeSource(applyEdits(source, command.run(current))); } catch (error) { report(error); }
    });
    documentActions.push(node);
  });
  function rebuildExports() {
    exportButtons.forEach(node => node.remove());
    exportButtons.length = 0;
    adapter.exports?.filter(format => !format.canvases || format.canvases.includes(canvas))
      .forEach(format => {
        const node = button(format.label, actions, () => {
          const current = context();
          if (!current || destroyed) return;
          const exportRevision = revision;
          const controller = new AbortController();
          exports_.add(controller);
          try {
            void Promise.resolve(format.export({
              ...current, theme, canvas, companionSources: companionList(), signal: controller.signal,
            })).then(data => {
              if (!destroyed && !controller.signal.aborted && exportRevision === revision) {
                download(data, format.extension, format.mimeType);
              }
            }).catch(error => {
              if (!destroyed && !controller.signal.aborted && exportRevision === revision) report(error);
            }).finally(() => exports_.delete(controller));
          } catch (error) { exports_.delete(controller); report(error); }
        });
        documentActions.push(node);
        exportButtons.push(node);
      });
  }
  const exportButtons: HTMLButtonElement[] = [];
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
    cancelExports();
    themeSelect.value = theme.id;
    applyTheme(root, theme);
    try { editor?.setTheme?.(theme); } catch (error) { report(error); }
    persist(themeKey, { theme: theme.id });
    if (parsed) void render();
  }
  listen(themeSelect, 'change', () => setTheme(themeSelect.value));
  themeSelect.value = theme.id;
  applyTheme(root, theme);
  function cancelExports() {
    exports_.forEach(controller => controller.abort());
    exports_.clear();
  }
  // Source tabs switch between the primary document and companion sources.
  function buildSourceTabs() {
    sourceTabs.replaceChildren();
    if (!companions.length) { sourceTabs.hidden = true; return; }
    sourceTabs.hidden = false;
    const tabs: { id: string | null; label: string }[] = [
      { id: null, label: adapter.title },
      ...companions.map(item => ({ id: item.id as string | null, label: item.label })),
    ];
    tabs.forEach(tab => {
      const node = element('button', 'lw-source-tab', tab.label);
      node.type = 'button';
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(tab.id === activeSourceId));
      node.onclick = () => setActiveSource(tab.id);
      sourceTabs.append(node);
    });
  }
  function setActiveSource(id: string | null) {
    if (destroyed || id === activeSourceId) return;
    if (id !== null && !companions.some(item => item.id === id)) return;
    activeSourceId = id;
    buildSourceTabs();
    updateActions();
    try { editor?.setSource(currentSource()); } catch (error) { report(error); }
  }
  // Canvas tabs switch preview surfaces (e.g. gantt chart vs table).
  function buildCanvasTabs() {
    canvasTabs.replaceChildren();
    if (canvases.length < 2) { canvasTabs.hidden = true; return; }
    canvasTabs.hidden = false;
    canvases.forEach(profile => {
      const node = element('button', 'lw-canvas-tab', profile.label);
      node.type = 'button';
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(profile.id === canvas));
      node.onclick = () => setCanvas(profile.id);
      canvasTabs.append(node);
    });
  }
  function setCanvas(id: string) {
    if (destroyed || id === canvas || !canvases.some(item => item.id === id)) return;
    canvas = id;
    buildCanvasTabs();
    rebuildExports();
    if (parsed) void render();
  }
  buildSourceTabs();
  buildCanvasTabs();
  rebuildExports();
  editor = (options.createEditor ?? createTextareaEditor)({
    container: editorHost, source: currentSource(), language: adapter.language, theme,
    onChange: value => changeSource(value),
    onSelect: range => {
      if (parsed && !destroyed && validRange(range)) select(objectAt(range)?.id ?? null, false);
    },
  });
  let viewport: { destroy(): void; reset(): void } | null = null;
  if (capabilities.panZoom) viewport = createViewport(previewViewport, preview, previewControls);
  void parse();
  return {
    getSource: () => source,
    setSource: value => changeSource(value),
    getActiveSourceId: () => activeSourceId,
    setActiveSource,
    select,
    reveal,
    edit,
    setTheme,
    setCanvas,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      revision++;
      parseController?.abort();
      cancelExports();
      importReader?.abort();
      importReader = null;
      viewport?.destroy();
      clearRender();
      cleanup(() => editor?.destroy());
      disposers.forEach(dispose => dispose());
      root.replaceChildren();
      root.classList.remove('lw-workbench');
      delete root.dataset.mode;
      parsed = null;
      selection = null;
    },
  };
}
