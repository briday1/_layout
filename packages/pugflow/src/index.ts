import type {
  DocumentContext, InspectorSection, LayoutAdapter, SourceObject, SourceRange,
  TextEdit, Theme,
} from '@briday1/layout';
import { defineAdapter, svgToPng } from '@briday1/layout';
import { parseDiagram } from './engine/parser.mjs';
import { renderSvg } from './engine/pugflow.mjs';
import {
  appendDeclaration, canvasFieldEdit, declarationRange, fieldEdit, sourceLines,
} from './source.js';

/* Upstream model shapes (engine/parser.mjs). */
interface PugflowNode {
  id: string; label: string; kind: string; hidden: boolean;
  layer: number; explicitLayer: boolean; lineNumber: number; sourceIndex: number;
  offsetX: number; offsetY: number;
  style: Record<string, unknown> & { shape?: string; fill?: string; color?: string | null; outline?: string };
}
interface PugflowEdge {
  id: string; from: string; to: string; kind: string; label: string;
  color: string | null; lineNumber: number; labelLineNumber: number;
  width: number; direction: string; arrowShape: string; style: string; hidden: boolean;
}
interface PugflowGroup {
  id: string; label: string; hidden: boolean; layer: number;
  fill: string; outline: string; lineNumber: number; nodeIds: string[];
}
export interface PugflowModel {
  nodes: PugflowNode[];
  edges: PugflowEdge[];
  groups: PugflowGroup[];
  figure: Record<string, unknown>;
  errors: string[];
}

const parse = parseDiagram as unknown as (source: string, styles?: string) => PugflowModel;
const render = renderSvg as unknown as (
  container: HTMLElement, model: PugflowModel, options?: Record<string, unknown>
) => SVGSVGElement;

const flowKey = (flow: PugflowEdge) => `${flow.from}:${flow.to}:${flow.lineNumber}`;

function rangeForLine(source: string, lineNumber: number): SourceRange {
  const lines = sourceLines(source);
  const line = lines[Math.max(0, Math.min(lineNumber - 1, lines.length - 1))];
  return line ? { start: line.start, end: line.end } : { start: 0, end: 0 };
}

function objects(source: string, model: PugflowModel): SourceObject[] {
  const result: SourceObject[] = [
    { id: 'canvas', label: 'Canvas settings', kind: 'canvas', range: { start: 0, end: source.length } },
  ];
  model.groups.forEach(group => result.push({
    id: `graph:${group.id}`, label: group.label || group.id, kind: 'graph',
    detail: `${group.nodeIds.length} nodes`, hidden: group.hidden,
    range: declarationRange(source, group.lineNumber),
  }));
  model.nodes.forEach(node => result.push({
    id: `node:${node.id}`, label: node.label || node.id,
    kind: node.kind === 'image' ? 'image' : 'node', hidden: node.hidden,
    range: declarationRange(source, node.lineNumber),
  }));
  model.edges.forEach(flow => result.push({
    id: `flow:${flowKey(flow)}`,
    label: `${flow.from} → ${flow.to}${flow.label ? ` (${flow.label})` : ''}`,
    kind: 'flow', hidden: flow.hidden,
    range: declarationRange(source, flow.lineNumber),
  }));
  return result;
}

const SHAPES = ['round', 'square', 'rounded', 'pill', 'diamond', 'hexagon', 'cylinder'];
const ARROW_STYLES = ['forward', 'backward', 'both', 'none'];
const ARROW_SHAPES = ['triangle', 'open', 'diamond', 'circle', 'chunky'];
const STROKE_STYLES = ['solid', 'dashed', 'dotted'];
const DIRECTIONS = ['right', 'left', 'up', 'down'];

/** Per-field inspector → source property mapping for nodes, flows and graphs. */
const NODE_FIELD_MAP: Record<string, string> = {
  id: 'id', label: 'label', hidden: 'hidden', layer: 'layer',
  shape: 'shape', fill: 'fill', color: 'color', outline: 'outline',
  'outline-style': 'outline-style', 'outline-width': 'outline-width',
};
const FLOW_FIELD_MAP: Record<string, string> = {
  from: 'from', to: 'to', label: 'label', hidden: 'hidden', color: 'color',
  width: 'width', 'stroke-style': 'style', 'arrow-style': 'direction',
  'arrow-shape': 'arrow-shape', direction: 'direction',
};
const GRAPH_FIELD_MAP: Record<string, string> = {
  id: 'id', label: 'label', hidden: 'hidden', layer: 'layer', fill: 'fill', outline: 'outline',
};

