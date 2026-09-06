import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkbench } from '../packages/layout/src/workbench.js';
import { builtinThemes } from '../packages/layout/src/themes.js';
import type {
  LayoutAdapter, ParsedDocument, RenderContext, RenderHandle, Workbench, WorkbenchOptions, SourceEditorContext,
} from '../packages/layout/src/types.js';

const plainAdapter = (): LayoutAdapter<string> => ({
  id: 'plain',
  title: 'Plain text studio',
  extension: 'txt',
  initialSource: 'hello',
  parse: source => ({
    model: source,
    objects: source ? [{ id: 'text', label: source, kind: 'text', range: { start: 0, end: source.length } }] : [],
  }),
  render: ({ model, container, select }) => {
    const node = document.createElement('button');
    node.textContent = model;
    node.onclick = () => select('text');
    container.append(node);
  },
  inspect: ({ model }) => [{ id: 'text', label: 'Text value', type: 'text', value: model }],
  update: ({ source, value }) => [{ start: 0, end: source.length, text: String(value) }],
  commands: [{
    id: 'upper', label: 'Uppercase',
    run: ({ source }) => [{ start: 0, end: source.length, text: source.toUpperCase() }],
  }],
  exports: [{
    id: 'text', label: 'Export text', extension: 'txt', mimeType: 'text/plain',
    export: ({ source }) => source,
  }],
});

const jsonAdapter = (): LayoutAdapter<{ name: string }> => ({
  id: 'json',
  title: 'JSON studio',
  extension: 'json',
  initialSource: '{"name":"hello"}',
  parse: source => {
    const model = JSON.parse(source) as { name: string };
    const start = source.indexOf(JSON.stringify(model.name));
    return {
      model,
      objects: [
        { id: 'root', label: 'Document', kind: 'object', range: { start: 0, end: source.length } },
        { id: 'name', label: model.name, kind: 'property', range: { start, end: start + JSON.stringify(model.name).length } },
      ],
    };
  },
  render: ({ model, container, select }) => {
    const node = document.createElement('button');
    node.textContent = model.name;
    node.onclick = () => select('name');
    container.append(node);
  },
  inspect: ({ model, selection }) => selection?.id === 'name'
    ? [{ id: 'name', label: 'Name', type: 'text', value: model.name }] : [],
  update: ({ selection, value }) => [{ ...selection!.range, text: JSON.stringify(value) }],
});

