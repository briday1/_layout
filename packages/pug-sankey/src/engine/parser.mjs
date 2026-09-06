import { compileStyleSheet } from "./style-sheet.mjs";
import { DIAGRAM_THEMES, DEFAULT_DIAGRAM_THEME, isDiagramTheme } from "./diagram-themes.mjs";

const ID_PATTERN = /^[a-zA-Z][\w-]*$/;
const ANNOTATION_STYLE_FIELDS = new Set([
  "color", "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width",
]);
const FONT_FIELDS = new Set([
  "font-family", "font-size", "font-weight", "font-style", "text-decoration", "text-outline", "text-outline-width",
]);
const NODE_PROPERTIES = new Set([
  "id", "label", "value", "color", "layer", "hidden", "offset",
  ...FONT_FIELDS,
]);
const FLOW_PROPERTIES = new Set(["id", "from", "to", "value", "color", "label", "hidden"]);
const NODE_STYLE_PROPERTIES = new Set(["color", ...FONT_FIELDS]);
const FLOW_STYLE_PROPERTIES = new Set(["color", "label", ...FONT_FIELDS]);
const CANVAS_SETTINGS = new Set([
  "background", "font", "node-labels", "node-values", "flow-labels", "flow-values", "blend", "theme",
  "label-color", "node-value-color", "flow-value-color", "label-font-size", "value-font-size",
]);
const VISIBILITY_SETTINGS = new Set(["node-labels", "node-values", "flow-labels", "flow-values"]);

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
  const styleDefinition = body.match(/^@(node|flow|line|annotation)\s+([a-zA-Z][\w-]*)$/);
  if (styleDefinition) {
    const kind = styleDefinition[1] === "line" ? "flow" : styleDefinition[1];
    return { type: `${kind}-definition`, name: styleDefinition[2], classes: [], attrs: {}, text: "", children: [], lineNumber };
  }
  const removedDefinition = body.match(/^@(graph)\s+([a-zA-Z][\w-]*)$/);
  if (removedDefinition) {
    errors.push(`Line ${lineNumber}: @graph definitions are not supported in Sankey diagrams; use @node, @flow, or @annotation.`);
    return null;
  }
  const diagram = body.match(/^#(?:canvas|diagram)(?:\((.*)\))?$/);
  if (diagram) return { type: "diagram", classes: [], attrs: parseAttributes(diagram[1], lineNumber, errors), text: "", children: [], lineNumber };
  if (["node", "flow", "stage"].includes(body)) return { type: body, classes: [], attrs: {}, text: "", children: [], lineNumber };
  if (["graph", "image", "branch", "merge", "connect"].includes(body)) {
    errors.push(`Line ${lineNumber}: "${body}" is not supported in Sankey diagrams; use node declarations for bars and flow declarations for weighted links.`);
    return null;
  }

  const element = body.match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+)+)(?:\((.*)\))?(?:\s+(.*))?$/);
  if (!element) {
    errors.push(`Line ${lineNumber}: expected a reusable definition, canvas setting, node/flow/stage declaration, or node field.`);
    return null;
  }
  const classes = [...element[2].matchAll(/\.([\w-]+)/g)].map((match) => match[1]);
  if (!element[1] && classes[0] === "annotation") {
    return {
      type: "annotation-group",
      tag: null,
      classes,
      attrs: parseAttributes(element[3], lineNumber, errors),
      text: "",
      children: element[4] ? [{ type: "text", classes: [], attrs: {}, text: element[4], children: [], lineNumber }] : [],
      lineNumber,
    };
  }
  if (!element[1] && ["above", "below"].includes(classes[0])) {
    return {
      type: "position",
      tag: null,
      classes,
      attrs: parseAttributes(element[3], lineNumber, errors),
      text: "",
      children: element[4] ? [{ type: "text", classes: [], attrs: {}, text: element[4], children: [], lineNumber }] : [],
      lineNumber,
    };
  }
  if (!element[1] && classes.length > 1 && !["node", "flow", "annotation"].includes(classes[0])) {
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

function fontStyleFields(attrs, defaults, lineNumber, errors) {
  return {
    fontFamily: attrs["font-family"] ?? defaults.fontFamily ?? null,
    fontSize: numberAttribute(attrs["font-size"], defaults.fontSize ?? 16, 1, "font-size", lineNumber, errors),
    fontWeight: attrs["font-weight"] ?? defaults.fontWeight ?? "normal",
    fontStyle: attrs["font-style"] ?? defaults.fontStyle ?? "normal",
    textDecoration: attrs["text-decoration"] ?? defaults.textDecoration ?? "none",
    textOutline: attrs["text-outline"] ?? defaults.textOutline ?? "transparent",
    textOutlineWidth: numberAttribute(attrs["text-outline-width"], defaults.textOutlineWidth ?? 0, 0, "text-outline-width", lineNumber, errors),
  };
}

/** Slim Sankey node style: bar color plus label typography. */
function nodeStyle(attrs, lineNumber, errors, defaults = {}) {
  return {
    color: attrs.color ?? defaults.color ?? null,
    ...fontStyleFields(attrs, defaults, lineNumber, errors),
  };
}

/** Per-flow style: link color and optional label override plus label typography. */
function flowStyle(attrs, lineNumber, errors, defaults = {}) {
  const effective = { ...(defaults.attributes ?? {}), ...attrs };
  return {
    color: effective.color ?? defaults.color ?? null,
    label: effective.label ?? defaults.label ?? null,
    ...fontStyleFields(effective, { fontSize: 12, ...defaults }, lineNumber, errors),
  };
}

function truthy(value) {
  return value !== undefined && ![false, "false", "no", "0"].includes(value);
}

function annotationsFor(container, errors, annotationStyles, defaults = {}) {
  return container.children
    .filter((child) => ["position", "annotation", "annotation-group"].includes(child.type) || child.type === "field" && child.classes.includes("annotation"))
    .map((original) => {
      const positionMarker = original.type === "position" ? original : original.children.find((item) => item.type === "position");
      const groupExtras = positionMarker && original !== positionMarker
        ? original.children.filter((item) => item !== positionMarker && item.type !== "text")
        : [];
      const child = positionMarker
        ? { ...original, children: [...groupExtras, ...positionMarker.children], classes: positionMarker.classes, markerLineNumber: positionMarker.lineNumber }
        : original;
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
        lineNumber: child.markerLineNumber ?? child.lineNumber,
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

/** Root-level canvas settings: figure colors/font plus Sankey label/value visibility and link blend. */
function canvasSettingsFor(diagram, errors) {
  const settings = {};
  const node = {};
  const annotation = {};
  if (Object.keys(diagram.attrs).length) {
    errors.push(`Line ${diagram.lineNumber}: #canvas does not accept inline attributes; use indented fields.`);
  }
  for (const child of diagram.children) {
    if (["node", "flow", "stage", "annotation", "annotation-group", "field"].includes(child.type)) continue;
    if (Object.keys(child.attrs).length || child.children.length) {
      errors.push(`Line ${child.lineNumber}: .${child.type} must contain one plain-text value.`);
      continue;
    }
    const value = child.text.trim();
    if (CANVAS_SETTINGS.has(child.type)) {
      if (!value) errors.push(`Line ${child.lineNumber}: .${child.type} needs a value.`);
      else if (child.type === "theme" && !isDiagramTheme(value)) {
        errors.push(`Line ${child.lineNumber}: .theme must be one of ${DIAGRAM_THEMES.map(theme => theme.id).join(", ")}.`);
      }
      else if (["label-font-size", "value-font-size"].includes(child.type) && (!Number.isFinite(Number(value)) || Number(value) <= 0 || Number(value) > 96)) {
        errors.push(`Line ${child.lineNumber}: .${child.type} must be a number greater than 0 and at most 96.`);
      }
      else settings[child.type] = value;
      continue;
    }
    if (child.type.startsWith("annotation.")) {
      const property = child.type.slice(11);
      if (!ANNOTATION_STYLE_FIELDS.has(property)) errors.push(`Line ${child.lineNumber}: unknown canvas annotation field ".${child.type}".`);
      else if (!value) errors.push(`Line ${child.lineNumber}: .${child.type} needs a value.`);
      else annotation[property] = value;
      continue;
    }
    if (child.type.startsWith("node.")) {
      const property = child.type.slice(5);
      if (!NODE_STYLE_PROPERTIES.has(property)) errors.push(`Line ${child.lineNumber}: unknown canvas node default ".${child.type}".`);
      else if (!value) errors.push(`Line ${child.lineNumber}: .${child.type} needs a value.`);
      else node[property] = value;
      continue;
    }
    errors.push(`Line ${child.lineNumber}: ".${child.type}" is not a canvas setting; use node, flow, or stage declarations and .background/.font/.node-labels/.node-values/.flow-labels/.flow-values/.blend.`);
  }
  return { settings, node, annotation };
}

function visibility(value, fallback) {
  if (value === undefined) return fallback;
  return value !== "hide";
}

/** Figure-level settings read by the editor; includes label/value visibility and link blend. */
function figureStyle(settings) {
  const blendRaw = Number(settings.blend ?? 60);
  return {
    theme: settings.theme ?? DEFAULT_DIAGRAM_THEME,
    background: settings.background ?? null,
    label: null,
    text: null,
    merge: null,
    annotation: settings["annotation.color"] ?? null,
    font: settings.font ?? null,
    labelColor: settings["label-color"] ?? null,
    nodeValueColor: settings["node-value-color"] ?? null,
    flowValueColor: settings["flow-value-color"] ?? null,
    labelFontSize: Number(settings["label-font-size"] ?? 11),
    valueFontSize: Number(settings["value-font-size"] ?? 9),
    nodeLabels: visibility(settings["node-labels"], true),
    nodeValues: visibility(settings["node-values"], true),
    flowLabels: visibility(settings["flow-labels"], false),
    flowValues: visibility(settings["flow-values"], true),
    blend: Number.isFinite(blendRaw) ? Math.min(100, Math.max(0, blendRaw)) : 60,
  };
}

function customNodeStyles(tree, nodeDefaults, errors) {
  const definitions = new Map();
  for (const definition of tree.roots.filter((root) => root.type === "node-definition")) {
    if (definitions.has(definition.name) || definition.name === "node") {
      errors.push(`Line ${definition.lineNumber}: node type "${definition.name}" is already defined.`);
      continue;
    }
    const attributes = {};
    for (const child of definition.children) {
      const property = child.type === "field" && child.tag === "node" ? child.classes[0] : child.type;
      if (!NODE_STYLE_PROPERTIES.has(property)) {
        errors.push(`Line ${child.lineNumber}: @node definitions accept .color and font styling fields only.`);
        continue;
      }
      if (Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: .${property} takes its value as text, not attributes.`);
      if (child.children.length) errors.push(`Line ${child.lineNumber}: reusable style fields must stay on one line.`);
      attributes[property] = child.text.trim() || true;
    }
    definitions.set(definition.name, { style: nodeStyle(attributes, definition.lineNumber, errors, nodeDefaults), lineNumber: definition.lineNumber });
  }
  return definitions;
}

function customFlowStyles(tree, errors) {
  const definitions = new Map();
  for (const definition of tree.roots.filter((root) => root.type === "flow-definition")) {
    if (definitions.has(definition.name)) {
      errors.push(`Line ${definition.lineNumber}: flow type "${definition.name}" is already defined.`);
      continue;
    }
    const attributes = {};
    for (const child of definition.children) {
      if (!FLOW_STYLE_PROPERTIES.has(child.type)) {
        errors.push(`Line ${child.lineNumber}: @flow definitions accept .color, .label, and font styling fields only.`);
        continue;
      }
      if (Object.keys(child.attrs).length || child.children.length) errors.push(`Line ${child.lineNumber}: .${child.type} must contain one plain-text value.`);
      attributes[child.type] = child.text.trim();
    }
    definitions.set(definition.name, { attributes, lineNumber: definition.lineNumber });
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
      if (used.has(name)) errors.push(`Line ${definition.lineNumber ?? 1}: reusable class ".${name}" is already defined by another style type.`);
      used.add(name);
    }
  }
  return errors;
}

function automaticId(label, usedIds) {
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "node";
  let id = stem;
  let suffix = 2;
  while (usedIds.has(id)) id = `${stem}-${suffix++}`;
  return id;
}

/** Read the .field children of a node/flow declaration into a plain attribute map. */
function fieldsFor(container, errors, allowed, context, labelUsesTextLines = false, knownStyles = new Set()) {
  const attributes = {};
  const lines = {};
  for (const child of container.children.filter((item) => item.tag === null && !["text", "position", "annotation", "annotation-group"].includes(item.type))) {
    const property = child.type === "field" ? child.classes[0] : child.type;
    if (!allowed.has(property)) {
      if (!knownStyles.has(property)) errors.push(`Line ${child.lineNumber}: unknown ${context} property "${property}".`);
      continue;
    }
    if (Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: .${property} takes its value as text, not attributes.`);
    if (attributes[property] !== undefined) errors.push(`Line ${child.lineNumber}: duplicate .${property} field.`);
    attributes[property] = property === "label" && labelUsesTextLines ? textFor(child, errors) : child.text.trim();
    if (attributes[property] === "") attributes[property] = true;
    lines[property] = child.lineNumber;
    if (!(property === "label" && labelUsesTextLines) && child.children.length) {
      errors.push(`Line ${child.lineNumber}: .${property} must stay on one line.`);
    }
  }
  Object.defineProperty(attributes, "__lines", { value: lines });
  return attributes;
}

function compileMarkup(tree) {
  const errors = [...tree.errors];
  const nodes = [];
  const edges = [];
  const groups = [];
  const pendingFlows = [];
  const nodesById = new Map();
  const diagramRoot = tree.roots.find((root) => root.type === "diagram") ?? null;
  const canvas = diagramRoot ? canvasSettingsFor(diagramRoot, errors) : { settings: {}, node: {}, annotation: {} };
  const annotationDefaults = Object.fromEntries(Object.entries(canvas.annotation ?? {}).map(([name, value]) => [name.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), value]));
  if (canvas.annotation.color) canvas.settings["annotation.color"] = canvas.annotation.color;
  const nodeDefaults = nodeStyle(canvas.node, diagramRoot?.lineNumber ?? 1, errors);
  const nodeStyles = customNodeStyles(tree, nodeDefaults, errors);
  const flowStyles = customFlowStyles(tree, errors);
  const annotationStyles = customAnnotationStyles(tree, errors);
  const knownStyles = new Set([...nodeStyles.keys(), ...flowStyles.keys(), ...annotationStyles.keys()]);
  const figure = figureStyle(canvas.settings);
  errors.push(...validateStyleNames(nodeStyles, flowStyles, annotationStyles));

  /** Effective defaults and resolved reusable styles, used by editors to store only overrides. */
  function styleBaselines() {
    return {
      defaults: {
        node: nodeDefaults,
        flow: flowStyle({}, 1, []),
        annotation: annotationDefaults,
        graph: {},
      },
      presets: {
        node: Object.fromEntries([...nodeStyles].map(([name, definition]) => [name, definition.style])),
        flow: Object.fromEntries([...flowStyles].map(([name, definition]) =>
          [name, flowStyle(definition.attributes, definition.lineNumber, [])])),
        annotation: Object.fromEntries(annotationStyles),
        graph: {},
      },
    };
  }

  function createNode(container) {
    if (Object.keys(container.attrs).length) {
      errors.push(`Line ${container.lineNumber}: node declarations do not accept inline attributes; use indented fields.`);
    }
    if (container.text) errors.push(`Line ${container.lineNumber}: node declarations take indented fields, not inline text.`);
    const attributes = fieldsFor(container, errors, NODE_PROPERTIES, "node", true, knownStyles);
    const label = attributes.label === true ? "" : attributes.label ?? "";
    const presetChildren = container.children.filter((child) => nodeStyles.has(child.type));
    if (presetChildren.length > 1) errors.push(`Line ${presetChildren[1].lineNumber}: only one reusable node class may be applied here.`);
    if (presetChildren[0]?.children.length) errors.push(`Line ${presetChildren[0].lineNumber}: reusable node classes take no fields here.`);
    const preset = nodeStyles.get(presetChildren[0]?.type);
    const knownExtras = container.children.filter((child) => knownStyles.has(child.type) && !nodeStyles.has(child.type));
    if (knownExtras.length) errors.push(`Line ${knownExtras[0].lineNumber}: ".${knownExtras[0].type}" is not a node style.`);
    const offset = offsetTuple(attributes.offset === true ? undefined : attributes.offset, "node.offset", attributes.__lines.offset ?? container.lineNumber, errors);
    const layerText = attributes.layer === true ? "" : attributes.layer;
    const layer = layerText === undefined ? 0 : Number(layerText);
    if (layerText !== undefined && !Number.isInteger(layer)) errors.push(`Line ${attributes.__lines.layer ?? container.lineNumber}: node.layer must be an integer.`);
    const valueText = attributes.value === true ? "" : attributes.value;
    let declaredValue;
    if (valueText !== undefined) {
      const parsedValue = Number(valueText);
      if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
        errors.push(`Line ${attributes.__lines.value ?? container.lineNumber}: node value must be a positive number.`);
      } else {
        declaredValue = parsedValue;
      }
    }
    const requestedId = attributes.id === true ? "" : attributes.id ?? "";
    if (requestedId && !ID_PATTERN.test(requestedId)) errors.push(`Line ${attributes.__lines.id ?? container.lineNumber}: "${requestedId}" is not a valid ID.`);
    const labelLineNumber = attributes.__lines.label ?? container.lineNumber;
    const id = requestedId || automaticId(label || "node", nodesById);
    if (nodesById.has(id)) {
      errors.push(`Line ${labelLineNumber}: the ID "${id}" is already in use.`);
      return null;
    }
    const node = {
      id,
      explicitId: requestedId,
      label,
      color: (attributes.color === true ? null : attributes.color) ?? preset?.style.color ?? nodeDefaults.color ?? null,
      layer: Number.isInteger(layer) ? layer : 0,
      declaredValue,
      hasDeclaredValue: declaredValue !== undefined,
      declaredValueLineNumber: attributes.__lines.value ?? labelLineNumber,
      hidden: truthy(attributes.hidden),
      lineNumber: labelLineNumber,
      sourceIndex: nodes.length,
      annotations: annotationsFor(container, errors, annotationStyles, annotationDefaults),
      nodeType: presetChildren[0]?.type ?? null,
      offsetX: offset.x,
      offsetY: offset.y,
      style: nodeStyle(attributes, labelLineNumber, errors, preset?.style ?? nodeDefaults),
      kind: "block",
    };
    nodes.push(node);
    nodesById.set(id, node);
    return node;
  }

  function buildFlow(container) {
    if (Object.keys(container.attrs).length) {
      errors.push(`Line ${container.lineNumber}: flow declarations do not accept inline attributes; use indented fields.`);
    }
    const attributes = fieldsFor(container, errors, FLOW_PROPERTIES, "flow", false, knownStyles);
    const presetChildren = container.children.filter((child) => flowStyles.has(child.type));
    if (presetChildren.length > 1) errors.push(`Line ${presetChildren[1].lineNumber}: only one reusable flow class may be applied here.`);
    const knownExtras = container.children.filter((child) => knownStyles.has(child.type) && !flowStyles.has(child.type));
    if (knownExtras.length) errors.push(`Line ${knownExtras[0].lineNumber}: ".${knownExtras[0].type}" is not a flow style.`);
    const preset = flowStyles.get(presetChildren[0]?.type) ?? null;
    pendingFlows.push({ container, attributes, preset, presetName: presetChildren[0]?.type ?? null });
  }

  function processContainer(container) {
    for (const child of container.children) {
      if (child.type === "node") createNode(child);
      else if (child.type === "flow") buildFlow(child);
      else if (child.type === "stage") {
        if (Object.keys(child.attrs).length) errors.push(`Line ${child.lineNumber}: stage declarations do not accept inline attributes.`);
        if (child.text) errors.push(`Line ${child.lineNumber}: stages are pass-through containers and take no label; nest node declarations inside.`);
        processContainer(child);
      } else if (child.type === "field") {
        errors.push(`Line ${child.lineNumber}: .${child.classes.join(".")} fields must be nested inside a node or flow declaration.`);
      } else if (["annotation", "annotation-group"].includes(child.type)) {
        errors.push(`Line ${child.lineNumber}: annotations must be nested inside a node or flow declaration.`);
      } else if (!child.type.startsWith("node.") && !child.type.startsWith("annotation.") && !CANVAS_SETTINGS.has(child.type)) {
        errors.push(`Line ${child.lineNumber}: ".${child.type}" is not valid here; declare nodes, flows, or stages.`);
      }
    }
  }

  const definitionTypes = new Set(["node-definition", "flow-definition", "annotation-definition"]);
  const unexpectedRoots = tree.roots.filter((root) => !definitionTypes.has(root.type) && root.type !== "diagram");
  if (unexpectedRoots.length) {
    errors.push("The document must contain optional reusable definitions followed by canvas settings, node, flow, and stage declarations.");
  }
  if (diagramRoot) processContainer(diagramRoot);
  else processContainer({ type: "root", children: tree.roots.filter((root) => !definitionTypes.has(root.type)), lineNumber: 1 });

  const flowIds = new Set();
  for (const { container, attributes, preset, presetName } of pendingFlows) {
    const lineNumber = container.lineNumber;
    const id = attributes.id === true ? "" : attributes.id ?? "";
    if (id && !ID_PATTERN.test(id)) errors.push(`Line ${lineNumber}: flow ID must start with a letter and contain only letters, numbers, underscores, or hyphens.`);
    if (id && flowIds.has(id)) errors.push(`Line ${lineNumber}: the flow ID "${id}" is already in use.`);
    if (id) flowIds.add(id);
    const from = attributes.from === true ? "" : attributes.from;
    const to = attributes.to === true ? "" : attributes.to;
    if (!from || !nodesById.has(from)) errors.push(`Line ${attributes.__lines.from ?? lineNumber}: flow source "${from || "(missing)"}" is not defined.`);
    if (!to || !nodesById.has(to)) errors.push(`Line ${attributes.__lines.to ?? lineNumber}: flow target "${to || "(missing)"}" is not defined.`);
    const valueText = attributes.value === true ? "" : attributes.value;
    const value = valueText === undefined ? NaN : Number(valueText);
    if (valueText === undefined) errors.push(`Line ${lineNumber}: every flow needs a .value.`);
    else if (!Number.isFinite(value) || value <= 0) errors.push(`Line ${attributes.__lines.value ?? lineNumber}: flow value must be a positive number.`);
    if (!from || !to || !nodesById.has(from) || !nodesById.has(to) || !Number.isFinite(value) || value <= 0) continue;
    const style = flowStyle(attributes, lineNumber, errors, preset ?? {});
    const label = (attributes.label === true ? "" : attributes.label) ?? preset?.attributes.label ?? null;
    edges.push({
      id,
      from,
      to,
      value,
      kind: "flow",
      declarationKind: "flow",
      explicitFlow: true,
      flowType: presetName,
      color: (attributes.color === true ? null : attributes.color) ?? preset?.attributes.color ?? null,
      label,
      labelLineNumber: attributes.__lines.label ?? lineNumber,
      lineNumber,
      sourceIndex: edges.length,
      hidden: truthy(attributes.hidden),
      annotations: annotationsFor(container, errors, annotationStyles, annotationDefaults),
      style,
    });
  }

  // A node's value is authoritative when declared explicitly. Flows still
  // drive the diagram's topology and ribbon thickness, but when a node also
  // states its own .value it must agree with what its flows add up to —
  // otherwise the source is inconsistent and we surface a clear error rather
  // than silently picking one number over the other.
  const outgoingTotal = new Map();
  const incomingTotal = new Map();
  edges.forEach((edge) => {
    outgoingTotal.set(edge.from, (outgoingTotal.get(edge.from) ?? 0) + edge.value);
    incomingTotal.set(edge.to, (incomingTotal.get(edge.to) ?? 0) + edge.value);
  });
  nodes.forEach((node) => {
    if (!node.hasDeclaredValue) return;
    const flowTotal = Math.max(outgoingTotal.get(node.id) ?? 0, incomingTotal.get(node.id) ?? 0);
    if (flowTotal <= 0) return;
    const tolerance = Math.max(1e-9, flowTotal * 1e-6);
    if (Math.abs(node.declaredValue - flowTotal) > tolerance) {
      errors.push(
        `Line ${node.declaredValueLineNumber}: node "${node.id}" value (${node.declaredValue}) does not match its flow total (${flowTotal}); update the node value or its flows to match.`,
      );
    }
  });

  return { nodes, edges, groups, errors, format: "pug", figure, ...styleBaselines() };
}

/** Parse a Sankey diagram definition with optional external CSS-shaped reusable definitions. */
export function parseDiagram(source, styleSource = "") {
  const styles = compileStyleSheet(styleSource);
  if (styles.errors.length) return { nodes: [], edges: [], groups: [], errors: styles.errors, format: "pug", figure: {} };
  const prefix = styles.source ? `${styles.source}\n\n` : "";
  const prefixLines = prefix ? prefix.split("\n").length - 1 : 0;
  const tree = parseMarkupTree(prefix + source);
  const definitionTypes = new Set(["node-definition", "flow-definition", "annotation-definition"]);
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
  } else if (explicitDiagramRoots.length > 1) {
    tree.errors.push("The document must contain a single #canvas section.");
  }
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
      edge.annotations.forEach((annotation) => { annotation.lineNumber = adjust(annotation.lineNumber); });
    });
    result.errors = result.errors.map((error) => error.replace(/^Line (\d+):/, (_match, line) => `Line ${adjust(Number(line))}:`));
  }
  return result;
}
