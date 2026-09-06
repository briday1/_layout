import { describe, expect, it, vi } from 'vitest';
import { createPugflowAdapter } from '../packages/pugflow/src/index.js';
import { applyEdits } from '../packages/layout/src/edits.js';
import { builtinThemes } from '../packages/layout/src/themes.js';
import type { ParsedDocument } from '../packages/layout/src/types.js';
import type { PugflowModel } from '../packages/pugflow/src/index.js';
import originalPug from '../packages/pugflow/fixtures/original.pug?raw';
import flowAndMergePug from '../packages/pugflow/fixtures/flow-and-merge.pug?raw';
import styledCliPug from '../packages/pugflow/fixtures/styled-cli.pug?raw';
import styledCliCss from '../packages/pugflow/fixtures/styled-cli.css.txt?raw';

const fixtures: Record<string, string> = {
  'original.pug': originalPug,
  'flow-and-merge.pug': flowAndMergePug,
  'styled-cli.pug': styledCliPug,
  'styled-cli.css.txt': styledCliCss,
};
const fixture = (name: string) => fixtures[name];

const source = fixture('original.pug');
const adapter = createPugflowAdapter(source);
const signal = new AbortController().signal;
const parse = (text = source, styles = '') =>
  adapter.parse(text, signal, [styles]) as ParsedDocument<PugflowModel>;
const renderContext = (model: PugflowModel, text = source) => ({
  source: text, model, selection: null, theme: builtinThemes[0],
  canvas: 'preview', companionSources: [''],
});

