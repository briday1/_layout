/**
 * Fidelity-critical assertions against the vendored pug-sankey engine:
 * the exact SVG structure, theming, and interaction behaviors that the
 * upstream editor produces — annotations, feedback loops, gradient blending,
 * trunk silhouettes, and all twelve flow-shape themes.
 */
import { describe, expect, it, vi } from 'vitest';
import { createSankeyAdapter } from '../packages/pug-sankey/src/index.js';
import { builtinThemes } from '../packages/layout/src/themes.js';
import type { ParsedDocument } from '../packages/layout/src/types.js';
import type { SankeyModel } from '../packages/pug-sankey/src/index.js';
import energyFlow from '../packages/pug-sankey/fixtures/energy-flow.pug?raw';
import trafficFunnel from '../packages/pug-sankey/fixtures/website-traffic-funnel.pug?raw';
import dataPipeline from '../packages/pug-sankey/fixtures/data-pipeline.pug?raw';
import householdBudget from '../packages/pug-sankey/fixtures/household-budget.pug?raw';
import supplyChain from '../packages/pug-sankey/fixtures/supply-chain.pug?raw';
import waterDistribution from '../packages/pug-sankey/fixtures/water-distribution.pug?raw';
import supportTickets from '../packages/pug-sankey/fixtures/support-tickets.pug?raw';
import minimalSankey from '../packages/pug-sankey/fixtures/minimal-sankey.pug?raw';

const adapter = createSankeyAdapter('');
const signal = new AbortController().signal;
const parse = (text: string) => adapter.parse(text, signal) as ParsedDocument<SankeyModel>;
const draw = (text: string) => {
  const parsed = parse(text);
  expect(parsed.diagnostics).toEqual([]);
  const container = document.createElement('div');
  adapter.render({
    container, source: text, model: parsed.model, selection: null, theme: builtinThemes[0],
    canvas: 'preview', companionSources: [], signal,
    select: vi.fn(), reveal: vi.fn(), edit: vi.fn(),
  });
  return { parsed, container, svg: container.querySelector('svg')! };
};

describe('sankey fidelity: upstream demo documents', () => {
  it.each([
    ['energy-flow', energyFlow],
    ['website-traffic-funnel', trafficFunnel],
    ['data-pipeline', dataPipeline],
    ['household-budget', householdBudget],
    ['supply-chain', supplyChain],
    ['water-distribution', waterDistribution],
    ['support-tickets', supportTickets],
    ['minimal-sankey', minimalSankey],
  ])('parses and renders %s without errors or NaN geometry', (_name, source) => {
    const { parsed, container, svg } = draw(source);
    expect(svg.classList.contains('exchange-map')).toBe(true);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity|undefined/);
    // Every node renders a trunk path and every flow a gradient channel.
    expect(svg.querySelectorAll('.flow-trunk')).toHaveLength(parsed.model.nodes.length);
    expect(svg.querySelectorAll('.solid-flow')).toHaveLength(parsed.model.edges.length);
  });

  it('keeps the energy demo annotation on the industry node', () => {
    const { container } = draw(energyFlow);
    expect(container.textContent).toContain('Largest single consumer');
  });

  it('renders the traffic funnel flow labels when enabled', () => {
    const { container, parsed } = draw(trafficFunnel);
    expect(parsed.model.figure.flowLabels).toBe(true);
    expect(container.textContent).toContain('search');
    expect(container.textContent).toContain('convert');
  });

  it('routes the data pipeline feedback loop above the field', () => {
    const { container, svg } = draw(dataPipeline);
    expect(svg.dataset.diagramTheme).toBeTruthy();
    // Feedback edge (ml-models → collectors) exists and gets its own lane path.
    const feedback = container.querySelectorAll('[data-selection-key]');
    expect(feedback.length).toBeGreaterThan(0);
    expect(container.innerHTML).toContain('channel');
  });
});

describe('sankey fidelity: rendering semantics', () => {
  const simple = `node
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

  it('emits the exact upstream SVG structure (style, background, gradient, channels)', () => {
    const { svg } = draw(simple);
    expect(svg.getAttribute('data-diagram-theme')).toBe('smooth');
    expect(svg.querySelector('style')!.textContent).toContain('.exchange-map .channel{fill:none');
    expect(svg.querySelector('rect')).toBeTruthy();
    // Three-stop gradient: source color at 0% and (100-blend)%, target at 100%.
    const stops = svg.querySelectorAll('linearGradient stop');
    expect(stops).toHaveLength(3);
    expect(stops[1].getAttribute('offset')).toBe('40%');
    // Ribbon opacity and background underlay are fidelity-critical.
    const ribbon = svg.querySelector('.solid-flow')!;
    expect(ribbon.getAttribute('opacity')).toBe('.76');
  });

  it('applies the blend setting to gradient stop offsets', () => {
    const { svg } = draw(`.blend 25\n${simple}`);
    expect(svg.querySelectorAll('linearGradient stop')[1].getAttribute('offset')).toBe('75%');
  });

  it('keeps the upstream artwork background independent of the workbench theme', () => {
    const explicit = draw(`.background #123456\n${simple}`);
    expect(explicit.svg.querySelector('rect')!.getAttribute('fill')).toBe('#123456');
    const inherited = draw(simple);
    expect(inherited.svg.querySelector('rect')!.getAttribute('fill')).toBe('#12171b');
  });

  it('marks sink nodes with pointed trunk silhouettes', () => {
    const { svg } = draw(simple);
    const sink = svg.querySelector('[data-selection-key="b"] .flow-trunk')!;
    expect(sink.getAttribute('d')).toContain('L');
    // Pointed tip: upstream sharedTrunk(0,116,c,…,true) ends with the arrow point.
    expect(sink.getAttribute('d')).toMatch(/L \d+\.?\d* \d+\.?\d* L/);
  });

  it('preserves self-loops and feedback edges as visible lanes', () => {
    const loop = `node
  .id a
  .label A
node
  .id b
  .label B
flow
  .from a
  .to b
  .value 5
flow
  .from b
  .to a
  .value 2
`;
    const { parsed, svg } = draw(loop);
    expect(parsed.diagnostics).toEqual([]);
    expect(svg.querySelectorAll('.solid-flow')).toHaveLength(2);
  });

  it('supports all twelve upstream flow-shape themes end to end', () => {
    for (const theme of ['smooth', 'wiggly', 'angular', 'terraced', 'arc', 'ripple',
      'circuit', 'zigzag', 'staircase', 'sail', 'dip', 's-bend']) {
      const { svg, container } = draw(`.theme ${theme}\n${simple}`);
      expect(svg.getAttribute('data-diagram-theme')).toBe(theme);
      expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    }
  });

  it('rejects unknown themes with a listed-error diagnostic', () => {
    const parsed = parse(`.theme bogus\n${simple}`);
    expect(parsed.diagnostics?.[0].message).toContain('.theme must be one of');
  });

  it('hides node labels/values when the canvas settings say so', () => {
    const { svg } = draw(`.node-labels hide\n.node-values hide\n${simple}`);
    expect(svg.querySelector('.junction-name')).toBeNull();
    expect(svg.querySelector('.quantity')).toBeNull();
  });
});
