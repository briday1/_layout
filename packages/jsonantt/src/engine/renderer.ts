/**
 * Gantt chart renderer — a TypeScript/SVG port of jsonantt/renderer.py's
 * `render_chart`. Geometry mirrors the matplotlib original: two panels
 * (labels + bars), row bands, rounded bars (alpha .9), diamond milestones,
 * cubic dependency arrows with 26px handles, calendar/fiscal tick systems.
 */
import {
  Arrow, ChartConfig, Style, Task, addDays, daysBetween,
  effectiveEnd, effectiveStart, lighten,
} from './models.js';

const NS = 'http://www.w3.org/2000/svg';
/** matplotlib's default figure DPI; geometry below is authored in inches. */
const DPI = 100;

/** One flattened, visible row. Mirrors renderer.py's `_Row`. */
export interface Row {
  task: Task;
  depth: number;
  row_index: number;
  color: string;
  number: string;
  milestone_label: string | null;
  rolled_milestones: { task: Task; label: string | null }[];
}

export function milestoneMarker(task: Task, style: Style): string {
  if (task.marker) return task.marker;
  if (task.major_milestone && style.major_milestone_marker) return style.major_milestone_marker;
  return style.milestone_marker;
}
function milestoneColor(task: Task, style: Style): string {
  if (task.color) return task.color;
  if (task.major_milestone && style.major_milestone_color) return style.major_milestone_color;
  return style.milestone_color;
}
function milestoneEdgeColor(task: Task, style: Style): string | null {
  if (task.edge_color) return task.edge_color;
  if (task.major_milestone && style.major_milestone_edge_color) return style.major_milestone_edge_color;
  return style.milestone_edge_color;
}
function milestoneSize(task: Task, style: Style): number {
  if (task.marker_size !== null) return task.marker_size;
  if (task.major_milestone && style.major_milestone_size !== null) return style.major_milestone_size;
  return style.milestone_size;
}

function taskMilestoneDates(task: Task): Date[] {
  if (task.milestone_dates.length) return task.milestone_dates;
  if (task.milestone_date) return [task.milestone_date];
  return [];
}

function collectDescendantMilestones(tasks: Task[], majorOnly = false): Task[] {
  const milestones: Task[] = [];
  for (const task of tasks) {
    if (task.milestone && (!majorOnly || task.major_milestone)) milestones.push(task);
    if (task.children.length) milestones.push(...collectDescendantMilestones(task.children, majorOnly));
  }
  return milestones;
}

/** Flatten the task tree into ordered rows. Mirrors renderer.py `_flatten`. */
export function flattenRows(config: ChartConfig, renderDepth = 0): Row[] {
  const style = config.style;
  const palette = style.colors.length ? style.colors : ['#4472C4'];
  const maxDepthIndex = renderDepth === 0 ? null : renderDepth - 1;
  const lightenAmount = Math.max(0, Math.min(100, style.subtask_lightening_pct)) / 100;
  const rows: Row[] = [];
  const visit = (tasks: Task[], depth: number, paletteStart: number,
    parentColor: string | null, numberPrefix: string): number => {
    let paletteIndex = paletteStart;
    tasks.forEach((task, taskIndex) => {
      let color: string;
      if (task.color) color = task.color;
      else if (parentColor && depth > 0) color = lighten(parentColor, lightenAmount);
      else { color = palette[paletteIndex % palette.length]; paletteIndex += 1; }
      const number = numberPrefix + String(taskIndex + (depth === 0 ? style.task_number_start : 1));
      const row: Row = {
        task, depth, row_index: 0, color, number, milestone_label: null,
        rolled_milestones: [],
      };
      if (task.children.length && style.rollup_milestones &&
          (maxDepthIndex === null || depth >= maxDepthIndex)) {
        row.rolled_milestones = collectDescendantMilestones(
          task.children, style.rollup_major_milestones_only)
          .map(milestoneTask => ({ task: milestoneTask, label: null }));
      }
      rows.push(row);
      if (task.children.length && (maxDepthIndex === null || depth < maxDepthIndex)) {
        paletteIndex = visit(task.children, depth + 1, paletteIndex, color, `${number}.`);
      }
    });
    return paletteIndex;
  };
  visit(config.tasks, 0, 0, null, '');
  rows.forEach((row, i) => { row.row_index = i; });
  let counter = style.milestone_number_start;
  for (const row of rows) {
    if (row.task.milestone && style.number_milestones) {
      row.milestone_label = `${style.milestone_prefix}${counter}`;
      counter += 1;
    }
    for (const overlay of row.rolled_milestones) {
      if (style.number_milestones) {
        overlay.label = `${style.milestone_prefix}${counter}`;
        counter += 1;
      }
    }
  }
  return rows;
}

