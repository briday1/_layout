/**
 * Task table renderer — a TypeScript/SVG port of jsonantt/renderer.py's
 * `render_table`: color accent gutter, darkened band header, measured
 * column widths, wrapped rows, and milestone markers.
 */
import {
  ChartConfig, Style, Task, darken, effectiveEnd, effectiveStart,
} from './models.js';
import { Row, flattenRows } from './renderer.js';

const NS = 'http://www.w3.org/2000/svg';
const DPI = 100;

function el(tag: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

interface TableColumn { field: string; title: string }

function defaultTableTitle(field: string): string {
  const titles: Record<string, string> = {
    task: 'Task', name: 'Name', description: 'Description', id: 'ID',
    not_before: 'Not Before', effective_start: 'Effective Start',
    effective_end: 'Effective End', milestone_date: 'Date', date: 'Date', offset: 'Offset',
  };
  return titles[field] ?? field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Normalize `style.table_columns`; empty keeps [task, name, description]. */
export function resolveTableColumns(style: Style): TableColumn[] {
  const raw = (style.table_columns?.length ? style.table_columns : ['task', 'name', 'description']) as unknown[];
  const columns: TableColumn[] = [];
  for (const item of raw) {
    if (typeof item === 'string') {
      if (!item.trim()) throw new Error("style.table_columns cannot contain blank field names");
      columns.push({ field: item.trim(), title: defaultTableTitle(item.trim()) });
    } else if (item && typeof item === 'object') {
      const record = item as Record<string, unknown>;
      const field = String(record.field ?? '').trim();
      if (!field) throw new Error("style.table_columns object entries require a non-empty 'field'");
      columns.push({ field, title: String(record.title ?? defaultTableTitle(field)) });
    } else {
      throw new Error("style.table_columns entries must be strings or objects with 'field'");
    }
  }
  if (!columns.length) throw new Error('style.table_columns must contain at least one column');
  return columns;
}

const formatDate = (d: Date | null) =>
  d ? `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` : '';

/** Cell text for a row/column. Mirrors `_row_table_cell` for core fields. */
export function rowTableCell(row: Row, column: TableColumn): string {
  const task = row.task;
  switch (column.field) {
    case 'task': {
      return row.milestone_label ??
        (row.number.includes('.') ? row.number : `${row.number}.`);
    }
    case 'name': return task.name;
    case 'description': return task.description;
    case 'id': return task.id ?? '';
    case 'not_before': return task.not_before ?? '';
    case 'start': return formatDate(task.start);
    case 'end': return formatDate(task.end);
    case 'effective_start': return formatDate(effectiveStart(task));
    case 'effective_end': return formatDate(effectiveEnd(task));
    case 'date':
    case 'milestone_date': return formatDate(task.milestone_date);
    case 'duration': {
      const s = effectiveStart(task);
      const e = effectiveEnd(task);
      return s && e ? `${Math.round((e.getTime() - s.getTime()) / 86_400_000)}d` : '';
    }
    default: {
      const value = task.fields[column.field];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value);
      return String(value);
    }
  }
}

function measureText(text: string, fontSizePx: number, weight = 'normal'): number {
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (context) {
      context.font = `${weight} ${fontSizePx}px DejaVu Sans, sans-serif`;
      return context.measureText(text).width;
    }
  }
  return text.length * fontSizePx * 0.55;
}

function wrapText(text: string, maxWidthPx: number, fontSizePx: number, weight = 'normal'): string[] {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines: string[] = [];
  let line = words[0];
  for (const word of words.slice(1)) {
    if (measureText(`${line} ${word}`, fontSizePx, weight) <= maxWidthPx) line += ` ${word}`;
    else { lines.push(line); line = word; }
  }
  lines.push(line);
  return lines;
}

export interface RenderTableOptions {
  milestonesOnly?: boolean;
  noMilestones?: boolean;
}

