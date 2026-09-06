import { parseDiagram } from "./parser.mjs";
import { DEFAULT_LAYOUT, inheritedFlowOffsets, layoutDiagram } from "./layout.mjs";
import { containsMath, layoutRichText, mathSvg } from "./math-render.mjs";

const SVG_NS = "http://www.w3.org/2000/svg";

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    if (value !== null && value !== undefined && value !== "") element.setAttribute(key, String(value));
  }
  return element;
}

export function constrainDragDelta(dx, dy, constrained) {
  if (!constrained) return { dx, dy };
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

export function constrainResizeDelta(dx, dy, resizeX, resizeY) {
  return { dx: resizeX ? dx : 0, dy: resizeY ? dy : 0 };
}

function fallbackMeasureContext() {
  return {
    font: "",
    measureText(text) {
      const size = /([\d.]+)px/.exec(this.font);
      const px = size ? Number(size[1]) : 16;
      return { width: String(text).length * px * 0.6 };
    },
  };
}
function measureContext2d() {
  const canvas = document.createElement("canvas");
  return canvas.getContext("2d") || fallbackMeasureContext();
}
function cssVariables(element) {
  const styles = getComputedStyle(element);
  const read = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
  return {
    background: read("--diagram-background", "#ffffff"),
    label: read("--diagram-label", "#111111"),
    text: read("--diagram-text", "#111111"),
    merge: read("--diagram-merge", "#111111"),
    annotation: read("--diagram-annotation", "#000000"),
    font: read("--diagram-font", "Verdana, sans-serif"),
  };
}

function figureColors(container, figure = {}) {
  const colors = cssVariables(container);
  for (const key of Object.keys(colors)) {
    if (figure[key] !== null && figure[key] !== undefined && figure[key] !== "") colors[key] = figure[key];
  }
  return colors;
}

function wrapText(text, maxWidth, measure) {
  const output = [];
  for (const explicitLine of text.split("\n")) {
    const words = explicitLine.split(/\s+/).filter(Boolean);
    if (!words.length) { output.push(""); continue; }
    let line = words.shift();
    for (const word of words) {
      if (measure(`${line} ${word}`) <= maxWidth) line += ` ${word}`;
      else { output.push(line); line = word; }
    }
    output.push(line);
  }
  return output;
}

function richTextLayout(text, style, colors, maxWidth = Infinity) {
  const context = measureContext2d();
  const fontSize = style.fontSize ?? 12;
  context.font = `${style.fontStyle ?? "normal"} ${style.fontWeight ?? "normal"} ${fontSize}px ${style.fontFamily ?? colors.font}`;
  return layoutRichText(text, { fontSize, maxWidth, measureText: (value) => context.measureText(value).width });
}

function measuredAnnotation(annotation, colors) {
  if (!containsMath(annotation.text)) return { ...annotation, rich: false, renderHeight: 16 };
  const richLayout = richTextLayout(annotation.text, annotation, colors);
  return { ...annotation, rich: true, richLayout, renderHeight: Math.max(16, richLayout.height) };
}

function measureNodes(nodes, colors) {
  const context = measureContext2d();
  context.font = `16px ${colors.font}`;
  const measure = (text) => context.measureText(text).width;

  return nodes.map((node) => {
    context.font = `${node.style.fontStyle} ${node.style.fontWeight} ${node.style.fontSize}px ${node.style.fontFamily ?? colors.font}`;
    const label = node.label;
    if (node.kind === "image") {
      const width = node.style.width + node.style.padding * 2;
      const height = node.style.height + node.style.padding * 2;
      const above = node.annotations.filter((annotation) => annotation.position === "above").map((annotation) => measuredAnnotation(annotation, colors));
      const below = node.annotations.filter((annotation) => annotation.position === "below").map((annotation) => measuredAnnotation(annotation, colors));
      return {
        ...node, width, height, lines: [], lineHeight: 0, rich: false, textHeight: 0, above, below,
        aboveHeight: above.length ? above.reduce((sum, annotation) => sum + annotation.renderHeight, 7) : 0,
        belowHeight: below.length ? below.reduce((sum, annotation) => sum + annotation.renderHeight, 7) : 0,
        layoutHeight: height,
      };
    }
    const requestedWidth = node.style.width;
    const initialLines = label.split("\n");
    const rich = containsMath(label);
    const unconstrainedRich = rich ? layoutRichText(label, { fontSize: node.style.fontSize, measureText: measure }) : null;
    const naturalWidth = Math.max(rich ? unconstrainedRich.width + 32 : Math.max(...initialLines.map(measure), 70) + 32, 0);
    let width = requestedWidth === "auto" ? Math.min(420, Math.max(110, naturalWidth)) : requestedWidth;
    const richLayout = rich ? layoutRichText(label, { fontSize: node.style.fontSize, maxWidth: Math.max(36, width - 30), measureText: measure }) : null;
    if (rich && richLayout.width > width - 30) width = richLayout.width + 30;
    const lines = rich ? richLayout.lines : wrapText(label, Math.max(36, width - 30), measure);
    const lineHeight = Math.ceil(node.style.fontSize * 1.2);
    const textHeight = rich ? richLayout.height : lines.length * lineHeight;
    const naturalHeight = Math.max(42, textHeight + 20);
    const height = node.style.height === "auto" ? naturalHeight : node.style.height;
    const above = node.annotations.filter((annotation) => annotation.position === "above").map((annotation) => measuredAnnotation(annotation, colors));
    const below = node.annotations.filter((annotation) => annotation.position === "below").map((annotation) => measuredAnnotation(annotation, colors));
    const aboveHeight = above.length ? above.reduce((sum, annotation) => sum + annotation.renderHeight, 7) : 0;
    const belowHeight = below.length ? below.reduce((sum, annotation) => sum + annotation.renderHeight, 7) : 0;
    return { ...node, width, height, lines, lineHeight, rich, textHeight, above, below, aboveHeight, belowHeight, layoutHeight: height };
  });
}

function boxTop(node) { return node.y; }
function centerY(node) { return boxTop(node) + node.height / 2; }
function annotationTop(node, annotation, index) {
  if (annotation.position === "above") {
    const followingHeight = node.above.slice(index).reduce((sum, item) => sum + item.renderHeight, 0);
    return boxTop(node) - 7 - followingHeight + annotation.offsetY;
  }
  const precedingHeight = node.below.slice(0, index).reduce((sum, item) => sum + item.renderHeight, 0);
  return boxTop(node) + node.height + 7 + precedingHeight + annotation.offsetY;
}
function edgeColor(edge, colors) { return edge.color === "merge" ? colors.merge : edge.color ?? colors.label; }
function dashArray(style) { return style === "dashed" ? "8 6" : style === "dotted" ? "2 5" : null; }
function textBorder(style, fallback = "transparent") {
  return {
    "paint-order": "stroke",
    stroke: style.textOutline ?? fallback,
    "stroke-width": style.textOutlineWidth ?? 0,
    "stroke-linejoin": "round",
  };
}

/** Build (or reuse) a drop-shadow filter for any styled element. */
function shadowFilter(defs, style, key) {
  if (!style?.shadowColor) return null;
  const id = `shadow-${String(key).replace(/[^\w-]/g, "-")}`;
  defs.__shadowIds ??= new Set();
  if (!defs.__shadowIds.has(id)) {
    defs.__shadowIds.add(id);
    const filter = svgElement("filter", { id, x: "-50%", y: "-50%", width: "200%", height: "200%" });
    filter.append(svgElement("feDropShadow", {
      dx: style.shadowOffsetX, dy: style.shadowOffsetY, stdDeviation: style.shadowBlur,
      "flood-color": style.shadowColor, "flood-opacity": Math.min(1, style.shadowOpacity),
    }));
    defs.append(filter);
  }
  return `url(#${id})`;
}

function ensureShadow(defs, node) {
  return shadowFilter(defs, node.style, `node-${node.id}`);
}

function shapeElement(node, colors, defs) {
  const top = boxTop(node);
  const outline = node.style.outline ?? (node.kind === "merge" ? colors.merge : colors.label);
  const common = {
    class: "label-box",
    fill: node.style.fill,
    stroke: outline,
    "stroke-width": node.style.outlineWidth,
    "stroke-dasharray": dashArray(node.style.outlineStyle),
    filter: ensureShadow(defs, node),
    "data-line": node.lineNumber,
    "data-id": node.id,
    "data-drag-kind": "node",
    "data-current-x": node.offsetX ?? 0,
    "data-current-y": node.offsetY ?? 0,
    role: "link",
    tabindex: 0,
    "aria-label": `Move or edit ${node.kind === "image" ? "image" : "block"} ${node.label.replace(/\n/g, " ") || node.id}`,
  };
  if (node.style.shape === "cylinder") {
    const capRy = Math.min(Math.round(node.height * 0.18), 20);
    const cx = node.x + node.width / 2;
    const rx = node.width / 2;
    const outlineColor = node.style.outline ?? colors.label;
    const sw = node.style.outlineWidth;
    const da = dashArray(node.style.outlineStyle);
    const g = svgElement("g", common);
    const bodyPath = `M ${node.x},${top + capRy} L ${node.x},${top + node.height - capRy} A ${rx},${capRy} 0 0 1 ${node.x + node.width},${top + node.height - capRy} L ${node.x + node.width},${top + capRy} A ${rx},${capRy} 0 0 0 ${node.x},${top + capRy} z`;
    g.append(svgElement("path", { d: bodyPath, fill: node.style.fill, stroke: "none" }));
    g.append(svgElement("ellipse", { cx, cy: top + node.height - capRy, rx, ry: capRy, fill: node.style.fill, stroke: outlineColor, "stroke-width": sw, "stroke-dasharray": da }));
    g.append(svgElement("ellipse", { cx, cy: top + capRy, rx, ry: capRy, fill: node.style.fill, stroke: outlineColor, "stroke-width": sw, "stroke-dasharray": da }));
    g.append(svgElement("path", { d: bodyPath, fill: "none", stroke: outlineColor, "stroke-width": sw, "stroke-dasharray": da, "stroke-linejoin": "round" }));
    return g;
  }
  if (node.style.shape === "diamond") {
    return svgElement("polygon", { ...common, points: `${node.x + node.width / 2},${top} ${node.x + node.width},${top + node.height / 2} ${node.x + node.width / 2},${top + node.height} ${node.x},${top + node.height / 2}` });
  }
  if (node.style.shape === "hexagon") {
    const inset = Math.min(24, node.width * 0.15);
    return svgElement("polygon", { ...common, points: `${node.x + inset},${top} ${node.x + node.width - inset},${top} ${node.x + node.width},${top + node.height / 2} ${node.x + node.width - inset},${top + node.height} ${node.x + inset},${top + node.height} ${node.x},${top + node.height / 2}` });
  }
  const radius = node.style.shape === "square" ? 0 : node.style.shape === "pill" ? node.height / 2 : node.style.shape === "rounded" ? 12 : 5;
  return svgElement("rect", { ...common, x: node.x, y: top, width: node.width, height: node.height, rx: radius });
}

function addRichLabel(group, node, colors, x, top, anchor, textColor) {
  const label = svgElement("g", {
    class: "label rich-label",
    "data-line": node.lineNumber, "data-id": node.id, "data-drag-kind": "node-label",
    "data-select-kind": "node", "data-selection-key": `node:${node.id}`,
    "data-current-x": node.labelOffsetX, "data-current-y": node.labelOffsetY,
    role: "link", tabindex: 0, "aria-label": "Move or edit label " + node.label.replace(/\n/g, " "),
  });
  const verticalTop = node.style.verticalAlign === "top" ? top + 12
    : node.style.verticalAlign === "bottom" ? top + node.height - node.textHeight - 12
      : top + (node.height - node.textHeight) / 2;
  let rowTop = verticalTop + node.labelOffsetY;
  node.lines.forEach((line) => {
    let cursor = anchor === "start" ? x : anchor === "end" ? x - line.width : x - line.width / 2;
    line.runs.forEach((run) => {
      if (run.kind === "math") label.append(mathSvg(run, { x: cursor, y: rowTop + (line.height - run.height) / 2, color: textColor }));
      else {
        const text = svgElement("text", {
          x: cursor, y: rowTop + line.height / 2, fill: textColor,
          "font-family": node.style.fontFamily ?? colors.font, "font-size": node.style.fontSize,
          "font-weight": node.style.fontWeight, "font-style": node.style.fontStyle,
          "text-decoration": node.style.textDecoration, "dominant-baseline": "middle",
          ...textBorder(node.style),
        });
        text.textContent = run.text;
        label.append(text);
      }
      cursor += run.width;
    });
    rowTop += line.height;
  });
  group.append(label);
}

function addBlockAnnotation(group, node, annotation, index, colors) {
  const x = node.x + node.width / 2 + annotation.offsetX;
  const top = annotationTop(node, annotation, index);
  const attributes = {
    class: "block-annotation", "data-line": annotation.lineNumber, "data-id": node.id,
    "data-select-kind": "node", "data-selection-key": `node:${node.id}`,
    "data-drag-kind": "block-annotation", "data-current-x": annotation.offsetX,
    "data-current-y": annotation.offsetY, role: "link", tabindex: 0,
    "aria-label": "Move or edit annotation " + annotation.text,
  };
  if (!annotation.rich) {
    const text = svgElement("text", {
      ...attributes, x, y: top + 12, fill: annotation.color ?? colors.annotation,
      "font-family": annotation.fontFamily ?? colors.font, "font-size": annotation.fontSize,
      "font-weight": annotation.fontWeight, "font-style": annotation.fontStyle,
      "text-decoration": annotation.textDecoration,
      ...textBorder(annotation),
    });
    text.textContent = annotation.text;
    group.append(text);
    return;
  }
  const wrapper = svgElement("g", attributes);
  let rowTop = top;
  annotation.richLayout.lines.forEach((line) => {
    let cursor = x - line.width / 2;
    line.runs.forEach((run) => {
      if (run.kind === "math") wrapper.append(mathSvg(run, { x: cursor, y: rowTop + (line.height - run.height) / 2, color: annotation.color ?? colors.annotation }));
      else {
        const text = svgElement("text", {
          x: cursor, y: rowTop + line.height / 2, fill: annotation.color ?? colors.annotation,
          "font-family": annotation.fontFamily ?? colors.font, "font-size": annotation.fontSize,
          "font-weight": annotation.fontWeight, "font-style": annotation.fontStyle,
          "text-decoration": annotation.textDecoration, "dominant-baseline": "middle",
          ...textBorder(annotation),
        });
        text.textContent = run.text;
        wrapper.append(text);
      }
      cursor += run.width;
    });
    rowTop += line.height;
  });
  group.append(wrapper);
}

function resizeHandles({ className, x, y, width, height, lineNumber, id, kind, currentX = 0, currentY = 0 }) {
  const handles = svgElement("g", { class: `resize-handles ${className}`, display: "none", "aria-hidden": "true" });
  handles.append(svgElement("rect", { class: "resize-frame", x, y, width, height }));
  for (const [resizeX, resizeY] of [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]]) {
    handles.append(svgElement("circle", {
      class: "resize-handle",
      cx: x + (resizeX + 1) * width / 2,
      cy: y + (resizeY + 1) * height / 2,
      r: 5,
      "data-line": lineNumber,
      "data-id": id,
      "data-drag-kind": kind,
      "data-resize-x": resizeX,
      "data-resize-y": resizeY,
      "data-current-x": currentX,
      "data-current-y": currentY,
      "data-current-width": width,
      "data-current-height": height,
    }));
  }
  return handles;
}