/** Label text for a row. Mirrors `_row_label_text`. */
export function rowLabelText(row: Row, style: Style): string {
  if (!style.number_tasks) return row.task.name;
  const numberStr = row.milestone_label ??
    (row.number.includes('.') ? row.number : `${row.number}.`);
  return `${numberStr}  ${row.task.name}`;
}

/** Compute the chart date range. Mirrors `_compute_date_range` + padding/snapping. */
export function computeDateRange(rows: Row[], config: ChartConfig): { start: Date; end: Date } {
  const dates: Date[] = [];
  for (const row of rows) {
    const s = effectiveStart(row.task);
    const e = effectiveEnd(row.task);
    if (s) dates.push(s);
    if (e) dates.push(e);
  }
  if (!dates.length) {
    const today = new Date();
    dates.push(today, addDays(today, 30));
  }
  const xMin = config.start ?? new Date(Math.min(...dates.map(Number)));
  let xMax = config.end ?? new Date(Math.max(...dates.map(Number)));
  if (xMin >= xMax) xMax = addDays(xMin, 1);
  const pad = Math.max(1, daysBetween(xMin, xMax) * 0.02);
  let xStart = addDays(xMin, -pad);
  let xEnd = addDays(xMax, pad);
  const spanDays = daysBetween(xStart, xEnd);
  let minorKey = config.style.minor_tick;
  if (!minorKey) {
    if (spanDays > 365) minorKey = 'quarter';
    else if (spanDays > 90) minorKey = 'month';
    else if (spanDays > 21) minorKey = 'week';
  }
  if (minorKey) {
    const fiscal = parseFiscalYearStart(config.style.fiscal_year_start);
    xStart = snapToTickStart(xStart, minorKey, fiscal);
    xEnd = snapToTickEnd(xEnd, minorKey, fiscal);
  }
  return { start: xStart, end: xEnd };
}

// ---------------------------------------------------------------------------
// Tick system (calendar + fiscal). Mirrors renderer.py's tick helpers.
// ---------------------------------------------------------------------------

export function parseFiscalYearStart(spec: unknown): [number, number] | null {
  if (typeof spec !== 'string' || !spec) return null;
  const match = /^(\d{1,2})(?:-(\d{1,2}))?$/.exec(spec);
  if (!match) {
    throw new Error(`Invalid fiscal_year_start '${spec}'. Use a 'MM' or 'MM-DD' string such as '10-01'.`);
  }
  const month = Number(match[1]);
  const day = match[2] !== undefined ? Number(match[2]) : 1;
  if (month < 1 || month > 12) {
    throw new Error('Invalid fiscal_year_start: month must be between 1 and 12.');
  }
  return [month, day];
}

function fiscalAnchor(year: number, fiscalStart: [number, number]): Date {
  const [month, day] = fiscalStart;
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1, Math.min(day, maxDay)));
}

function fiscalYearInfo(d: Date, fiscalStart: [number, number]): [number, Date] {
  const anchor = fiscalAnchor(d.getUTCFullYear(), fiscalStart);
  if (d >= anchor) return [d.getUTCFullYear() + 1, anchor];
  return [d.getUTCFullYear(), fiscalAnchor(d.getUTCFullYear() - 1, fiscalStart)];
}

function fiscalQuarterInfo(d: Date, fiscalStart: [number, number]): [number, number, Date] {
  const [fiscalYear, anchor] = fiscalYearInfo(d, fiscalStart);
  const monthsSince = (d.getUTCFullYear() - anchor.getUTCFullYear()) * 12 +
    (d.getUTCMonth() - anchor.getUTCMonth());
  const quarterIndex = Math.max(0, Math.min(3, Math.floor(monthsSince / 3)));
  const monthIndex = anchor.getUTCMonth() + quarterIndex * 3;
  const startYear = anchor.getUTCFullYear() + Math.floor(monthIndex / 12);
  const startMonth = monthIndex % 12;
  const maxDay = new Date(Date.UTC(startYear, startMonth + 1, 0)).getUTCDate();
  return [fiscalYear, quarterIndex + 1,
    new Date(Date.UTC(startYear, startMonth, Math.min(anchor.getUTCDate(), maxDay)))];
}

