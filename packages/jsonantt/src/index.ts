import type {
  DocumentContext, InspectorSection, LayoutAdapter, SourceObject, SourceRange,
  TextEdit, Theme,
} from '@briday1/layout';
import { defineAdapter, svgToPng } from '@briday1/layout';
import { parseChart } from './engine/parser.js';
import type { ChartConfig, Task } from './engine/models.js';
import { effectiveEnd, effectiveStart } from './engine/models.js';
import { flattenRows, renderChartSvg, rowLabelText } from './engine/renderer.js';
import { renderTableSvg, tableCsv } from './engine/table.js';

export interface JsonanttModel {
  config: ChartConfig;
  /** Task identity → JSON pointer path within the document (e.g. /tasks/2/children/0). */
  taskPaths: Map<Task, string>;
}

/** Locate the range of a JSON pointer's value in the source text. */
function pointerRange(source: string, pointer: string): SourceRange {
  const segments = pointer.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  // Minimal JSON value locator: walks keys/indices tracking character offsets.
  let index = 0;
  const ws = () => { while (/\s/.test(source[index])) index++; };
  const stringValue = () => {
    const start = index;
    index++; // opening quote
    while (index < source.length) {
      if (source[index] === '\\') index += 2;
      else if (source[index] === '"') { index++; break; }
      else index++;
    }
    return source.slice(start, index);
  };
  const value = (): SourceRange => {
    ws();
    const start = index;
    const char = source[index];
    if (char === '"') { stringValue(); return { start, end: index }; }
    if (char === '{') {
      index++;
      ws();
      if (source[index] === '}') { index++; return { start, end: index }; }
      while (index < source.length) {
        ws(); stringValue(); ws();
        if (source[index] === ':') index++;
        value(); ws();
        if (source[index] === ',') { index++; continue; }
        if (source[index] === '}') { index++; break; }
      }
      return { start, end: index };
    }
    if (char === '[') {
      index++;
      ws();
      if (source[index] === ']') { index++; return { start, end: index }; }
      while (index < source.length) {
        value(); ws();
        if (source[index] === ',') { index++; continue; }
        if (source[index] === ']') { index++; break; }
      }
      return { start, end: index };
    }
    while (index < source.length && !/[\s,\]}]/.test(source[index])) index++;
    return { start, end: index };
  };
  let current: SourceRange = { start: 0, end: source.length };
  for (const segment of segments) {
    // Descend one level from `current.start`.
    index = current.start;
    ws();
    if (/^\d+$/.test(segment)) {
      // Array index
      index++; // [
      ws();
      let target = Number(segment);
      let found: SourceRange | null = null;
      if (source[index] !== ']') {
        while (index < source.length) {
          const childRange = value();
          if (target === 0) { found = childRange; break; }
          target--;
          ws();
          if (source[index] === ',') { index++; continue; }
          break;
        }
      }
      current = found ?? current;
    } else {
      // Object key
      index++; // {
      ws();
      let found: SourceRange | null = null;
      if (source[index] !== '}') {
        while (index < source.length) {
          ws();
          const key = JSON.parse(stringValue()) as string;
          ws();
          if (source[index] === ':') index++;
          const childRange = value();
          if (key === segment) { found = childRange; break; }
          ws();
          if (source[index] === ',') { index++; continue; }
          break;
        }
      }
      current = found ?? current;
    }
  }
  return current;
}

function buildModel(source: string): { model: JsonanttModel; diagnostics: { severity: 'error'; message: string }[] } {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(source || '{}');
  } catch (error) {
    return {
      model: { config: parseChart({}), taskPaths: new Map() },
      diagnostics: [{ severity: 'error', message: `Invalid JSON: ${(error as Error).message}` }],
    };
  }
  try {
    const config = parseChart(data);
    const taskPaths = new Map<Task, string>();
    const walk = (tasks: Task[], path: string) => {
      tasks.forEach((task, i) => {
        const taskPath = `${path}/${i}`;
        taskPaths.set(task, taskPath);
        walk(task.children, `${taskPath}/children`);
      });
    };
    walk(config.tasks, '/tasks');
    return { model: { config, taskPaths }, diagnostics: [] };
  } catch (error) {
    return {
      model: { config: parseChart({}), taskPaths: new Map() },
      diagnostics: [{ severity: 'error', message: (error as Error).message }],
    };
  }
}