function addNode(svg, node, colors, defs) {
  const group = svgElement("g", {
    class: `entry ${node.kind === "merge" ? "merge-entry" : ""}`.trim(),
    "data-id": node.id,
    "data-selection-key": `node:${node.id}`,
    "data-line": node.lineNumber,
    role: "link",
    tabindex: 0,
    "aria-label": `Edit ${node.kind === "image" ? "image " + node.id : node.label.replace(/\n/g, " ")}`,
  });
  const top = boxTop(node);
  node.above.filter((annotation) => !annotation.hidden).forEach((annotation, index) => addBlockAnnotation(group, node, annotation, index, colors));
  const shape = shapeElement(node, colors, defs);
  if (node.kind === "image") {
    shape.removeAttribute("filter");
    const clipId = `image-clip-${node.id.replace(/[^\w-]/g, "-")}`;
    const clip = svgElement("clipPath", { id: clipId });
    const clipShape = shape.cloneNode(false);
    ["class", "filter", "stroke", "stroke-width", "stroke-dasharray", "data-line", "data-id", "data-drag-kind", "data-current-x", "data-current-y", "role", "tabindex", "aria-label"].forEach((name) => clipShape.removeAttribute(name));
    clip.append(clipShape);
    defs.append(clip);
    const preserveAspectRatio = node.style.fit === "fill" ? "none" : `xMidYMid ${node.style.fit === "cover" ? "slice" : "meet"}`;
    const imageX = node.x + node.style.padding;
    const imageY = top + node.style.padding;
    const imageShadow = svgElement("g", { filter: ensureShadow(defs, node) });
    imageShadow.append(svgElement("image", {
      href: node.style.source,
      x: imageX,
      y: imageY,
      width: node.style.width,
      height: node.style.height,
      opacity: Math.min(1, node.style.opacity),
      preserveAspectRatio,
      "clip-path": `url(#${clipId})`,
      "data-line": node.lineNumber,
      "data-id": node.id,
      "data-drag-kind": "node",
      "data-select-kind": "node",
      "data-selection-key": `node:${node.id}`,
      "data-current-x": node.offsetX,
      "data-current-y": node.offsetY,
      role: "link",
      tabindex: 0,
      "aria-label": `Move image ${node.id}`,
    }));
    group.append(imageShadow);
    group.append(resizeHandles({
      className: "image-resize-handles", x: imageX, y: imageY,
      width: node.style.width, height: node.style.height, lineNumber: node.lineNumber,
      id: node.id, kind: "image-resize", currentX: node.offsetX, currentY: node.offsetY,
    }));
  }
  group.append(shape);
  if (node.kind === "image") {
    node.below.filter((annotation) => !annotation.hidden).forEach((annotation, index) => addBlockAnnotation(group, node, annotation, index, colors));
    svg.append(group);
    return;
  }
  group.append(resizeHandles({
    className: "node-resize-handles", x: node.x, y: top, width: node.width, height: node.height,
    lineNumber: node.lineNumber, id: node.id, kind: "node-resize",
    currentX: node.offsetX, currentY: node.offsetY,
  }));
  const textColor = node.style.color ?? colors.text;
  const anchor = node.style.align === "left" ? "start" : node.style.align === "right" ? "end" : "middle";
  const baseX = node.style.align === "left" ? node.x + 16 : node.style.align === "right" ? node.x + node.width - 16 : node.x + node.width / 2;
  const x = baseX + node.labelOffsetX;
  if (node.rich) addRichLabel(group, node, colors, x, top, anchor, textColor);
  else {
  const text = svgElement("text", {
    class: "label",
    x,
    y: (node.style.verticalAlign === "top" ? top + 12 + node.lineHeight / 2
      : node.style.verticalAlign === "bottom" ? top + node.height - 12 - ((node.lines.length - 1) * node.lineHeight)
        : top + node.height / 2 - ((node.lines.length - 1) * node.lineHeight / 2)) + node.labelOffsetY,
    fill: textColor,
    "font-family": node.style.fontFamily ?? colors.font,
    "font-size": node.style.fontSize, "font-weight": node.style.fontWeight,
    "font-style": node.style.fontStyle, "text-decoration": node.style.textDecoration,
    ...textBorder(node.style),
    "text-anchor": anchor,
    "dominant-baseline": "middle",
    "data-line": node.lineNumber,
    "data-id": node.id,
    "data-drag-kind": "node-label",
    "data-select-kind": "node",
    "data-selection-key": `node:${node.id}`,
    "data-current-x": node.labelOffsetX,
    "data-current-y": node.labelOffsetY,
    role: "link",
    tabindex: 0,
    "aria-label": "Move or edit label " + node.label.replace(/\n/g, " "),
  });
  node.lines.forEach((line, index) => {
    const span = svgElement("tspan", { x, dy: index ? node.lineHeight : 0 });
    span.textContent = line;
    text.append(span);
  });
  group.append(text);
  }
  node.below.filter((annotation) => !annotation.hidden).forEach((annotation, index) => addBlockAnnotation(group, node, annotation, index, colors));
  svg.append(group);
}

