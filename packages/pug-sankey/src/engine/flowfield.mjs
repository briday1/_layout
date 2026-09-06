// Confluence renderer. SVG geometry and interaction are shared by the editor
// and exported artwork; no external plotting library is required.
import { layoutFlowField } from "./flow-layout.mjs";
import { sharedTrunk } from "./flow-geometry.mjs";
import { traceFlowRoute } from "./flow-fabric.mjs";

const NS = "http://www.w3.org/2000/svg";
const PALETTE = ["#70c9b1", "#c1aaed", "#e9b779", "#85b7e5", "#dc93ad", "#cad88e"];
let instance = 0;
const format = value => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
const flag = (value, fallback) => value == null ? fallback : value !== false && value !== "hide";

function make(tag, attrs = {}, text) {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value != null) element.setAttribute(key, String(value));
  }
  if (text != null) element.textContent = text;
  return element;
}

function palette(container, figure) {
  const css = getComputedStyle(container);
  const read = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const background = figure.background || read("--diagram-background", "#12171b");
  const hex = background.match(/^#([a-f0-9]{6}|[a-f0-9]{3})$/i);
  const channels = hex ? (hex[1].length === 3 ? [...hex[1]].map(c => c+c).join("") : hex[1]).match(/../g).map(c => parseInt(c,16)) : [18,23,27];
  const light = channels[0]*.299 + channels[1]*.587 + channels[2]*.114 > 160;
  return {
    background, light, text: figure.text || (light ? "#25313c" : "#e5eae8"),
    muted: figure.annotation || (light ? "#5b6b73" : "#95a6ac"),
    panel: light ? "#f3f5f4" : "#192126", border: light ? "#bcc8c8" : "#39464c",
    font: figure.font || read("--diagram-font", "Arial, sans-serif"),
  };
}

function addText(parent, attrs, text) {
  const element = make("text", attrs, text);
  parent.append(element);
  return element;
}

function wrapLabel(value, limit = 23) {
  const lines = [];
  let line = "";
  for (const word of String(value).split(/\s+/)) {
    if (line && line.length + word.length + 1 > limit) { lines.push(line); line = ""; }
    line += (line ? " " : "") + word;
  }
  if (line) lines.push(line);
  return lines;
}

export function renderFlowField(container, graph, options = {}) {
  const colors = palette(container, graph.figure || {});
  const labelSize = graph.figure?.labelFontSize || 11;
  const valueSize = graph.figure?.valueFontSize || 9;
  const labelColor = graph.figure?.labelColor || colors.text;
  const nodeValueColor = graph.figure?.nodeValueColor || colors.muted;
  const flowValueColor = graph.figure?.flowValueColor || colors.text;
  const trunkWidth = options.layout?.nodeWidth || Math.max(116, labelSize*8);
  const lineHeight = labelSize + 6;
  const sourceNodes = graph.nodes.map(n => ({ ...n, labelLines: wrapLabel(n.label || n.id, Math.max(8,Math.floor(trunkWidth/(labelSize*.56)))) }));
  const maxLabelLines = Math.max(1, ...sourceNodes.map(n => n.labelLines.length));
  const layout = layoutFlowField(sourceNodes, graph.edges, {
    theme: graph.figure?.theme ?? "smooth",
    nodeWidth: trunkWidth, padding: Math.max(62,maxLabelLines*lineHeight+24),
    nodeGutter: Math.max(84, maxLabelLines * lineHeight + 36), ...options.layout,
  });
  const idPrefix = "exchange-" + (++instance);
  const svg = make("svg", {
    xmlns: NS, viewBox: [layout.viewX, layout.viewY, layout.width, layout.height].join(" "),
    "data-diagram-theme": layout.options.theme,
    width: layout.width, height: layout.height, role: "img",
    "aria-label": options.accessibleLabel || "Continuous flows split, merge, and branch into terminal arrows; width represents quantity",
    class: "pugflow-svg exchange-map" + (layout.nodes.length ? "" : " empty-diagram"),
  });
  const style = make("style");
  style.textContent = [
    ".exchange-map text{font-family:" + colors.font + ";fill:" + colors.text + "}",
    ".exchange-map .channel{fill:none;stroke-linecap:butt;stroke-linejoin:bevel}",
    ".exchange-map .channel-hit{fill:none;stroke:transparent;pointer-events:stroke}",
    ".exchange-map .junction-name{font-size:"+labelSize+"px;font-weight:500;letter-spacing:.05px;fill:"+labelColor+"}",
    ".exchange-map .quantity{font-size:"+valueSize+"px;font-weight:400;fill:" + nodeValueColor + ";font-variant-numeric:tabular-nums}",
    ".exchange-map .micro{font-size:8px;letter-spacing:1px;fill:" + colors.muted + "}",
    ".exchange-map .edge-label{font-size:"+valueSize+"px;font-weight:400;font-variant-numeric:tabular-nums;opacity:.85;fill:"+labelColor+"}",
    ".exchange-map .branch-value{fill:"+flowValueColor+"}",
    ".exchange-map .detail-label{opacity:0}",
    ".exchange-map .detail-label.revealed{opacity:1}",
    ".exchange-map .annotation{font-size:9px;fill:" + colors.muted + "}",
    ".exchange-map .connector,.exchange-map .entry{transition:opacity .12s}",
    ".exchange-map .dimmed{opacity:.07}",
    ".exchange-map.interactive [data-selection-key]{cursor:pointer;outline:none}",
    ".exchange-map.interactive [data-selection-key]:focus-visible .flow-trunk{stroke:" + colors.text + ";stroke-width:1}",
    ".exchange-map .selected-element .flow-trunk{stroke:" + colors.text + ";stroke-width:1}",
    "@media(prefers-reduced-motion:reduce){.exchange-map *{transition:none!important}}",
  ].join("\n");
  svg.append(style, make("rect", { x: layout.viewX, y: layout.viewY, width: layout.width, height: layout.height, fill: colors.background }));
  const defs = make("defs"); svg.append(defs);
  const byId = new Map(layout.nodes.map((node, index) => {
    node.color = node.color || PALETTE[index % PALETTE.length];
    return [node.id, node];
  }));
  const channels = make("g", { class: "channels" }); svg.append(channels);
  const labelLayer = make("g");
  const elements = [];
  for (const [index, edge] of layout.edges.entries()) {
    const from = byId.get(edge.from), to = byId.get(edge.to);
    const gradientId = idPrefix + "-channel-" + index;
    const gradient = make("linearGradient", {
      id: gradientId, gradientUnits: "userSpaceOnUse",
      x1: edge.sourceX, y1: edge.sourceY, x2: edge.targetX, y2: edge.targetY,
    });
    // Blend controls where the target color begins, and zero keeps source color.
    const blend = Math.max(0, Math.min(100, graph.figure?.blend ?? 60));
    gradient.append(
      make("stop", { offset: "0%", "stop-color": edge.color || from.color }),
      make("stop", { offset: (100-blend) + "%", "stop-color": edge.color || from.color }),
      make("stop", { offset: "100%", "stop-color": edge.color || (blend ? to.color : from.color) }),
    );
    defs.append(gradient);
    const group = make("g", { class: "connector", "data-selection-key": edge.key,
      "data-line": edge.lineNumber, "data-select-kind": "line", "data-from": edge.from,
      "data-to": edge.to, tabindex: "0", role: "button",
      "aria-label": from.label + " to " + to.label + ": " + format(edge.value),
    });
    group.append(make("title", {}, from.label + " → " + to.label + "\n" + format(edge.value) + " · " + format(edge.value / from.outgoing * 100) + "% of outgoing flow"));
    // Width is exact; a separate transparent path makes tiny values selectable.
    group.append(make("path", { d: edge.path, class: "channel", stroke: colors.background, "stroke-width": edge.thickness+3, "pointer-events": "none" }));
    group.append(make("path", { d: edge.path, class: "channel solid-flow", stroke: "url(#" + gradientId + ")", "stroke-width": edge.thickness, opacity: ".76" }));
    group.append(make("path", { d: edge.path, class: "channel-hit", "stroke-width": Math.max(12,edge.thickness) }));
    channels.append(group);
    const parts = [];
    if (flag(graph.figure?.flowLabels, false) && edge.label) parts.push(edge.label);
    if (flag(graph.figure?.flowValues, true)) parts.push(format(edge.value));
    const label = make("g", { "data-edge-label": edge.key, "pointer-events": "none", class: edge.thickness < valueSize+3 ? "detail-label" : "flow-label" });
    if (parts.length) {
      const text = addText(label, {
      x: edge.feedback ? edge.labelX : edge.sourceX+16,
      y: edge.feedback ? edge.labelY-5 : edge.sourceY+3,
      class: "edge-label", "text-anchor": edge.feedback ? "middle" : "start",
      }, "");
      if (flag(graph.figure?.flowLabels, false) && edge.label) text.append(make("tspan", {}, edge.label));
      if (flag(graph.figure?.flowValues, true)) text.append(make("tspan", {
        class: "branch-value", dx: text.textContent ? 6 : 0,
      }, format(edge.value)));
    }
    labelLayer.append(label);
    elements.push({ element: group, label, edge });
  }

  const junctions = make("g", { class: "junctions" }); svg.append(junctions);
  for (const node of layout.nodes) {
    const group = make("g", { class: "entry", "data-id": node.id, "data-line": node.lineNumber,
      "data-selection-key": node.id, "data-select-kind": "node", tabindex: "0", role: "button",
      "aria-label": (node.label || node.id) + ": " + format(node.incoming) + " incoming, " + format(node.outgoing) + " outgoing",
    });
    group.append(make("title", {}, (node.label || node.id) + "\nIn " + format(node.incoming) + " / Out " + format(node.outgoing)));
    const centerY = node.y + layout.options.headerHeight + node.channelHeight / 2;
    const inlet = (node.incoming || node.outgoing || node.value) * layout.valueScale;
    const outlet = (node.outgoing || node.incoming || node.value) * layout.valueScale;
    const left = node.x, right = node.x + node.width;
    const sink = node.incoming > 0 && node.outgoing === 0;
    // Arrow-shaped destinations are part of the flow silhouette. There are
    // no decorative direction marks inside the channels.
    // At an exchange the full trunk spans the incoming/outgoing banks so every
    // branch joins without a gap or a visible vertical boundary.
    const trunk = sharedTrunk(left,right,centerY,inlet,outlet,sink);
    group.append(make("path", { d: trunk, fill: colors.background, "pointer-events": "none" }));
    group.append(make("path", { d: trunk, fill: node.color, opacity: ".76", class: "flow-trunk" }));
    const labelY = node.y - 12 - (node.labelLines.length-1)*lineHeight;
    let name;
    if (flag(graph.figure?.nodeLabels,true)) {
      node.labelLines.forEach((line,index) => {
        name = addText(group, { x: node.x, y: labelY+index*lineHeight, class: "junction-name" }, line);
      });
    }
    if (flag(graph.figure?.nodeValues,true)) {
      if (name) name.append(make("tspan", { dx: 8, class: "quantity" }, format(node.value)));
      else addText(group, { x: node.x, y: labelY, class: "quantity" }, format(node.value));
    }
    // Keep authored annotations, including multiline text and positional offsets.
    let above = 0, below = 0;
    for (const annotation of node.annotations || []) {
      if (annotation.hidden || !annotation.text) continue;
      const isBelow = annotation.position === "below";
      const lines = String(annotation.text).split("\n");
      const lineHeight = Number(annotation.fontSize) || 9;
      const startY = isBelow ? node.y+node.height+16+below : labelY-18-above-(lines.length-1)*(lineHeight+3);
      lines.forEach((line,index) => addText(group, {
        x: node.x+(annotation.offsetX || 0), y: startY+index*(lineHeight+3)+(annotation.offsetY || 0),
        class: "annotation", style: "fill:"+(annotation.color || colors.muted)+";font-size:"+lineHeight+"px;font-family:"+(annotation.fontFamily || colors.font)+";font-weight:"+(annotation.fontWeight || 400)+";font-style:"+(annotation.fontStyle || "normal"),
      }, line));
      if (isBelow) below += lines.length*(lineHeight+3); else above += lines.length*(lineHeight+3);
    }
    junctions.append(group);
    elements.push({ element: group, node });
  }
  svg.append(labelLayer);
  let pinned = null;
  const resetFocus = () => elements.forEach(({ element,label }) => { element.classList.remove("dimmed", "route-active"); label?.classList.remove("dimmed", "revealed"); });
  const focus = item => {
    const route = traceFlowRoute(layout.edges,item);
    elements.forEach(({ element,label,node,edge }) => {
      const related = node ? route.nodeIds.has(node.id) : route.edgeKeys.has(edge.key);
      element.classList.toggle("dimmed", !related); label?.classList.toggle("dimmed", !related);
      element.classList.toggle("route-active",related);
      label?.classList.toggle("revealed", Boolean(item.edge && item.edge.key === edge?.key));
    });
  };
  if (options.onNodeClick || options.onElementClick) {
    svg.classList.add("interactive");
    elements.forEach(item => {
      item.element.addEventListener("pointerenter", () => focus(item));
      item.element.addEventListener("pointerleave", () => pinned ? focus(pinned) : resetFocus());
      item.element.addEventListener("focus", () => focus(item));
      item.element.addEventListener("blur", () => pinned ? focus(pinned) : resetFocus());
      const activate = event => {
        if (event.type === "keydown" && !["Enter"," "].includes(event.key)) return;
        if (event.type === "keydown") event.preventDefault();
        pinned = pinned === item ? null : item;
        if (pinned) focus(pinned); else resetFocus();
        const { node,edge } = item;
        const selection = { kind: node ? "node" : "line", id: node?.id, from: edge?.from, to: edge?.to,
          lineNumber: (node || edge).lineNumber, selectionKey: node?.id || edge.key,
          additive: Boolean(event.shiftKey || event.ctrlKey || event.metaKey) };
        options.onElementClick?.(selection);
        if (!selection.additive) options.onNodeClick?.(selection);
      };
      item.element.addEventListener("click", activate);
      item.element.addEventListener("keydown", activate);
    });
    svg.addEventListener("keydown",event => { if(event.key === "Escape") { pinned=null; resetFocus(); } });
    svg.addEventListener("click",event => { if(!event.target.closest("[data-selection-key]")) { pinned=null; resetFocus(); } });
  }
  Object.defineProperty(svg, "__diagramLayout", { value: layout });
  return svg;
}