function objects(source: string, model: JsonanttModel): SourceObject[] {
  const { config, taskPaths } = model;
  const result: SourceObject[] = [
    { id: 'chart', label: config.title || 'Chart settings', kind: 'chart', range: { start: 0, end: source.length } },
  ];
  const rows = flattenRows(config, config.style.render_depth);
  for (const row of rows) {
    const path = taskPaths.get(row.task);
    const range = path ? pointerRange(source, path) : { start: 0, end: 0 };
    const start = effectiveStart(row.task);
    const end = effectiveEnd(row.task);
    const dates = start && end
      ? `${start.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)}` : '';
    result.push({
      id: `task:${path ?? row.number}`,
      label: rowLabelText(row, config.style).replace(/^\d+(\.\d+)*\.\s+/, ''),
      kind: row.task.milestone ? 'milestone' : 'task',
      detail: dates, range,
    });
  }
  config.arrows.forEach((arrow, i) => {
    result.push({
      id: `arrow:${i}`, label: `${arrow.from_id} → ${arrow.to_id}`, kind: 'arrow',
      range: pointerRange(source, `/arrows/${i}`),
    });
  });
  return result;
}

const TICKS = ['year', 'quarter', 'month', 'week', 'day'];

function inspect({ model, selection }: DocumentContext<JsonanttModel>): InspectorSection[] {
  if (!selection) return [];
  const { config, taskPaths } = model;
  const style = config.style;
  if (selection.kind === 'chart') {
    return [
      {
        id: 'chart', title: 'Chart',
        fields: [
          { id: 'title', label: 'Title', type: 'text', value: config.title },
          { id: 'dateformat', label: 'Date format', type: 'text', value: config.date_format },
        ],
      },
      {
        id: 'layout', title: 'Layout',
        fields: [
          { id: 'style.width', label: 'Width (inches)', type: 'number', value: style.width, min: 4, step: 0.5 },
          { id: 'style.row_height', label: 'Row height (inches)', type: 'number', value: style.row_height, min: 0.1, step: 0.05 },
          { id: 'style.bar_height', label: 'Bar height (fraction)', type: 'number', value: style.bar_height, min: 0.1, max: 1, step: 0.05 },
          { id: 'style.font_size', label: 'Font size (pt)', type: 'number', value: style.font_size, min: 6, step: 1 },
        ],
      },
      {
        id: 'time-axis', title: 'Time axis',
        fields: [
          {
            id: 'style.major_tick', label: 'Major tick', type: 'select', value: style.major_tick ?? 'year',
            options: TICKS.map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })),
          },
          {
            id: 'style.minor_tick', label: 'Minor tick', type: 'select', value: style.minor_tick ?? 'quarter',
            options: TICKS.map(t => ({ value: t, label: t[0].toUpperCase() + t.slice(1) })),
          },
          { id: 'style.today_marker', label: 'Mark today', type: 'checkbox', value: style.today_marker },
          { id: 'style.show_arrows', label: 'Show dependency arrows', type: 'checkbox', value: style.show_arrows },
        ],
      },
      {
        id: 'colors', title: 'Colors',
        fields: [
          { id: 'style.background', label: 'Background', type: 'color', value: style.background },
          { id: 'style.grid_color', label: 'Grid', type: 'color', value: style.grid_color },
          { id: 'style.row_band_color', label: 'Row bands', type: 'color', value: style.row_band_color },
          { id: 'style.milestone_color', label: 'Milestones', type: 'color', value: style.milestone_color },
        ],
      },
    ];
  }
  const path = selection.id.startsWith('task:') ? selection.id.slice(5) : null;
  const task = path ? [...taskPaths.entries()].find(([, p]) => p === path)?.[0] : null;
  if (task) {
    return [{
      id: 'task', title: task.milestone ? 'Milestone' : 'Task',
      fields: [
        { id: 'name', label: 'Name', type: 'text', value: task.name },
        { id: 'id', label: 'ID', type: 'text', value: task.id ?? '' },
        { id: 'description', label: 'Description', type: 'textarea', value: task.description },
        ...(task.milestone
          ? [{ id: 'date', label: 'Date', type: 'text' as const, value: task.milestone_date?.toISOString().slice(0, 10) ?? '' }]
          : [
            { id: 'start', label: 'Start', type: 'text' as const, value: task.start?.toISOString().slice(0, 10) ?? '' },
            { id: 'end', label: 'End', type: 'text' as const, value: task.end?.toISOString().slice(0, 10) ?? '' },
            { id: 'duration', label: 'Duration (e.g. 14d, 3m)', type: 'text' as const, value: task.duration_spec ?? '' },
            { id: 'not_before', label: 'Not before (task id)', type: 'text' as const, value: task.not_before ?? '' },
          ]),
        { id: 'color', label: 'Color', type: 'color', value: task.color ?? '', placeholder: 'palette' },
        { id: 'milestone', label: 'Milestone', type: 'checkbox', value: task.milestone },
        { id: 'bold', label: 'Bold label', type: 'checkbox', value: task.bold },
      ],
    }];
  }
  const arrowIndex = selection.id.startsWith('arrow:') ? Number(selection.id.slice(6)) : null;
  if (arrowIndex !== null && config.arrows[arrowIndex]) {
    const arrow = config.arrows[arrowIndex];
    return [{
      id: 'arrow', title: 'Dependency arrow',
      fields: [
        { id: 'from', label: 'From (task id)', type: 'text', value: arrow.from_id },
        { id: 'to', label: 'To (task id)', type: 'text', value: arrow.to_id },
        { id: 'color', label: 'Color', type: 'color', value: arrow.color },
        { id: 'label', label: 'Label', type: 'text', value: arrow.label ?? '' },
      ],
    }];
  }
  return [];
}