describe('pugflow adapter (upstream engine fidelity)', () => {
  it('parses the original example into nodes and flows with line mapping', () => {
    const parsed = parse();
    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.model.nodes.map(node => node.id)).toEqual(
      ['root', 'entry-1', 'entry-2', 'entry-3', 'entry-3-1', 'entry-3-2']);
    expect(parsed.model.edges).toHaveLength(5);
    const object = parsed.objects.find(item => item.id === 'node:root')!;
    expect(source.slice(object.range.start, object.range.end)).toContain('.label Root');
  });

  it('renders the upstream SVG structure: shapes, connectors, arrow markers', () => {
    const parsed = parse();
    const container = document.createElement('div');
    adapter.render({
      ...renderContext(parsed.model), container, signal,
      select: vi.fn(), reveal: vi.fn(), edit: vi.fn(),
    });
    const svg = container.querySelector('svg')!;
    expect(svg.classList.contains('pugflow-svg')).toBe(true);
    // Root fans out to three children: default round shape rects + arrow markers.
    expect(svg.querySelectorAll('.label-box').length).toBe(6);
    expect(svg.querySelectorAll('marker').length).toBeGreaterThan(0);
    expect(svg.querySelectorAll('.connector[data-select-kind="line"]').length).toBe(5);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('clicking a node selects it through the adapter contract', () => {
    const parsed = parse();
    const container = document.createElement('div');
    const select = vi.fn();
    adapter.render({
      ...renderContext(parsed.model), container, signal, select, reveal: vi.fn(), edit: vi.fn(),
    });
    const node = container.querySelector<HTMLElement>('[data-selection-key="node:entry-1"]')!;
    node.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0 }));
    node.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
    expect(select).toHaveBeenCalledWith('node:entry-1');
  });

  it('applies reusable CSS-shaped styles from the companion source', () => {
    const text = fixture('styled-cli.pug');
    const styles = fixture('styled-cli.css.txt');
    const parsed = parse(text, styles);
    expect(parsed.diagnostics).toEqual([]);
    const input = parsed.model.nodes.find(node => node.id === 'input')!;
    expect(input.style.shape).toBe('rounded');
    expect(input.style.fill).toBe('#245886');
    const container = document.createElement('div');
    adapter.render({
      ...renderContext(parsed.model, text), container, signal,
      select: vi.fn(), reveal: vi.fn(), edit: vi.fn(),
    });
    const box = container.querySelector('[data-selection-key="node:input"] .label-box, [data-selection-key="node:input"]')!;
    expect(container.innerHTML).toContain('#245886');
    expect(box).toBeTruthy();
  });

  it('renders dashed connectors and flow labels from flow-and-merge', () => {
    const text = fixture('flow-and-merge.pug');
    const parsed = parse(text);
    expect(parsed.diagnostics).toEqual([]);
    const dashed = parsed.model.edges.find(edge => edge.to === 'database')!;
    expect(dashed.style).toBe('dashed');
    const container = document.createElement('div');
    adapter.render({
      ...renderContext(parsed.model, text), container, signal,
      select: vi.fn(), reveal: vi.fn(), edit: vi.fn(),
    });
    expect(container.innerHTML).toContain('stroke-dasharray');
    expect(container.textContent).toContain('route');
    expect(container.textContent).toContain('hit');
  });

  it('updates fields without rewriting unrelated source', () => {
    const parsed = parse();
    const selection = parsed.objects.find(item => item.id === 'node:root')!;
    const edits = adapter.update!({
      source, model: parsed.model, selection, field: 'label', value: 'Origin',
    });
    const updated = applyEdits(source, edits);
    expect(updated).toBe(source.replace('.label Root', '.label Origin'));
    expect(parse(updated).diagnostics).toEqual([]);
  });

  it('edits graph properties', () => {
    const graphSource = `graph
  .id group
  .label Group
  node
    .id first
    .label First
  node
    .id second
    .label Second
`;
    const parsed = parse(graphSource);
    const graph = parsed.objects.find(item => item.id === 'graph:group')!;
    const graphUpdated = applyEdits(graphSource, adapter.update!({
      source: graphSource, model: parsed.model, selection: graph, field: 'label', value: 'Updated group',
    }));
    expect(graphUpdated).toContain('.label Updated group');
    expect(parse(graphUpdated).diagnostics).toEqual([]);
  });

  it('renames node IDs and every flow endpoint atomically', () => {
    const parsed = parse();
    const selection = parsed.objects.find(item => item.id === 'node:root')!;
    const updated = applyEdits(source, adapter.update!({
      source, model: parsed.model, selection, field: 'id', value: 'origin',
    }));
    expect(updated).toContain('.id origin');
    expect(updated.match(/\.from origin/g)).toHaveLength(3);
    expect(parse(updated).diagnostics).toEqual([]);
    expect(() => adapter.update!({
      source, model: parsed.model, selection, field: 'id', value: 'entry-1',
    })).toThrow('already exists');
  });

  it('deletes a node with its connected flows and keeps comments', () => {
    const text = `// keep me\n${source}`;
    const parsed = parse(text);
    const selection = parsed.objects.find(item => item.id === 'node:entry-3')!;
    const updated = applyEdits(text, adapter.commands!.find(c => c.id === 'delete')!.run({
      source: text, model: parsed.model, selection,
    }));
    expect(updated).toContain('// keep me');
    expect(parse(updated).model.nodes.map(node => node.id)).not.toContain('entry-3');
    expect(parse(updated).model.edges.filter(e => e.from === 'entry-3' || e.to === 'entry-3')).toEqual([]);
  });

  it('surfaces upstream parser errors with ranges instead of throwing', () => {
    const bad = parse('graph\n  .id x\n  node\n    .id a\n    .label A\n  flow\n    .from a\n    .to missing\n');
    expect(bad.diagnostics?.some(item => item.severity === 'error')).toBe(true);
    expect(bad.diagnostics?.[0].message).toContain('not defined');
  });

  it('exports standalone SVG and reports per-canvas', async () => {
    const parsed = parse();
    const exported = await adapter.exports![0].export(renderContext(parsed.model));
    expect(exported).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(exported).toContain('<svg');
    expect(exported).toContain('Root');
    expect(exported).not.toContain('connector-hit');
  });
});