function text(id: string, label: string, value: unknown, placeholder = '') {
  return { id, label, type: 'text' as const, value: value == null ? '' : String(value), placeholder };
}
function num(id: string, label: string, value: unknown, extra: Record<string, unknown> = {}) {
  return { id, label, type: 'number' as const, value: Number(value ?? 0), ...extra };
}
function selectField(id: string, label: string, value: unknown, values: string[]) {
  return {
    id, label, type: 'select' as const, value: String(value ?? values[0]),
    options: values.map(v => ({ value: v, label: v[0].toUpperCase() + v.slice(1) })),
  };
}
function color(id: string, label: string, value: unknown, placeholder = 'inherit') {
  return { id, label, type: 'color' as const, value: value == null ? '' : String(value), placeholder };
}

function inspect({ model, selection }: DocumentContext<PugflowModel>): InspectorSection[] {
  if (!selection) return [];
  if (selection.kind === 'canvas') {
    return [{
      id: 'canvas', title: 'Canvas',
      fields: [
        color('background', 'Background', model.figure.background, 'theme default'),
        text('font', 'Font family', model.figure.font, 'theme default'),
        color('annotation.color', 'Annotation color', model.figure.annotation, 'theme default'),
      ],
    }];
  }
  const node = model.nodes.find(item => `node:${item.id}` === selection.id);
  if (node) {
    return [
      {
        id: 'identity', title: 'Node',
        fields: [
          text('id', 'ID (updates connected flows)', node.id),
          { id: 'label', label: 'Label', type: 'textarea', value: node.label },
          { id: 'hidden', label: 'Hidden', type: 'checkbox', value: node.hidden },
          num('layer', 'Layer', node.layer, { step: 1 }),
        ],
      },
      {
        id: 'style', title: 'Style',
        fields: [
          selectField('shape', 'Shape', node.style.shape ?? 'round', SHAPES),
          color('fill', 'Fill', node.style.fill, 'transparent'),
          color('color', 'Text color', node.style.color, 'theme default'),
          color('outline', 'Outline', node.style.outline, 'theme default'),
          selectField('outline-style', 'Outline style', node.style.outlineStyle ?? 'solid', STROKE_STYLES),
          num('outline-width', 'Outline width', node.style.outlineWidth ?? 2, { min: 0, step: 0.5 }),
        ],
      },
    ];
  }
  const flow = model.edges.find(item => `flow:${flowKey(item)}` === selection.id);
  if (flow) {
    return [
      {
        id: 'flow', title: 'Flow',
        fields: [
          text('from', 'From', flow.from),
          text('to', 'To', flow.to),
          text('label', 'Label', flow.label),
          { id: 'hidden', label: 'Hidden', type: 'checkbox', value: flow.hidden },
        ],
      },
      {
        id: 'routing', title: 'Routing and arrows',
        fields: [
          selectField('direction', 'Direction', flow.direction, DIRECTIONS),
          color('color', 'Color', flow.color, 'theme default'),
          num('width', 'Width', flow.width, { min: 0.5, step: 0.5 }),
          selectField('stroke-style', 'Stroke style', flow.style, STROKE_STYLES),
          selectField('arrow-style', 'Arrow style', flow.direction, ARROW_STYLES),
          selectField('arrow-shape', 'Arrow shape', flow.arrowShape, ARROW_SHAPES),
        ],
      },
    ];
  }
  const group = model.groups.find(item => `graph:${item.id}` === selection.id);
  if (group) {
    return [{
      id: 'graph', title: 'Graph',
      fields: [
        text('id', 'ID', group.id),
        text('label', 'Label', group.label),
        { id: 'hidden', label: 'Hidden', type: 'checkbox', value: group.hidden },
        num('layer', 'Layer', group.layer, { step: 1 }),
        color('fill', 'Fill', group.fill, 'transparent'),
        color('outline', 'Outline', group.outline, 'transparent'),
      ],
    }];
  }
  return [];
}

