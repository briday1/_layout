import { compileStyleSheet } from "./style-sheet.mjs";

const ID_PATTERN = /^[a-zA-Z][\w-]*$/;
const SHAPES = new Set(["square", "round", "rounded", "pill", "diamond", "hexagon", "cylinder"]);
const DIRECTIONS = new Set(["forward", "backward", "both", "none"]);
const ARROW_SHAPES = new Set(["triangle", "open", "diamond", "circle", "chunky"]);
const FLOW_DIRECTIONS = new Set(["right", "left", "up", "down"]);
const PORT_DISTRIBUTIONS = new Set(["shared", "distributed"]);
const LINE_STYLES = new Set(["solid", "dashed", "dotted"]);
const LINE_FIELDS = new Set([
  "line.arrow-style", "line.arrow-shape", "line.arrow-height", "line.arrow-head-width", "line.color", "line.outline", "line.outline-width", "line.stroke-style", "line.width",
  "line.source-face", "line.target-face", "line.roundness",
  "line.label", "line.label-position", "line.label-offset", "line.label-hidden",
  "line.annotation-above", "line.annotation-below", "line.annotation-above-hidden", "line.annotation-below-hidden",
  "line.annotation-above-color", "line.annotation-below-color",
  "line.annotation-above-font-family", "line.annotation-below-font-family",
  "line.annotation-above-font-size", "line.annotation-below-font-size",
  "line.annotation-above-font-weight", "line.annotation-below-font-weight",
  "line.annotation-above-font-style", "line.annotation-below-font-style",
  "line.annotation-above-text-decoration", "line.annotation-below-text-decoration",
  "line.annotation-above-text-outline", "line.annotation-below-text-outline",
  "line.annotation-above-text-outline-width", "line.annotation-below-text-outline-width",
  "line.use", "line.hidden",
  "line.shadow-color", "line.shadow-offset-x", "line.shadow-offset-y", "line.shadow-blur", "line.shadow-opacity",
  "line.font-family", "line.font-size", "line.font-weight", "line.font-style", "line.text-decoration",
  "line.text-outline", "line.text-outline-width",
]);
const LINE_DEFINITION_FIELDS = new Map([
  ["arrow-style", "line.arrow-style"],
  ["arrow-shape", "line.arrow-shape"],
  ["arrow-height", "line.arrow-height"],
  ["arrow-head-width", "line.arrow-head-width"],
  ["source-face", "line.source-face"],
  ["target-face", "line.target-face"],
  ["roundness", "line.roundness"],
  ["color", "line.color"],
  ["outline", "line.outline"],
  ["outline-width", "line.outline-width"],
  ["stroke-style", "line.stroke-style"],
  ["width", "line.width"],
  ["label-position", "line.label-position"],
  ["label-offset", "line.label-offset"],
  ["label-hidden", "line.label-hidden"],
  ["annotation-above", "line.annotation-above"], ["annotation-below", "line.annotation-below"],
  ["annotation-above-hidden", "line.annotation-above-hidden"], ["annotation-below-hidden", "line.annotation-below-hidden"],
  ...["above", "below"].flatMap((position) => ["color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width"]
    .map((property) => [`annotation-${position}-${property}`, `line.annotation-${position}-${property}`])),
  ["hidden", "line.hidden"],
  ["shadow-color", "line.shadow-color"], ["shadow-offset-x", "line.shadow-offset-x"],
  ["shadow-offset-y", "line.shadow-offset-y"], ["shadow-blur", "line.shadow-blur"],
  ["shadow-opacity", "line.shadow-opacity"],
  ["font-family", "line.font-family"], ["font-size", "line.font-size"],
  ["font-weight", "line.font-weight"], ["font-style", "line.font-style"],
  ["text-decoration", "line.text-decoration"], ["text-outline", "line.text-outline"],
  ["text-outline-width", "line.text-outline-width"],
]);
const FLOW_STYLE_FIELDS = new Set([...LINE_DEFINITION_FIELDS.keys(), "label"]);
const ANNOTATION_STYLE_FIELDS = new Set([
  "color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width",
]);
const BLOCK_PROPERTIES = new Set([
  "id", "shape", "fill", "color", "outline", "outline-style", "outline-width",
  "width", "height", "align", "vertical-align", "layer", "hidden", "offset", "label-offset",
  "top-ports", "right-ports", "bottom-ports", "left-ports",
  "shadow-color", "shadow-offset-x", "shadow-offset-y", "shadow-blur", "shadow-opacity",
  "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width",
]);
const BLOCK_STYLE_PROPERTIES = new Set([
  "shape", "fill", "color", "outline", "outline-style", "outline-width",
  "width", "height", "align", "vertical-align",
  "top-ports", "right-ports", "bottom-ports", "left-ports",
  "shadow-color", "shadow-offset-x", "shadow-offset-y", "shadow-blur", "shadow-opacity",
  "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width",
]);
const IMAGE_PROPERTIES = new Set([
  "id", "source", "shape", "fill", "outline", "outline-style", "outline-width",
  "width", "height", "fit", "opacity", "padding", "layer", "hidden", "offset",
  "top-ports", "right-ports", "bottom-ports", "left-ports",
  "shadow-color", "shadow-offset-x", "shadow-offset-y", "shadow-blur", "shadow-opacity",
]);
const GRAPH_STYLE_PROPERTIES = new Set([
  "label-position", "align", "vertical-align", "placement", "fill", "color", "outline", "outline-style", "outline-width",
  "width", "height", "padding", "x-spacing", "y-spacing",
  "shadow-color", "shadow-offset-x", "shadow-offset-y", "shadow-blur", "shadow-opacity",
  "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width",
]);

function indentationWidth(whitespace) {
  return [...whitespace].reduce((width, character) => width + (character === "\t" ? 2 : 1), 0);
}

function parseAttributes(raw, lineNumber, errors) {
  const attributes = {};
  if (!raw?.trim()) return attributes;
  const pattern = /([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s,]+)))?/g;
  let match;
  let consumed = "";
  while ((match = pattern.exec(raw))) {
    attributes[match[1]] = match[2] ?? match[3] ?? match[4] ?? true;
    consumed += match[0];
  }
  if (raw.replace(/[\s,]+/g, "") !== consumed.replace(/[\s,]+/g, "")) {
    errors.push(`Line ${lineNumber}: could not parse all attributes.`);
  }
  return attributes;
}

function parseMarkupLine(body, lineNumber, errors) {
  if (body.startsWith("|")) {
    return { type: "text", classes: [], attrs: {}, text: body.slice(1).replace(/^ /, ""), children: [], lineNumber };
  }
  const styleDefinition = body.match(/^@(node|flow|line|annotation|graph)\s+([a-zA-Z][\w-]*)$/);
  if (styleDefinition) return { type: styleDefinition[1] + "-definition", name: styleDefinition[2], classes: [], attrs: {}, text: "", children: [], lineNumber };
  const diagram = body.match(/^#(?:canvas|diagram)(?:\((.*)\))?$/);
  if (diagram) return { type: "diagram", classes: [], attrs: parseAttributes(diagram[1], lineNumber, errors), text: "", children: [], lineNumber };
  if (["graph", "node", "image", "flow"].includes(body)) return { type: body, classes: [], attrs: {}, text: "", children: [], lineNumber };
  if (/^[a-zA-Z][\w-]*$/.test(body)) return { type: "node-group", tag: body, classes: [], attrs: {}, text: "", children: [], lineNumber };

  const element = body.match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)+)(?:\((.*)\))?(?:\s+(.*))?$/);
  if (!element) {
    errors.push(`Line ${lineNumber}: expected a reusable definition, canvas setting, graph, structural declaration, or node field.`);
    return null;
  }
  const classes = [...element[2].matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  if (!element[1] && classes.length > 1 && !["line", "node", "annotation", "merge"].includes(classes[0])) {
    errors.push(`Line ${lineNumber}: structural declarations do not accept extra classes.`);
  }
  return {
    type: element[1] ? "field" : classes.join("."),
    tag: element[1] ?? null,
    classes,
    attrs: parseAttributes(element[3], lineNumber, errors),
    text: element[4] ?? "",
    children: [],
    lineNumber,
  };
}

