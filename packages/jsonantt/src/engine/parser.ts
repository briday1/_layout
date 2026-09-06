/**
 * JSON → model parser — a TypeScript port of jsonantt/parser.py.
 * Supports dateformat directives (%Y %m %d %b %B %y), duration specs
 * (14d / 2w / 3m / 2y / bare days), not_before chains, milestone date lists,
 * filename includes (host-resolved), and the full style field mapping.
 */
import {
  Arrow, ChartConfig, Style, Task, addDays, dateUTC, defaultStyle, effectiveEnd, newTask,
} from './models.js';

/** Host hook for `{ "filename": "…" }` includes; omitted in single-document mode. */
export type IncludeResolver = (filename: string) => unknown;

const KNOWN_FIELDS = new Set([
  'name', 'description', 'id', 'start', 'end', 'duration', 'not_before',
  'color', 'edge_color', 'milestone', 'major_milestone', 'date', 'marker',
  'marker_size', 'bold', 'filename', 'tasks', 'children',
]);

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** Parse a date string with a strptime-style format (subset used by jsonantt). */
export function parseDate(value: string, fmt: string): Date {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let pattern = escape(fmt);
  const groups: string[] = [];
  pattern = pattern.replace(/%[YymdbB]/g, token => {
    groups.push(token);
    switch (token) {
      case '%Y': return '(\\d{4})';
      case '%y': return '(\\d{2})';
      case '%m': return '(\\d{1,2})';
      case '%d': return '(\\d{1,2})';
      case '%b': return `(${MONTHS_SHORT.join('|')})`;
      case '%B': return `(${MONTHS_LONG.join('|')})`;
      default: return token;
    }
  });
  const match = new RegExp(`^${pattern}$`).exec(value.trim());
  if (!match) throw new Error(`time data '${value}' does not match format '${fmt}'`);
  let year = 0, month = 1, day = 1;
  groups.forEach((token, i) => {
    const raw = match[i + 1];
    if (token === '%Y') year = Number(raw);
    else if (token === '%y') year = 2000 + Number(raw);
    else if (token === '%m') month = Number(raw);
    else if (token === '%d') day = Number(raw);
    else if (token === '%b') month = MONTHS_SHORT.indexOf(raw) + 1;
    else if (token === '%B') month = MONTHS_LONG.indexOf(raw) + 1;
  });
  if (!year || !month || !day || month > 12 || day > 31) {
    throw new Error(`time data '${value}' does not match format '${fmt}'`);
  }
  return dateUTC(year, month, day);
}

const DURATION_RE = /^\s*(\d+)\s*(d|day|days|w|week|weeks|m|month|months|y|year|years)\s*$/i;

/** Parse a duration spec into (unit, value); bare integers are days. */
export function parseDuration(spec: string): ['d' | 'm' | 'y', number] {
  const text = String(spec).trim();
  if (/^\d+$/.test(text)) return ['d', Number(text)];
  const match = DURATION_RE.exec(text);
  if (!match) {
    throw new Error(`Invalid duration spec '${spec}'. Use e.g. '14d', '2w', '3m', '2y', or a plain integer (days).`);
  }
  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  if (['d', 'day', 'days'].includes(unit)) return ['d', value];
  if (['w', 'week', 'weeks'].includes(unit)) return ['d', value * 7];
  if (['m', 'month', 'months'].includes(unit)) return ['m', value];
  return ['y', value];
}