/** Render the task table as SVG. Mirrors `render_table`'s layout in inches. */
export function renderTableSvg(config: ChartConfig, options: RenderTableOptions = {}): SVGSVGElement | null {
  const style = config.style;
  let rows = flattenRows(config, style.render_depth);
  if (options.milestonesOnly && options.noMilestones) {
    throw new Error('Cannot use milestones_only and no_milestones together.');
  }
  if (options.milestonesOnly) rows = rows.filter(row => row.task.milestone);
  if (options.noMilestones) rows = rows.filter(row => !row.task.milestone);
  if (!rows.length) return null;

  const fontSizePx = style.font_size * (DPI / 72);
  const lineHeightPx = style.font_size * 1.5 * (DPI / 72);
  const tableWidthPx = style.width * DPI * 0.94;
  const gutterWidthPx = style.table_colorize ? tableWidthPx * 0.018 : 0;
  const gutterGapPx = style.table_colorize ? 0.05 * DPI : 0;
  const textPadPx = tableWidthPx * 0.014;
  const colPaddingPx = textPadPx * 2 + 0.05 * DPI;
  const columns = resolveTableColumns(style);

  // Measure columns from content and fit proportionally into the table width.
  const naturalWidths = columns.map(column => {
    const header = measureText(column.title, fontSizePx, 'bold');
    const cells = rows.map(row => measureText(rowTableCell(row, column), fontSizePx));
    return Math.max(header, ...cells) + colPaddingPx;
  });
  const availPx = tableWidthPx - gutterWidthPx - gutterGapPx;
  const totalNatural = naturalWidths.reduce((a, b) => a + b, 0);
  const widths = naturalWidths.map(w => Math.max(0.06 * availPx, (w / totalNatural) * availPx));

  // Wrap cells and compute row heights in text-line units (header = 1 row).
  const wrapped = rows.map(row =>
    columns.map((column, c) => wrapText(rowTableCell(row, column), widths[c] - colPaddingPx, fontSizePx)));
  const headerLines = columns.map((column, c) =>
    wrapText(column.title, widths[c] - colPaddingPx, fontSizePx, 'bold').length);
  const rowHeights = wrapped.map(cells => Math.max(...cells.map(lines => lines.length), 1));
  const headerHeight = Math.max(...headerLines, 1);
  const totalUnits = headerHeight + rowHeights.reduce((a, b) => a + b, 0);

  const figWPx = style.width * DPI;
  const topMarginPx = (config.title ? 0.8 : 0.35) * DPI;
  const figHPx = totalUnits * lineHeightPx + topMarginPx;
  const tableLeftPx = style.width * DPI * 0.03;

  const svg = el('svg', {
    xmlns: NS, viewBox: `0 0 ${figWPx} ${figHPx}`, width: figWPx, height: figHPx,
    role: 'img', class: 'jsonantt-table',
    'aria-label': config.title || 'Task table',
  });
  const styleEl = el('style', {});
  styleEl.textContent = '.jsonantt-table text{font-family:DejaVu Sans, sans-serif;fill:#111111}';
  svg.append(styleEl);
  svg.append(el('rect', { x: 0, y: 0, width: figWPx, height: figHPx, fill: style.background }));

  if (config.title) {
    svg.append(el('text', {
      x: figWPx / 2, y: 0.34 * DPI, 'text-anchor': 'middle',
      'font-size': (style.font_size + 3) * (DPI / 72), 'font-weight': 'bold',
      class: 'chart-title',
    }, config.title));
  }

  const headerColor = darken(style.row_band_color, 0.08);
  const dividerColor = style.grid_color;
  let yPx = topMarginPx;
  const xStarts: number[] = [];
  let x = tableLeftPx + gutterWidthPx + gutterGapPx;
  for (const w of widths) { xStarts.push(x); x += w; }

  // Header row
  svg.append(el('rect', {
    x: tableLeftPx, y: yPx, width: tableWidthPx, height: headerHeight * lineHeightPx,
    fill: headerColor, class: 'table-header',
  }));
  columns.forEach((column, c) => {
    svg.append(el('text', {
      x: xStarts[c] + textPadPx, y: yPx + headerHeight * lineHeightPx / 2,
      'font-size': fontSizePx, 'font-weight': 'bold', 'dominant-baseline': 'central',
    }, column.title));
  });
  yPx += headerHeight * lineHeightPx;

  // Data rows
  rows.forEach((row, r) => {
    const heightPx = rowHeights[r] * lineHeightPx;
    if (r % 2 === 1) {
      svg.append(el('rect', {
        x: tableLeftPx, y: yPx, width: tableWidthPx, height: heightPx,
        fill: style.row_band_color, class: 'row-band',
      }));
    }
    if (style.table_colorize) {
      svg.append(el('rect', {
        x: tableLeftPx, y: yPx, width: gutterWidthPx, height: heightPx,
        fill: row.color, class: 'row-gutter',
      }));
      if (style.table_show_markers && row.task.milestone) {
        const cx = tableLeftPx + gutterWidthPx / 2;
        const cy = yPx + heightPx / 2;
        const size = Math.min(gutterWidthPx, lineHeightPx) * 0.55;
        svg.append(el('path', {
          d: `M ${cx} ${cy - size} L ${cx + size} ${cy} L ${cx} ${cy + size} L ${cx - size} ${cy} Z`,
          fill: style.milestone_color, class: 'table-milestone',
        }));
      }
    }
    const group = el('g', {
      class: 'jsonantt-row', 'data-row-index': r,
      'data-task-id': row.task.id ?? '', 'data-number': row.number,
    });
    wrapped[r].forEach((lines, c) => {
      const weight = row.task.bold || (style.bold_tasks && row.depth === 0) ? 'bold' : 'normal';
      lines.forEach((line, lineIndex) => {
        group.append(el('text', {
          x: xStarts[c] + textPadPx,
          y: yPx + (lineIndex + 0.5) * lineHeightPx + (heightPx - rowHeights[r] * lineHeightPx) / 2,
          'font-size': fontSizePx, 'font-weight': weight, 'dominant-baseline': 'central',
        }, line));
      });
    });
    svg.append(group);
    yPx += heightPx;
    svg.append(el('line', {
      x1: tableLeftPx, y1: yPx, x2: tableLeftPx + tableWidthPx, y2: yPx,
      stroke: dividerColor, 'stroke-width': 0.8, class: 'row-divider',
    }));
  });

  // Column separators
  for (const xStart of xStarts.slice(1)) {
    svg.append(el('line', {
      x1: xStart - 0.5, y1: topMarginPx, x2: xStart - 0.5, y2: yPx,
      stroke: dividerColor, 'stroke-width': 0.5, class: 'col-divider',
    }));
  }
  return svg as SVGSVGElement;
}

/** CSV export for the table canvas. Mirrors `_write_table_csv` columns. */
export function tableCsv(config: ChartConfig, options: RenderTableOptions = {}): string {
  const style = config.style;
  let rows = flattenRows(config, style.render_depth);
  if (options.milestonesOnly) rows = rows.filter(row => row.task.milestone);
  if (options.noMilestones) rows = rows.filter(row => !row.task.milestone);
  const columns = resolveTableColumns(style);
  const escape = (value: string) =>
    /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  const lines = [columns.map(column => escape(column.title)).join(',')];
  for (const row of rows) {
    lines.push(columns.map(column => escape(rowTableCell(row, column))).join(','));
  }
  return `${lines.join('\n')}\n`;
}
