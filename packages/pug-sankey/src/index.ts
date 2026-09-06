import type {
  LayoutAdapter, SourceObject, InspectorField, TextEdit, DocumentContext,
} from '@briday1/layout';
import { defineAdapter, svgToPng } from '@briday1/layout';
import { parseDiagram } from './engine/parser.mjs';
import { renderFlowField } from './engine/flowfield.mjs';
import { DIAGRAM_THEMES } from './engine/diagram-themes.mjs';
import { declarationRange, fieldEdit, sourceLines } from './source.js';

interface Node {
  id: string; label: string; color: string | null; layer: number;
  lineNumber: number; declaredValue?: number;
}
interface Flow {
  id?: string; from: string; to: string; value: number; label?: string;
  color: string | null; lineNumber: number;
}
export interface SankeyModel {
  nodes: Node[];
  edges: Flow[];
  figure: Record<string, unknown>;
  errors: string[];
}
const parse = parseDiagram as unknown as (source: string) => SankeyModel;
const render = renderFlowField as unknown as (
  container: HTMLElement, model: SankeyModel, options?: Record<string, unknown>
) => SVGSVGElement;
const flowId = (flow: Flow) => `flow:${flow.from}|${flow.to}|${flow.lineNumber}`;
const textField = (id: string, label: string, value: unknown): InspectorField =>
  ({ id, label, type: 'text', value: value == null ? '' : String(value) });

// The upstream renderer constructs SVG CSS. Reject CSS statements and external
// paint references at the adapter boundary, including values from reusable styles.
function validateStyles(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === 'object') { validateStyles(field); continue; }
    if (typeof field !== 'string') continue;
    const color = /color|background|textOutline$/i.test(key);
    const font = /^(font|fontFamily|fontWeight|fontStyle|textDecoration)$/.test(key);
    if (color && !/^(?:#[\da-f]{3,8}|[a-z]+|(?:rgb|rgba|hsl|hsla)\([\d.%+\-,\s]+\))$/i.test(field)) {
      throw new Error(`Unsafe or unsupported ${key}: use a CSS color, not a URL or CSS statement.`);
    }
    if (font && !/^[\w\s,'".-]+$/.test(field)) {
      throw new Error(`Unsafe or unsupported ${key}: use a plain font name or style.`);
    }
  }
}