function normalizeGroups(item, errors, nodeTypeNames, lineTypeNames) {
  item.children.forEach((child) => normalizeGroups(child, errors, nodeTypeNames, lineTypeNames));

  const expanded = [];
  let directChildBranch = null;
  const itemIsNode = item.type === "node-group" || item.type === "node" || nodeTypeNames.has(item.type);
  for (const child of item.children) {
    if (child.type === "defaults" && item.type === "diagram") {
      if (child.text || Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: .defaults is a group; put its fields on indented lines.`);
      expanded.push(...child.children);
      continue;
    }
    if (item.type === "defaults" && ["node", "flow", "line", "annotation"].includes(child.type)) {
      if (child.text || Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: .${child.type} is a defaults group; put its fields on indented lines.`);
      const prefix = child.type === "flow" ? "line" : child.type;
      for (const field of child.children) expanded.push({ ...field, type: `${prefix}.${field.type}`, classes: [prefix, field.type] });
      continue;
    }
    if (child.type === "line" && item.type !== "flow") {
      if (child.text || Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: .line is a group; put its fields on indented lines.`);
      for (const field of child.children) {
        expanded.push({ ...field, type: `line.${field.type}`, classes: ["line", field.type] });
      }
      continue;
    }
    if (lineTypeNames.has(child.type) && child.children.length) {
      expanded.push({ ...child, children: [] });
      for (const field of child.children) {
        expanded.push({ ...field, type: `line.${field.type}`, classes: ["line", field.type] });
      }
      continue;
    }
    if (item.type === "node" && nodeTypeNames.has(child.type)) {
      expanded.push({ ...child, children: [] });
      for (const field of child.children) expanded.push(field);
      continue;
    }
    if (child.type === "node-group" || child.type === "node" || child.type === "image" || nodeTypeNames.has(child.type)) {
      const isImage = child.type === "image";
      if (child.text || Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: ${isImage ? "image" : "node"} is a group; put its fields on indented lines.`);
      const nodeChildren = [];
      for (const field of child.children) {
        if (field.type === "annotation") {
          for (const annotation of field.children) {
            if (!["above", "below"].includes(annotation.type)) {
              errors.push(`Line ${annotation.lineNumber}: .annotation accepts .above and .below entries.`);
              continue;
            }
            nodeChildren.push({ ...annotation, type: "field", tag: "node", classes: ["annotation", annotation.type] });
          }
        } else if ((!isImage && field.type === "label") || (isImage ? IMAGE_PROPERTIES : BLOCK_PROPERTIES).has(field.type)) {
          nodeChildren.push({ ...field, type: "field", tag: isImage ? "image" : child.tag ?? (child.type === "node" ? "node" : child.type), classes: [field.type] });
        } else {
          nodeChildren.push(field);
        }
      }
      const entry = { type: "entry", classes: ["entry"], attrs: {}, text: "", children: nodeChildren, lineNumber: child.lineNumber, synthetic: true, objectType: isImage ? "image" : "node" };
      if (["branch", "merge", "flow", "graph"].includes(item.type)) {
        expanded.push(entry);
      } else if (itemIsNode) {
        if (!directChildBranch) {
          directChildBranch = { type: "branch", classes: ["branch"], attrs: {}, text: "", children: [], lineNumber: child.lineNumber, synthetic: true };
          expanded.push(directChildBranch);
        }
        directChildBranch.children.push(entry);
      } else {
        expanded.push(...nodeChildren);
      }
      continue;
    }
    if (itemIsNode && ["branch", "merge"].includes(child.type)) directChildBranch = null;
    expanded.push(child);
  }
  item.children = expanded;
}

function textFor(element, errors, allowedChildren = []) {
  const unexpected = element.children.filter((child) => child.type !== "text" && !allowedChildren.includes(child.type));
  if (unexpected.length) errors.push(`Line ${unexpected[0].lineNumber}: text fields accept indented | lines only.`);
  const lines = [];
  if (element.text) lines.push(element.text);
  lines.push(...element.children.filter((child) => child.type === "text").map((child) => child.text));
  return lines.join("\n");
}

function parseMarkupTree(source) {
  const roots = [];
  const stack = [];
  const errors = [];
  source.split(/\r?\n/).forEach((rawLine, index) => {
    const lineNumber = index + 1;
    if (!rawLine.trim() || rawLine.trimStart().startsWith("//")) return;
    const whitespace = rawLine.match(/^[\t ]*/)?.[0] ?? "";
    const width = indentationWidth(whitespace);
    if (width % 2) return errors.push(`Line ${lineNumber}: use two spaces (or one tab) per level.`);
    const depth = width / 2;
    if (depth > stack.length) return errors.push(`Line ${lineNumber}: indentation skipped a level.`);
    const item = parseMarkupLine(rawLine.trim(), lineNumber, errors);
    if (!item) return;
    if (depth === 0) roots.push(item);
    else stack[depth - 1].children.push(item);
    stack.length = depth;
    stack.push(item);
  });
  return { roots, errors };
}

function numberAttribute(value, fallback, minimum, name, lineNumber, errors) {
  if (value === undefined || value === "auto") return value ?? fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum) {
    errors.push(`Line ${lineNumber}: ${name} must be "auto" or at least ${minimum}.`);
    return fallback;
  }
  return number;
}

function offsetTuple(value, name, lineNumber, errors) {
  if (value === undefined) return { x: 0, y: 0 };
  const match = String(value).match(/^\(\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*,\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*\)$/);
  if (!match) {
    errors.push(`Line ${lineNumber}: ${name} must be a tuple such as (12, -8).`);
    return { x: 0, y: 0 };
  }
  return { x: Number(match[1]), y: Number(match[2]) };
}

/** Shared shadow parsing for blocks, flows, and graphs. */
function shadowStyle(attrs, defaults, lineNumber, errors, prefix = "") {
  const color = attrs[`${prefix}shadow-color`] ?? defaults.shadowColor ?? null;
  return {
    shadowColor: /^(?:none|transparent)$/i.test(color ?? "") ? null : color,
    shadowOffsetX: numberAttribute(attrs[`${prefix}shadow-offset-x`], defaults.shadowOffsetX ?? 4, -100, `${prefix}shadow-offset-x`, lineNumber, errors),
    shadowOffsetY: numberAttribute(attrs[`${prefix}shadow-offset-y`], defaults.shadowOffsetY ?? 5, -100, `${prefix}shadow-offset-y`, lineNumber, errors),
    shadowBlur: numberAttribute(attrs[`${prefix}shadow-blur`], defaults.shadowBlur ?? 6, 0, `${prefix}shadow-blur`, lineNumber, errors),
    shadowOpacity: numberAttribute(attrs[`${prefix}shadow-opacity`], defaults.shadowOpacity ?? 0.3, 0, `${prefix}shadow-opacity`, lineNumber, errors),
  };
}

function blockStyle(attrs, lineNumber, errors, defaults = {}) {
  const shape = attrs.shape ?? defaults.shape ?? "round";
  const outlineStyle = attrs["outline-style"] ?? defaults.outlineStyle ?? "solid";
  if (!SHAPES.has(shape)) errors.push(`Line ${lineNumber}: unknown block shape "${shape}".`);
  if (!LINE_STYLES.has(outlineStyle)) errors.push(`Line ${lineNumber}: unknown outline style "${outlineStyle}".`);
  const ports = Object.fromEntries(["top", "right", "bottom", "left"].map((face) => {
    const value = attrs[`${face}-ports`] ?? defaults.ports?.[face] ?? "shared";
    if (!PORT_DISTRIBUTIONS.has(value)) errors.push(`Line ${lineNumber}: ${face}-ports must be shared or distributed.`);
    return [face, PORT_DISTRIBUTIONS.has(value) ? value : "shared"];
  }));
  return {
    shape: SHAPES.has(shape) ? shape : "round",
    fill: attrs.fill ?? defaults.fill ?? "transparent",
    color: attrs.color ?? defaults.color ?? null,
    outline: attrs.outline ?? defaults.outline ?? "#000000",
    outlineStyle: LINE_STYLES.has(outlineStyle) ? outlineStyle : "solid",
    outlineWidth: numberAttribute(attrs["outline-width"], defaults.outlineWidth ?? 2, 0, "outline-width", lineNumber, errors),
    width: numberAttribute(attrs.width, defaults.width ?? "auto", 48, "width", lineNumber, errors),
    height: numberAttribute(attrs.height, defaults.height ?? "auto", 28, "height", lineNumber, errors),
    align: ["left", "center", "right"].includes(attrs.align) ? attrs.align : defaults.align ?? "center",
    verticalAlign: ["top", "middle", "bottom"].includes(attrs["vertical-align"]) ? attrs["vertical-align"] : defaults.verticalAlign ?? "middle",
    ports,
    ...shadowStyle(attrs, defaults, lineNumber, errors),
    fontFamily: attrs["font-family"] ?? defaults.fontFamily ?? null,
    fontSize: numberAttribute(attrs["font-size"], defaults.fontSize ?? 16, 1, "font-size", lineNumber, errors),
    fontWeight: attrs["font-weight"] ?? defaults.fontWeight ?? "normal",
    fontStyle: attrs["font-style"] ?? defaults.fontStyle ?? "normal",
    textDecoration: attrs["text-decoration"] ?? defaults.textDecoration ?? "none",
    textOutline: attrs["text-outline"] ?? defaults.textOutline ?? "transparent",
    textOutlineWidth: numberAttribute(attrs["text-outline-width"], defaults.textOutlineWidth ?? 0, 0, "text-outline-width", lineNumber, errors),
  };
}

