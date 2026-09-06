import { describe, expect, it, vi } from 'vitest';
import { createSankeyAdapter } from '../packages/pug-sankey/src/index.js';
import { fieldEdit } from '../packages/pug-sankey/src/source.js';
import { applyEdits } from '../packages/layout/src/edits.js';
import { builtinThemes } from '../packages/layout/src/themes.js';
import type { ParsedDocument } from '../packages/layout/src/types.js';
import type { SankeyModel } from '../packages/pug-sankey/src/index.js';

const source = `// keep me
node
  .id a
  .label Supply
node
  .id b
  .label Demand
flow
  .from a
  .to b
  .value 12
`;
const adapter = createSankeyAdapter(source);
const signal = new AbortController().signal;
const parse = (text = source) => adapter.parse(text, signal) as ParsedDocument<SankeyModel>;

describe('Sankey adapter', () => {
  it('uses the original grammar and maps labels back to whole declarations', () => {
    const parsed = parse();
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.model.edges[0].value).toBe(12);
    const object = parsed.objects.find(object => object.id === 'node:a')!;
    expect(source.slice(object.range.start, object.range.end)).toBe('node\n  .id a\n  .label Supply\n');
  });

  it('renders original ribbons with selection callbacks and standalone SVG export', async () => {
    const parsed = parse();
    const container = document.createElement('div');
    const select = vi.fn();
    const context = { source, model: parsed.model, selection: null, theme: builtinThemes[0], canvas: 'preview', companionSources: [] };
    await adapter.render({ ...context, container, select, signal, reveal: vi.fn(), edit: vi.fn() });
    container.querySelector('[data-selection-key="a"]')!.dispatchEvent(new MouseEvent('click'));
    expect(select).toHaveBeenCalledWith('node:a');
    const exported = await adapter.exports![0].export(context);
    expect(exported).toContain('<svg');
    expect(exported).toContain('Supply');
    expect(exported).not.toContain('class="pugflow-svg exchange-map interactive"');
  });

  it('updates properties without rewriting unrelated source', () => {
    const parsed = parse();
    const selection = parsed.objects.find(object => object.id === 'node:a')!;
    const edits = adapter.update!({ source, model: parsed.model, selection, field: 'label', value: 'Renewables' });
    const updated = applyEdits(source, edits);
    expect(updated).toBe(source.replace('.label Supply', '.label Renewables'));
    expect(parse(updated).diagnostics).toEqual([]);
  });

  it('renames node IDs and every reference atomically', () => {
    const parsed = parse();
    const selection = parsed.objects.find(object => object.id === 'node:a')!;
    const updated = applyEdits(source, adapter.update!({
      source, model: parsed.model, selection, field: 'id', value: 'supply',
    }));
    expect(updated).toContain('.id supply');
    expect(updated).toContain('.from supply');
    expect(parse(updated).diagnostics).toEqual([]);
    expect(() => adapter.update!({ source, model: parsed.model, selection, field: 'id', value: 'b' })).toThrow('already exists');
  });

  it('deletes connected flows together with a node', () => {
    const parsed = parse();
    const selection = parsed.objects.find(object => object.id === 'node:a')!;
    const updated = applyEdits(source, adapter.commands!.find(command => command.id === 'delete')!.run({
      source, model: parsed.model, selection,
    }));
    expect(updated).toContain('// keep me');
    expect(parse(updated).model.nodes.map(node => node.id)).toEqual(['b']);
    expect(parse(updated).model.edges).toEqual([]);
  });

  it('preserves CRLF and multiline field boundaries', () => {
    const text = 'node\r\n  .id a\r\n  .label\r\n    | old\r\n    | name\r\n  .color red\r\n';
    const updated = applyEdits(text, [fieldEdit(text, { start: 0, end: text.length }, 'label', 'New')]);
    expect(updated).toBe('node\r\n  .id a\r\n  .label New\r\n  .color red\r\n');
  });

  it('supports tab-indented input and optional fields at EOF', () => {
    const text = 'node\n\t.id a';
    const parsed = parse(text);
    const updated = applyEdits(text, adapter.update!({
      source: text, model: parsed.model, selection: parsed.objects[1], field: 'label', value: 'New',
    }));
    expect(parse(updated).diagnostics).toEqual([]);
    expect(parse(updated).model.nodes[0].label).toBe('New');
  });

  it('retains feedback loops, reusable styles and all twelve flow themes', () => {
    const text = `@node accent\n  .color #ff0000\n${source.replace('  .id a', '  .accent\n  .id a')}flow\n  .from b\n  .to a\n  .value 4\n`;
    for (const theme of ['smooth', 'wiggly', 'angular', 'terraced', 'arc', 'ripple', 'circuit', 'zigzag', 'staircase', 'sail', 'dip', 's-bend']) {
      const parsed = parse(`.theme ${theme}\n${text}`);
      expect(parsed.diagnostics).toEqual([]);
      expect(parsed.model.nodes[0].color).toBe('#ff0000');
      const container = document.createElement('div');
      adapter.render({ container, model: parsed.model, source: text, selection: null, theme: builtinThemes[0], canvas: 'preview', companionSources: [], signal, select() {}, reveal() {}, edit() {} });
      expect(container.querySelector('svg')?.dataset.diagramTheme).toBe(theme);
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    }
  });

  it('adds declarations inside an explicit canvas and keeps root definitions', () => {
    const text = '#canvas\n  node\n    .id a\n@node accent\n  .color red\n';
    const parsed = parse(text);
    expect(parsed.diagnostics).toEqual([]);
    const updated = applyEdits(text, adapter.commands![0].run({ source: text, model: parsed.model, selection: null }));
    expect(parse(updated).diagnostics).toEqual([]);
    expect(parse(updated).model.nodes).toHaveLength(2);
    expect(updated).toContain('@node accent\n  .color red');
  });

  it('reports syntax errors with source ranges and accepts empty diagrams', () => {
    expect(parse('').diagnostics).toEqual([]);
    const bad = parse(source.replace('.value 12', '.value nope'));
    expect(bad.diagnostics?.[0].severity).toBe('error');
    expect(bad.diagnostics?.[0].range).toBeDefined();
  });

  it('blocks CSS statements and external paint references, but treats labels as text', async () => {
    expect(parse(source.replace('.label Supply', '.label <script>alert(1)</script>')).diagnostics).toEqual([]);
    for (const setting of ['.font Arial;} @import "https://example.com/x";', '.background url(https://example.com/x)']) {
      expect(parse(`${setting}\n${source}`).diagnostics?.some(item => item.severity === 'error')).toBe(true);
    }
    const parsed = parse(source.replace('.label Supply', '.label <script>alert(1)</script>'));
    const container = document.createElement('div');
    await adapter.render({ container, source, model: parsed.model, selection: null, theme: builtinThemes[0], canvas: 'preview', companionSources: [], signal, select() {}, reveal() {}, edit() {} });
    expect(container.querySelector('script')).toBeNull();
  });
});
