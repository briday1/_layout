import { describe, expect, it, vi } from 'vitest';
import { createJsonanttAdapter } from '../packages/jsonantt/src/index.js';
import { applyEdits } from '../packages/layout/src/edits.js';
import { builtinThemes } from '../packages/layout/src/themes.js';
import type { ParsedDocument } from '../packages/layout/src/types.js';
import type { JsonanttModel } from '../packages/jsonantt/src/index.js';
import simpleJson from '../packages/jsonantt/fixtures/simple.json?raw';
import dependenciesJson from '../packages/jsonantt/fixtures/dependencies.json?raw';
import colorsJson from '../packages/jsonantt/fixtures/colors.json?raw';
import chainedJson from '../packages/jsonantt/fixtures/chained-milestones.json?raw';
import complexJson from '../packages/jsonantt/fixtures/complex.json?raw';

const adapter = createJsonanttAdapter(simpleJson);
const signal = new AbortController().signal;
const parse = (text: string) => adapter.parse(text, signal) as ParsedDocument<JsonanttModel>;
const ctx = (model: JsonanttModel, source: string, canvas = 'gantt') => ({
  source, model, selection: null, theme: builtinThemes[0], canvas, companionSources: [],
});

describe('jsonantt adapter (gantt fidelity)', () => {
  it('parses the simple example: 5 phases, nested children, milestones', () => {
    const parsed = parse(simpleJson);
    expect(parsed.diagnostics).toEqual([]);
    const { config } = parsed.model;
    expect(config.title).toBe('Simple Project');
    expect(config.tasks).toHaveLength(5);
    expect(config.tasks[0].children.map(t => t.name)).toEqual(
      ['Requirements gathering', 'Architecture design', 'Planning complete']);
    expect(config.tasks[0].children[2].milestone).toBe(true);
    expect(config.style.major_tick).toBe('year');
    expect(config.style.minor_tick).toBe('quarter');
  });

  it('renders the gantt SVG with palette colors, bars, diamonds, and tick grid', () => {
    const parsed = parse(simpleJson);
    const container = document.createElement('div');
    adapter.render({ ...ctx(parsed.model, simpleJson), container, signal, select: vi.fn(), reveal: vi.fn(), edit: vi.fn() });
    const svg = container.querySelector('svg.jsonantt-chart')!;
    expect(svg).toBeTruthy();
    // 22 rows: 5 phases + 17 children.
    expect(svg.querySelectorAll('.jsonantt-row')).toHaveLength(22);
    // Bars for non-milestone leaf rows with explicit dates.
    expect(svg.querySelectorAll('.task-bar').length).toBeGreaterThan(10);
    // Milestones drawn as diamonds with the default gold color.
    const milestones = svg.querySelectorAll('.milestone');
    expect(milestones.length).toBeGreaterThanOrEqual(5);
    expect(milestones[0].getAttribute('fill')).toBe('#FFD700');
    // First top-level task takes the first palette color.
    const firstBar = [...svg.querySelectorAll('.task-bar')][0];
    expect(firstBar.getAttribute('fill')).toBe('#4472C4');
    // Year gridlines present.
    expect(svg.querySelectorAll('.grid-major').length).toBeGreaterThan(2);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('resolves not_before chains and duration specs (dependencies fixture)', () => {
    const parsed = parse(dependenciesJson);
    expect(parsed.diagnostics).toEqual([]);
    const { config } = parsed.model;
    const byId = new Map<string, { start: string | null; end: string | null }>();
    const walk = (tasks: { id: string | null; start: Date | null; end: Date | null; children: unknown[] }[]) => {
      for (const task of tasks) {
        if (task.id) {
          byId.set(task.id, {
            start: task.start?.toISOString().slice(0, 10) ?? null,
            end: task.end?.toISOString().slice(0, 10) ?? null,
          });
        }
        walk(task.children as typeof tasks);
      }
    };
    walk(config.tasks as never);
    // design: 2024-01-06 + 3m → 2024-04-06 (upstream month arithmetic)
    expect(byId.get('design')).toEqual({ start: '2024-01-06', end: '2024-04-06' });
    // mockups starts at wireframes end (2024-01-06 + 6w = 2024-02-17)
    expect(byId.get('mockups')?.start).toBe('2024-02-17');
    // launch milestone lands at rollout's end
    expect(byId.get('launch')?.start).toBe(byId.get('rollout')?.end);
  });

  it('renders chained milestone markers on one row', () => {
    const parsed = parse(chainedJson);
    expect(parsed.diagnostics).toEqual([]);
    const container = document.createElement('div');
    adapter.render({ ...ctx(parsed.model, chainedJson), container, signal, select: vi.fn(), reveal: vi.fn(), edit: vi.fn() });
    const milestones = container.querySelectorAll('.milestone');
    expect(milestones.length).toBeGreaterThan(2);
  });

  it('maps task colors and palette inheritance (colors fixture)', () => {
    const parsed = parse(colorsJson);
    expect(parsed.diagnostics).toEqual([]);
    const container = document.createElement('div');
    adapter.render({ ...ctx(parsed.model, colorsJson), container, signal, select: vi.fn(), reveal: vi.fn(), edit: vi.fn() });
    const fills = new Set([...container.querySelectorAll('.task-bar')].map(b => b.getAttribute('fill')));
    expect(fills.size).toBeGreaterThan(2);
  });

  it('table canvas renders header, gutter colors, and CSV export', async () => {
    const parsed = parse(simpleJson);
    const container = document.createElement('div');
    adapter.render({
      ...ctx(parsed.model, simpleJson, 'table'), container, signal,
      select: vi.fn(), reveal: vi.fn(), edit: vi.fn(),
    });
    const table = container.querySelector('svg.jsonantt-table')!;
    expect(table).toBeTruthy();
    expect(table.textContent).toContain('Task');
    expect(table.textContent).toContain('Requirements gathering');
    const csv = await adapter.exports!.find(e => e.id === 'csv')!.export(
      ctx(parsed.model, simpleJson, 'table'));
    expect(String(csv)).toContain('Task,Name,Description');
    expect(String(csv)).toContain('Phase 1 — Planning');
  });

  it('clicking a row selects the task by JSON pointer', () => {
    const parsed = parse(simpleJson);
    const container = document.createElement('div');
    const select = vi.fn();
    adapter.render({ ...ctx(parsed.model, simpleJson), container, signal, select, reveal: vi.fn(), edit: vi.fn() });
    const row = container.querySelector<SVGElement>('.jsonantt-row[data-number="1.1"]')!;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(select).toHaveBeenCalledWith('task:/tasks/0/children/0');
  });

  it('navigator objects carry task ranges that slice real JSON', () => {
    const parsed = parse(simpleJson);
    const task = parsed.objects.find(o => o.id === 'task:/tasks/0/children/0')!;
    const slice = simpleJson.slice(task.range.start, task.range.end);
    expect(JSON.parse(slice).name).toBe('Requirements gathering');
  });

  it('edits a task name through the inspector without reformatting the document', () => {
    const parsed = parse(simpleJson);
    const selection = parsed.objects.find(o => o.id === 'task:/tasks/0/children/0')!;
    const edits = adapter.update!({
      source: simpleJson, model: parsed.model, selection, field: 'name', value: 'Discovery',
    });
    const updated = applyEdits(simpleJson, edits);
    expect(updated).toContain('"name": "Discovery"');
    expect(updated).not.toContain('Requirements gathering');
    expect(parse(updated).diagnostics).toEqual([]);
  });

  it('updates chart style fields via /style pointer', () => {
    const withRowHeight = simpleJson.replace(
      '"major_tick": "year",', '"major_tick": "year",\n    "row_height": 0.3,');
    const parsed = parse(withRowHeight);
    const selection = parsed.objects.find(o => o.kind === 'chart')!;
    const edits = adapter.update!({
      source: withRowHeight, model: parsed.model, selection,
      field: 'style.row_height', value: 0.5,
    });
    const updated = applyEdits(withRowHeight, edits);
    expect(updated).toContain('"row_height": 0.5');
    expect(updated).not.toContain('"row_height": 0.3');
    expect(parse(updated).diagnostics).toEqual([]);
  });

  it('reports invalid JSON and unknown not_before references as diagnostics', () => {
    expect(parse('{ nope').diagnostics?.[0].message).toContain('Invalid JSON');
    const badRef = parse('{"tasks":[{"name":"A","not_before":"ghost","duration":"3d"}]}');
    expect(badRef.diagnostics?.[0].message).toContain("unknown id: 'ghost'");
  });

  it('exports standalone gantt SVG with ticks and title', async () => {
    const parsed = parse(simpleJson);
    const svg = await adapter.exports!.find(e => e.id === 'svg')!.export(ctx(parsed.model, simpleJson));
    expect(String(svg)).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(String(svg)).toContain('Simple Project');
    expect(String(svg)).toContain('grid-major');
  });

  it('handles the complex example end-to-end', () => {
    const parsed = parse(complexJson);
    expect(parsed.diagnostics).toEqual([]);
    const container = document.createElement('div');
    adapter.render({ ...ctx(parsed.model, complexJson), container, signal, select: vi.fn(), reveal: vi.fn(), edit: vi.fn() });
    expect(container.querySelectorAll('.jsonantt-row').length).toBeGreaterThan(8);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});