function imageStyle(attrs, lineNumber, errors) {
  const style = blockStyle(attrs, lineNumber, errors, {
    shape: "square", fill: "transparent", outline: "transparent", width: 64, height: 64,
  });
  const fit = attrs.fit ?? "contain";
  if (!["contain", "cover", "fill"].includes(fit)) errors.push(`Line ${lineNumber}: image.fit must be contain, cover, or fill.`);
  return {
    ...style,
    source: attrs.source ?? "",
    fit: ["contain", "cover", "fill"].includes(fit) ? fit : "contain",
    opacity: numberAttribute(attrs.opacity, 1, 0, "image.opacity", lineNumber, errors),
    padding: numberAttribute(attrs.padding, 0, 0, "image.padding", lineNumber, errors),
  };
}

function hiddenElement(...elements) {
  return elements.some((element) => {
    if (!element) return false;
    const hidden = element.attrs?.hidden;
    return hidden !== undefined && ![false, "false", "no", "0"].includes(hidden);
  });
}

function figureStyle(attrs, lineColor = null, textColor = null) {
  return {
    background: attrs.background ?? null,
    label: lineColor,
    text: textColor,
    merge: null,
    annotation: attrs["annotation.color"] ?? null,
    font: attrs.font ?? null,
  };
}

function diagramSettingsFor(diagram, errors) {
  const settings = {};
  const block = {};
  const annotation = {};
  if (Object.keys(diagram.attrs).length) {
    errors.push(`Line ${diagram.lineNumber}: #canvas does not accept inline attributes; use indented default fields.`);
  }
  for (const child of diagram.children) {
    const blockProperty = child.type.startsWith("node.") ? child.type.slice(5) : null;
    const annotationProperty = child.type.startsWith("annotation.") ? child.type.slice(11) : null;
    const isFigureField = ["background", "font"].includes(child.type) || (annotationProperty && ANNOTATION_STYLE_FIELDS.has(annotationProperty));
    if (!isFigureField && !(blockProperty && BLOCK_STYLE_PROPERTIES.has(blockProperty))) continue;
    if (Object.keys(child.attrs).length || child.children.length) errors.push(`Line ${child.lineNumber}: .${child.type} must contain one plain-text value.`);
    const value = child.text.trim();
    if (!value) errors.push(`Line ${child.lineNumber}: .${child.type} needs a value.`);
    if (blockProperty) block[blockProperty] = value;
    else if (annotationProperty) annotation[annotationProperty] = value;
    else settings[child.type] = value;
  }
  if (annotation.color) settings["annotation.color"] = annotation.color;
  return { settings, block, annotation };
}

function edgeStyle(attrs, defaults, lineNumber, errors, lineStyles = new Map()) {
  const presetName = attrs["line.use"] ?? defaults.lineType ?? null;
  const preset = presetName ? lineStyles.get(presetName) : null;
  if (presetName && !preset) errors.push(`Line ${attrs.__lines?.["line.use"] ?? lineNumber}: unknown line style "${presetName}".`);
  const effective = { ...(preset?.attributes ?? {}), ...attrs };
  const style = effective["line.stroke-style"] ?? defaults.style ?? "solid";
  const resolvedDirection = effective["line.arrow-style"] ?? defaults.direction ?? "forward";
  if (!DIRECTIONS.has(resolvedDirection)) errors.push(`Line ${lineNumber}: unknown arrow direction "${resolvedDirection}".`);
  const resolvedArrowShape = effective["line.arrow-shape"] ?? defaults.arrowShape ?? "triangle";
  if (!ARROW_SHAPES.has(resolvedArrowShape)) errors.push(`Line ${lineNumber}: unknown arrow shape "${resolvedArrowShape}". Must be triangle, open, diamond, circle, or chunky.`);
  if (!LINE_STYLES.has(style)) errors.push(`Line ${lineNumber}: unknown line style "${style}".`);
  const layoutDirection = attrs.direction ?? defaults.layoutDirection ?? "right";
  if (!FLOW_DIRECTIONS.has(layoutDirection)) errors.push(`Line ${lineNumber}: direction must be right, left, up, or down.`);
  const faces = new Set(["top", "right", "bottom", "left"]);
  const sourceFace = effective["line.source-face"] ?? defaults.sourceFace ?? null;
  const targetFace = effective["line.target-face"] ?? defaults.targetFace ?? null;
  if (sourceFace && !faces.has(sourceFace)) errors.push(`Line ${lineNumber}: line.source-face must be top, right, bottom, or left.`);
  if (targetFace && !faces.has(targetFace)) errors.push(`Line ${lineNumber}: line.target-face must be top, right, bottom, or left.`);
  const sourceDirections = { top: "up", right: "right", bottom: "down", left: "left" };
  const targetDirections = { top: "down", right: "left", bottom: "up", left: "right" };
  const labelOffset = effective["line.label-offset"] !== undefined
    ? offsetTuple(effective["line.label-offset"], "line.label-offset", lineNumber, errors)
    : { x: defaults.labelOffsetX ?? 0, y: defaults.labelOffsetY ?? 0 };
  return {
    lineType: presetName,
    direction: DIRECTIONS.has(resolvedDirection) ? resolvedDirection : "forward",
    arrowShape: ARROW_SHAPES.has(resolvedArrowShape) ? resolvedArrowShape : "triangle",
    arrowHeight: numberAttribute(effective["line.arrow-height"], defaults.arrowHeight ?? 8, 1, "line.arrow-height", lineNumber, errors),
    arrowHeadWidth: numberAttribute(effective["line.arrow-head-width"], defaults.arrowHeadWidth ?? 16, 1, "line.arrow-head-width", lineNumber, errors),
    color: effective["line.color"] ?? defaults.color ?? null,
    outline: effective["line.outline"] ?? defaults.outline ?? "transparent",
    outlineWidth: numberAttribute(effective["line.outline-width"], defaults.outlineWidth ?? 0, 0, "line.outline-width", lineNumber, errors),
    style: LINE_STYLES.has(style) ? style : "solid",
    ...shadowStyle(effective, defaults, lineNumber, errors, "line."),
    width: numberAttribute(effective["line.width"], defaults.width ?? 2, 0.5, "line.width", lineNumber, errors),
    roundness: numberAttribute(effective["line.roundness"], defaults.roundness ?? 9, 0, "line.roundness", lineNumber, errors),
    label: effective["line.label"] ?? defaults.label ?? "",
    labelPosition: effective["line.label-position"] ?? defaults.labelPosition ?? "above",
    lineNumber,
    labelLineNumber: attrs["line.label"] !== undefined
      ? attrs.__lines?.["line.label"] ?? lineNumber
      : defaults.labelLineNumber ?? lineNumber,
    labelOffsetX: labelOffset.x,
    labelOffsetY: labelOffset.y,
    labelHidden: effective["line.label-hidden"] !== undefined && ![false, "false", "no", "0"].includes(effective["line.label-hidden"]),
    annotationAbove: effective["line.annotation-above"] ?? (effective["line.label-position"] !== "below" ? effective["line.label"] ?? "" : ""),
    annotationBelow: effective["line.annotation-below"] ?? (effective["line.label-position"] === "below" ? effective["line.label"] ?? "" : ""),
    annotationAboveLineNumber: attrs.__lines?.["line.annotation-above"] ?? attrs.__lines?.["line.label"] ?? lineNumber,
    annotationBelowLineNumber: attrs.__lines?.["line.annotation-below"] ?? attrs.__lines?.["line.label"] ?? lineNumber,
    annotationAboveHidden: effective["line.annotation-above-hidden"] !== undefined
      ? ![false, "false", "no", "0"].includes(effective["line.annotation-above-hidden"])
      : effective["line.annotation-above"] === undefined && effective["line.label-hidden"] !== undefined,
    annotationBelowHidden: effective["line.annotation-below-hidden"] !== undefined
      ? ![false, "false", "no", "0"].includes(effective["line.annotation-below-hidden"])
      : effective["line.annotation-below"] === undefined && effective["line.label-hidden"] !== undefined,
    layoutDirection: FLOW_DIRECTIONS.has(layoutDirection) ? layoutDirection : "right",
    sourceDirection: sourceDirections[sourceFace] ?? (FLOW_DIRECTIONS.has(layoutDirection) ? layoutDirection : "right"),
    targetLayoutDirection: targetDirections[targetFace] ?? defaults.targetLayoutDirection ?? null,
    sourceFace: faces.has(sourceFace) ? sourceFace : null,
    targetFace: faces.has(targetFace) ? targetFace : null,
    hidden: effective["line.hidden"] !== undefined && ![false, "false", "no", "0"].includes(effective["line.hidden"]),
    fontFamily: effective["line.font-family"] ?? defaults.fontFamily ?? null,
    fontSize: numberAttribute(effective["line.font-size"], defaults.fontSize ?? 12, 1, "line.font-size", lineNumber, errors),
    fontWeight: effective["line.font-weight"] ?? defaults.fontWeight ?? "normal",
    fontStyle: effective["line.font-style"] ?? defaults.fontStyle ?? "normal",
    textDecoration: effective["line.text-decoration"] ?? defaults.textDecoration ?? "none",
    textOutline: effective["line.text-outline"] ?? defaults.textOutline ?? "transparent",
    textOutlineWidth: numberAttribute(effective["line.text-outline-width"], defaults.textOutlineWidth ?? 0, 0, "line.text-outline-width", lineNumber, errors),
    annotationAboveStyle: annotationFlowStyle(effective, "above", defaults, lineNumber, errors),
    annotationBelowStyle: annotationFlowStyle(effective, "below", defaults, lineNumber, errors),
  };
}