function markerId(color, outline = "transparent", outlineWidth = 0, arrowShape = "triangle") {
  let hash = 0;
  for (const character of `${color}|${outline}|${outlineWidth}|${arrowShape}`) hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  return `arrow-${Math.abs(hash)}`;
}

let markerScope = 0;
function ensureMarker(defs, color, outline = "transparent", outlineWidth = 0, arrowShape = "triangle") {
  const scoped = defs.closest("svg") ?? defs;
  if (!scoped.__markerScope) scoped.__markerScope = `s${++markerScope}-`;
  const id = scoped.__markerScope + markerId(color, outline, outlineWidth, arrowShape);
  if (defs.querySelector(`#${id}`)) return id;
  let markerEl;
  if (arrowShape === "open") {
    markerEl = svgElement("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", markerUnits: "strokeWidth" });
    markerEl.append(svgElement("path", { d: "M 1 1 L 9 5 L 1 9", fill: "none", stroke: color, "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  } else if (arrowShape === "diamond") {
    markerEl = svgElement("marker", { id, viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: "auto-start-reverse", markerUnits: "strokeWidth" });
    markerEl.append(svgElement("path", { d: "M 0 5 L 5 0 L 10 5 L 5 10 z", fill: color, stroke: outline, "stroke-width": outlineWidth, "paint-order": "stroke" }));
  } else if (arrowShape === "circle") {
    markerEl = svgElement("marker", { id, viewBox: "0 0 10 10", refX: 10, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", markerUnits: "strokeWidth" });
    markerEl.append(svgElement("circle", { cx: 5, cy: 5, r: 4.5, fill: color, stroke: outline, "stroke-width": outlineWidth, "paint-order": "stroke" }));
  } else {
    markerEl = svgElement("marker", { id, viewBox: "0 0 10 10", refX: 8.5, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse", markerUnits: "strokeWidth" });
    markerEl.append(svgElement("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: color, stroke: outline, "stroke-width": outlineWidth, "paint-order": "stroke", "stroke-linejoin": "round" }));
  }
  defs.append(markerEl);
  return id;
}

function chunkyArrowPath(routeD, direction, arrowHeight, arrowHeadWidth) {
  const guide = svgElement("path", { d: routeD });
  const length = guide.getTotalLength();
  if (!length) return routeD;
  const shaftHalf = Math.max(0.5, arrowHeight / 2);
  const headHalf = shaftHalf * 1.8;
  const headLength = Math.min(Math.max(1, arrowHeadWidth), length * 0.4);
  const backward = ["backward", "both"].includes(direction);
  const forward = ["forward", "both"].includes(direction);
  const bodyStart = backward ? headLength : 0;
  const bodyEnd = forward ? length - headLength : length;
  const point = (distance) => guide.getPointAtLength(Math.max(0, Math.min(length, distance)));
  const offset = (distance, amount) => {
    const current = point(distance);
    const before = point(distance - 0.5);
    const after = point(distance + 0.5);
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    const magnitude = Math.hypot(dx, dy) || 1;
    return { x: current.x - dy / magnitude * amount, y: current.y + dx / magnitude * amount };
  };
  const distances = [bodyStart];
  const steps = Math.max(1, Math.ceil((bodyEnd - bodyStart) / 5));
  for (let index = 1; index < steps; index += 1) distances.push(bodyStart + (bodyEnd - bodyStart) * index / steps);
  distances.push(bodyEnd);
  const left = distances.map((distance) => offset(distance, shaftHalf));
  const right = [...distances].reverse().map((distance) => offset(distance, -shaftHalf));
  const commands = [`M ${left[0].x} ${left[0].y}`, ...left.slice(1).map((item) => `L ${item.x} ${item.y}`)];
  if (forward) {
    const upperBase = offset(bodyEnd, headHalf);
    const tip = point(length);
    const lowerBase = offset(bodyEnd, -headHalf);
    commands.push(`L ${upperBase.x} ${upperBase.y}`, `L ${tip.x} ${tip.y}`, `L ${lowerBase.x} ${lowerBase.y}`);
  }
  commands.push(...right.map((item) => `L ${item.x} ${item.y}`));
  if (backward) {
    const lowerBase = offset(bodyStart, -headHalf);
    const tip = point(0);
    const upperBase = offset(bodyStart, headHalf);
    commands.push(`L ${lowerBase.x} ${lowerBase.y}`, `L ${tip.x} ${tip.y}`, `L ${upperBase.x} ${upperBase.y}`);
  }
  commands.push("Z");
  return commands.join(" ");
}

/** Route a connection with straight segments and small rounded 90-degree bends. */
export function connectionPath(source, target, kind = "branch", direction = "right", targetPortOffset = 0, sourcePortOffset = 0, targetDirection = direction, roundness = 9) {
  const vertical = direction === "up" || direction === "down";
  const sx = vertical ? source.x + source.width / 2 + sourcePortOffset : direction === "left" ? source.x : source.x + source.width;
  const sy = vertical ? direction === "up" ? boxTop(source) : boxTop(source) + source.height : centerY(source) + sourcePortOffset;
  const targetVertical = targetDirection === "up" || targetDirection === "down";
  const tx = targetVertical ? target.x + target.width / 2 + targetPortOffset : targetDirection === "left" ? target.x + target.width : target.x;
  const ty = targetVertical ? targetDirection === "up" ? boxTop(target) + target.height : boxTop(target) : centerY(target) + targetPortOffset;
  if (targetDirection !== direction) {
    const sourceVector = direction === "right" ? { x: 1, y: 0 } : direction === "left" ? { x: -1, y: 0 } : direction === "down" ? { x: 0, y: 1 } : { x: 0, y: -1 };
    const targetVector = targetDirection === "right" ? { x: 1, y: 0 } : targetDirection === "left" ? { x: -1, y: 0 } : targetDirection === "down" ? { x: 0, y: 1 } : { x: 0, y: -1 };
    const startLead = { x: sx + sourceVector.x * 24, y: sy + sourceVector.y * 24 };
    const endLead = { x: tx - targetVector.x * 24, y: ty - targetVector.y * 24 };
    let middle;
    if (sourceVector.x && targetVector.y) middle = [{ x: startLead.x, y: endLead.y }];
    else if (sourceVector.y && targetVector.x) middle = [{ x: endLead.x, y: startLead.y }];
    else if (sourceVector.x) {
      const middleY = (startLead.y + endLead.y) / 2;
      middle = [{ x: startLead.x, y: middleY }, { x: endLead.x, y: middleY }];
    } else {
      const middleX = (startLead.x + endLead.x) / 2;
      middle = [{ x: middleX, y: startLead.y }, { x: middleX, y: endLead.y }];
    }
    return roundedRoute([{ x: sx, y: sy }, startLead, ...middle, endLead, { x: tx, y: ty }], roundness);
  }
  if (vertical) {
    if (Math.abs(sx - tx) < 1) return { d: `M ${sx} ${sy} V ${ty}`, labelX: sx, labelY: (sy + ty) / 2 };
    const middle = sy + (ty - sy) * (kind === "merge" ? 0.58 : 0.5);
    const ySign = Math.sign(ty - sy) || 1;
    const xSign = Math.sign(tx - sx) || 1;
    const radius = Math.min(roundness, Math.abs(tx - sx) / 2, Math.abs(middle - sy) / 2, Math.abs(ty - middle) / 2);
    return {
      d: radius ? `M ${sx} ${sy} V ${middle - ySign * radius} Q ${sx} ${middle} ${sx + xSign * radius} ${middle} H ${tx - xSign * radius} Q ${tx} ${middle} ${tx} ${middle + ySign * radius} V ${ty}` : `M ${sx} ${sy} V ${middle} H ${tx} V ${ty}`,
      labelX: tx,
      labelY: kind === "merge" ? (sy + middle) / 2 : (middle + ty) / 2,
    };
  }
  if (Math.abs(sy - ty) < 1) return { d: `M ${sx} ${sy} H ${tx}`, labelX: (sx + tx) / 2, labelY: sy };
  const middle = sx + (tx - sx) * (kind === "merge" ? 0.58 : 0.5);
  const xSign = Math.sign(tx - sx) || 1;
  const ySign = Math.sign(ty - sy) || 1;
  const radius = Math.min(roundness, Math.abs(ty - sy) / 2, Math.abs(middle - sx) / 2, Math.abs(tx - middle) / 2);
  return {
    d: radius ? `M ${sx} ${sy} H ${middle - xSign * radius} Q ${middle} ${sy} ${middle} ${sy + ySign * radius} V ${ty - ySign * radius} Q ${middle} ${ty} ${middle + xSign * radius} ${ty} H ${tx}` : `M ${sx} ${sy} H ${middle} V ${ty} H ${tx}`,
    labelX: kind === "merge" ? (sx + middle) / 2 : (middle + tx) / 2,
    labelY: kind === "merge" ? sy : ty,
  };
}

function segmentClear(a, b, obstacles) {
  return obstacles.every((box) => {
    if (a.y === b.y) {
      const left = Math.min(a.x, b.x);
      const right = Math.max(a.x, b.x);
      return !(a.y > box.top && a.y < box.bottom && right > box.left && left < box.right);
    }
    const top = Math.min(a.y, b.y);
    const bottom = Math.max(a.y, b.y);
    return !(a.x > box.left && a.x < box.right && bottom > box.top && top < box.bottom);
  });
}

function roundedRoute(points, roundness = 9) {
  const unique = points.filter((point, index) => !index || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
  const compact = unique.filter((point, index) => {
    if (!index || index === unique.length - 1) return true;
    const previous = unique[index - 1];
    const next = unique[index + 1];
    return !((previous.x === point.x && point.x === next.x) || (previous.y === point.y && point.y === next.y));
  });
  if (roundness <= 0) {
    const d = compact.slice(1).reduce((path, point) => `${path} L ${point.x} ${point.y}`, `M ${compact[0].x} ${compact[0].y}`);
    const segments = compact.slice(1).map((point, index) => ({ a: compact[index], b: point, length: Math.abs(point.x - compact[index].x) + Math.abs(point.y - compact[index].y) }));
    const labelSegment = segments.sort((a, b) => b.length - a.length)[0];
    return { d, labelX: (labelSegment.a.x + labelSegment.b.x) / 2, labelY: (labelSegment.a.y + labelSegment.b.y) / 2 };
  }
  let d = `M ${compact[0].x} ${compact[0].y}`;
  for (let index = 1; index < compact.length - 1; index += 1) {
    const previous = compact[index - 1];
    const point = compact[index];
    const next = compact[index + 1];
    const incoming = Math.abs(point.x - previous.x) + Math.abs(point.y - previous.y);
    const outgoing = Math.abs(next.x - point.x) + Math.abs(next.y - point.y);
    const radius = Math.min(roundness, incoming / 2, outgoing / 2);
    const before = {
      x: point.x - Math.sign(point.x - previous.x) * radius,
      y: point.y - Math.sign(point.y - previous.y) * radius,
    };
    const after = {
      x: point.x + Math.sign(next.x - point.x) * radius,
      y: point.y + Math.sign(next.y - point.y) * radius,
    };
    d += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
  }
  const last = compact.at(-1);
  d += ` L ${last.x} ${last.y}`;
  const segments = compact.slice(1).map((point, index) => ({
    a: compact[index],
    b: point,
    length: Math.abs(point.x - compact[index].x) + Math.abs(point.y - compact[index].y),
  }));
  const labelSegment = segments.sort((a, b) => b.length - a.length)[0];
  return {
    d,
    labelX: (labelSegment.a.x + labelSegment.b.x) / 2,
    labelY: (labelSegment.a.y + labelSegment.b.y) / 2,
  };
}

export function connectionPathAvoidingNodes(source, target, kind, direction, nodes, targetPortOffset = 0, sourcePortOffset = 0, targetDirection = direction, roundness = 9) {
  const basic = connectionPath(source, target, kind, direction, targetPortOffset, sourcePortOffset, targetDirection, roundness);
  const vertical = direction === "up" || direction === "down";
  const start = vertical
    ? { x: source.x + source.width / 2 + sourcePortOffset, y: direction === "up" ? boxTop(source) : boxTop(source) + source.height }
    : { x: direction === "left" ? source.x : source.x + source.width, y: centerY(source) + sourcePortOffset };
  const targetVertical = targetDirection === "up" || targetDirection === "down";
  const end = targetVertical
    ? { x: target.x + target.width / 2 + targetPortOffset, y: targetDirection === "up" ? boxTop(target) + target.height : boxTop(target) }
    : { x: targetDirection === "left" ? target.x + target.width : target.x, y: centerY(target) + targetPortOffset };
  const portVector = direction === "right" ? { x: 1, y: 0 }
    : direction === "left" ? { x: -1, y: 0 }
      : direction === "down" ? { x: 0, y: 1 }
        : { x: 0, y: -1 };
  const targetVector = targetDirection === "right" ? { x: 1, y: 0 }
    : targetDirection === "left" ? { x: -1, y: 0 }
      : targetDirection === "down" ? { x: 0, y: 1 }
        : { x: 0, y: -1 };
  const portLead = 24;
  const startLead = { x: start.x + portVector.x * portLead, y: start.y + portVector.y * portLead };
  const endLead = { x: end.x - targetVector.x * portLead, y: end.y - targetVector.y * portLead };
  const obstacles = nodes
    .filter((node) => node.id !== source.id && node.id !== target.id && !node.hidden)
    .map((node) => ({ left: node.x - 12, right: node.x + node.width + 12, top: boxTop(node) - 12, bottom: boxTop(node) + node.height + 12 }));
  if (!obstacles.length || segmentClear(start, end, obstacles) && (start.x === end.x || start.y === end.y)) return basic;
  if (kind === "merge" && !vertical && !targetVertical) {
    const bendX = start.x + (end.x - start.x) * 0.58;
    const bendStart = { x: bendX, y: start.y };
    const bendEnd = { x: bendX, y: end.y };
    if (segmentClear(start, bendStart, obstacles)
      && segmentClear(bendStart, bendEnd, obstacles)
      && segmentClear(bendEnd, end, obstacles)) return basic;
  }

  const xValues = [...new Set([startLead.x, endLead.x, ...obstacles.flatMap((box) => [box.left, box.right])])];
  const yValues = [...new Set([startLead.y, endLead.y, ...obstacles.flatMap((box) => [box.top, box.bottom])])];
  const points = [];
  const pointByKey = new Map();
  for (const x of xValues) for (const y of yValues) {
    if (obstacles.some((box) => x > box.left && x < box.right && y > box.top && y < box.bottom)) continue;
    const point = { x, y };
    points.push(point);
    pointByKey.set(`${x},${y}`, point);
  }
  const adjacency = new Map(points.map((point) => [point, []]));
  const connect = (items, coordinate) => {
    items.sort((a, b) => a[coordinate] - b[coordinate]);
    for (let index = 1; index < items.length; index += 1) {
      const a = items[index - 1];
      const b = items[index];
      if (!segmentClear(a, b, obstacles)) continue;
      adjacency.get(a).push(b);
      adjacency.get(b).push(a);
    }
  };
  yValues.forEach((y) => connect(points.filter((point) => point.y === y), "x"));
  xValues.forEach((x) => connect(points.filter((point) => point.x === x), "y"));

  const startPoint = pointByKey.get(`${startLead.x},${startLead.y}`);
  const endPoint = pointByKey.get(`${endLead.x},${endLead.y}`);
  if (!startPoint || !endPoint) return basic;
  const queue = [{ point: startPoint, axis: "", cost: 0, previous: null }];
  const best = new Map();
  let finished = null;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const state = queue.shift();
    const stateKey = `${state.point.x},${state.point.y}|${state.axis}`;
    if (best.has(stateKey) && best.get(stateKey) <= state.cost) continue;
    best.set(stateKey, state.cost);
    if (state.point === endPoint) { finished = state; break; }
    for (const neighbor of adjacency.get(state.point)) {
      const axis = neighbor.x === state.point.x ? "v" : "h";
      const distance = Math.abs(neighbor.x - state.point.x) + Math.abs(neighbor.y - state.point.y);
      queue.push({ point: neighbor, axis, cost: state.cost + distance + (state.axis && state.axis !== axis ? 18 : 0), previous: state });
    }
  }
  if (!finished) return basic;
  const route = [];
  for (let state = finished; state; state = state.previous) route.unshift(state.point);
  route.unshift(start);
  route.push(end);
  return roundedRoute(route, roundness);
}

function addEdge(svg, defs, edge, source, target, colors, nodes) {
  const color = edgeColor(edge, colors);
  const outline = edge.outline ?? "transparent";
  const outlineWidth = edge.outlineWidth ?? 0;
  const arrowShape = edge.arrowShape ?? "triangle";
  const marker = arrowShape === "chunky" ? null : ensureMarker(defs, color, outline, outlineWidth, arrowShape);
  const sourceDirection = edge.sourceDirection ?? edge.layoutDirection;
  const vertical = ["up", "down"].includes(sourceDirection);
  const targetDirection = edge.targetLayoutDirection ?? edge.layoutDirection;
  const targetVertical = ["up", "down"].includes(targetDirection);
  const targetPortOffset = (edge.targetPortFraction ?? 0) * (targetVertical ? target.width : target.height);
  const sourcePortOffset = (edge.sourcePortFraction ?? 0) * (vertical ? source.width : source.height);
  const route = connectionPathAvoidingNodes(source, target, edge.kind, sourceDirection, nodes, targetPortOffset, sourcePortOffset, targetDirection, edge.roundness);
  const selection = {
    "data-line": edge.lineNumber,
    "data-select-kind": "line",
    "data-selection-key": `line:${edge.from}:${edge.to}:${edge.lineNumber}`,
    "data-from": edge.from,
    "data-to": edge.to,
    role: "link",
    tabindex: 0,
    "aria-label": "Edit connection",
  };
  const hitPath = svgElement("path", {
    ...selection,
    d: route.d,
    class: "connector-hit",
    fill: "none",
    stroke: "transparent",
    "stroke-width": Math.max(14, edge.width + 10),
    "pointer-events": "stroke",
  });
  const shadow = shadowFilter(defs, edge, `flow-${edge.from}-${edge.to}-${edge.lineNumber}`);
  if (arrowShape === "chunky") {
    const chunkyPath = chunkyArrowPath(route.d, edge.direction, edge.arrowHeight, edge.arrowHeadWidth);
    const hasOutline = outlineWidth > 0 && !["none", "transparent"].includes(String(outline).toLowerCase());
    svg.append(svgElement("path", {
      ...selection,
      d: chunkyPath,
      class: `connector chunky ${edge.kind}`,
      fill: color,
      filter: shadow,
      stroke: hasOutline ? outline : "none",
      "stroke-width": hasOutline ? outlineWidth * 2 : 0,
      "stroke-dasharray": dashArray(edge.style),
      "stroke-linejoin": "round",
      "stroke-linecap": "round",
      "paint-order": "stroke fill",
      "pointer-events": "none",
    }));
    svg.append(hitPath);
  }
  if (arrowShape !== "chunky") {
    svg.append(hitPath);
    if (outlineWidth > 0 && !["none", "transparent"].includes(String(outline).toLowerCase())) {
      svg.append(svgElement("path", {
        d: route.d,
        class: `connector connector-outline ${edge.kind}`,
        filter: shadow,
        stroke: outline,
        "stroke-width": edge.width + outlineWidth * 2,
        "stroke-dasharray": dashArray(edge.style),
        "pointer-events": "none",
      }));
    }
    svg.append(svgElement("path", {
      ...selection,
      d: route.d,
      class: `connector ${edge.kind}`,
      filter: outlineWidth > 0 ? null : shadow,
      stroke: color,
      "stroke-width": edge.width,
      "stroke-dasharray": dashArray(edge.style),
      "marker-start": ["backward", "both"].includes(edge.direction) ? `url(#${marker})` : null,
      "marker-end": ["forward", "both"].includes(edge.direction) ? `url(#${marker})` : null,
      "pointer-events": "none",
    }));
  }
  const annotations = edge.annotations ?? [];
  const annotationStackHeight = { above: 0, below: 0 };
  annotations.filter((annotation) => annotation.text && !annotation.hidden).forEach((annotation) => {
    const annotationStyle = annotation;
    const annotationColor = annotationStyle?.color === "merge" ? colors.merge : annotationStyle?.color ?? color;
    const rich = containsMath(annotation.text);
    const richLayout = rich ? richTextLayout(annotation.text, annotationStyle, colors) : null;
    const renderHeight = richLayout?.height ?? annotationStyle.fontSize ?? edge.fontSize ?? 12;
    const x = route.labelX + (annotation.offsetX ?? 0);
    const position = annotation.position === "below" ? "below" : "above";
    const baseline = route.labelY + (position === "below" ? 8 + renderHeight + annotationStackHeight.below : -8 - annotationStackHeight.above) + (annotation.offsetY ?? 0);
    annotationStackHeight[position] += renderHeight + 4;
    const common = {
      class: "connection-annotation", "data-line": annotation.lineNumber,
      "data-offset-line": annotation.legacy ? edge.lineNumber : annotation.lineNumber,
      "data-drag-kind": annotation.legacy ? "connection-label" : "flow-annotation",
      "data-select-kind": "line", "data-selection-key": `line:${edge.from}:${edge.to}:${edge.lineNumber}`,
      "data-from": edge.from, "data-to": edge.to, "data-current-x": annotation.offsetX ?? 0,
      "data-current-y": annotation.offsetY ?? 0, role: "link", tabindex: 0,
      "aria-label": "Move or edit connection annotation " + annotation.text,
    };
    if (rich) {
      const wrapper = svgElement("g", common);
      let rowTop = baseline - richLayout.height;
      richLayout.lines.forEach((line) => {
        let cursor = x - line.width / 2;
        line.runs.forEach((run) => {
          if (run.kind === "math") wrapper.append(mathSvg(run, { x: cursor, y: rowTop + (line.height - run.height) / 2, color: annotationColor }));
          else {
            const text = svgElement("text", {
              x: cursor, y: rowTop + line.height / 2, fill: annotationColor,
              "font-family": annotationStyle?.fontFamily ?? colors.font, "font-size": annotationStyle?.fontSize,
              "font-weight": annotationStyle?.fontWeight, "font-style": annotationStyle?.fontStyle,
              "text-decoration": annotationStyle?.textDecoration, "dominant-baseline": "middle",
              ...textBorder(annotationStyle ?? {}),
            });
            text.textContent = run.text;
            wrapper.append(text);
          }
          cursor += run.width;
        });
        rowTop += line.height;
      });
      svg.append(wrapper);
      return;
    }
    const label = svgElement("text", {
      ...common, x, y: baseline,
      fill: annotationColor,
      "font-family": annotationStyle?.fontFamily ?? colors.font,
      "font-size": annotationStyle?.fontSize, "font-weight": annotationStyle?.fontWeight,
      "font-style": annotationStyle?.fontStyle, "text-decoration": annotationStyle?.textDecoration,
      ...textBorder(annotationStyle ?? {}),
    });
    label.textContent = annotation.text;
    svg.append(label);
  });
}

export function edgeIsVisible(edge, nodesById) {
  const source = nodesById.get(edge.from);
  const target = nodesById.get(edge.to);
  return Boolean(source && target && !edge.hidden && !source.hidden && !target.hidden);
}

function layoutOptionsForLabels(edges, colors, requested = {}) {
  const context = measureContext2d();
  const widestLabel = Math.max(0, ...edges.map((edge) => {
    const measure = (annotation) => {
      context.font = `${annotation.fontStyle ?? "normal"} ${annotation.fontWeight ?? "normal"} ${annotation.fontSize ?? 12}px ${annotation.fontFamily ?? colors.font}`;
      return containsMath(annotation.text ?? "")
        ? richTextLayout(annotation.text ?? "", annotation, colors).width
        : context.measureText(annotation.text ?? "").width;
    };
    return Math.max(0, ...(edge.annotations ?? []).map(measure));
  }));
  return {
    ...requested,
    horizontalGutter: requested.horizontalGutter ?? Math.max(DEFAULT_LAYOUT.horizontalGutter, Math.ceil(widestLabel + 46)),
  };
}

function diagramBounds(groups, nodesById, colors) {
  return groups.map((group) => {
    const nodes = group.nodeIds.map((id) => nodesById.get(id)).filter(Boolean);
    if (!nodes.length) return null;
    const padding = group.padding ?? 24;
    const titleHeight = group.label ? Math.ceil((group.fontSize ?? 13) * 1.2) : 0;
    const titleSpace = group.label && group.labelPosition !== "outside" && group.verticalAlign !== "middle" ? titleHeight + 6 : 0;
    const titleAtBottom = group.verticalAlign === "bottom";
    const natural = {
      ...group,
      x: Math.min(...nodes.map((node) => node.x)) - padding,
      y: Math.min(...nodes.map((node) => node.y)) - padding - (titleAtBottom ? 0 : titleSpace),
      right: Math.max(...nodes.map((node) => node.x + node.width)) + padding,
      bottom: Math.max(...nodes.map((node) => node.y + node.layoutHeight)) + padding + (titleAtBottom ? titleSpace : 0),
    };
    const extraWidth = Math.max(0, (group.width ?? 0) - (natural.right - natural.x));
    const extraHeight = Math.max(0, (group.height ?? 0) - (natural.bottom - natural.y));
    const frameOffsetX = Math.max(-extraWidth / 2, Math.min(extraWidth / 2, group.frameOffsetX ?? 0));
    const frameOffsetY = Math.max(-extraHeight / 2, Math.min(extraHeight / 2, group.frameOffsetY ?? 0));
    const bounds = {
      ...natural,
      x: natural.x - extraWidth / 2 + frameOffsetX,
      right: natural.right + extraWidth / 2 + frameOffsetX,
      y: natural.y - extraHeight / 2 + frameOffsetY,
      bottom: natural.bottom + extraHeight / 2 + frameOffsetY,
      frameOffsetX,
      frameOffsetY,
    };
    const context = measureContext2d();
    context.font = `${group.fontStyle ?? "normal"} ${group.fontWeight ?? "600"} ${group.fontSize ?? 13}px ${group.fontFamily ?? colors.font}`;
    const labelWidth = group.label ? context.measureText(group.label).width : 0;
    const labelLeft = (group.align === "center" ? (bounds.x + bounds.right - labelWidth) / 2
      : group.align === "right" ? bounds.right - 12 - labelWidth : bounds.x + 12) + (group.labelOffsetX ?? 0);
    const labelBaseline = group.labelPosition === "outside"
      ? group.verticalAlign === "bottom" ? bounds.bottom + (group.fontSize ?? 13) + 8 : bounds.y - 8
      : group.verticalAlign === "bottom" ? bounds.bottom - 8
        : group.verticalAlign === "middle" ? (bounds.y + bounds.bottom) / 2 + (group.fontSize ?? 13) * 0.35
          : bounds.y + (group.fontSize ?? 13) + 4;
    const shiftedLabelBaseline = labelBaseline + (group.labelOffsetY ?? 0);
    bounds.visualTop = group.label ? Math.min(bounds.y, shiftedLabelBaseline - titleHeight) : bounds.y;
    bounds.visualBottom = group.label ? Math.max(bounds.bottom, shiftedLabelBaseline + 3) : bounds.bottom;
    bounds.visualLeft = Math.min(bounds.x, labelLeft);
    bounds.visualRight = Math.max(bounds.right, labelLeft + labelWidth);
    return bounds;
  }).filter(Boolean);
}

function addDiagramFrame(parent, group, colors, defs) {
  const frame = svgElement("g", { "data-line": group.lineNumber, "data-id": group.id, "data-select-kind": "graph", "data-selection-key": `graph:${group.id}`, "data-drag-kind": "graph", "data-current-x": group.offsetX ?? 0, "data-current-y": group.offsetY ?? 0, role: "group", tabindex: 0, "aria-label": group.label ? `Graph: ${group.label}` : "Graph boundary" });
  const hit = svgElement("rect", {
    class: "subdiagram-hit", x: group.x, y: group.y, width: group.right - group.x, height: group.bottom - group.y,
    rx: 12, fill: "none", stroke: "transparent", "stroke-width": 44, "pointer-events": "stroke",
  });
  hit.addEventListener("pointermove", (event) => {
    const svg = event.currentTarget.ownerSVGElement;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM().inverse());
    const distance = Math.min(Math.abs(local.x - group.x), Math.abs(local.x - group.right), Math.abs(local.y - group.y), Math.abs(local.y - group.bottom));
    frame.style.setProperty("--graph-proximity", String(Math.max(0.16, Math.min(0.82, 1 - distance / 26))));
  });
  hit.addEventListener("pointerleave", () => frame.style.removeProperty("--graph-proximity"));
  frame.append(hit);
  frame.append(svgElement("rect", {
    class: "subdiagram-frame", x: group.x, y: group.y, width: group.right - group.x, height: group.bottom - group.y,
    rx: 12, fill: group.fill, stroke: group.outline, "stroke-width": group.outlineWidth,
    "stroke-dasharray": dashArray(group.outlineStyle), "pointer-events": "none",
    filter: shadowFilter(defs, group, `graph-${group.id}`),
  }));
  frame.append(svgElement("rect", {
    class: "subdiagram-selection-outline", x: group.x, y: group.y, width: group.right - group.x, height: group.bottom - group.y,
    rx: 12, fill: "none", stroke: "var(--accent)", "stroke-width": 3, "stroke-dasharray": "7 4", "pointer-events": "none",
  }));
  if (group.label) {
    const align = group.align ?? "center";
    const verticalAlign = group.verticalAlign ?? "top";
    const x = (align === "center" ? (group.x + group.right) / 2 : align === "right" ? group.right - 12 : group.x + 12) + (group.labelOffsetX ?? 0);
    const fontSize = group.fontSize ?? 13;
    const y = (group.labelPosition === "outside"
      ? verticalAlign === "bottom" ? group.bottom + fontSize + 8 : group.y - 8
      : verticalAlign === "bottom" ? group.bottom - 8
        : verticalAlign === "middle" ? (group.y + group.bottom) / 2 + fontSize * 0.35
          : group.y + fontSize + 4) + (group.labelOffsetY ?? 0);
    const label = svgElement("text", {
      class: "subdiagram-label", x,
      y,
      "data-line": group.lineNumber,
      "data-id": group.id,
      "data-select-kind": "graph",
      "data-selection-key": `graph:${group.id}`,
      "data-drag-kind": "graph-label",
      "data-current-x": group.labelOffsetX ?? 0,
      "data-current-y": group.labelOffsetY ?? 0,
      role: "button",
      tabindex: 0,
      "aria-label": `Move graph label: ${group.label}`,
      fill: group.color ?? colors.text,
      "font-family": group.fontFamily ?? colors.font,
      "font-size": group.fontSize ?? 13,
      "font-weight": group.fontWeight ?? "600",
      "font-style": group.fontStyle ?? "normal",
      "text-decoration": group.textDecoration ?? "none",
      ...textBorder(group),
      "text-anchor": align === "center" ? "middle" : align === "right" ? "end" : "start",
      "pointer-events": "auto",
    });
    label.textContent = group.label;
    frame.append(label);
  }
  frame.append(resizeHandles({
    className: "graph-resize-handles", x: group.x, y: group.y,
    width: group.right - group.x, height: group.bottom - group.y,
    lineNumber: group.lineNumber, id: group.id, kind: "graph-resize",
    currentX: group.frameOffsetX, currentY: group.frameOffsetY,
  }));
  parent.append(frame);
}

function packGraphs(nodes, groups, colors, gap = 80, packingNodes = nodes) {
  if (groups.length < 2) return nodes;
  const byId = new Map(packingNodes.map((node) => [node.id, node]));
  const bounds = diagramBounds(groups, byId, colors);
  const boundsById = new Map(bounds.map((group) => [group.id, group]));
  const shifts = new Map();
  const graphShifts = new Map();
  const resolving = new Set();
  const resolve = (group) => {
    if (graphShifts.has(group.id)) return graphShifts.get(group.id);
    if (resolving.has(group.id)) return { x: 0, y: 0 };
    resolving.add(group.id);
    const index = bounds.indexOf(group);
    const fallback = index > 0 ? bounds[index - 1] : null;
    const target = boundsById.get(group.relativeTo) ?? fallback;
    if (!target) {
      graphShifts.set(group.id, { x: 0, y: 0 });
      resolving.delete(group.id);
      return graphShifts.get(group.id);
    }
    const targetShift = resolve(target);
    const placement = group.placement ?? "below";
    const shift = placement === "above"
      ? { x: target.x + targetShift.x - group.x, y: target.visualTop + targetShift.y - gap - group.bottom }
      : placement === "left"
        ? { x: target.visualLeft + targetShift.x - gap - group.visualRight, y: target.y + targetShift.y - group.y }
        : placement === "right"
          ? { x: target.visualRight + targetShift.x + gap - group.visualLeft, y: target.y + targetShift.y - group.y }
          : { x: target.x + targetShift.x - group.x, y: target.visualBottom + targetShift.y + gap - group.visualTop };
    graphShifts.set(group.id, shift);
    resolving.delete(group.id);
    return shift;
  };
  bounds.forEach((group) => {
    const shift = resolve(group);
    group.nodeIds.forEach((id) => shifts.set(id, shift));
  });
  return nodes.map((node) => ({ ...node, x: node.x + (shifts.get(node.id)?.x ?? 0), y: node.y + (shifts.get(node.id)?.y ?? 0) }));
}

export function renderSvg(container, graph, options) {
  const colors = figureColors(container, graph.figure);
  const measured = measureNodes(graph.nodes, colors);
  const groupedIds = new Set((graph.groups ?? []).flatMap((group) => group.nodeIds));
  const layouts = (graph.groups ?? []).map((group) => {
    const ids = new Set(group.nodeIds);
    const nodes = measured.filter((node) => ids.has(node.id));
    const edges = graph.edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    return layoutDiagram(nodes, edges, layoutOptionsForLabels(edges, colors, {
      ...options.layout,
      horizontalGutter: group.xSpacing ?? options.layout?.horizontalGutter,
      verticalGutter: group.ySpacing ?? options.layout?.verticalGutter,
    }));
  });
  const ungroupedNodes = measured.filter((node) => !groupedIds.has(node.id));
  if (ungroupedNodes.length) layouts.push(layoutDiagram(ungroupedNodes, graph.edges.filter((edge) => !groupedIds.has(edge.from) && !groupedIds.has(edge.to)), layoutOptionsForLabels(graph.edges, colors, options.layout)));
  const layout = { nodes: layouts.flatMap((item) => item.nodes), edges: graph.edges };
  let visualNodes = layout.nodes.map((node) => ({ ...node, x: node.x + node.offsetX, y: node.y + node.offsetY }));
  visualNodes = packGraphs(visualNodes, graph.groups ?? [], colors, 80, layout.nodes);
  const ownerByNode = new Map();
  (graph.groups ?? []).forEach((group) => group.nodeIds.forEach((id) => ownerByNode.set(id, group)));
  visualNodes = visualNodes.map((node) => {
    const owner = ownerByNode.get(node.id);
    return { ...node, x: node.x + (owner?.offsetX ?? 0), y: node.y + (owner?.offsetY ?? 0) };
  });
  const byId = new Map(visualNodes.map((node) => [node.id, node]));
  const groups = diagramBounds((graph.groups ?? []).filter((group) => !group.hidden), byId, colors);
  const extentX = visualNodes.flatMap((node) => [
    node.x,
    node.x + node.width,
    node.x + node.width / 2 + node.labelOffsetX,
    ...node.annotations.map((annotation) => node.x + node.width / 2 + annotation.offsetX),
  ]);
  const extentY = visualNodes.flatMap((node) => [
    boxTop(node),
    boxTop(node) + node.height,
    boxTop(node) + node.height / 2 + node.labelOffsetY,
    ...node.above.map((annotation, index) => annotationTop(node, annotation, index)),
    ...node.below.map((annotation, index) => annotationTop(node, annotation, index) + annotation.renderHeight),
  ]);
  const viewX = extentX.length ? Math.min(...extentX.map((value) => value - 60), ...groups.map((group) => group.visualLeft - 20)) : 0;
  const viewY = extentY.length ? Math.min(...extentY.map((value) => value - 40), ...groups.map((group) => group.visualTop - 20)) : 0;
  const viewRight = extentX.length ? Math.max(...extentX.map((value) => value + 60), ...groups.map((group) => group.visualRight + 20)) : 1;
  const viewBottom = extentY.length ? Math.max(...extentY.map((value) => value + 40), ...groups.map((group) => group.visualBottom + 20)) : 1;
  const viewWidth = viewRight - viewX;
  const viewHeight = viewBottom - viewY;
  const svg = svgElement("svg", { xmlns: SVG_NS, viewBox: `${viewX} ${viewY} ${viewWidth} ${viewHeight}`, width: viewWidth, height: viewHeight, role: "img", "aria-label": options.accessibleLabel ?? "Block diagram" });
  svg.classList.add("pugflow-svg");
  if (!visualNodes.length && !groups.length) svg.classList.add("empty-diagram");
  const style = svgElement("style");
  style.textContent = `
    .diagram-background { fill: ${colors.background}; }
    .label { user-select: none; }
    .block-annotation, .connection-annotation { text-anchor: middle; user-select: none; }
    .subdiagram-label { user-select: none; }
    .connector { fill: none; stroke-linecap: round; stroke-linejoin: round; }
    .interactive [data-line] { cursor: pointer; }
    .interactive [data-drag-kind] { touch-action: none; }
    .interactive .entry:hover .label-box, .interactive .entry:focus .label-box { filter: brightness(1.08); }
    .interactive text[data-line]:hover, .interactive text[data-line]:focus { text-decoration: underline; }
    .interactive path[data-line]:hover, .interactive path[data-line]:focus { filter: brightness(1.25); }
    .interactive .dragging { opacity: .82; }
    .interactive .drag-origin { opacity: .24; pointer-events: none; }
  `;
  svg.append(style);
  const defs = svgElement("defs");
  svg.append(defs);
  svg.append(svgElement("rect", { class: "diagram-background", x: viewX, y: viewY, width: viewWidth, height: viewHeight }));
  const visibleGroups = [...groups].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0));
  const layerNumbers = [...new Set([-1, ...visibleGroups.map((group) => group.layer ?? 0)])].sort((a, b) => a - b);
  const layerContainers = new Map(layerNumbers.map((layerNumber) => {
    const layer = svgElement("g", { class: "diagram-layer", "data-layer": layerNumber });
    svg.append(layer);
    return [layerNumber, layer];
  }));
  visibleGroups.forEach((group) => addDiagramFrame(layerContainers.get(group.layer ?? 0), group, colors, defs));
  const edgeLayers = new Map(layerNumbers.map((layerNumber) => {
    const layer = svgElement("g", { class: "connector-layer", "data-layer": layerNumber });
    layerContainers.get(layerNumber).append(layer);
    return [layerNumber, layer];
  }));
  layout.edges.forEach((edge) => {
    const source = byId.get(edge.from);
    const target = byId.get(edge.to);
    const sourceLayer = ownerByNode.get(edge.from)?.layer ?? -1;
    const targetLayer = ownerByNode.get(edge.to)?.layer ?? -1;
    if (edgeIsVisible(edge, byId)) addEdge(edgeLayers.get(Math.max(sourceLayer, targetLayer)), defs, edge, source, target, colors, visualNodes);
  });
  const nodeLayers = new Map();
  visibleGroups.forEach((group) => {
    const layer = svgElement("g", { class: "graph-node-layer", "data-graph-id": group.id, "data-layer": group.layer ?? 0 });
    layerContainers.get(group.layer ?? 0).append(layer);
    nodeLayers.set(group.id, layer);
  });
  const ungrouped = svgElement("g", { class: "graph-node-layer ungrouped-layer", "data-layer": -1 });
  layerContainers.get(-1).append(ungrouped);
  [...visualNodes].sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0) || (a.sourceIndex ?? 0) - (b.sourceIndex ?? 0)).forEach((node) => {
    const owner = ownerByNode.get(node.id);
    if (!node.hidden) addNode(owner ? nodeLayers.get(owner.id) ?? ungrouped : ungrouped, node, colors, defs);
  });
  Object.defineProperty(svg, "__diagramLayout", { value: { ...layout, nodes: visualNodes, groups } });
  if (options.onNodeClick || options.onElementMove) {
    svg.classList.add("interactive");
    let drag = null;
    let navigationPointer = null;
    const pointFor = (event) => {
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(svg.getScreenCTM().inverse());
    };
    if (options.onNodeClick) {
      svg.addEventListener("pointerdown", (event) => {
        const target = event.target.closest?.("[data-line]");
        if (!target || event.button !== 0) return;
        navigationPointer = {
          pointerId: event.pointerId,
          target,
          clientX: event.clientX,
          clientY: event.clientY,
          moved: false,
        };
      });
      svg.addEventListener("pointermove", (event) => {
        if (!navigationPointer || navigationPointer.pointerId !== event.pointerId) return;
        if (Math.hypot(event.clientX - navigationPointer.clientX, event.clientY - navigationPointer.clientY) > 2) {
          navigationPointer.moved = true;
        }
      });
      svg.addEventListener("pointerup", (event) => {
        if (!navigationPointer || navigationPointer.pointerId !== event.pointerId) return;
        const completed = navigationPointer;
        navigationPointer = null;
        if (!completed.moved) {
          const entry = completed.target.closest?.(".entry");
          const connector = completed.target.closest?.(".connector");
          const additive = event.shiftKey || event.ctrlKey || event.metaKey;
          const selectedTarget = completed.target.closest?.("[data-select-kind]") ?? completed.target;
          const kind = selectedTarget.dataset.selectKind ?? (connector ? "line" : "node");
          options.onElementClick?.({
            kind,
            id: entry?.dataset.id ?? selectedTarget.dataset.id ?? null,
            from: connector?.dataset.from ?? selectedTarget.dataset.from ?? null,
            to: connector?.dataset.to ?? selectedTarget.dataset.to ?? null,
            lineNumber: Number(kind === "line" ? selectedTarget.dataset.offsetLine ?? selectedTarget.dataset.line : selectedTarget.dataset.line ?? completed.target.dataset.line),
            offsetLineNumber: Number(selectedTarget.dataset.offsetLine ?? selectedTarget.dataset.line),
            selectionKey: selectedTarget.dataset.selectionKey ?? connector?.dataset.selectionKey ?? entry?.dataset.selectionKey ?? null,
            additive,
          });
          if (!additive) options.onNodeClick({
            id: completed.target.dataset.id ?? null,
            lineNumber: Number(completed.target.dataset.line),
          });
        }
      });
      svg.addEventListener("pointercancel", (event) => {
        if (navigationPointer?.pointerId === event.pointerId) navigationPointer = null;
      });
    }
    if (options.onElementMove) {
      svg.addEventListener("pointerdown", (event) => {
        const target = event.target.closest?.("[data-drag-kind]");
        if (!target || event.button !== 0) return;
        event.preventDefault();
        const start = pointFor(event);
        const element = target.dataset.dragKind === "node" ? target.closest(".entry") : target;
        const selectionKey = target.closest?.("[data-selection-key]")?.dataset.selectionKey ?? null;
        const groupDrag = selectionKey && element.classList.contains("selected-element")
          && !["image-resize", "node-resize", "graph-resize", "node-label", "block-annotation"].includes(target.dataset.dragKind);
        const elements = groupDrag
          ? [...svg.querySelectorAll(".entry.selected-element, g[data-drag-kind='graph'].selected-element, text[data-drag-kind='connection-label'].selected-element")]
          : [element];
        const ghosts = elements.map((movingElement) => {
          const ghost = movingElement.cloneNode(true);
          ghost.classList.remove("dragging", "selected-element");
          ghost.classList.add("drag-origin");
          for (const item of [ghost, ...ghost.querySelectorAll("[data-line], [tabindex], [data-drag-kind]")]) {
            item.removeAttribute("data-line");
            item.removeAttribute("data-drag-kind");
            item.removeAttribute("tabindex");
            item.removeAttribute("role");
          }
          movingElement.parentNode.insertBefore(ghost, movingElement);
          return ghost;
        });
        drag = {
          pointerId: event.pointerId,
          target,
          elements,
          ghosts,
          selectionKey,
          start,
          dx: 0,
          dy: 0,
        };
        drag.elements.forEach((movingElement) => movingElement.classList.add("dragging"));
        svg.setPointerCapture(event.pointerId);
      });
      svg.addEventListener("pointermove", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const point = pointFor(event);
        const constrained = constrainDragDelta(
          point.x - drag.start.x,
          point.y - drag.start.y,
          event.metaKey || event.ctrlKey || event.shiftKey,
        );
        const { dx, dy } = drag.target.dataset.resizeX === undefined
          ? constrained
          : constrainResizeDelta(constrained.dx, constrained.dy, Number(drag.target.dataset.resizeX), Number(drag.target.dataset.resizeY));
        drag.dx = dx;
        drag.dy = dy;
        drag.elements.forEach((movingElement) => movingElement.setAttribute("transform", `translate(${drag.dx} ${drag.dy})`));
      });
      const finishDrag = (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        const completed = drag;
        drag = null;
        completed.elements.forEach((movingElement) => {
          movingElement.removeAttribute("transform");
          movingElement.classList.remove("dragging");
        });
        completed.ghosts.forEach((ghost) => ghost.remove());
        if (Math.hypot(completed.dx, completed.dy) > 2) {
          const drop = pointFor(event);
          options.onElementMove({
            kind: completed.target.dataset.dragKind,
            selectionKey: completed.selectionKey,
            id: completed.target.dataset.id ?? null,
            lineNumber: Number(completed.target.dataset.offsetLine ?? completed.target.dataset.line),
            currentX: Number(completed.target.dataset.currentX ?? 0),
            currentY: Number(completed.target.dataset.currentY ?? 0),
            currentWidth: Number(completed.target.dataset.currentWidth ?? 0),
            currentHeight: Number(completed.target.dataset.currentHeight ?? 0),
            resizeX: Number(completed.target.dataset.resizeX ?? 0),
            resizeY: Number(completed.target.dataset.resizeY ?? 0),
            dx: completed.dx,
            dy: completed.dy,
            dropX: drop.x,
            dropY: drop.y,
          });
        }
      };
      svg.addEventListener("pointerup", finishDrag);
      svg.addEventListener("pointercancel", (event) => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.elements.forEach((movingElement) => {
          movingElement.removeAttribute("transform");
          movingElement.classList.remove("dragging");
        });
        drag.ghosts.forEach((ghost) => ghost.remove());
        drag = null;
      });
    }
    const activateNode = (event) => {
      const target = event.target.closest?.("[data-line]");
      if (!target || !["Enter", " "].includes(event.key)) return;
      event.preventDefault();
      options.onNodeClick?.({ id: target.dataset.id ?? null, lineNumber: Number(target.dataset.line) });
    };
    svg.addEventListener("keydown", activateNode);
  }
  return svg;
}

function serialize(svg) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(svg)}`;
}

function exportSvgClone(svg, layout, graphId = "") {
  const clone = svg.cloneNode(true);
  clone.classList.remove("interactive");
  clone.querySelectorAll(".connector-hit").forEach((element) => element.remove());
  clone.querySelectorAll(".selected-element").forEach((element) => element.classList.remove("selected-element"));
  if (!graphId) return clone;
  const group = layout?.groups.find((candidate) => candidate.id === graphId);
  if (!group) throw new Error(`Graph "${graphId}" was not found.`);
  const nodeIds = new Set(group.nodeIds);
  clone.querySelectorAll("[data-select-kind='graph']").forEach((element) => {
    if (element.dataset.id !== graphId) element.remove();
  });
  clone.querySelectorAll(".graph-node-layer").forEach((element) => {
    if (element.dataset.graphId !== graphId) element.remove();
  });
  clone.querySelectorAll("[data-from][data-to]").forEach((element) => {
    if (!nodeIds.has(element.dataset.from) || !nodeIds.has(element.dataset.to)) element.remove();
  });
  const padding = 20;
  const x = group.visualLeft - padding;
  const y = group.visualTop - padding;
  const width = group.visualRight - group.visualLeft + padding * 2;
  const height = group.bottom - group.visualTop + padding * 2;
  clone.setAttribute("viewBox", `${x} ${y} ${width} ${height}`);
  clone.setAttribute("width", width);
  clone.setAttribute("height", height);
  const background = clone.querySelector(".diagram-background");
  if (background) {
    background.setAttribute("x", x);
    background.setAttribute("y", y);
    background.setAttribute("width", width);
    background.setAttribute("height", height);
  }
  return clone;
}

function download(blob, filename) {
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(anchor.href), 1000);
}

export function createBlockDiagram(container, source, options = {}) {
  if (!(container instanceof Element)) throw new TypeError("A container element is required.");
  let currentSource = source;
  let currentStyles = options.styles ?? "";
  let currentSvg = null;
  let currentLayout = null;

  function render(nextSource = currentSource, nextStyles = currentStyles) {
    currentSource = nextSource;
    currentStyles = nextStyles;
    const graph = parseDiagram(currentSource, currentStyles);
    if (graph.errors.length) throw new Error(graph.errors.join("\n"));
    currentSvg = renderSvg(container, graph, options);
    currentLayout = currentSvg.__diagramLayout;
    container.classList.add("pugflow");
    container.replaceChildren(currentSvg);
    return graph;
  }
  function exportSvg(graphId = "") {
    if (!currentSvg) render();
    return exportSvgClone(currentSvg, currentLayout, graphId);
  }
  function toSVGString(graphId = "") { return serialize(exportSvg(graphId)); }
  function saveSVG(filename = "diagram.svg", graphId = "") { download(new Blob([toSVGString(graphId)], { type: "image/svg+xml;charset=utf-8" }), filename); }
  function saveSource(filename = "diagram.pug") { download(new Blob([currentSource], { type: "text/plain;charset=utf-8" }), filename); }
  function toPNGBlob(scale = 2, graphId = "") {
    return new Promise((resolve, reject) => {
      const exported = exportSvg(graphId);
      const viewBox = exported.viewBox.baseVal;
      const url = URL.createObjectURL(new Blob([serialize(exported)], { type: "image/svg+xml;charset=utf-8" }));
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = viewBox.width * scale;
        canvas.height = viewBox.height * scale;
        const context = canvas.getContext("2d");
        context.scale(scale, scale);
        context.drawImage(image, 0, 0);
        canvas.toBlob((png) => {
          URL.revokeObjectURL(url);
          if (!png) return reject(new Error("The browser could not create the PNG."));
          resolve(png);
        }, "image/png");
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The browser could not rasterize the SVG.")); };
      image.src = url;
    });
  }
  async function savePNG(filename = "diagram.png", scale = 2, graphId = "") { download(await toPNGBlob(scale, graphId), filename); }
  render();
  return {
    render, toSVGString, toPNGBlob, saveSVG, savePNG, saveSource,
    get source() { return currentSource; },
    get layout() { return currentLayout; },
  };
}

export { parseDiagram } from "./parser.mjs";