function monthRange(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addMonths(d: Date, months: number): Date {
  const total = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const maxDay = monthRange(year, month + 1);
  return dateUTC(year, month + 1, Math.min(d.getUTCDate(), maxDay));
}

export function addYears(d: Date, years: number): Date {
  const year = d.getUTCFullYear() + years;
  const maxDay = monthRange(year, d.getUTCMonth() + 1);
  return dateUTC(year, d.getUTCMonth() + 1, Math.min(d.getUTCDate(), maxDay));
}

/** Return the date that is `spec` after `start`. */
export function applyDuration(start: Date, spec: string): Date {
  const [unit, value] = parseDuration(spec);
  if (unit === 'd') return addDays(start, value);
  if (unit === 'm') return addMonths(start, value);
  return addYears(start, value);
}

const SCALES: Record<string, [number, string]> = {
  units: [1, ''], thousands: [1000, 'K'], millions: [1_000_000, 'M'], billions: [1_000_000_000, 'B'],
};

export function valueFormatActive(style: Style, field: string): boolean {
  if (['task', 'id', 'name', 'description', 'start', 'end', 'date', 'effective_start',
    'effective_end', 'milestone_date', 'duration', 'not_before', 'offset', 'marker_size']
    .includes(field)) return false;
  const fields = style.value_fields;
  return (!fields.length || fields.includes(field)) &&
    (style.value_prefix !== null || style.value_suffix !== null ||
      style.value_scale !== 'units' || style.value_decimals !== null);
}

export function validateValueFormat(style: Style): void {
  if (!(style.value_scale in SCALES)) {
    throw new Error('value_scale must be units, thousands, millions, or billions');
  }
  if (style.value_decimals !== null &&
      (!Number.isInteger(style.value_decimals) || style.value_decimals < 0 || style.value_decimals > 8)) {
    throw new Error('value_decimals must be an integer from 0 to 8');
  }
  if (!Array.isArray(style.value_fields) ||
      style.value_fields.some(field => typeof field !== 'string' || !field.trim())) {
    throw new Error('value_fields must be a list of field names');
  }
  for (const value of [style.value_prefix, style.value_suffix]) {
    if (value !== null && typeof value !== 'string') {
      throw new Error('value_prefix and value_suffix must be strings');
    }
  }
}

/** Format a numeric value for display; never changes source amounts. */
export function formatValue(amount: number, style: Style, field: string): string | null {
  if (!valueFormatActive(style, field)) return null;
  const [divisor, unit] = SCALES[style.value_scale];
  const places = style.value_decimals === null ? 2 : style.value_decimals;
  const value = amount / divisor;
  const prefix = style.value_prefix ?? '';
  const suffix = style.value_suffix ?? '';
  let text = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: places, maximumFractionDigits: places,
  });
  if (style.value_decimals === null && text.includes('.')) {
    text = text.replace(/0+$/, '').replace(/\.$/, '');
  }
  return `${value < 0 ? '-' : ''}${prefix}${text}${unit}${suffix ? ` ${suffix}` : ''}`;
}

function parseStyle(data: Record<string, unknown>): Style {
  const style = defaultStyle();
  const keys = [
    'value_prefix', 'value_suffix', 'value_scale', 'value_decimals', 'value_fields',
    'render_depth', 'show_arrows', 'today_marker', 'width', 'row_height', 'bar_height',
    'font_size', 'indent_size', 'label_fraction', 'subtask_lightening_pct', 'colors',
    'background', 'grid_color', 'row_band_color', 'milestone_color',
    'milestone_edge_color', 'milestone_marker', 'milestone_size', 'rollup_milestones',
    'rollup_major_milestones_only', 'number_milestones', 'major_milestone_color',
    'major_milestone_edge_color', 'major_milestone_marker', 'major_milestone_size',
    'major_tick', 'minor_tick', 'fiscal_year_start', 'major_grid_width',
    'minor_grid_width', 'bold_tasks', 'number_tasks', 'task_number_start',
    'milestone_number_start', 'milestone_prefix', 'table_colorize',
    'table_show_markers', 'tick_position', 'table_columns',
  ] as const;
  for (const key of keys) {
    if (key in data) (style as unknown as Record<string, unknown>)[key] = data[key];
  }
  validateValueFormat(style);
  return style;
}

interface ParseContext {
  resolveInclude?: IncludeResolver;
  seenFiles: Set<string>;
}

function nestedTaskItems(data: Record<string, unknown>): unknown[] {
  const items: unknown[] = [];
  if ('tasks' in data) items.push(...(data.tasks as unknown[]));
  if ('children' in data) items.push(...(data.children as unknown[]));
  return items;
}

function parseTaskEntries(items: unknown[], dateFormat: string, ctx: ParseContext): Task[] {
  const tasks: Task[] = [];
  for (const item of items) {
    if (item && typeof item === 'object' && !Array.isArray(item) &&
        Object.keys(item as object).join(',') === 'filename') {
      if (!ctx.resolveInclude) {
        throw new Error('filename includes require a host include resolver.');
      }
      const filename = String((item as Record<string, unknown>).filename);
      if (ctx.seenFiles.has(filename)) {
        throw new Error(`Circular filename reference detected: ${filename}`);
      }
      const included = ctx.resolveInclude(filename) as Record<string, unknown>;
      const includedFormat = String(included.dateformat ?? included.date_format ?? '%Y-%m-%d');
      tasks.push(...parseTaskEntries(
        nestedTaskItems(included), includedFormat,
        { ...ctx, seenFiles: new Set([...ctx.seenFiles, filename]) }));
      continue;
    }
    tasks.push(parseTask(item, dateFormat, ctx));
  }
  return tasks;
}