function annotationFlowStyle(effective, position, defaults, lineNumber, errors) {
  const field = (name) => effective[`line.annotation-${position}-${name}`];
  return {
    color: field("color") ?? effective["line.color"] ?? defaults.color ?? null,
    fontFamily: field("font-family") ?? effective["line.font-family"] ?? defaults.fontFamily ?? null,
    fontSize: numberAttribute(field("font-size"), effective["line.font-size"] ?? defaults.fontSize ?? 12, 1, `line.annotation-${position}-font-size`, lineNumber, errors),
    fontWeight: field("font-weight") ?? effective["line.font-weight"] ?? defaults.fontWeight ?? "normal",
    fontStyle: field("font-style") ?? effective["line.font-style"] ?? defaults.fontStyle ?? "normal",
    textDecoration: field("text-decoration") ?? effective["line.text-decoration"] ?? defaults.textDecoration ?? "none",
    textOutline: field("text-outline") ?? effective["line.text-outline"] ?? defaults.textOutline ?? "transparent",
    textOutlineWidth: numberAttribute(field("text-outline-width"), effective["line.text-outline-width"] ?? defaults.textOutlineWidth ?? 0, 0, `line.annotation-${position}-text-outline-width`, lineNumber, errors),
  };
}

function connectionAttributesFor(container, errors, extras = [], rejectInline = true, lineStyles = new Map(), knownStyles = new Set(lineStyles.keys())) {
  const directFlowFields = container.type === "flow" ? FLOW_STYLE_FIELDS : new Set();
  const allowed = new Set([...LINE_FIELDS, ...directFlowFields, ...extras]);
  const nested = {
    diagram: new Set(["graph", "branch", "merge", "flow", "connect", "background", "font", ...[...ANNOTATION_STYLE_FIELDS].map((field) => `annotation.${field}`)]),
    graph: new Set(["graph", "branch", "merge", "flow", "connect"]),
    branch: new Set(["entry"]),
    entry: new Set(["graph", "branch", "merge", "flow", "connect"]),
    flow: new Set(["entry", "annotation"]),
    merge: new Set(["source", "entry"]),
    source: new Set(),
  }[container.type] ?? new Set();
  const attributes = {};
  const lines = {};
  if (rejectInline && Object.keys(container.attrs).length) {
    errors.push(`Line ${container.lineNumber}: .${container.type} does not accept inline attributes; use indented fields.`);
  }
  for (const child of container.children.filter((item) => item.type.startsWith("line.") && !allowed.has(item.type))) {
    errors.push(`Line ${child.lineNumber}: unknown line field ".${child.type}".`);
  }
  for (const child of container.children.filter((item) =>
    item.type !== "field"
    && item.type !== "text"
    && !item.type.startsWith("line.")
    && !allowed.has(item.type)
    && !nested.has(item.type)
    && !knownStyles.has(item.type)
    && !(container.type === "diagram" && item.type.startsWith("node.")))) {
    if (["diagram", "graph"].includes(container.type) && /^[a-zA-Z][\w-]*$/.test(child.type)) {
      errors.push(`Line ${child.lineNumber}: unknown node style ".${child.type}". Open the companion CSS file that defines it, or add an @node ${child.type} definition.`);
    } else errors.push(`Line ${child.lineNumber}: ".${child.type}" is not valid inside .${container.type}.`);
  }
  const presetChildren = container.children.filter((item) => lineStyles.has(item.type));
  if (presetChildren.length > 1) errors.push(`Line ${presetChildren[1].lineNumber}: only one reusable line class may be applied here.`);
  if (presetChildren[0]) {
    attributes["line.use"] = presetChildren[0].type;
    lines["line.use"] = presetChildren[0].lineNumber;
  }
  for (const child of container.children.filter((item) => allowed.has(item.type))) {
    const type = directFlowFields.has(child.type) ? `line.${child.type}` : child.type;
    if (Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: .${child.type} takes plain text, not attributes.`);
    if (attributes[type] !== undefined) errors.push(`Line ${child.lineNumber}: duplicate .${child.type} field.`);
    attributes[type] = ["line.label", "line.annotation-above", "line.annotation-below"].includes(type) ? textFor(child, errors) : child.text.trim();
    lines[type] = child.lineNumber;
    if (!["line.label", "line.annotation-above", "line.annotation-below"].includes(type) && child.children.length) errors.push(`Line ${child.lineNumber}: .${child.type} must stay on one line.`);
  }
  Object.defineProperty(attributes, "__lines", { value: lines });
  return attributes;
}

function annotationsFor(container, errors, annotationStyles, defaults = {}) {
  return container.children
    .filter((child) => child.type === "annotation" || child.type === "field" && child.classes.includes("annotation"))
    .map((child) => {
      if (Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: annotations do not accept inline attributes; use indented .color and .offset fields.`);
      const presetFields = child.children.filter((item) => annotationStyles.has(item.type));
      if (presetFields.length > 1) errors.push(`Line ${presetFields[1].lineNumber}: only one reusable annotation class may be applied here.`);
      const preset = annotationStyles.get(presetFields[0]?.type) ?? {};
      const colorFields = child.children.filter((item) => item.type === "color");
      const offsetFields = child.children.filter((item) => item.type === "offset");
      const hiddenFields = child.children.filter((item) => item.type === "hidden");
      const textFields = Object.fromEntries(["font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width"].map((name) => [name, child.children.find((item) => item.type === name)]));
      if (colorFields.length > 1) errors.push(`Line ${colorFields[1].lineNumber}: duplicate .color field.`);
      if (offsetFields.length > 1) errors.push(`Line ${offsetFields[1].lineNumber}: duplicate .offset field.`);
      for (const field of [...colorFields, ...offsetFields, ...hiddenFields]) {
        if (Object.keys(field.attrs).length || field.children.length) errors.push(`Line ${field.lineNumber}: .${field.type} must contain one plain-text value.`);
      }
      const colorField = colorFields[0];
      const offsetField = offsetFields[0];
      const offset = offsetField ? offsetTuple(offsetField.text.trim(), "offset", offsetField.lineNumber, errors) : preset.offset ?? { x: 0, y: 0 };
      return {
        text: textFor(child, errors, ["color", "offset", "hidden", ...Object.keys(textFields), ...annotationStyles.keys()]),
        position: child.classes?.includes("below") ? "below" : "above",
        color: colorField?.text.trim() ?? preset.color ?? defaults.color ?? null,
        lineNumber: child.lineNumber,
        offsetX: offset.x,
        offsetY: offset.y,
        hidden: Boolean(hiddenFields.length && !["false", "no", "0"].includes(hiddenFields[0].text.trim())),
        fontFamily: textFields["font-family"]?.text.trim() ?? preset.fontFamily ?? defaults.fontFamily ?? null,
        fontSize: numberAttribute(textFields["font-size"]?.text.trim(), preset.fontSize ?? defaults.fontSize ?? 12, 1, "font-size", child.lineNumber, errors),
        fontWeight: textFields["font-weight"]?.text.trim() ?? preset.fontWeight ?? defaults.fontWeight ?? "normal",
        fontStyle: textFields["font-style"]?.text.trim() ?? preset.fontStyle ?? defaults.fontStyle ?? "normal",
        textDecoration: textFields["text-decoration"]?.text.trim() ?? preset.textDecoration ?? defaults.textDecoration ?? "none",
        textOutline: textFields["text-outline"]?.text.trim() ?? preset.textOutline ?? defaults.textOutline ?? "transparent",
        textOutlineWidth: numberAttribute(textFields["text-outline-width"]?.text.trim(), preset.textOutlineWidth ?? defaults.textOutlineWidth ?? 0, 0, "text-outline-width", child.lineNumber, errors),
      };
    });
}