function exportSvg(model: SankeyModel): string {
  const svg = render(document.createElement('div'), model);
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

function objects(source: string, model: SankeyModel): SourceObject[] {
  return [
    { id: 'diagram', label: 'Diagram settings', kind: 'diagram', range: { start: 0, end: source.length } },
    ...model.nodes.map(node => ({
      id: `node:${node.id}`, label: node.label || node.id, kind: 'node',
      range: declarationRange(source, node.lineNumber, 'node'),
    })),
    ...model.edges.map(flow => ({
      id: flowId(flow), label: `${flow.from} → ${flow.to} (${flow.value})`, kind: 'flow',
      range: declarationRange(source, flow.lineNumber, 'flow'),
    })),
  ];
}

function inspect({ model, selection }: DocumentContext<SankeyModel>): InspectorField[] {
  if (!selection) return [];
  if (selection.kind === 'diagram') return [
    { id: 'theme', label: 'Flow shape', type: 'select', value: String(model.figure.theme || 'smooth'),
      options: DIAGRAM_THEMES.map(({ id, label }) => ({ value: id, label })) },
    textField('background', 'Artwork background (blank inherits theme)', model.figure.background),
    { id: 'blend', label: 'Color blend', type: 'number', value: Number(model.figure.blend ?? 60), min: 0, max: 100 },
    ...(['node-labels', 'node-values', 'flow-labels', 'flow-values'] as const).map(id => ({
      id, label: id.replace('-', ' '), type: 'select' as const,
      value: model.figure[id.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] ? 'show' : 'hide',
      options: [{ value: 'show', label: 'Show' }, { value: 'hide', label: 'Hide' }],
    })),
  ];
  const node = model.nodes.find(node => `node:${node.id}` === selection.id);
  if (node) return [
    textField('id', 'ID (updates connected flows)', node.id),
    textField('label', 'Label', node.label),
    textField('color', 'Color (blank uses palette)', node.color),
    { id: 'layer', label: 'Layer', type: 'number', value: node.layer, min: 0, step: 1 },
    textField('value', 'Declared value (optional)', node.declaredValue),
  ];
  const flow = model.edges.find(flow => flowId(flow) === selection.id);
  if (!flow) return [];
  return [
    ...(['from', 'to'] as const).map(id => ({
      id, label: id === 'from' ? 'From' : 'To', type: 'select' as const, value: flow[id],
      options: model.nodes.map(node => ({ value: node.id, label: node.label || node.id })),
    })),
    { id: 'value', label: 'Value', type: 'number', value: flow.value, min: 0.000001, step: 0.1 },
    textField('label', 'Label', flow.label),
    textField('color', 'Color (blank blends endpoints)', flow.color),
  ];
}

function append(source: string, text: string): TextEdit[] {
  const lines = sourceLines(source);
  const canvas = lines.findIndex(line => /^#canvas(?:\s|$)/.test(line.text));
  const end = canvas < 0 ? source.length :
    declarationRange(source, canvas + 1, lines[canvas].text).end;
  const newline = source.includes('\r\n') ? '\r\n' : '\n';
  const body = canvas < 0 ? text : text.split('\n').map(line => line ? `  ${line}` : line).join('\n');
  return [{ start: end, end, text: `${end && source[end - 1] !== '\n' ? newline : ''}${body.replace(/\n/g, newline)}` }];
}

/** Only syntax, domain commands, rendering and source patches belong here. */
export function createSankeyAdapter(initialSource = ''): LayoutAdapter<SankeyModel> {
  return defineAdapter<SankeyModel>({
    id: 'pug-sankey', title: 'Pug Sankey', extension: 'pug', initialSource,
    language: 'pug-sankey', preview: 'canvas',
  }, {
    parse(source) {
      const model = parse(source);
      const diagnostics = model.errors.map(message => {
        const line = sourceLines(source)[Number(message.match(/^Line (\d+):/)?.[1]) - 1];
        return { severity: 'error' as const, message, range: line ? { start: line.start, end: line.end } : undefined };
      });
      try { validateStyles(model); } catch (error) {
        diagnostics.push({ severity: 'error', message: (error as Error).message, range: undefined });
      }
      return { model, objects: objects(source, model), diagnostics };
    },
    render({ container, model, select, selection }) {
      const svg = render(container, model, {
        onElementClick: (item: { id?: string; from?: string; to?: string; lineNumber: number }) => {
          select(item.id ? `node:${item.id}` : `flow:${item.from}|${item.to}|${item.lineNumber}`);
        },
      });
      svg.querySelector('style')!.textContent += '\n.selected-element .channel{filter:drop-shadow(0 0 3px currentColor)}';
      const highlight = (selected: SourceObject | null) => {
        const key = selected?.id.replace(/^(node|flow):/, '');
        svg.querySelectorAll('[data-selection-key]').forEach(element => {
          element.classList.toggle('selected-element', element.getAttribute('data-selection-key') === key);
        });
      };
      highlight(selection);
      container.replaceChildren(svg);
      return { select: highlight, destroy: () => svg.remove() };
    },
    inspect,
    update(context) {
      const { source, model, selection, field } = context;
      if (!selection || !inspect(context).some(item => item.id === field)) throw new Error('Select an editable property first.');
      const value = String(context.value).trim();
      const edits = [fieldEdit(source, selection.range, field, value, selection.kind === 'diagram')];
      if (selection.kind === 'node' && field === 'id') {
        if (!/^[a-zA-Z][\w-]*$/.test(value)) throw new Error('IDs start with a letter and contain letters, numbers, underscores or hyphens.');
        const oldId = selection.id.slice(5);
        if (value !== oldId && model.nodes.some(node => node.id === value)) throw new Error('That node ID already exists.');
        for (const flow of model.edges) for (const endpoint of ['from', 'to']) {
          if (flow[endpoint as 'from' | 'to'] === oldId) {
            edits.push(fieldEdit(source, declarationRange(source, flow.lineNumber, 'flow'), endpoint, value));
          }
        }
      }
      return edits;
    },
    commands: [
      { id: 'add-node', label: 'Add node', run({ source, model }) {
        let index = 1;
        while (model.nodes.some(node => node.id === `node-${index}`)) index++;
        return append(source, `node\n  .id node-${index}\n  .label New node ${index}\n`);
      } },
      { id: 'add-flow', label: 'Add flow', run({ source, model }) {
        if (model.nodes.length < 2) throw new Error('Add at least two nodes before adding a flow.');
        return append(source, `flow\n  .from ${model.nodes[0].id}\n  .to ${model.nodes[1].id}\n  .value 10\n`);
      } },
      { id: 'delete', label: 'Delete selected', run({ source, model, selection }) {
        if (!selection || selection.kind === 'diagram') throw new Error('Select a node or flow to delete.');
        const ranges = [selection.range];
        if (selection.kind === 'node') {
          const id = selection.id.slice(5);
          model.edges.filter(flow => flow.from === id || flow.to === id)
            .forEach(flow => ranges.push(declarationRange(source, flow.lineNumber, 'flow')));
        }
        return ranges.map(range => ({ ...range, text: '' }));
      } },
    ],
    exports: [{
      id: 'svg', label: 'Export SVG', extension: 'svg', mimeType: 'image/svg+xml',
      export: ({ model }) => exportSvg(model),
    }, {
      id: 'png', label: 'Export PNG', extension: 'png', mimeType: 'image/png',
      export: ({ model }) => svgToPng(exportSvg(model)),
    }],
  });
}