function parseTask(data: unknown, dateFormat: string, ctx: ParseContext): Task {
  if (typeof data === 'string') return newTask(data);
  const source = (data ?? {}) as Record<string, unknown>;
  const task = newTask(String(source.name ?? 'Unnamed'));
  task.description = String(source.description ?? '');
  task.id = source.id != null ? String(source.id) : null;
  task.color = source.color != null ? String(source.color) : null;
  task.edge_color = source.edge_color != null ? String(source.edge_color) : null;
  task.major_milestone = Boolean(source.major_milestone);
  task.milestone = Boolean(source.milestone) || task.major_milestone;
  task.not_before = source.not_before != null ? String(source.not_before) : null;
  task.marker_size = 'marker_size' in source ? Number(source.marker_size) : null;
  task.marker = 'marker' in source ? String(source.marker) : null;
  task.bold = Boolean(source.bold);
  task.duration_spec = 'duration' in source ? String(source.duration) : null;
  task.start = 'start' in source ? parseDate(String(source.start), dateFormat) : null;
  task.end = 'end' in source ? parseDate(String(source.end), dateFormat) : null;
  if (task.start !== null && task.duration_spec !== null && task.end === null) {
    task.end = applyDuration(task.start, task.duration_spec);
    task.duration_spec = null;
  }
  if (task.milestone) {
    if ('date' in source) {
      const raw = source.date;
      const values = Array.isArray(raw) ? raw : [raw];
      task.milestone_dates = values.map(value => parseDate(String(value), dateFormat));
      task.milestone_date = task.milestone_dates[0] ?? null;
    } else if (task.start !== null) {
      task.milestone_dates = [task.start];
      task.milestone_date = task.start;
    } else if (task.end !== null) {
      task.milestone_dates = [task.end];
      task.milestone_date = task.end;
    }
  }
  if ('filename' in source && ctx.resolveInclude) {
    const filename = String(source.filename);
    if (ctx.seenFiles.has(filename)) {
      throw new Error(`Circular filename reference detected: ${filename}`);
    }
    const included = ctx.resolveInclude(filename) as Record<string, unknown>;
    const includedFormat = String(included.dateformat ?? included.date_format ?? '%Y-%m-%d');
    task.children.push(...parseTaskEntries(
      nestedTaskItems(included), includedFormat,
      { ...ctx, seenFiles: new Set([...ctx.seenFiles, filename]) }));
  }
  task.children.push(...parseTaskEntries(nestedTaskItems(source), dateFormat, ctx));
  task.fields = Object.fromEntries(
    Object.entries(source).filter(([key]) => !KNOWN_FIELDS.has(key)));
  return task;
}

function collectTasks(tasks: Task[], collected: Task[], mapping: Map<string, Task>): void {
  for (const task of tasks) {
    collected.push(task);
    if (task.id !== null) mapping.set(task.id, task);
    collectTasks(task.children, collected, mapping);
  }
}

function resolveNotBefore(allTasks: Task[], byId: Map<string, Task>): void {
  const maxPasses = allTasks.length + 1;
  for (let pass = 0; pass < maxPasses; pass++) {
    let changed = false;
    for (const task of allTasks) {
      if (task.not_before === null || task.start !== null) continue;
      const ref = byId.get(task.not_before);
      if (!ref) throw new Error(`not_before references unknown id: '${task.not_before}'`);
      const refEnd = effectiveEnd(ref);
      if (refEnd === null) continue;
      task.start = refEnd;
      if (task.milestone && task.milestone_date === null) {
        task.milestone_dates = [refEnd];
        task.milestone_date = refEnd;
      }
      if (task.duration_spec !== null) {
        task.end = applyDuration(refEnd, task.duration_spec);
        task.duration_spec = null;
      }
      changed = true;
    }
    if (!changed) break;
  }
  for (const task of allTasks) {
    if (task.not_before !== null && task.start === null) {
      throw new Error(`Could not resolve not_before='${task.not_before}' for task '${task.name}'. Check for circular references.`);
    }
  }
}

/** Parse a raw JSON object into a ChartConfig. */
export function parseChart(
  data: Record<string, unknown>, options: { resolveInclude?: IncludeResolver } = {},
): ChartConfig {
  const dateFormat = String(data.dateformat ?? data.date_format ?? '%Y-%m-%d');
  const ctx: ParseContext = { resolveInclude: options.resolveInclude, seenFiles: new Set() };
  const start = 'start' in data ? parseDate(String(data.start), dateFormat) : null;
  const end = 'end' in data ? parseDate(String(data.end), dateFormat) : null;
  const style = parseStyle((data.style ?? {}) as Record<string, unknown>);
  const tasks = parseTaskEntries(nestedTaskItems(data), dateFormat, ctx);
  const allTasks: Task[] = [];
  const byId = new Map<string, Task>();
  collectTasks(tasks, allTasks, byId);
  resolveNotBefore(allTasks, byId);
  const arrows: Arrow[] = ((data.arrows ?? []) as Record<string, unknown>[]).map(a => ({
    from_id: String(a.from), to_id: String(a.to),
    color: a.color != null ? String(a.color) : '#888888',
    label: a.label != null ? String(a.label) : null,
  }));
  return {
    tasks, title: String(data.title ?? ''), date_format: dateFormat,
    start, end, style, arrows,
  };
}