const workbenches: Workbench[] = [];
function mount<Model>(adapter: LayoutAdapter<Model>, options: WorkbenchOptions = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const workbench = createWorkbench(root, adapter, options);
  workbenches.push(workbench);
  return { root, workbench, editor: root.querySelector('textarea')! };
}
function getButton(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')].find(item => item.textContent === label);
  if (!button) throw new Error(`Missing button: ${label}`);
  return button;
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
function input(editor: HTMLTextAreaElement, value: string) {
  editor.value = value;
  editor.dispatchEvent(new Event('input', { bubbles: true }));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
function parsed(source: string): ParsedDocument<string> {
  return { model: source, objects: [{ id: 'text', label: source, kind: 'text', range: { start: 0, end: source.length } }] };
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  workbenches.splice(0).forEach(workbench => workbench.destroy());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('source-agnostic workbench', () => {
  it('provides semantic controls and switches modes without losing source', async () => {
    const { root, editor, workbench } = mount(plainAdapter());
    await settle();
    expect(root.querySelector('h1')?.textContent).toBe('Plain text studio');
    expect(editor.getAttribute('aria-label')).toBe('Source editor');
    expect(root.querySelector('.lw-preview')?.textContent).toBe('hello');
    getButton(root, 'Preview').click();
    expect(root.dataset.mode).toBe('preview');
    expect(root.querySelector<HTMLElement>('.lw-source-panel')!.hidden).toBe(true);
    getButton(root, 'Source').click();
    expect(root.querySelector<HTMLElement>('.lw-preview-panel')!.hidden).toBe(true);
    getButton(root, 'Split').click();
    expect(root.querySelector<HTMLElement>('.lw-source-panel')!.hidden).toBe(false);
    expect(workbench.getSource()).toBe('hello');
  });

  it('selects from preview, edits plain source through the adapter, and reparses', async () => {
    const adapter = plainAdapter();
    const update = vi.spyOn(adapter, 'update');
    const parse = vi.spyOn(adapter, 'parse');
    const onChange = vi.fn();
    const { root, editor, workbench } = mount(adapter, { onChange });
    await settle();
    getButton(root, 'Preview').click();
    root.querySelector<HTMLButtonElement>('.lw-preview button')!.click();
    expect(root.dataset.mode).toBe('split');
    expect(document.activeElement).toBe(editor);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 5]);
    const field = root.querySelector<HTMLInputElement>('[aria-label="Text value"]')!;
    field.value = '<img src=x onerror=alert(1)>';
    field.dispatchEvent(new Event('change'));
    await settle();
    expect(update).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenLastCalledWith(field.value, expect.any(AbortSignal));
    expect(workbench.getSource()).toBe(field.value);
    expect(onChange).toHaveBeenLastCalledWith(field.value);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('.lw-preview')?.textContent).toBe(field.value);
  });

  it('supports JSON selection, innermost caret objects, and source-only inspector changes', async () => {
    const { root, editor, workbench } = mount(jsonAdapter());
    await settle();
    editor.setSelectionRange(10, 10);
    editor.dispatchEvent(new Event('keyup'));
    expect(root.querySelector('[data-object-id="name"]')?.getAttribute('aria-pressed')).toBe('true');
    const field = root.querySelector<HTMLInputElement>('[aria-label="Name"]')!;
    field.value = 'a"b';
    field.dispatchEvent(new Event('change'));
    await settle();
    expect(workbench.getSource()).toBe('{"name":"a\\"b"}');
    expect(root.querySelector('.lw-preview')?.textContent).toBe('a"b');
    workbench.select('root');
    editor.dispatchEvent(new Event('select'));
    expect(root.querySelector('[data-object-id="root"]')?.getAttribute('aria-pressed')).toBe('true');
    workbench.select(null);
    expect(root.querySelector('.lw-inspector')?.textContent).toContain('Select an object');
  });

  it('scrolls distant source ranges into view and reveals the editor from navigator selection', async () => {
    const source = `${'line\n'.repeat(200)}target`;
    const adapter = plainAdapter();
    adapter.parse = () => ({
      model: source,
      objects: [{ id: 'target', label: 'Distant object', kind: 'text', range: { start: 1000, end: 1006 } }],
    });
    const { root, editor } = mount(adapter, { source });
    editor.style.lineHeight = '20px';
    Object.defineProperty(editor, 'clientHeight', { value: 200 });
    await settle();
    getButton(root, 'Preview').click();
    getButton(root, 'Distant object').click();
    expect(root.dataset.mode).toBe('split');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([1000, 1006]);
    expect(editor.scrollTop).toBeGreaterThan(3800);
    expect(root.querySelector('.lw-source-measure')).toBeNull();
  });

  it('treats multi-edit commands as one undo transaction, including textarea shortcuts', async () => {
    const adapter = plainAdapter();
    adapter.commands = [{
      id: 'wrap', label: 'Wrap', run: ({ source }) => [
        { start: 0, end: 0, text: '[' }, { start: source.length, end: source.length, text: ']' },
      ],
    }];
    const { root, editor, workbench } = mount(adapter);
    await settle();
    getButton(root, 'Wrap').click();
    expect(workbench.getSource()).toBe('[hello]');
    const undo = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true });
    editor.dispatchEvent(undo);
    expect(undo.defaultPrevented).toBe(true);
    expect(workbench.getSource()).toBe('hello');
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Z', metaKey: true, shiftKey: true, bubbles: true }));
    expect(workbench.getSource()).toBe('[hello]');
    getButton(root, 'Undo').click();
    input(editor, 'new branch');
    expect(getButton(root, 'Redo').disabled).toBe(true);
    getButton(root, 'Undo').click();
    expect(editor.value).toBe('hello');
  });

  it('requires confirmation for new and reset and preserves undo', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const { root, workbench } = mount(plainAdapter(), { source: 'custom' });
    await settle();
    getButton(root, 'New').click();
    expect(workbench.getSource()).toBe('custom');
    confirm.mockReturnValue(true);
    getButton(root, 'New').click();
    expect(workbench.getSource()).toBe('');
    getButton(root, 'Reset').click();
    expect(workbench.getSource()).toBe('hello');
    getButton(root, 'Undo').click();
    expect(workbench.getSource()).toBe('');
  });

  it('disables invalid document actions and ignores stale preview and inspector events', async () => {
    const adapter = plainAdapter();
    adapter.parse = source => source === 'bad'
      ? { ...parsed(source), diagnostics: [{ severity: 'error', message: 'Bad source', range: { start: 0, end: 3 } }] }
      : parsed(source);
    const update = vi.spyOn(adapter, 'update');
    const { root, editor, workbench } = mount(adapter);
    await settle();
    workbench.select('text');
    await settle();
    const oldPreview = root.querySelector<HTMLButtonElement>('.lw-preview button')!;
    const oldField = root.querySelector<HTMLInputElement>('[aria-label="Text value"]')!;
    input(editor, 'bad');
    expect(getButton(root, 'Uppercase').disabled).toBe(true);
    await settle();
    oldPreview.click();
    oldField.dispatchEvent(new Event('change'));
    expect(update).not.toHaveBeenCalled();
    expect(root.querySelector('.lw-preview')?.textContent).toBe('');
    expect(getButton(root, 'Export text').disabled).toBe(true);
    expect(root.querySelector('.lw-inspector input')).toBeNull();
    getButton(root, 'Bad source').click();
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([0, 3]);
    input(editor, 'fixed');
    await settle();
    expect(getButton(root, 'Export text').disabled).toBe(false);
  });

  it('reports thrown parse/update/inspect errors without changing source', async () => {
    const adapter = plainAdapter();
    adapter.update = () => { throw new Error('Update failed'); };
    const { root, workbench } = mount(adapter);
    await settle();
    workbench.select('text');
    root.querySelector<HTMLInputElement>('.lw-inspector input')!.dispatchEvent(new Event('change'));
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Update failed');
    expect(workbench.getSource()).toBe('hello');
    adapter.inspect = () => { throw new Error('Inspect failed'); };
    workbench.select('text');
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Inspect failed');
    adapter.parse = () => { throw new Error('Parse failed'); };
    workbench.setSource('error');
    await settle();
    expect(root.querySelector('.lw-diagnostics')?.textContent).toBe('Parse failed');
    expect(getButton(root, 'Uppercase').disabled).toBe(true);
  });

  it('passes typed inspector values and enforces read-only and invalid-number controls', async () => {
    const adapter = plainAdapter();
    adapter.inspect = () => [
      { id: 'count', label: 'Count', type: 'number', value: 2, min: 0, max: 10, step: 1 },
      { id: 'enabled', label: 'Enabled', type: 'checkbox', value: true },
      { id: 'choice', label: 'Choice', type: 'select', value: 'a', options: [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] },
      { id: 'locked', label: 'Locked', type: 'text', value: 'fixed', readOnly: true },
    ];
    const update = vi.fn(() => []);
    adapter.update = update;
    const { root, workbench } = mount(adapter);
    await settle();
    workbench.select('text');
    const number = root.querySelector<HTMLInputElement>('[aria-label="Count"]')!;
    number.value = '7';
    number.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'count', value: 7 }));
    number.value = '';
    number.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledTimes(1);
    const checkbox = root.querySelector<HTMLInputElement>('[aria-label="Enabled"]')!;
    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'enabled', value: false }));
    const choice = root.querySelector<HTMLSelectElement>('[aria-label="Choice"]')!;
    choice.value = 'b';
    choice.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ field: 'choice', value: 'b' }));
    const locked = root.querySelector<HTMLInputElement>('[aria-label="Locked"]')!;
    expect(locked.disabled).toBe(true);
    locked.dispatchEvent(new Event('change'));
    expect(update).toHaveBeenCalledTimes(3);
  });

  it('rejects invalid adapter edit transactions without mutating source or undo history', async () => {
    const adapter = plainAdapter();
    adapter.commands = [{
      id: 'invalid', label: 'Invalid edit', run: () => [
        { start: 0, end: 2, text: 'x' }, { start: 1, end: 3, text: 'y' },
      ],
    }];
    const { root, workbench } = mount(adapter);
    await settle();
    getButton(root, 'Invalid edit').click();
    expect(workbench.getSource()).toBe('hello');
    expect(getButton(root, 'Undo').disabled).toBe(true);
    expect(root.querySelector('[role="status"]')?.textContent).toMatch(/overlap/);
  });

  it('saves source and adapter exports through object URL downloads', async () => {
    const urls = { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() };
    vi.stubGlobal('URL', Object.assign(class extends URL {}, urls));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const adapter = plainAdapter();
    const exportFn = vi.spyOn(adapter.exports![0], 'export');
    const { root } = mount(adapter);
    await settle();
    getButton(root, 'Save source').click();
    getButton(root, 'Export text').click();
    await settle();
    expect(click).toHaveBeenCalledTimes(2);
    expect(exportFn).toHaveBeenCalledWith(expect.objectContaining({ source: 'hello', model: 'hello', theme: expect.any(Object) }));
    expect(urls.createObjectURL).toHaveBeenCalledTimes(2);
    await new Promise(resolve => setTimeout(resolve, 1));
    expect(urls.revokeObjectURL).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });

  it('imports a local text file as an undoable source transaction', async () => {
    const { root, workbench } = mount(plainAdapter());
    const upload = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(upload, 'files', { value: [new File(['local file'], 'example.txt', { type: 'text/plain' })] });
    upload.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(workbench.getSource()).toBe('local file'));
    getButton(root, 'Undo').click();
    expect(workbench.getSource()).toBe('hello');
  });
});