function blockAttributesFor(container, labelElement, errors) {
  const attributes = {};
  if (Object.keys(labelElement.attrs).length) {
    errors.push(`Line ${labelElement.lineNumber}: node.label does not accept attributes; use separate node property lines.`);
  }

  container.children
    .filter((child) => child.type === "field" && child !== labelElement && !child.classes.includes("annotation"))
    .forEach((child) => {
      const property = child.classes.find((name) => BLOCK_PROPERTIES.has(name));
      if (!property) {
        errors.push(`Line ${child.lineNumber}: unknown node property "${child.classes.join(".")}".`);
        return;
      }
      if (Object.keys(child.attrs).length) {
        errors.push(`Line ${child.lineNumber}: node.${property} takes its value as text, not attributes.`);
      }
      if (child.children.length) errors.push(`Line ${child.lineNumber}: node.${property} must stay on one line.`);
      const textValue = child.text.trim();
      attributes[property] = child.attrs.value ?? (textValue || true);
    });
  return attributes;
}

function imageAttributesFor(container, errors) {
  const attributes = {};
  container.children.filter((child) => child.type === "field" && !child.classes.includes("annotation")).forEach((child) => {
    const property = child.classes.find((name) => IMAGE_PROPERTIES.has(name));
    if (!property) {
      errors.push(`Line ${child.lineNumber}: unknown image property "${child.classes.join(".")}".`);
      return;
    }
    if (Object.keys(child.attrs).length || child.children.length) errors.push(`Line ${child.lineNumber}: image.${property} must contain one plain-text value.`);
    attributes[property] = child.text.trim() || true;
  });
  return attributes;
}