/** Produce a JSON value edit at a pointer, preserving document formatting. */
function jsonValueEdit(source: string, pointer: string, field: string, value: unknown): TextEdit[] {
  const target = `${pointer}/${field.replace(/~/g, '~0').replace(/\//g, '~1')}`;
  const existing = pointerRange(source, target);
  const found = existing.start !== existing.end || source[existing.start] !== source[existing.end];
  if (found && (existing.end > existing.start)) {
    return [{ ...existing, text: JSON.stringify(value) }];
  }
  // Insert a new field into the task object: after the opening brace.
  const objectRange = pointerRange(source, pointer);
  let index = objectRange.start;
  while (/\s/.test(source[index])) index++;
  if (source[index] !== '{') throw new Error('Task is not a JSON object.');
  const afterBrace = index + 1;
  const isEmpty = source.slice(afterBrace, objectRange.end).trim().startsWith('}');
  const indentMatch = /\n([ \t]*)[^\n]*$/.exec(source.slice(0, objectRange.start));
  const childIndent = `${indentMatch?.[1] ?? ''}  `;
  const baseIndent = indentMatch?.[1] ?? '';
  const text = isEmpty
    ? `\n${childIndent}${JSON.stringify(field)}: ${JSON.stringify(value)}\n${baseIndent}`
    : `\n${childIndent}${JSON.stringify(field)}: ${JSON.stringify(value)},`;
  return [{ start: afterBrace, end: afterBrace, text }];
}

function taskPointer(selection: SourceObject): string {
  return selection.id.slice(5);
}