function nextFiscalQuarterStart(start: Date, fiscalStart: [number, number]): Date {
  const monthIndex = start.getUTCMonth() + 3;
  const year = start.getUTCFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), maxDay)));
}

export function snapToTickStart(d: Date, key: string, fiscalStart: [number, number] | null = null): Date {
  const k = key.trim().toLowerCase();
  if (k.startsWith('year')) {
    if (fiscalStart) return fiscalYearInfo(d, fiscalStart)[1];
    return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  }
  if (k.startsWith('quarter')) {
    if (fiscalStart) return fiscalQuarterInfo(d, fiscalStart)[2];
    return new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));
  }
  if (k.startsWith('month')) return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  if (k.startsWith('week')) {
    const weekday = (d.getUTCDay() + 6) % 7; // Monday = 0
    return addDays(d, -weekday);
  }
  return d;
}

export function snapToTickEnd(d: Date, key: string, fiscalStart: [number, number] | null = null): Date {
  const start = snapToTickStart(d, key, fiscalStart);
  if (start >= d) return d;
  const k = key.trim().toLowerCase();
  if (k.startsWith('year')) {
    if (fiscalStart) return fiscalAnchor(start.getUTCFullYear() + 1, fiscalStart);
    return new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
  }
  if (k.startsWith('quarter')) {
    if (fiscalStart) return nextFiscalQuarterStart(start, fiscalStart);
    const nextMonth = Math.floor(d.getUTCMonth() / 3) * 3 + 3;
    if (nextMonth > 11) return new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
    return new Date(Date.UTC(d.getUTCFullYear(), nextMonth, 1));
  }
  if (k.startsWith('month')) {
    const next = d.getUTCMonth() + 1;
    if (next > 11) return new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
    return new Date(Date.UTC(d.getUTCFullYear(), next, 1));
  }
  if (k.startsWith('week')) return addDays(start, 7);
  return addDays(start, 1);
}

/** Tick positions from xStart to xEnd for the tick key. Mirrors `_iter_ticks`. */
export function iterTicks(xStart: Date, xEnd: Date, key: string, fiscalStart: [number, number] | null = null): Date[] {
  const k = key.trim().toLowerCase();
  const ticks: Date[] = [];
  let d = snapToTickStart(xStart, key, fiscalStart);
  let guard = 0;
  while (d <= xEnd && guard++ < 5000) {
    ticks.push(d);
    if (k.startsWith('year')) {
      d = fiscalStart ? fiscalAnchor(d.getUTCFullYear() + 1, fiscalStart)
        : new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1));
    } else if (k.startsWith('quarter')) {
      if (fiscalStart) d = nextFiscalQuarterStart(d, fiscalStart);
      else {
        const month = d.getUTCMonth() + 3;
        d = new Date(Date.UTC(d.getUTCFullYear() + Math.floor(month / 12), month % 12, 1));
      }
    } else if (k.startsWith('month')) {
      const month = d.getUTCMonth() + 1;
      d = new Date(Date.UTC(d.getUTCFullYear() + Math.floor(month / 12), month % 12, 1));
    } else if (k.startsWith('week')) {
      d = addDays(d, 7);
    } else if (k.startsWith('day')) {
      d = addDays(d, 1);
    } else break;
  }
  return ticks;
}