const FIELD_IDS = new Set([
  ...Object.keys(NODE_FIELD_MAP), ...Object.keys(FLOW_FIELD_MAP),
  'background', 'font', 'annotation.color',
]);

function themedFigure(model: PugflowModel, theme: Theme): Record<string, unknown> {
  return {
    ...model.figure,
    background: model.figure.background || theme.tokens.preview,
    text: model.figure.text || theme.tokens.previewText,
    label: model.figure.label || theme.tokens.previewText,
    merge: model.figure.merge || theme.tokens.previewText,
    annotation: model.figure.annotation || theme.tokens.muted,
    font: model.figure.font || theme.tokens.font,
  };
}

function exportSvgString(model: PugflowModel, theme: Theme, styles: string): string {
  const container = document.createElement('div');
  const graph = { ...model, figure: themedFigure(model, theme) };
  const svg = render(container, graph, { styles });
  // Mirror upstream exportSvgClone: drop hit-only paths and interactive state.
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.classList.remove('interactive');
  clone.querySelectorAll('.connector-hit').forEach(element => element.remove());
  clone.querySelectorAll('.selected-element').forEach(element => element.classList.remove('selected-element'));
  clone.querySelectorAll('.resize-handles').forEach(element => element.remove());
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(clone)}`;
}

/** Only syntax, domain commands, rendering and source patches belong here. */
export function createPugflowAdapter(initialSource = '', stylesSource = ''): LayoutAdapter<PugflowModel> {
  return defineAdapter<PugflowModel>({
    id: 'pugflow', title: 'Pugflow', extension: 'pug', initialSource,
    language: 'pugflow', preview: 'canvas',
    sources: [{
      id: 'styles', label: 'Styles', extension: 'css', initialSource: stylesSource, language: 'css',
    }],
    capabilities: { navigatorGroups: true, panZoom: true },
    styleProfile: {
      artwork: (theme: Theme) => ({
        '--diagram-background': theme.tokens.preview,
        '--diagram-label': theme.tokens.previewText,
        '--diagram-text': theme.tokens.previewText,
        '--diagram-merge': theme.tokens.previewText,
        '--diagram-annotation': theme.tokens.muted,
        '--diagram-font': theme.tokens.font,
      }),
    },
  }, {
    parse(source, signal, companions = []) {
      void signal;
      const model = parse(source, companions[0] ?? '');
      const diagnostics = model.errors.map(message => {
        const line = sourceLines(source)[Number(message.match(/^Line (\d+):/)?.[1]) - 1];
        return {
          severity: 'error' as const, message,
          range: line ? { start: line.start, end: line.end } : undefined,
        };
      });
      return { model, objects: objects(source, model), diagnostics };
    },
    render({ container, model, theme, select, selection, companionSources }) {
      const graph = { ...model, figure: themedFigure(model, theme) };
      const svg = render(container, graph, {
        styles: companionSources[0] ?? '',
        onElementClick: (item: { kind: string; id: string | null; from: string | null; to: string | null; lineNumber: number; additive: boolean }) => {
          if (item.additive) return;
          if (item.kind === 'graph' && item.id) select(`graph:${item.id}`);
          else if (item.kind === 'line' && item.from && item.to) {
            select(`flow:${item.from}:${item.to}:${item.lineNumber}`);
          } else if (item.id) select(`node:${item.id}`);
        },
        onNodeClick: (item: { id: string | null; lineNumber: number }) => {
          if (item.id) select(`node:${item.id}`);
        },
      });
      svg.style.color = theme.tokens.accent;
      const highlight = (selected: SourceObject | null) => {
        let key: string | undefined;
        if (selected?.kind === 'node' || selected?.kind === 'image') key = selected.id;
        else if (selected?.kind === 'graph') key = selected.id;
        else if (selected?.kind === 'flow') key = `line:${selected.id.slice(5)}`;
        svg.querySelectorAll('[data-selection-key]').forEach(element => {
          element.classList.toggle('selected-element',
            Boolean(key) && element.getAttribute('data-selection-key') === key);
        });
      };
      highlight(selection);
      container.replaceChildren(svg);
      return { select: highlight, destroy: () => svg.remove() };
    },
    inspect,
    update(context) {
      const { source, model, selection, field } = context;
      if (!selection || !FIELD_IDS.has(field)) throw new Error('Select an editable property first.');
      const value = String(context.value).trim();
      if (selection.kind === 'canvas') return [canvasFieldEdit(source, field, value)];
      const map = selection.kind === 'node' ? NODE_FIELD_MAP
        : selection.kind === 'flow' ? FLOW_FIELD_MAP
        : selection.kind === 'graph' ? GRAPH_FIELD_MAP : {};
      const property = map[field];
      if (!property) throw new Error('Select an editable property first.');
      const edits = [fieldEdit(source, selection.range, property, value)];
      if (selection.kind === 'node' && field === 'id') {
        if (!/^[a-zA-Z][\w-]*$/.test(value)) {
          throw new Error('IDs start with a letter and contain letters, numbers, underscores or hyphens.');
        }
        const oldId = selection.id.slice(5);
        if (value !== oldId && model.nodes.some(item => item.id === value)) {
          throw new Error('That node ID already exists.');
        }
        for (const flow of model.edges) for (const endpoint of ['from', 'to'] as const) {
          if (flow[endpoint] === oldId) {
            edits.push(fieldEdit(source, declarationRange(source, flow.lineNumber), endpoint, value));
          }
        }
      }
      return edits;
    },
    commands: [
      {
        id: 'add-node', label: 'Add node', group: 'Build',
        run({ source, model }) {
          let index = 1;
          while (model.nodes.some(node => node.id === `node-${index}`)) index++;
          return appendDeclaration(source, `node\n  .id node-${index}\n  .label New node ${index}\n`);
        },
      },
      {
        id: 'add-flow', label: 'Add flow', group: 'Build',
        run({ source, model }) {
          if (model.nodes.length < 2) throw new Error('Add at least two nodes before adding a flow.');
          return appendDeclaration(source, `flow\n  .from ${model.nodes[0].id}\n  .to ${model.nodes[1].id}\n`);
        },
      },
      {
        id: 'add-graph', label: 'Add graph', group: 'Build',
        run({ source }) {
          return appendDeclaration(source, `graph\n  .id graph-1\n  .label New graph\n`);
        },
      },
      {
        id: 'delete', label: 'Delete selected', group: 'Edit',
        run({ source, model, selection }) {
          if (!selection || selection.kind === 'canvas') throw new Error('Select a node, flow, or graph to delete.');
          const ranges = [selection.range];
          if (selection.kind === 'node') {
            const id = selection.id.slice(5);
            model.edges.filter(flow => flow.from === id || flow.to === id)
              .forEach(flow => ranges.push(declarationRange(source, flow.lineNumber)));
          }
          if (selection.kind === 'graph') {
            const id = selection.id.slice(6);
            const group = model.groups.find(item => item.id === id);
            group?.nodeIds.forEach(nodeId => {
              const node = model.nodes.find(item => item.id === nodeId);
              if (node) ranges.push(declarationRange(source, node.lineNumber));
            });
          }
          // Drop duplicates and ranges contained by another (nested declarations).
          const unique = ranges
            .filter((range, index) => ranges.findIndex(other =>
              other.start === range.start && other.end === range.end) === index)
            .filter(range => !ranges.some(other =>
              other !== range && other.start <= range.start && other.end >= range.end &&
              (other.start !== range.start || other.end !== range.end)));
          return unique.map(range => ({ ...range, text: '' }));
        },
      },
    ],
    exports: [{
      id: 'svg', label: 'Export SVG', extension: 'svg', mimeType: 'image/svg+xml',
      export: ({ model, theme, companionSources }) => exportSvgString(model, theme, companionSources[0] ?? ''),
    }, {
      id: 'png', label: 'Export PNG', extension: 'png', mimeType: 'image/png',
      export: ({ model, theme, companionSources }) => svgToPng(exportSvgString(model, theme, companionSources[0] ?? '')),
    }],
  });
}