function customNodeStyles(tree, blockDefaults, errors) {
  const definitions = new Map();
  for (const definition of tree.roots.filter((root) => root.type === "node-definition")) {
    if (definitions.has(definition.name) || definition.name === "node") {
      errors.push(`Line ${definition.lineNumber}: node type "${definition.name}" is already defined.`);
      continue;
    }
    const attributes = {};
    for (const child of definition.children) {
      const property = child.type === "field" && child.tag === "node" ? child.classes[0] : child.type;
      if (!BLOCK_STYLE_PROPERTIES.has(property)) {
        errors.push(`Line ${child.lineNumber}: @node definitions accept .shape, .fill, .color, and other node styling fields only.`);
        continue;
      }
      if (Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: .${property} takes its value as text, not attributes.`);
      if (child.children.length) errors.push(`Line ${child.lineNumber}: reusable style fields must stay on one line.`);
      attributes[property] = child.text.trim() || true;
    }
    definitions.set(definition.name, blockStyle(attributes, definition.lineNumber, errors, blockDefaults));
  }
  return definitions;
}

function customLineStyles(tree, errors) {
  const definitions = new Map();
  for (const definition of tree.roots.filter((root) => ["flow-definition", "line-definition"].includes(root.type))) {
    const attributes = {};
    const lines = {};
    for (const child of definition.children) {
      const field = LINE_DEFINITION_FIELDS.get(child.type);
      if (!field) {
        errors.push(`Line ${child.lineNumber}: unknown @flow style field .${child.type}.`);
        continue;
      }
      if (Object.keys(child.attrs).length || child.children.length) errors.push(`Line ${child.lineNumber}: .${child.type} must contain one plain-text value.`);
      attributes[field] = child.text.trim();
      lines[field] = child.lineNumber;
    }
    Object.defineProperty(attributes, "__lines", { value: lines });
    definitions.set(definition.name, { attributes, lineNumber: definition.lineNumber });
    edgeStyle(attributes, {}, definition.lineNumber, errors);
  }
  return definitions;
}

const GRAPH_DEFAULTS = {
  labelPosition: "inside", labelOffsetX: 0, labelOffsetY: 0, align: "center", verticalAlign: "top", placement: "below", fill: "transparent", color: null,
  outline: "transparent", outlineStyle: "solid", outlineWidth: 1.5, width: 0, height: 0, padding: 24, xSpacing: 60, ySpacing: 40,
  shadowColor: null, shadowOffsetX: 4, shadowOffsetY: 5, shadowBlur: 6, shadowOpacity: 0.3,
  fontFamily: null, fontSize: 13, fontWeight: "600", fontStyle: "normal", textDecoration: "none",
  textOutline: "transparent", textOutlineWidth: 0,
};

function camelCase(name) {
  return name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase());
}

/** Convert a reusable @graph definition's raw fields into a graph-shaped model. */
function graphPresetModel(attributes) {
  return { ...GRAPH_DEFAULTS, ...Object.fromEntries(Object.entries(attributes).map(([name, value]) => [camelCase(name), value])) };
}

function customGraphStyles(tree, errors) {
  const definitions = new Map();
  for (const definition of tree.roots.filter((root) => root.type === "graph-definition")) {
    if (definitions.has(definition.name)) {
      errors.push(`Line ${definition.lineNumber}: graph type "${definition.name}" is already defined.`);
      continue;
    }
    const attributes = {};
    for (const child of definition.children) {
      if (!GRAPH_STYLE_PROPERTIES.has(child.type)) {
        errors.push(`Line ${child.lineNumber}: unknown @graph style field .${child.type}.`);
        continue;
      }
      if (Object.keys(child.attrs).length || child.children.length) errors.push(`Line ${child.lineNumber}: .${child.type} must contain one plain-text value.`);
      attributes[child.type] = child.text.trim();
    }
    Object.defineProperty(attributes, "__lineNumber", { value: definition.lineNumber });
    definitions.set(definition.name, attributes);
  }
  return definitions;
}

function customAnnotationStyles(tree, errors) {
  const definitions = new Map();
  for (const definition of tree.roots.filter((root) => root.type === "annotation-definition")) {
    const style = {};
    for (const child of definition.children) {
      if (!["color", "offset", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width"].includes(child.type)) {
        errors.push(`Line ${child.lineNumber}: unknown @annotation style field .${child.type}.`);
        continue;
      }
      if (Object.keys(child.attrs).length || child.children.length) errors.push(`Line ${child.lineNumber}: .${child.type} must contain one plain-text value.`);
      if (child.type === "color") style.color = child.text.trim();
      else if (child.type === "offset") style.offset = offsetTuple(child.text.trim(), "offset", child.lineNumber, errors);
      else if (child.type === "font-size") style.fontSize = numberAttribute(child.text.trim(), 12, 1, "font-size", child.lineNumber, errors);
      else if (child.type === "text-outline-width") style.textOutlineWidth = numberAttribute(child.text.trim(), 0, 0, "text-outline-width", child.lineNumber, errors);
      else style[child.type.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())] = child.text.trim();
    }
    definitions.set(definition.name, style);
  }
  return definitions;
}

function validateStyleNames(...definitionMaps) {
  const errors = [];
  const used = new Set();
  for (const definitions of definitionMaps) {
    for (const [name, definition] of definitions) {
      if (used.has(name)) errors.push(`Line ${definition.lineNumber ?? definition.__lineNumber ?? 1}: reusable class ".${name}" is already defined by another style type.`);
      used.add(name);
    }
  }
  return errors;
}

function automaticId(label, usedIds) {
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "block";
  let id = stem;
  let suffix = 2;
  while (usedIds.has(id)) id = `${stem}-${suffix++}`;
  return id;
}

function compileMarkup(tree) {
  const errors = [...tree.errors];
  const nodes = [];
  const edges = [];
  const groups = [];
  const pendingFlows = [];
  const nodesById = new Map();
  const diagramRoot = tree.roots.find((root) => root.type === "diagram") ?? null;
  const diagramSettings = diagramRoot ? diagramSettingsFor(diagramRoot, errors) : { settings: {}, block: {}, annotation: {} };
  const annotationDefaults = Object.fromEntries(Object.entries(diagramSettings.annotation ?? {}).map(([name, value]) => [name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), value]));
  const blockDefaults = diagramRoot ? blockStyle(diagramSettings.block, diagramRoot.lineNumber, errors) : blockStyle({}, 1, errors);
  const nodeStyles = customNodeStyles(tree, blockDefaults, errors);
  const lineStyles = customLineStyles(tree, errors);
  const annotationStyles = customAnnotationStyles(tree, errors);
  const graphStyles = customGraphStyles(tree, errors);
  const knownStyles = new Set([...nodeStyles.keys(), ...lineStyles.keys(), ...annotationStyles.keys(), ...graphStyles.keys()]);
  const edgeDefaults = diagramRoot ? edgeStyle(connectionAttributesFor(diagramRoot, errors, [], false, lineStyles, knownStyles), {}, diagramRoot.lineNumber, errors, lineStyles) : edgeStyle({}, {}, 1, errors, lineStyles);
  const figure = diagramRoot ? figureStyle(diagramSettings.settings, edgeDefaults.color, blockDefaults.color) : {};
  errors.push(...validateStyleNames(nodeStyles, lineStyles, annotationStyles, graphStyles));

  /** Effective defaults and resolved reusable styles, used by editors to store only overrides. */
  function styleBaselines() {
    const ignored = [];
    return {
      defaults: {
        node: blockDefaults,
        flow: edgeDefaults,
        annotation: annotationDefaults,
        graph: GRAPH_DEFAULTS,
      },
      presets: {
        node: Object.fromEntries(nodeStyles),
        flow: Object.fromEntries([...lineStyles].map(([name, definition]) =>
          [name, edgeStyle(definition.attributes, edgeDefaults, definition.lineNumber, ignored, lineStyles)])),
        annotation: Object.fromEntries(annotationStyles),
        graph: Object.fromEntries([...graphStyles].map(([name, attributes]) => [name, graphPresetModel(attributes)])),
      },
    };
  }

  function createNode(container, labelElement) {
    const label = labelElement ? textFor(labelElement, errors) : "";
    if (!labelElement) {
      errors.push(`Line ${container.lineNumber}: every diagram/entry needs a node.label.`);
      return null;
    }

    const attributes = blockAttributesFor(container, labelElement, errors);
    const foreignTags = [...new Set(container.children
      .filter((child) => child.type === "field" && child.tag !== "node")
      .map((child) => child.tag))];
    for (const tag of foreignTags) {
      if (!nodeStyles.has(tag)) errors.push(`Line ${labelElement.lineNumber}: unknown node type "${tag}".`);
    }
    const customTags = container.children
      .filter((child) => child.type === "field" && child.tag !== "node" && nodeStyles.has(child.tag))
      .map((child) => child.tag);
    const customClasses = container.children.filter((child) => nodeStyles.has(child.type));
    const appliedStyles = [...new Set([...customTags, ...customClasses.map((child) => child.type)])];
    if (appliedStyles.length > 1) errors.push(`Line ${customClasses[1]?.lineNumber ?? labelElement.lineNumber}: only one reusable node class may be applied here.`);
    const customDefaults = nodeStyles.get(appliedStyles[0]) ?? blockDefaults;
    const offset = offsetTuple(attributes.offset, "node.offset", labelElement.lineNumber, errors);
    const labelOffset = offsetTuple(attributes["label-offset"], "node.label-offset", labelElement.lineNumber, errors);
    const requestedId = attributes.id;
    const layerText = attributes.layer;
    const explicitLayer = layerText !== undefined;
    const layer = explicitLayer ? Number(layerText) : 0;
    if (explicitLayer && !Number.isInteger(layer)) errors.push(`Line ${labelElement.lineNumber}: node.layer must be an integer.`);
    if (requestedId && !ID_PATTERN.test(requestedId)) errors.push(`Line ${labelElement.lineNumber}: "${requestedId}" is not a valid ID.`);
    const id = requestedId ?? automaticId(label, nodesById);
    if (nodesById.has(id)) {
      errors.push(`Line ${labelElement.lineNumber}: the ID "${id}" is already in use.`);
      return null;
    }
    const node = {
      id,
      explicitId: requestedId ?? "",
      nodeType: appliedStyles[0] ?? null,
      label,
      annotations: annotationsFor(container, errors, annotationStyles, annotationDefaults),
      style: blockStyle(attributes, labelElement.lineNumber, errors, customDefaults),
      hidden: hiddenElement({ attrs: attributes }),
      offsetX: offset.x,
      offsetY: offset.y,
      labelOffsetX: labelOffset.x,
      labelOffsetY: labelOffset.y,
      layer: Number.isInteger(layer) ? layer : 0,
      explicitLayer,
      sourceIndex: nodes.length,
      lineNumber: labelElement.lineNumber,
      kind: "block",
    };
    nodes.push(node);
    nodesById.set(id, node);
    return node;
  }

  function createImage(container) {
    const attributes = imageAttributesFor(container, errors);
    const requestedId = attributes.id;
    if (!attributes.source || attributes.source === true) errors.push(`Line ${container.lineNumber}: every image needs a .source.`);
    if (requestedId && !ID_PATTERN.test(requestedId)) errors.push(`Line ${container.lineNumber}: "${requestedId}" is not a valid ID.`);
    const id = requestedId ?? automaticId("image", nodesById);
    if (nodesById.has(id)) {
      errors.push(`Line ${container.lineNumber}: the ID "${id}" is already in use.`);
      return null;
    }
    const offset = offsetTuple(attributes.offset, "image.offset", container.lineNumber, errors);
    const layer = attributes.layer === undefined ? 0 : Number(attributes.layer);
    if (!Number.isInteger(layer)) errors.push(`Line ${container.lineNumber}: image.layer must be an integer.`);
    const image = {
      id, explicitId: requestedId ?? "", nodeType: null, label: "", annotations: annotationsFor(container, errors, annotationStyles, annotationDefaults),
      style: imageStyle(attributes, container.lineNumber, errors), hidden: hiddenElement({ attrs: attributes }),
      offsetX: offset.x, offsetY: offset.y, labelOffsetX: 0, labelOffsetY: 0,
      layer: Number.isInteger(layer) ? layer : 0, explicitLayer: attributes.layer !== undefined,
      sourceIndex: nodes.length, lineNumber: container.lineNumber, kind: "image",
    };
    nodes.push(image);
    nodesById.set(id, image);
    return image;
  }

  function buildEntry(entry, parent, branchDefaults = {}) {
    if (entry.objectType === "image") return createImage(entry);
    const label = entry.children.find((child) => child.type === "field" && child.classes.includes("label"));
    const node = createNode(entry, label);
    if (!node) return null;
    if (parent) edges.push({ from: parent.id, to: node.id, kind: "branch", declarationKind: "node", ...edgeStyle(connectionAttributesFor(entry, errors, [], true, lineStyles, knownStyles), branchDefaults, entry.lineNumber, errors, lineStyles) });
    processChildren(entry, node);
    return node;
  }

  function buildBranch(branch, parent) {
    if (!branch.synthetic) {
      errors.push(`Line ${branch.lineNumber}: .branch has been removed; use multiple .flow groups or directly nested nodes.`);
      return;
    }
    const defaults = edgeStyle(connectionAttributesFor(branch, errors, ["direction"], true, lineStyles, knownStyles), edgeDefaults, branch.lineNumber, errors, lineStyles);
    const entries = branch.children.filter((child) => child.type === "entry");
    if (!entries.length) errors.push(`Line ${branch.lineNumber}: a branch needs at least one .entry.`);
    entries.forEach((entry) => buildEntry(entry, parent, defaults));
  }

  function buildFlow(flow, graphId = null) {
    const attributes = connectionAttributesFor(flow, errors, ["id", "from", "to", "from-direction", "to-direction", "direction"], true, lineStyles, knownStyles);
    const defaults = edgeStyle(attributes, edgeDefaults, flow.lineNumber, errors, lineStyles);
    const explicitAnnotations = annotationsFor(flow, errors, annotationStyles, annotationDefaults);
    const legacyAnnotations = [
      defaults.annotationAbove ? { text: defaults.annotationAbove, position: "above", lineNumber: defaults.annotationAboveLineNumber, offsetX: defaults.labelOffsetX, offsetY: defaults.labelOffsetY, hidden: defaults.annotationAboveHidden, legacy: true, ...defaults.annotationAboveStyle } : null,
      defaults.annotationBelow ? { text: defaults.annotationBelow, position: "below", lineNumber: defaults.annotationBelowLineNumber, offsetX: defaults.labelOffsetX, offsetY: defaults.labelOffsetY, hidden: defaults.annotationBelowHidden, legacy: true, ...defaults.annotationBelowStyle } : null,
    ].filter(Boolean);
    defaults.annotations = [...legacyAnnotations, ...explicitAnnotations];
    const entries = flow.children.filter((child) => child.type === "entry");
    if (entries.length) errors.push(`Line ${flow.lineNumber}: flows cannot contain nodes or images; declare objects directly in a graph and reference them with .from and .to.`);
    pendingFlows.push({ flow, attributes, defaults, graphId });
  }

  function buildSubdiagram(component) {
    const entries = component.children.filter((child) => child.type === "entry");
    const members = component.children.find((child) => child.type === "members");
    if (members) errors.push(`Line ${members.lineNumber}: .members has been removed; move each node declaration directly into its graph.`);
    const before = nodes.length;
    const edgeBefore = edges.length;
    const graphPresetChildren = component.children.filter((child) => graphStyles.has(child.type));
    if (graphPresetChildren.length > 1) errors.push(`Line ${graphPresetChildren[1].lineNumber}: only one reusable graph class may be applied here.`);
    const graphType = graphPresetChildren[0]?.type ?? null;
    const graphPreset = graphStyles.get(graphType) ?? {};
    const directNodes = entries.map((entry) => buildEntry(entry, null)).filter(Boolean);
    directNodes.forEach((node, index) => {
      if (!node.explicitLayer) node.layer = index;
    });
    const field = (name) => component.children.find((child) => child.type === name)?.text.trim() ?? graphPreset[name];
    const graphOffset = offsetTuple(field("offset"), "graph.offset", component.lineNumber, errors);
    const frameOffset = offsetTuple(field("frame-offset"), "graph.frame-offset", component.lineNumber, errors);
    const labelOffset = offsetTuple(field("label-offset"), "graph.label-offset", component.lineNumber, errors);
    const layerText = field("layer");
    const layer = layerText === undefined || layerText === "" ? 0 : Number(layerText);
    if (!Number.isInteger(layer)) errors.push(`Line ${component.lineNumber}: graph.layer must be an integer.`);
    const labelPosition = field("label-position") || "inside";
    const align = field("align") || "center";
    const verticalAlign = field("vertical-align") || "top";
    const placement = field("placement") || "below";
    if (!["inside", "outside"].includes(labelPosition)) errors.push(`Line ${component.lineNumber}: graph.label-position must be inside or outside.`);
    if (!["left", "center", "right"].includes(align)) errors.push(`Line ${component.lineNumber}: graph.align must be left, center, or right.`);
    if (!["top", "middle", "bottom"].includes(verticalAlign)) errors.push(`Line ${component.lineNumber}: graph.vertical-align must be top, middle, or bottom.`);
    if (!["above", "below", "left", "right"].includes(placement)) errors.push(`Line ${component.lineNumber}: graph.placement must be above, below, left, or right.`);
    const hiddenField = component.children.find((child) => child.type === "hidden");
    const hidden = Boolean(hiddenField && !["false", "no", "0"].includes(hiddenField.text.trim()));
    if (hidden) {
      nodes.slice(before).forEach((node) => { node.hidden = true; });
      edges.slice(edgeBefore).forEach((edge) => { edge.hidden = true; });
    }
    const group = {
      id: field("id") || `diagram-${groups.length + 1}`,
      graphType,
      label: field("label") || "",
      labelPosition: ["inside", "outside"].includes(labelPosition) ? labelPosition : "inside",
      labelOffsetX: labelOffset.x,
      labelOffsetY: labelOffset.y,
      align: ["left", "center", "right"].includes(align) ? align : "center",
      verticalAlign: ["top", "middle", "bottom"].includes(verticalAlign) ? verticalAlign : "top",
      fill: field("fill") || "transparent",
      color: field("color") || null,
      fontFamily: field("font-family") || null,
      fontSize: numberAttribute(field("font-size"), 13, 1, "graph.font-size", component.lineNumber, errors),
      fontWeight: field("font-weight") || "600",
      fontStyle: field("font-style") || "normal",
      textDecoration: field("text-decoration") || "none",
      textOutline: field("text-outline") || "transparent",
      textOutlineWidth: numberAttribute(field("text-outline-width"), 0, 0, "graph.text-outline-width", component.lineNumber, errors),
      outline: field("outline") || "transparent",
      outlineStyle: field("outline-style") || "solid",
      outlineWidth: Number(field("outline-width") || 1.5),
      width: numberAttribute(field("width"), 0, 0, "graph.width", component.lineNumber, errors),
      height: numberAttribute(field("height"), 0, 0, "graph.height", component.lineNumber, errors),
      padding: Number(field("padding") || 24),
      xSpacing: numberAttribute(field("x-spacing"), 60, 0, "graph.x-spacing", component.lineNumber, errors),
      ySpacing: numberAttribute(field("y-spacing"), 40, 0, "graph.y-spacing", component.lineNumber, errors),
      ...shadowStyle(Object.fromEntries(["shadow-color", "shadow-offset-x", "shadow-offset-y", "shadow-blur", "shadow-opacity"]
        .map((name) => [name, field(name) || undefined])), {}, component.lineNumber, errors),
      placement: ["above", "below", "left", "right"].includes(placement) ? placement : "below",
      relativeTo: field("relative-to") || null,
      rootId: directNodes[0]?.id ?? null,
      hidden,
      offsetX: graphOffset.x,
      offsetY: graphOffset.y,
      frameOffsetX: frameOffset.x,
      frameOffsetY: frameOffset.y,
      layer: Number.isInteger(layer) ? layer : 0,
      nodeIds: nodes.slice(before).map((node) => node.id),
      sourceIndex: groups.length,
      lineNumber: component.lineNumber,
    };
    groups.push(group);
    component.children.filter((child) => child.type === "flow").forEach((flow) => buildFlow(flow, group.id));
    component.children.filter((child) => ["branch", "merge", "connect"].includes(child.type)).forEach((child) => {
      errors.push(`Line ${child.lineNumber}: .${child.type} has been removed; declare a .flow with .from and .to instead.`);
    });
    entries.forEach((entry) => {
      const nested = entry.children.find((child) => ["branch", "flow", "merge", "connect", "entry"].includes(child.type));
      if (nested) errors.push(`Line ${nested.lineNumber}: nodes cannot contain nodes or flows, and images must also be declared directly in graph.`);
    });
  }

  function buildMerge(merge) {
    const targetEntry = merge.children.find((child) => child.type === "entry");
    if (!targetEntry) return errors.push(`Line ${merge.lineNumber}: a merge needs one target .entry.`);
    const label = targetEntry.children.find((child) => child.type === "field" && child.classes.includes("label"));
    const target = createNode(targetEntry, label);
    if (!target) return;
    target.kind = "merge";
    const explicitSources = merge.children.filter((child) => child.type === "source");
    const mergeAttributes = connectionAttributesFor(merge, errors, ["from", "direction"], true, lineStyles, knownStyles);
    const shorthand = String(mergeAttributes.from ?? "").split(/[\s,]+/).filter(Boolean).map((ref) => ({ type: "source", children: [{ type: "ref", text: ref, attrs: {}, children: [], lineNumber: mergeAttributes.__lines.from }], attrs: {}, lineNumber: merge.lineNumber }));
    const sources = explicitSources.length ? explicitSources : shorthand;
    if (sources.length < 2) errors.push(`Line ${merge.lineNumber}: a merge needs at least two .source lines or from IDs.`);
    const defaults = edgeStyle(mergeAttributes, { ...edgeDefaults, color: edgeDefaults.color ?? "merge" }, merge.lineNumber, errors, lineStyles);
    sources.forEach((source) => {
      const sourceAttributes = connectionAttributesFor(source, errors, ["ref", "direction"], true, lineStyles, knownStyles);
      const ref = sourceAttributes.ref;
      if (!ref || !nodesById.has(ref)) return errors.push(`Line ${source.lineNumber}: merge source "${ref || "(missing)"}" has not been defined yet.`);
      edges.push({ from: ref, to: target.id, kind: "merge", declarationKind: "merge", mergeId: target.id, ...edgeStyle(sourceAttributes, defaults, source.lineNumber, errors, lineStyles) });
    });
    processChildren(targetEntry, target);
  }

  function buildConnect(connect) {
    const attributes = connectionAttributesFor(connect, errors, ["from", "to", "from-direction", "to-direction"], true, lineStyles, knownStyles);
    const from = attributes.from;
    const to = attributes.to;
    if (!from || !nodesById.has(from)) errors.push(`Line ${connect.lineNumber}: connection source "${from || "(missing)"}" has not been defined yet.`);
    if (!to || !nodesById.has(to)) errors.push(`Line ${connect.lineNumber}: connection target "${to || "(missing)"}" has not been defined yet.`);
    if (from && to && nodesById.has(from) && nodesById.has(to)) {
      const fromDirection = attributes["from-direction"] ?? "right";
      const toDirection = attributes["to-direction"] ?? fromDirection;
      if (!FLOW_DIRECTIONS.has(fromDirection)) errors.push(`Line ${connect.lineNumber}: from-direction must be right, left, up, or down.`);
      if (!FLOW_DIRECTIONS.has(toDirection)) errors.push(`Line ${connect.lineNumber}: to-direction must be right, left, up, or down.`);
      const style = edgeStyle(attributes, edgeDefaults, connect.lineNumber, errors, lineStyles);
      edges.push({ from, to, kind: "connection", declarationKind: "connect", ...style,
        layoutDirection: FLOW_DIRECTIONS.has(fromDirection) ? fromDirection : "right",
        sourceDirection: style.sourceFace ? style.sourceDirection : (FLOW_DIRECTIONS.has(fromDirection) ? fromDirection : "right"),
        targetLayoutDirection: style.targetFace ? style.targetLayoutDirection : (FLOW_DIRECTIONS.has(toDirection) ? toDirection : fromDirection) });
    }
  }

  function processChildren(container, parent) {
    container.children.forEach((child) => {
      if (child.type === "flow") buildFlow(child, null);
      else if (child.type === "graph") {
        if (container.type !== "diagram") errors.push(`Line ${child.lineNumber}: graphs cannot be nested; place every graph directly at the source root.`);
        else buildSubdiagram(child);
      }
      else if (["branch", "merge", "connect"].includes(child.type)) errors.push(`Line ${child.lineNumber}: .${child.type} has been removed; declare a .flow with .from and .to instead.`);
    });
  }

  const diagramRoots = tree.roots.filter((root) => root.type === "diagram");
  const definitionTypes = new Set(["node-definition", "flow-definition", "line-definition", "annotation-definition", "graph-definition"]);
  const unexpectedRoots = tree.roots.filter((root) => !definitionTypes.has(root.type) && root.type !== "diagram");
  const definitionAfterDiagram = diagramRoot && tree.roots.some((root, index) => definitionTypes.has(root.type) && index > tree.roots.indexOf(diagramRoot));
  if (diagramRoots.length !== 1 || unexpectedRoots.length || definitionAfterDiagram) {
    errors.push("The document must contain optional reusable definitions followed by root-level canvas settings and graphs.");
    return { nodes, edges, groups, errors, format: "pug", figure, ...styleBaselines() };
  }
  const rootLabel = diagramRoot.children.find((child) => child.type === "field" && child.classes.includes("label"));
  if (rootLabel) errors.push(`Line ${rootLabel.lineNumber}: nodes must be declared directly inside a graph.`);
  processChildren(diagramRoot, null);
  const graphIds = new Set();
  for (const group of groups) {
    if (graphIds.has(group.id)) errors.push(`Line ${group.lineNumber}: the graph ID "${group.id}" is already in use.`);
    graphIds.add(group.id);
  }
  for (const group of groups) {
    if (group.relativeTo === group.id) errors.push(`Line ${group.lineNumber}: a graph cannot be positioned relative to itself.`);
    else if (group.relativeTo && !graphIds.has(group.relativeTo)) errors.push(`Line ${group.lineNumber}: graph.relative-to references unknown graph "${group.relativeTo}".`);
  }
  const groupById = new Map(groups.map((group) => [group.id, group]));
  const placementState = new Map();
  function validatePlacementChain(group) {
    const state = placementState.get(group.id);
    if (state === "done") return;
    if (state === "visiting") {
      errors.push(`Line ${group.lineNumber}: graph placement references form a cycle at "${group.id}".`);
      return;
    }
    placementState.set(group.id, "visiting");
    const reference = groupById.get(group.relativeTo);
    if (reference && reference !== group) validatePlacementChain(reference);
    placementState.set(group.id, "done");
  }
  for (const group of groups) validatePlacementChain(group);
  const graphByNode = new Map(groups.flatMap((group) => group.nodeIds.map((id) => [id, group.id])));
  const flowIds = new Set();
  for (const { flow, attributes, defaults, graphId } of pendingFlows) {
    const id = attributes.id ?? "";
    if (id && !ID_PATTERN.test(id)) errors.push(`Line ${flow.lineNumber}: flow ID must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
    if (id && flowIds.has(id)) errors.push(`Line ${flow.lineNumber}: the flow ID "${id}" is already in use.`);
    if (id) flowIds.add(id);
    const from = attributes.from;
    const to = attributes.to;
    if (!from || !nodesById.has(from)) errors.push(`Line ${flow.lineNumber}: flow source "${from || "(missing)"}" is not defined.`);
    if (!to || !nodesById.has(to)) errors.push(`Line ${flow.lineNumber}: flow target "${to || "(missing)"}" is not defined.`);
    if (!from || !to || !nodesById.has(from) || !nodesById.has(to)) continue;
    const fromGraph = graphByNode.get(from);
    const toGraph = graphByNode.get(to);
    if (graphId && (fromGraph !== graphId || toGraph !== graphId)) errors.push(`Line ${flow.lineNumber}: a graph flow must connect two objects in graph "${graphId}"; place cross-graph flows directly at the source root.`);
    if (!graphId && fromGraph && toGraph && fromGraph === toGraph) errors.push(`Line ${flow.lineNumber}: a canvas flow must connect objects in different graphs; place this flow inside graph "${fromGraph}".`);
    const fromDirection = attributes["from-direction"] ?? attributes.direction ?? "right";
    const toDirection = attributes["to-direction"] ?? fromDirection;
    if (!FLOW_DIRECTIONS.has(fromDirection)) errors.push(`Line ${flow.lineNumber}: from-direction must be right, left, up, or down.`);
    if (!FLOW_DIRECTIONS.has(toDirection)) errors.push(`Line ${flow.lineNumber}: to-direction must be right, left, up, or down.`);
    edges.push({ id, from, to, kind: "flow", declarationKind: "flow", explicitFlow: true, graphId, ...defaults,
      layoutDirection: FLOW_DIRECTIONS.has(fromDirection) ? fromDirection : "right",
      sourceDirection: defaults.sourceFace ? defaults.sourceDirection : (FLOW_DIRECTIONS.has(fromDirection) ? fromDirection : "right"),
      targetLayoutDirection: defaults.targetFace ? defaults.targetLayoutDirection : (FLOW_DIRECTIONS.has(toDirection) ? toDirection : fromDirection) });
  }
  const incoming = new Map();
  edges.forEach((edge) => incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1));
  edges.forEach((edge) => {
    if (edge.kind === "flow" || edge.kind === "branch") {
      edge.kind = (incoming.get(edge.to) ?? 0) > 1 ? "merge" : "branch";
      if (edge.kind === "merge") edge.mergeId = edge.to;
    }
  });
  nodes.forEach((node) => {
    if (node.kind !== "image" && (incoming.get(node.id) ?? 0) > 1) node.kind = "merge";
  });
  for (const group of groups.filter((candidate) => candidate.hidden)) {
    const hiddenIds = new Set(group.nodeIds);
    nodes.filter((node) => hiddenIds.has(node.id)).forEach((node) => { node.hidden = true; });
    edges.filter((edge) => hiddenIds.has(edge.from) || hiddenIds.has(edge.to)).forEach((edge) => { edge.hidden = true; });
  }
  return { nodes, edges, groups, errors, format: "pug", figure, ...styleBaselines() };
}

/** Parse a diagram definition with optional external CSS-shaped reusable definitions. */
export function parseDiagram(source, styleSource = "") {
  const styles = compileStyleSheet(styleSource);
  if (styles.errors.length) return { nodes: [], edges: [], errors: styles.errors, format: "pug", figure: {} };
  const prefix = styles.source ? `${styles.source}\n\n` : "";
  const prefixLines = prefix ? prefix.split("\n").length - 1 : 0;
  const tree = parseMarkupTree(prefix + source);
  const definitionTypes = new Set(["node-definition", "flow-definition", "line-definition", "annotation-definition", "graph-definition"]);
  const explicitDiagramRoots = tree.roots.filter((root) => root.type === "diagram");
  if (!explicitDiagramRoots.length) {
    const definitions = tree.roots.filter((root) => definitionTypes.has(root.type));
    const canvasChildren = tree.roots.filter((root) => !definitionTypes.has(root.type));
    tree.roots = [...definitions, {
      type: "diagram",
      attrs: {},
      children: canvasChildren,
      lineNumber: canvasChildren[0]?.lineNumber ?? 1,
      implicit: true,
    }];
  }
  tree.roots.filter((root) => root.type === "diagram").forEach((root) => { root._isRoot = true; });
  const nodeTypeNames = new Set(tree.roots.filter((root) => root.type === "node-definition").map((root) => root.name));
  const lineTypeNames = new Set(tree.roots.filter((root) => ["flow-definition", "line-definition"].includes(root.type)).map((root) => root.name));
  tree.roots.forEach((root) => normalizeGroups(root, tree.errors, nodeTypeNames, lineTypeNames));
  const result = compileMarkup(tree);
  if (prefixLines) {
    const adjust = (value) => value > prefixLines ? value - prefixLines : value;
    result.nodes.forEach((node) => {
      node.lineNumber = adjust(node.lineNumber);
      node.annotations.forEach((annotation) => { annotation.lineNumber = adjust(annotation.lineNumber); });
    });
    result.edges.forEach((edge) => {
      edge.lineNumber = adjust(edge.lineNumber);
      edge.labelLineNumber = adjust(edge.labelLineNumber);
    });
    result.groups.forEach((group) => { group.lineNumber = adjust(group.lineNumber); });
    result.errors = result.errors.map((error) => error.replace(/^Line (\d+):/, (_, line) => `Line ${adjust(Number(line))}:`));
  }
  return result;
}