/** Tick label text for a position. Mirrors the matplotlib formatters. */
export function tickLabel(d: Date, key: string, fiscalStart: [number, number] | null = null): string {
  const k = key.trim().toLowerCase();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (k.startsWith('year')) {
    if (fiscalStart) return `FY${String(fiscalYearInfo(d, fiscalStart)[0] % 100).padStart(2, '0')}`;
    return String(d.getUTCFullYear());
  }
  if (k.startsWith('quarter')) {
    if (fiscalStart) {
      const [fy, q] = fiscalQuarterInfo(d, fiscalStart);
      return `Q${q} FY${String(fy % 100).padStart(2, '0')}`;
    }
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  }
  if (k.startsWith('month')) return `${months[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
  return `${months[d.getUTCMonth()]} ${String(d.getUTCDate()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Text measurement: canvas when available, else the 0.55em heuristic that
// renderer.py uses for its label-layout char width.
// ---------------------------------------------------------------------------

function measureText(text: string, fontSizePx: number, weight: string): number {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = `${weight} ${fontSizePx}px DejaVu Sans, sans-serif`;
      return context.measureText(text).width;
    }
  }
  return text.length * fontSizePx * (weight === 'bold' ? 0.58 : 0.55);
}

// ---------------------------------------------------------------------------
// SVG construction
// ---------------------------------------------------------------------------

function el(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Resolved pixel geometry shared by every draw helper. */
export interface ChartGeometry {
  style: Style;
  rowHPx: number;
  topPadPx: number;
  bottomPadPx: number;
  figWPx: number;
  figHPx: number;
  labelPx: number;
  barLeftPx: number;
  barWidthPx: number;
  fontSizePx: number;
  indentStepPx: number;
  leftMarginPx: number;
  n: number;
  xFor: (d: Date) => number;
  yFor: (rowIndex: number) => number;
}

/** Compute the full geometry for a chart. Exported for adapter/tooltip use. */
export function chartGeometry(config: ChartConfig, rows: Row[]): ChartGeometry | null {
  const style = config.style;
  if (!rows.length) return null;
  const n = rows.length;
  const rowHPx = style.row_height * DPI;
  const tickPos = (style.tick_position || 'top').toLowerCase();
  const tickOnTop = tickPos === 'top' || tickPos === 'both';
  const tickOnBottom = tickPos === 'bottom' || tickPos === 'both';
  const topPadPx = (config.title ? (tickOnTop ? 0.9 : 0.6) : (tickOnTop ? 0.55 : 0.25)) * DPI;
  const bottomPadPx = (tickOnBottom ? 0.55 : 0.25) * DPI;
  const figWPx = style.width * DPI;
  const figHPx = n * rowHPx + topPadPx + bottomPadPx;
  const fontSizePx = style.font_size * (DPI / 72);
  const indentWidthPx = style.indent_size * style.font_size * 0.55 * (DPI / 72);
  const leftMarginIn = 0.15 * DPI;
  const rightMarginPx = 0.05 * DPI;
  const measured = rows.map(row => {
    const weight = row.task.bold || (style.bold_tasks && row.depth === 0) ? 'bold' : 'normal';
    return row.depth * indentWidthPx + measureText(rowLabelText(row, style), fontSizePx, weight);
  });
  const labelWidthPx = Math.max(0.8 * DPI, leftMarginIn + Math.max(0, ...measured) + rightMarginPx);
  const labelFraction = Math.min(0.6, Math.max(style.label_fraction, labelWidthPx / figWPx));
  const labelPx = labelFraction * figWPx;
  const indentStepPx = (indentWidthPx / labelWidthPx) * labelPx;
  const leftMarginPx = (leftMarginIn / labelWidthPx) * labelPx;
  const barLeftPx = labelPx;
  const barWidthPx = figWPx - labelPx;
  const { start: xStart, end: xEnd } = computeDateRange(rows, config);
  const spanDays = Math.max(1e-9, daysBetween(xStart, xEnd));
  const xFor = (d: Date) => barLeftPx + (daysBetween(xStart, d) / spanDays) * barWidthPx;
  const yFor = (rowIndex: number) => topPadPx + rowIndex * rowHPx + rowHPx / 2;
  return {
    style, rowHPx, topPadPx, bottomPadPx, figWPx, figHPx, labelPx,
    barLeftPx, barWidthPx, fontSizePx, indentStepPx, leftMarginPx, n, xFor, yFor,
  };
}

export interface RenderChartOptions {
  dateLine?: Date | null;
  dateLineColor?: string;
}

/**
 * Render a chart to an SVG element. Returns null when there are no rows.
 * Row order, colors, numbering, and geometry follow render_chart exactly.
 */
export function renderChartSvg(config: ChartConfig, options: RenderChartOptions = {}): SVGSVGElement | null {
  const style = config.style;
  const rows = flattenRows(config, style.render_depth);
  const g = chartGeometry(config, rows);
  if (!g) return null;
  const dateLine = options.dateLine ?? (style.today_marker ? new Date() : null);
  const tickPos = (style.tick_position || 'top').toLowerCase();
  const tickOnTop = tickPos === 'top' || tickPos === 'both';
  const tickOnBottom = tickPos === 'bottom' || tickPos === 'both';

  const svg = el('svg', {
    xmlns: NS, viewBox: `0 0 ${g.figWPx} ${g.figHPx}`, width: g.figWPx, height: g.figHPx,
    role: 'img', class: 'jsonantt-chart',
    'aria-label': config.title || 'Gantt chart',
  });
  const styleEl = el('style', {});
  styleEl.textContent = '.jsonantt-chart text{font-family:DejaVu Sans, sans-serif}';
  svg.append(styleEl);
  svg.append(el('rect', { x: 0, y: 0, width: g.figWPx, height: g.figHPx, fill: style.background }));
  svg.append(el('rect', {
    x: 0, y: g.topPadPx, width: g.labelPx, height: g.n * g.rowHPx, fill: style.row_band_color,
    class: 'label-panel',
  }));

  // ---- gridlines + tick labels --------------------------------------------
  const fiscalStart = parseFiscalYearStart(style.fiscal_year_start);
  const spanDays = daysBetween(
    computeDateRange(rows, config).start, computeDateRange(rows, config).end);
  const majorKey = style.major_tick || 'year';
  let minorKey = style.minor_tick;
  if (!minorKey) {
    if (spanDays > 365) minorKey = 'quarter';
    else if (spanDays > 90) minorKey = 'month';
    else if (spanDays > 21) minorKey = 'week';
  }
  const { start: xStart, end: xEnd } = computeDateRange(rows, config);
  for (const tick of iterTicks(xStart, xEnd, majorKey, fiscalStart)) {
    const x = g.xFor(tick);
    svg.append(el('line', {
      x1: x, y1: g.topPadPx, x2: x, y2: g.topPadPx + g.n * g.rowHPx,
      stroke: style.grid_color, 'stroke-width': style.major_grid_width, class: 'grid-major',
    }));
    const label = tickLabel(tick, majorKey, fiscalStart);
    if (tickOnTop) {
      svg.append(el('text', {
        x, y: g.topPadPx - 6, 'text-anchor': 'middle', class: 'tick-label',
        'font-size': g.fontSizePx, fill: '#111111',
      }, label));
    }
    if (tickOnBottom) {
      svg.append(el('text', {
        x, y: g.topPadPx + g.n * g.rowHPx + g.fontSizePx + 6, 'text-anchor': 'middle',
        class: 'tick-label', 'font-size': g.fontSizePx, fill: '#111111',
      }, label));
    }
  }
  if (minorKey) {
    for (const tick of iterTicks(xStart, xEnd, minorKey, fiscalStart)) {
      const x = g.xFor(tick);
      svg.append(el('line', {
        x1: x, y1: g.topPadPx, x2: x, y2: g.topPadPx + g.n * g.rowHPx,
        stroke: style.grid_color, 'stroke-width': style.minor_grid_width,
        'stroke-dasharray': '1 3', class: 'grid-minor',
      }));
    }
  }

  // ---- date line ------------------------------------------------------------
  if (dateLine) {
    svg.append(el('line', {
      x1: g.xFor(dateLine), y1: g.topPadPx,
      x2: g.xFor(dateLine), y2: g.topPadPx + g.n * g.rowHPx,
      stroke: options.dateLineColor ?? '#C00000', 'stroke-width': 2,
      'stroke-dasharray': '6 4', opacity: 0.95, class: 'date-line',
    }));
  }

  // ---- rows ------------------------------------------------------------------
  rows.forEach((row, i) => {
    const y = g.yFor(i);
    if (i % 2 === 1) {
      svg.append(el('rect', {
        x: g.barLeftPx, y: g.topPadPx + i * g.rowHPx, width: g.barWidthPx, height: g.rowHPx,
        fill: style.row_band_color, class: 'row-band',
      }));
    }
    const group = el('g', {
      class: 'jsonantt-row', 'data-row-index': i,
      'data-task-id': row.task.id ?? '', 'data-number': row.number,
    }) as SVGGElement;
    const weight = row.task.bold || (style.bold_tasks && row.depth === 0) ? 'bold' : 'normal';
    group.append(el('text', {
      x: g.leftMarginPx + row.depth * g.indentStepPx, y,
      class: 'row-label', 'font-size': g.fontSizePx, 'font-weight': weight,
      'dominant-baseline': 'central', fill: '#111111',
    }, rowLabelText(row, style)));
    if (row.task.milestone) drawMilestone(group, g, row.task, y, row.milestone_label);
    else drawBar(group, g, row, y);
    for (const overlay of row.rolled_milestones) {
      drawMilestone(group, g, overlay.task, y, overlay.label);
    }
    svg.append(group);
  });

  // ---- dependency arrows ------------------------------------------------------
  if (style.show_arrows) {
    const idToRow = new Map(rows.filter(r => r.task.id).map(r => [r.task.id!, r]));
    config.arrows.forEach(arrow => drawArrow(svg as SVGSVGElement, g, arrow, idToRow));
  }

  // ---- title -------------------------------------------------------------------
  if (config.title) {
    const titleYFrac = 1 - (g.topPadPx * (tickOnTop ? 0.2 : 0.35)) / g.figHPx;
    svg.append(el('text', {
      x: g.figWPx / 2, y: g.figHPx * titleYFrac - g.topPadPx * 0.55,
      'text-anchor': 'middle', class: 'chart-title',
      'font-size': (style.font_size + 3) * (DPI / 72), 'font-weight': 'bold', fill: '#111111',
    }, config.title));
  }
  return svg as SVGSVGElement;
}

function drawBar(group: SVGGElement, g: ChartGeometry, row: Row, yPx: number): void {
  const start = effectiveStart(row.task);
  let end = effectiveEnd(row.task);
  if (!start || !end) return;
  if (start.getTime() === end.getTime()) end = addDays(start, 1);
  const x0 = g.xFor(start);
  const x1 = g.xFor(end);
  const barHPx = g.style.bar_height * g.rowHPx;
  const radius = Math.min(0.02 * DPI + barHPx / 2, barHPx / 2);
  group.append(el('rect', {
    x: x0, y: yPx - barHPx / 2, width: Math.max(1, x1 - x0), height: barHPx,
    rx: radius, fill: row.color, 'fill-opacity': 0.9, class: 'task-bar',
  }));
}

function drawMilestone(group: SVGGElement, g: ChartGeometry, task: Task, yPx: number, label: string | null): void {
  const dates = taskMilestoneDates(task);
  if (!dates.length) return;
  const color = milestoneColor(task, g.style);
  const edgeColor = milestoneEdgeColor(task, g.style);
  const radius = milestoneSize(task, g.style) * (DPI / 72) / 2;
  for (const date of dates) {
    const x = g.xFor(date);
    group.append(el('path', {
      d: `M ${x} ${yPx - radius} L ${x + radius} ${yPx} L ${x} ${yPx + radius} L ${x - radius} ${yPx} Z`,
      fill: color, stroke: edgeColor ?? 'none',
      'stroke-width': edgeColor ? 1.2 : 0, class: 'milestone',
    }));
    if (label) {
      group.append(el('text', {
        x, y: yPx, 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': Math.max(6, radius * 1.1), fill: '#111111', class: 'milestone-label',
      }, label));
    }
  }
}

function drawArrow(
  svg: SVGSVGElement, g: ChartGeometry, arrow: Arrow, idToRow: Map<string, Row>,
): void {
  const fromRow = idToRow.get(arrow.from_id);
  const toRow = idToRow.get(arrow.to_id);
  if (!fromRow || !toRow) return;
  const fromEnd = effectiveEnd(fromRow.task);
  const toStart = effectiveStart(toRow.task);
  if (!fromEnd || !toStart) return;
  const x0 = g.xFor(fromEnd), y0 = g.yFor(fromRow.row_index);
  const x1 = g.xFor(toStart), y1 = g.yFor(toRow.row_index);
  svg.append(el('path', {
    d: `M ${x0} ${y0} C ${x0 + 26} ${y0} ${x1 - 26} ${y1} ${x1} ${y1}`,
    fill: 'none', stroke: arrow.color, 'stroke-width': 1.4, class: 'dependency-arrow',
  }));
  svg.append(el('path', {
    d: `M ${x1 - 4.8} ${y1 - 3} L ${x1 + 1.2} ${y1} L ${x1 - 4.8} ${y1 + 3} Z`,
    fill: arrow.color, class: 'dependency-arrow-head',
  }));
}
