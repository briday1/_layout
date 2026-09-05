// Geometry for a continuous flow map. Logical nodes are invisible stretches
// of shared trunk; branches attach flush with a single linear quantity scale.
import { sweepChannel, bendFeedback } from "./flow-geometry.mjs";
import { DEFAULT_DIAGRAM_THEME, isDiagramTheme } from "./diagram-themes.mjs";
export const FLOW_LAYOUT = Object.freeze({
  nodeWidth: 116, columnGutter: 204, nodeGutter: 84, padding: 62,
  targetHeight: 108, portGap: 0, headerHeight: 0, theme: DEFAULT_DIAGRAM_THEME,
});

export function layoutFlowField(sourceNodes, sourceEdges, overrides = {}) {
  const options = { ...FLOW_LAYOUT, ...overrides };
  if (!isDiagramTheme(options.theme)) throw new Error(`Unknown diagram theme: ${options.theme}`);
  const nodes = sourceNodes.filter(n => !n.hidden).map(n => ({ ...n, incoming: 0, outgoing: 0 }));
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = sourceEdges.filter(e => !e.hidden && byId.has(e.from) && byId.has(e.to)).map(e => ({ ...e }));
  const incoming = new Map(nodes.map(n => [n.id, []]));
  const outgoing = new Map(nodes.map(n => [n.id, []]));
  edges.forEach(e => {
    incoming.get(e.to).push(e); outgoing.get(e.from).push(e);
    byId.get(e.to).incoming += e.value; byId.get(e.from).outgoing += e.value;
  });

  // DFS removes only feedback edges from ranking. All edges remain visible.
  const visited = new Set(), active = new Set(), order = [];
  function visit(node) {
    if (visited.has(node.id)) return;
    visited.add(node.id); active.add(node.id);
    outgoing.get(node.id).forEach(e => {
      if (active.has(e.to)) e.feedback = true;
      else visit(byId.get(e.to));
    });
    active.delete(node.id); order.push(node);
  }
  nodes.filter(n => !incoming.get(n.id).length).forEach(visit);
  nodes.forEach(visit);
  nodes.forEach(n => { n.column = 0; });
  order.reverse().forEach(n => outgoing.get(n.id).forEach(e => {
    if (!e.feedback) byId.get(e.to).column = Math.max(byId.get(e.to).column, n.column + 1);
  }));
  const lastColumn = Math.max(0, ...nodes.map(n => n.column));
  nodes.forEach(n => { if (!outgoing.get(n.id).length && incoming.get(n.id).length) n.column = lastColumn; });
  const columns = Array.from({ length: lastColumn + 1 }, (_, column) => nodes.filter(n => n.column === column));
  const positions = new Map();
  const indexColumns = () => columns.forEach(col => col.forEach((n, index) => positions.set(n.id, index)));
  indexColumns();
  // Barycentric sweeps improve branch/merge ordering without changing source.
  for (let pass = 0; pass < 4; pass++) {
    const forward = pass % 2 === 0;
    const sweep = forward ? columns : [...columns].reverse();
    sweep.forEach(col => {
      const score = n => {
        const peers = (forward ? incoming : outgoing).get(n.id).filter(e => !e.feedback);
        const total = peers.reduce((sum, e) => sum + e.value, 0);
        return total ? peers.reduce((sum, e) => sum + positions.get(forward ? e.from : e.to) * e.value, 0) / total : positions.get(n.id);
      };
      col.sort((a, b) => score(a) - score(b)); indexColumns();
    });
  }
  const maxVolume = Math.max(1, ...nodes.map(n => Math.max(n.incoming, n.outgoing, n.declaredValue || 0)));
  const valueScale = options.valueScale > 0 ? options.valueScale : options.targetHeight / maxVolume;
  const portHeight = list => list.reduce((sum, e) => sum + e.value * valueScale, 0) + Math.max(0, list.length - 1) * options.portGap;
  nodes.forEach(n => {
    n.value = n.hasDeclaredValue ? n.declaredValue : Math.max(n.incoming, n.outgoing);
    n.width = options.nodeWidth;
    n.channelHeight = Math.max(18, portHeight(incoming.get(n.id)), portHeight(outgoing.get(n.id)));
    n.height = options.headerHeight + n.channelHeight + 14;
  });
  const columnHeights = columns.map(col => col.reduce((sum, n) => sum + n.height, 0) + Math.max(0, col.length - 1) * options.nodeGutter);
  const contentHeight = Math.max(120, ...columnHeights);
  const feedback = edges.filter(e => e.feedback);
  // Each feedback channel gets a dedicated upper lane, including self-loops.
  const feedbackHeight = feedback.reduce((sum, e) => sum + e.value * valueScale + 22, 0);
  const top = options.padding + feedbackHeight;
  columns.forEach((col, index) => {
    let y = top + (contentHeight - columnHeights[index]) / 2;
    col.forEach(n => {
      n.x = options.padding + index * (options.nodeWidth + options.columnGutter);
      n.y = y; y += n.height + options.nodeGutter;
    });
  });
  // Follow the dominant upstream channel horizontally. Smaller branches fan
  // out below it; later columns retain enough space for labels and offshoots.
  columns.slice(1).forEach(col => {
    let bottom = top;
    col.forEach(n => {
      const strongest = [...incoming.get(n.id)].filter(e => !e.feedback).sort((a,b) => b.value-a.value)[0];
      if (strongest) {
        const upstream = byId.get(strongest.from);
        n.y = Math.max(bottom, upstream.y + upstream.channelHeight/2 - n.channelHeight/2);
      } else n.y = Math.max(bottom,n.y);
      bottom = n.y + n.height + options.nodeGutter;
    });
  });
  const assignPorts = (node, list, other, side) => {
    list.sort((a, b) => byId.get(a[other]).y - byId.get(b[other]).y);
    let y = node.y + options.headerHeight + (node.channelHeight - portHeight(list)) / 2;
    list.forEach(e => {
      e.thickness = e.value * valueScale;
      e[side + 'X'] = node.x + (side === 'source' ? node.width : 0);
      e[side + 'Y'] = y + e.thickness / 2;
      y += e.thickness + options.portGap;
    });
  };
  nodes.forEach(n => { assignPorts(n, incoming.get(n.id), 'from', 'target'); assignPorts(n, outgoing.get(n.id), 'to', 'source'); });
  let lane = options.padding;
  edges.forEach((e, index) => {
    e.key = `${e.from}|${e.to}|${e.lineNumber ?? index}`;
    const { sourceX: x0, sourceY: y0, targetX: x1, targetY: y1 } = e;
    if (e.feedback) {
      const y = lane + e.thickness / 2;
      lane += e.thickness + 22;
      const clearance = e.thickness / 2 + 22;
      e.points = [[x0,y0],[x0+clearance,y0],[x0+clearance,y],[x1-clearance,y],[x1-clearance,y1],[x1,y1]];
      e.path = options.theme === "angular" ? `M ${e.points.map(p => p.join(" ")).join(" L ")}` : bendFeedback(e.points, Math.max(24,e.thickness/2+12));
      e.labelX = (x0+x1)/2; e.labelY = y;
    } else {
      const sweep = sweepChannel(x0,y0,x1,y1,e.thickness,options.theme,maxVolume*valueScale);
      e.points = sweep.points;
      e.path = sweep.path;
      e.labelX = (x0+x1)/2; e.labelY = (y0+y1)/2;
    }
  });
  const maxX = Math.max(options.padding, ...nodes.map(n => n.x+n.width), ...edges.flatMap(e => e.points.map(p => p[0]+e.thickness/2)));
  const minX = Math.min(0, ...edges.flatMap(e => e.points.map(p => p[0]-e.thickness/2-options.padding)));
  const minY = Math.min(0, ...edges.flatMap(e => e.points.map(p => p[1]-e.thickness/2-options.padding)));
  const maxY = Math.max(top+contentHeight,...nodes.map(n => n.y+n.height),...edges.flatMap(e => e.points.map(p => p[1]+e.thickness/2)));
  return { nodes, edges, width: maxX + options.padding - minX, height: maxY + options.padding - minY,
    viewX: minX, viewY: minY, options, valueScale, groups: [] };
}