describe('persistence', () => {
  it('defaults to the system color scheme without persisting an unchosen preference', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const system = mount(plainAdapter());
    expect(system.root.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!.value).toBe('dark');
    expect(localStorage.getItem('layout:plain:document:theme')).toBeNull();
    const explicit = mount(plainAdapter(), { theme: 'light' });
    expect(explicit.root.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!.value).toBe('light');
    system.workbench.setTheme('light');
    const saved = mount(plainAdapter());
    expect(saved.root.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!.value).toBe('light');
  });

  it('isolates adapters, restores versioned source, and persists theme separately', async () => {
    const first = mount(plainAdapter());
    first.workbench.setSource('persisted plain');
    const otherTheme = builtinThemes.find(theme => theme.id !== builtinThemes[0].id)!;
    first.workbench.setTheme(otherTheme.id);
    await settle();
    first.workbench.destroy();
    const second = mount(plainAdapter());
    const json = mount(jsonAdapter());
    expect(second.workbench.getSource()).toBe('persisted plain');
    expect(json.workbench.getSource()).toBe('{"name":"hello"}');
    expect(second.root.querySelector<HTMLSelectElement>('[aria-label="Theme"]')!.value).toBe(otherTheme.id);
    const stored = JSON.parse(localStorage.getItem('layout:plain:document')!);
    expect(stored).toEqual({ version: 1, source: 'persisted plain' });
    expect(localStorage.getItem('layout:plain:document:theme')).not.toBeNull();
  });

  it('honors explicit initial source and custom keys or disabled persistence', () => {
    localStorage.setItem('custom', JSON.stringify({ version: 1, source: 'stored' }));
    expect(mount(plainAdapter(), { storageKey: 'custom' }).workbench.getSource()).toBe('stored');
    expect(mount(plainAdapter(), { storageKey: 'custom', source: '' }).workbench.getSource()).toBe('');
    const disabled = mount(plainAdapter(), { storageKey: false });
    disabled.workbench.setSource('not saved');
    expect(localStorage.getItem('layout:plain:document')).toBeNull();
  });

  it.each(['{broken', 'null', '{"version":9,"source":"old"}', '{"version":1,"source":17}'])(
    'ignores corrupt or unsupported stored values: %s', stored => {
      localStorage.setItem('layout:plain:document', stored);
      expect(mount(plainAdapter()).workbench.getSource()).toBe('hello');
    },
  );

  it('continues working when storage access and writes throw', async () => {
    const failure = () => { throw new Error('Storage unavailable'); };
    const instance = mount(plainAdapter(), { storage: { getItem: failure, setItem: failure, removeItem: failure } });
    instance.workbench.setSource('still works');
    await settle();
    expect(instance.root.querySelector('.lw-preview')?.textContent).toBe('still works');
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(failure);
    expect(mount(plainAdapter()).workbench.getSource()).toBe('hello');
  });
});

