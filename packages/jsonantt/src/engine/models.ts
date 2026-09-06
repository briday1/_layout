/**
 * jsonantt data model — a TypeScript port of jsonantt/models.py.
 * Dates are plain `Date` objects at UTC midnight; durations and fiscal
 * calendars follow the upstream Python semantics exactly.
 */

export const DEFAULT_PALETTE = [
  '#4472C4', '#ED7D31', '#70AD47', '#FF5757', '#9DC3E6',
  '#FFC000', '#7030A0', '#00B0F0', '#FF0066', '#00B050',
];

export interface Arrow {
  from_id: string;
  to_id: string;
  color: string;
  label?: string | null;
}

export interface Task {
  name: string;
  description: string;
  id: string | null;
  start: Date | null;
  end: Date | null;
  color: string | null;
  edge_color: string | null;
  milestone: boolean;
  major_milestone: boolean;
  milestone_date: Date | null;
  milestone_dates: Date[];
  children: Task[];
  not_before: string | null;
  duration_spec: string | null;
  marker_size: number | null;
  marker: string | null;
  bold: boolean;
  fields: Record<string, unknown>;
}

export interface Style {
  width: number;
  row_height: number;
  bar_height: number;
  font_size: number;
  indent_size: number;
  label_fraction: number;
  subtask_lightening_pct: number;
  colors: string[];
  background: string;
  grid_color: string;
  row_band_color: string;
  milestone_color: string;
  milestone_edge_color: string | null;
  milestone_marker: string;
  milestone_size: number;
  rollup_milestones: boolean;
  rollup_major_milestones_only: boolean;
  number_milestones: boolean;
  major_milestone_color: string | null;
  major_milestone_edge_color: string | null;
  major_milestone_marker: string | null;
  major_milestone_size: number | null;
  major_tick: string | null;
  minor_tick: string | null;
  fiscal_year_start: string | null;
  major_grid_width: number;
  minor_grid_width: number;
  bold_tasks: boolean;
  number_tasks: boolean;
  table_colorize: boolean;
  table_show_markers: boolean;
  tick_position: string;
  table_columns: unknown[];
  render_depth: number;
  show_arrows: boolean;
  today_marker: boolean;
  value_prefix: string | null;
  value_suffix: string | null;
  value_scale: string;
  value_decimals: number | null;
  value_fields: string[];
  task_number_start: number;
  milestone_number_start: number;
  milestone_prefix: string;
}

export function defaultStyle(): Style {
  return {
    width: 14.0, row_height: 0.3, bar_height: 0.5, font_size: 12.0,
    indent_size: 3, label_fraction: 0.0, subtask_lightening_pct: 0.0,
    colors: [...DEFAULT_PALETTE], background: '#FFFFFF', grid_color: '#E0E0E0',
    row_band_color: '#F5F5F5', milestone_color: '#FFD700',
    milestone_edge_color: null, milestone_marker: 'D', milestone_size: 14.0,
    rollup_milestones: false, rollup_major_milestones_only: false,
    number_milestones: false, major_milestone_color: null,
    major_milestone_edge_color: null, major_milestone_marker: null,
    major_milestone_size: null, major_tick: null, minor_tick: null,
    fiscal_year_start: null, major_grid_width: 2.0, minor_grid_width: 1.5,
    bold_tasks: true, number_tasks: true, table_colorize: true,
    table_show_markers: true, tick_position: 'top', table_columns: [],
    render_depth: 0, show_arrows: true, today_marker: false,
    value_prefix: null, value_suffix: null, value_scale: 'units',
    value_decimals: null, value_fields: ['cost'],
    task_number_start: 1, milestone_number_start: 1, milestone_prefix: 'M',
  };
}

export interface ChartConfig {
  tasks: Task[];
  title: string;
  date_format: string;
  start: Date | null;
  end: Date | null;
  style: Style;
  arrows: Arrow[];
}

export function newTask(name: string): Task {
  return {
    name, description: '', id: null, start: null, end: null,
    color: null, edge_color: null, milestone: false, major_milestone: false,
    milestone_date: null, milestone_dates: [], children: [],
    not_before: null, duration_spec: null, marker_size: null, marker: null,
    bold: false, fields: {},
  };
}

const DAY = 86_400_000;
export const dateUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY);
export const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY);

/** Earliest start date, resolving through children if needed. */
export function effectiveStart(task: Task): Date | null {
  if (task.milestone) {
    if (task.milestone_dates.length) return new Date(Math.min(...task.milestone_dates.map(Number)));
    return task.milestone_date ?? task.start;
  }
  if (task.start !== null) return task.start;
  const starts = task.children.map(effectiveStart).filter((d): d is Date => d !== null);
  return starts.length ? new Date(Math.min(...starts.map(Number))) : null;
}

/** Latest end date, resolving through children if needed. */
export function effectiveEnd(task: Task): Date | null {
  if (task.milestone) {
    if (task.milestone_dates.length) return new Date(Math.max(...task.milestone_dates.map(Number)));
    return task.milestone_date ?? task.start;
  }
  if (task.end !== null) return task.end;
  const ends = task.children.map(effectiveEnd).filter((d): d is Date => d !== null);
  return ends.length ? new Date(Math.max(...ends.map(Number))) : null;
}

export function isParent(task: Task): boolean {
  return task.children.length > 0;
}

/** Move each RGB channel toward white by `amount` (0..1). Matches _lighten. */
export function lighten(color: string, amount = 0): string {
  const hex = color.replace(/^#/, '');
  if (hex.length !== 6) return color.startsWith('#') ? color : `#${color}`;
  const clamped = Math.max(0, Math.min(1, amount));
  const channel = (i: number) => {
    const value = parseInt(hex.slice(i, i + 2), 16);
    return Math.round(value + (255 - value) * clamped);
  };
  const hexOut = [channel(0), channel(2), channel(4)]
    .map(v => v.toString(16).toUpperCase().padStart(2, '0')).join('');
  return `#${hexOut}`;
}

/** Darken by `amount` (0..1). Matches _darken (header row of tables). */
export function darken(color: string, amount = 0.2): string {
  const hex = color.replace(/^#/, '');
  if (hex.length !== 6) return color;
  const channel = (i: number) =>
    Math.max(0, Math.trunc(parseInt(hex.slice(i, i + 2), 16) * (1 - amount)));
  return `#${[channel(0), channel(2), channel(4)]
    .map(v => v.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}