export function createJsonanttAdapter(initialSource = ''): LayoutAdapter<JsonanttModel> {
  return defineAdapter<JsonanttModel>({
    id: 'jsonantt', title: 'jsonantt', extension: 'json', initialSource,
    language: 'json', preview: 'document',
    canvases: [
      { id: 'gantt', label: 'Gantt' },
      { id: 'table', label: 'Table' },
    ],
    capabilities: { navigatorGroups: true, panZoom: false },
  }, {
    parse(source, signal) {
      void signal;
      const { model, diagnostics } = buildModel(source);
      return { model, objects: objects(source, model), diagnostics };
    },
    render({ container, model, theme, canvas, select }) {
      const config: ChartConfig = {
        ...model.config,
        style: {
          ...model.config.style,
          background: model.config.style.background === '#FFFFFF'
            ? theme.tokens.preview : model.config.style.background,
        },
      };
      const svg = canvas === 'table' ? renderTableSvg(config) : renderChartSvg(config);
      if (!svg) {
        container.replaceChildren();
        return undefined;
      }
      svg.querySelectorAll<SVGElement>('.jsonantt-row').forEach(rowEl => {
        rowEl.style.cursor = 'pointer';
        rowEl.addEventListener('click', () => {
          const number = rowEl.getAttribute('data-number');
          const object = flattenRows(config, config.style.render_depth)
            .find(row => row.number === number);
          if (!object) return;
          const path = model.taskPaths.get(object.task);
          if (path) select(`task:${path}`);
        });
      });
      container.replaceChildren(svg);
      return { destroy: () => svg.remove() };
    },
    inspect,
    update(context) {
      const { source, model, selection, field } = context;
      if (!selection) throw new Error('Select an editable property first.');
      const { config } = model;
      const style = config.style;
      if (selection.kind === 'chart') {
        if (field === 'title' || field === 'dateformat') {
          return jsonValueEdit(source, '', field, String(context.value));
        }
        if (field.startsWith('style.')) {
          const key = field.slice(6);
          const typed = (style as unknown as Record<string, unknown>)[key];
          const value = typeof typed === 'number'
            ? Number(context.value)
            : typeof typed === 'boolean'
              ? Boolean(context.value)
              : String(context.value);
          return jsonValueEdit(source, '/style', key, value);
        }
        throw new Error('Select an editable property first.');
      }
      if (selection.kind === 'task' || selection.kind === 'milestone') {
        const pointer = taskPointer(selection);
        const numeric = new Set(['marker_size']);
        const value = numeric.has(field) ? Number(context.value) : context.value;
        const jsonField = field === 'date' && selection.kind === 'milestone' ? 'date' : field;
        return jsonValueEdit(source, pointer, jsonField, value === '' ? null : value);
      }
      if (selection.kind === 'arrow') {
        const index = selection.id.slice(6);
        const arrowField = field === 'from' ? 'from' : field === 'to' ? 'to' : field;
        return jsonValueEdit(source, `/arrows/${index}`, arrowField, context.value);
      }
      throw new Error('Select an editable property first.');
    },
    commands: [
      {
        id: 'add-task', label: 'Add task', group: 'Build',
        run({ source }) {
          const tasks = pointerRange(source, '/tasks');
          const today = new Date().toISOString().slice(0, 10);
          const entry = `{\n      "name": "New task",\n      "start": "${today}",\n      "duration": "14d"\n    }`;
          let index = tasks.start;
          while (/\s/.test(source[index])) index++;
          if (source[index] !== '[') {
            return jsonValueEdit(source, '', 'tasks', [JSON.parse(entry)]);
          }
          const afterOpen = index + 1;
          const empty = source.slice(afterOpen, tasks.end).trim().startsWith(']');
          return [{
            start: afterOpen, end: afterOpen,
            text: empty ? `\n    ${entry}\n  ` : `\n    ${entry},`,
          }];
        },
      },
      {
        id: 'delete', label: 'Delete selected', group: 'Edit',
        run({ selection }) {
          if (!selection || selection.kind === 'chart') throw new Error('Select a task, milestone, or arrow to delete.');
          const range = selection.range;
          return [{ start: range.start, end: range.end, text: '' }];
        },
      },
    ],
    exports: [
      {
        id: 'svg', label: 'Export SVG', extension: 'svg', mimeType: 'image/svg+xml',
        export: ({ model, canvas }) => {
          const svg = canvas === 'table' ? renderTableSvg(model.config) : renderChartSvg(model.config);
          if (!svg) throw new Error('Nothing to export.');
          return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
        },
      },
      {
        id: 'png', label: 'Export PNG', extension: 'png', mimeType: 'image/png',
        canvases: ['gantt'],
        export: ({ model }) => {
          const svg = renderChartSvg(model.config);
          if (!svg) throw new Error('Nothing to export.');
          return svgToPng(`<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`);
        },
      },
      {
        id: 'csv', label: 'Export CSV', extension: 'csv', mimeType: 'text/csv',
        canvases: ['table'],
        export: ({ model }) => tableCsv(model.config),
      },
    ],
  });
}