describe('asynchronous lifecycle', () => {
  it('mounts renderers in a connected, themed container before measuring the preview', async () => {
    const adapter = plainAdapter();
    const connected = vi.fn();
    adapter.render = ({ container }) => {
      connected(container.isConnected, container.closest('[data-theme]')?.getAttribute('data-theme'));
      container.textContent = 'Measured canvas';
    };
    const { root } = mount(adapter, { theme: 'dracula' });
    await settle();
    expect(connected).toHaveBeenCalledWith(true, 'dracula');
    expect(root.querySelector<HTMLElement>('.lw-render')!.style.visibility).toBe('');
    expect(root.querySelector('.lw-preview')?.hasAttribute('aria-busy')).toBe(false);
  });

  it('updates selection through render handles without rebuilding expensive previews', async () => {
    const adapter = plainAdapter();
    const select = vi.fn();
    const destroy = vi.fn();
    const render = vi.fn(({ container }: RenderContext<string>) => {
      container.textContent = 'Persistent preview';
      return { select, destroy };
    });
    adapter.render = render;
    const { root, workbench } = mount(adapter);
    await settle();
    const canvas = root.querySelector('.lw-render');
    workbench.select('text');
    workbench.select(null);
    expect(select.mock.calls.map(([object]) => object?.id ?? null)).toEqual(['text', null]);
    expect(render).toHaveBeenCalledOnce();
    expect(root.querySelector('.lw-render')).toBe(canvas);
    workbench.setSource('replacement');
    await settle();
    expect(destroy).toHaveBeenCalledOnce();
    workbench.destroy();
    expect(destroy).toHaveBeenCalledTimes(2);
  });

  it('cleans late render handles without installing their selection hooks', async () => {
    const adapter = plainAdapter();
    const pending = deferred<RenderHandle>();
    const late = { select: vi.fn(), destroy: vi.fn() };
    adapter.render = ({ model }) => model === 'hello' ? pending.promise : undefined;
    const { workbench } = mount(adapter);
    await settle();
    workbench.setSource('new');
    await settle();
    pending.resolve(late);
    await settle();
    expect(late.destroy).toHaveBeenCalledOnce();
    workbench.select('text');
    expect(late.select).not.toHaveBeenCalled();
  });

  it.each(['source', 'theme', 'destroy'])('aborts backend exports on %s changes', async change => {
    const adapter = plainAdapter();
    const pending = deferred<string>();
    let signal!: AbortSignal;
    adapter.exports![0].export = context => { signal = context.signal!; return pending.promise; };
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { root, workbench } = mount(adapter);
    await settle();
    getButton(root, 'Export text').click();
    expect(signal.aborted).toBe(false);
    if (change === 'source') workbench.setSource('new');
    else if (change === 'theme') workbench.setTheme('dark');
    else workbench.destroy();
    expect(signal.aborted).toBe(true);
    pending.resolve('obsolete output');
    await settle();
    expect(click).not.toHaveBeenCalled();
  });

  it('reveals arbitrary UTF-16 preview ranges and selects the nearest inspector object', async () => {
    const adapter = jsonAdapter();
    const contexts: RenderContext<{ name: string }>[] = [];
    adapter.render = context => { contexts.push(context); };
    const { root, editor, workbench } = mount(adapter, { source: '{"name":"😀hello"}' });
    await settle();
    getButton(root, 'Preview').click();
    contexts.at(-1)!.reveal({ start: 9, end: 11 });
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([9, 11]);
    expect(root.dataset.mode).toBe('split');
    expect(document.activeElement).toBe(editor);
    expect(root.querySelector('[data-object-id="name"]')?.getAttribute('aria-pressed')).toBe('true');
    expect(root.querySelector<HTMLInputElement>('[aria-label="Name"]')?.value).toBe('😀hello');
    await settle();
    contexts.at(-1)!.reveal({ start: -1, end: 99 });
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([9, 11]);
    workbench.destroy();

    const sparse = plainAdapter();
    let sparseContext!: RenderContext<string>;
    sparse.parse = source => ({ model: source, objects: [
      { id: 'text', label: 'Word', kind: 'text', range: { start: 0, end: 5 } },
    ] });
    sparse.render = context => { sparseContext = context; };
    const other = mount(sparse, { source: 'hello    ' });
    await settle();
    sparseContext.reveal({ start: 7, end: 8 });
    other.editor.dispatchEvent(new Event('select'));
    expect([other.editor.selectionStart, other.editor.selectionEnd]).toEqual([7, 8]);
    expect(other.root.querySelector('.lw-inspector input')).not.toBeNull();
  });

  describe('replaceable source editors', () => {
    it('keeps history, mapping, diagnostics and themes in the host with a custom editor', async () => {
      const adapter = jsonAdapter();
      adapter.language = 'json';
      let context!: SourceEditorContext;
      const editor = { setSource: vi.fn(), reveal: vi.fn(), setTheme: vi.fn(), setDiagnostics: vi.fn(), destroy: vi.fn() };
      const { root, workbench } = mount(adapter, {
        createEditor: supplied => {
          context = supplied;
          supplied.container.textContent = 'Custom editor surface';
          return editor;
        },
      });
      await settle();
      expect(root.querySelector('textarea')).toBeNull();
      expect(context.language).toBe('json');
      expect(context.container.isConnected).toBe(true);
      expect(context.source).toBe('{"name":"hello"}');
      context.onSelect({ start: 10, end: 10 });
      expect(root.querySelector('[data-object-id="name"]')?.getAttribute('aria-pressed')).toBe('true');
      workbench.reveal({ start: 9, end: 11 });
      expect(editor.reveal).toHaveBeenCalledWith({ start: 9, end: 11 });
      workbench.edit([{ start: 9, end: 14, text: 'world' }]);
      expect(workbench.getSource()).toBe('{"name":"world"}');
      expect(editor.setSource).toHaveBeenLastCalledWith('{"name":"world"}');
      getButton(root, 'Undo').click();
      expect(editor.setSource).toHaveBeenLastCalledWith('{"name":"hello"}');
      context.onChange('invalid JSON');
      await settle();
      expect(editor.setDiagnostics).toHaveBeenLastCalledWith([expect.objectContaining({ severity: 'error' })]);
      workbench.setTheme('dark');
      expect(editor.setTheme).toHaveBeenCalledWith(builtinThemes[1]);
      workbench.destroy();
      expect(editor.destroy).toHaveBeenCalledOnce();
      context.onChange('too late');
      context.onSelect({ start: 0, end: 1 });
      workbench.edit([{ start: 0, end: 0, text: 'too late' }]);
      workbench.reveal({ start: 0, end: 1 });
      expect(workbench.getSource()).toBe('invalid JSON');
      expect(editor.reveal).toHaveBeenCalledOnce();
    });

    it('ignores invalid custom-editor ranges and reports integration exceptions', async () => {
      let context!: SourceEditorContext;
      const { root, workbench } = mount(plainAdapter(), {
        createEditor: supplied => {
          context = supplied;
          return {
            setSource() {}, destroy() {},
            reveal() { throw new Error('Editor failed'); },
          };
        },
      });
      await settle();
      context.onSelect({ start: -1, end: 100 });
      expect(root.querySelector('[aria-pressed="true"][data-object-id]')).toBeNull();
      workbench.reveal({ start: 0, end: 1 });
      expect(root.querySelector('[role="status"]')?.textContent).toBe('Editor failed');
    });
  });

  it('applies current preview edits as one persisted undo transaction and ignores stale callbacks', async () => {
    const contexts: RenderContext<string>[] = [];
    const adapter = plainAdapter();
    const onChange = vi.fn();
    adapter.render = context => { contexts.push(context); context.container.textContent = context.source; };
    const { root, editor, workbench } = mount(adapter, { onChange });
    await settle();
    const initial = contexts[0];
    initial.edit([
      { start: 0, end: 0, text: '[' },
      { start: 5, end: 5, text: ']' },
    ]);
    expect(workbench.getSource()).toBe('[hello]');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('[hello]');
    expect(JSON.parse(localStorage.getItem('layout:plain:document')!).source).toBe('[hello]');
    await settle();
    expect(root.querySelector('.lw-preview')?.textContent).toBe('[hello]');
    editor.setSelectionRange(2, 2);
    initial.reveal({ start: 0, end: 1 });
    initial.edit([{ start: 0, end: 7, text: 'stale' }]);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 2]);
    expect(workbench.getSource()).toBe('[hello]');
    getButton(root, 'Undo').click();
    expect(workbench.getSource()).toBe('hello');
    expect(getButton(root, 'Undo').disabled).toBe(true);
    await settle();
    const current = contexts.at(-1)!;
    current.edit([{ start: 0, end: 99, text: 'invalid' }]);
    expect(workbench.getSource()).toBe('hello');
    workbench.destroy();
    current.edit([{ start: 0, end: 5, text: 'destroyed' }]);
    current.reveal({ start: 0, end: 1 });
    expect(workbench.getSource()).toBe('hello');
  });

  it('aborts and ignores stale parse resolutions and rejections', async () => {
    const old = deferred<ParsedDocument<string>>();
    const latest = deferred<ParsedDocument<string>>();
    const signals: AbortSignal[] = [];
    const adapter = plainAdapter();
    adapter.parse = (source, signal) => { signals.push(signal); return source === 'hello' ? old.promise : latest.promise; };
    const { root, workbench } = mount(adapter);
    workbench.setSource('latest');
    expect(signals[0].aborted).toBe(true);
    latest.resolve(parsed('latest'));
    await settle();
    old.resolve(parsed('hello'));
    await settle();
    expect(root.querySelector('.lw-preview')?.textContent).toBe('latest');
    const pending = deferred<ParsedDocument<string>>();
    adapter.parse = () => pending.promise;
    workbench.setSource('waiting');
    adapter.parse = source => parsed(source);
    workbench.setSource('current');
    pending.reject(new Error('stale failure'));
    await settle();
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Ready');
  });

  it('isolates stale render writes, aborts signals, and cleans late and replaced results once', async () => {
    const first = deferred<() => void>();
    const contexts: RenderContext<string>[] = [];
    const staleCleanup = vi.fn();
    const currentCleanup = vi.fn();
    const adapter = plainAdapter();
    adapter.render = context => {
      contexts.push(context);
      context.container.textContent = context.model;
      return context.model === 'hello' ? first.promise : currentCleanup;
    };
    const { root, workbench } = mount(adapter);
    await settle();
    expect(contexts[0].container.isConnected).toBe(true);
    expect(contexts[0].container.style.visibility).toBe('hidden');
    workbench.setSource('latest');
    await settle();
    expect(contexts[0].signal.aborted).toBe(true);
    contexts[0].container.textContent = 'late mutation';
    contexts[0].select('text');
    expect(root.querySelector('.lw-preview')?.textContent).toBe('latest');
    first.resolve(staleCleanup);
    await settle();
    expect(staleCleanup).toHaveBeenCalledOnce();
    expect(currentCleanup).not.toHaveBeenCalled();
    workbench.destroy();
    workbench.destroy();
    expect(currentCleanup).toHaveBeenCalledOnce();
  });

  it('cleans replaced render results on theme changes without reparsing', async () => {
    const adapter = plainAdapter();
    const parse = vi.spyOn(adapter, 'parse');
    const clean = vi.fn();
    adapter.render = ({ container, theme }) => { container.textContent = theme.id; return clean; };
    const { root, workbench } = mount(adapter);
    await settle();
    workbench.setTheme(builtinThemes[1].id);
    await settle();
    expect(clean).toHaveBeenCalledOnce();
    expect(parse).toHaveBeenCalledOnce();
    expect(root.querySelector('.lw-preview')?.textContent).toBe(builtinThemes[1].id);
  });

  it('handles throwing cleanup and late render completion after destroy', async () => {
    const adapter = plainAdapter();
    const late = deferred<() => void>();
    const cleanup = vi.fn(() => { throw new Error('Cleanup failed'); });
    adapter.render = ({ model }) => model === 'late' ? late.promise : cleanup;
    const { root, workbench, editor } = mount(adapter);
    await settle();
    expect(() => workbench.setSource('late')).not.toThrow();
    await settle();
    expect(cleanup).toHaveBeenCalledOnce();
    workbench.destroy();
    const lateCleanup = vi.fn(() => { throw new Error('Late cleanup failed'); });
    late.resolve(lateCleanup);
    await settle();
    expect(lateCleanup).toHaveBeenCalledOnce();
    expect(root.childElementCount).toBe(0);
    input(editor, 'ignored');
    workbench.setSource('ignored');
    expect(workbench.getSource()).toBe('late');
  });

  it('does not render when parsing resolves after destroy and catches render failures', async () => {
    const adapter = plainAdapter();
    const pending = deferred<ParsedDocument<string>>();
    adapter.parse = () => pending.promise;
    const render = vi.spyOn(adapter, 'render');
    const instance = mount(adapter);
    instance.workbench.destroy();
    pending.resolve(parsed('hello'));
    await settle();
    expect(render).not.toHaveBeenCalled();
    const broken = plainAdapter();
    broken.render = async () => { throw new Error('Render failed'); };
    const { root } = mount(broken);
    await settle();
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Render failed');
  });

  it('suppresses stale export downloads and export failures after a source change', async () => {
    const adapter = plainAdapter();
    const pending = deferred<string>();
    adapter.exports![0].export = () => pending.promise;
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const { root, workbench } = mount(adapter);
    await settle();
    getButton(root, 'Export text').click();
    workbench.setSource('new source');
    pending.resolve('old export');
    await settle();
    expect(click).not.toHaveBeenCalled();
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Ready');
  });
});
