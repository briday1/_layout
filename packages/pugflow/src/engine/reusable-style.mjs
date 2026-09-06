const FIELD_MAPS = {
  node: [
    ["shape", "shape"], ["fill", "fill"], ["color", "color"], ["outline", "outline"],
    ["outline-style", "outlineStyle"], ["outline-width", "outlineWidth"], ["width", "width"],
    ["height", "height"], ["align", "align"], ["vertical-align", "verticalAlign"], ["shadow-color", "shadowColor"],
    ["shadow-offset-x", "shadowOffsetX"], ["shadow-offset-y", "shadowOffsetY"],
    ["shadow-blur", "shadowBlur"], ["shadow-opacity", "shadowOpacity"], ["image", "image"],
    ["font-family", "fontFamily"], ["font-size", "fontSize"], ["font-weight", "fontWeight"],
    ["font-style", "fontStyle"], ["text-decoration", "textDecoration"],
    ["text-outline", "textOutline"], ["text-outline-width", "textOutlineWidth"],
  ],
  flow: [
    ["color", "color"], ["outline", "outline"], ["outline-width", "outlineWidth"],
    ["width", "width"], ["roundness", "roundness"],
    ["stroke-style", "style"], ["arrow-style", "direction"], ["arrow-shape", "arrowShape"],
    ["arrow-height", "arrowHeight"], ["arrow-head-width", "arrowHeadWidth"], ["label-position", "labelPosition"],
    ["shadow-color", "shadowColor"], ["shadow-offset-x", "shadowOffsetX"],
    ["shadow-offset-y", "shadowOffsetY"], ["shadow-blur", "shadowBlur"], ["shadow-opacity", "shadowOpacity"],
    ["font-family", "fontFamily"], ["font-size", "fontSize"], ["font-weight", "fontWeight"],
    ["font-style", "fontStyle"], ["text-decoration", "textDecoration"],
    ["text-outline", "textOutline"], ["text-outline-width", "textOutlineWidth"],
  ],
  annotation: [
    ["color", "color"], ["font-family", "fontFamily"], ["font-size", "fontSize"],
    ["font-weight", "fontWeight"], ["font-style", "fontStyle"], ["text-decoration", "textDecoration"],
    ["text-outline", "textOutline"], ["text-outline-width", "textOutlineWidth"],
  ],
  graph: [
    ["label-position", "labelPosition"], ["align", "align"], ["vertical-align", "verticalAlign"], ["placement", "placement"],
    ["fill", "fill"], ["color", "color"], ["outline", "outline"], ["outline-style", "outlineStyle"],
    ["outline-width", "outlineWidth"], ["padding", "padding"], ["x-spacing", "xSpacing"], ["y-spacing", "ySpacing"],
    ["shadow-color", "shadowColor"], ["shadow-offset-x", "shadowOffsetX"],
    ["shadow-offset-y", "shadowOffsetY"], ["shadow-blur", "shadowBlur"], ["shadow-opacity", "shadowOpacity"],
    ["font-family", "fontFamily"], ["font-size", "fontSize"], ["font-weight", "fontWeight"],
    ["font-style", "fontStyle"], ["text-decoration", "textDecoration"],
    ["text-outline", "textOutline"], ["text-outline-width", "textOutlineWidth"],
  ],
};

const BASELINES = {
  node: {
    shape: "round", fill: "transparent", outlineStyle: "solid", outlineWidth: 2, width: "auto", height: "auto",
    align: "center", verticalAlign: "middle", shadowOffsetX: 4, shadowOffsetY: 5, shadowBlur: 6, shadowOpacity: 0.3,
    imageWidth: 64, imageHeight: 64, imageFit: "contain", imageOpacity: 1, imagePadding: 0,
    fontSize: 16, fontWeight: "normal", fontStyle: "normal", textDecoration: "none",
    textOutline: "transparent", textOutlineWidth: 0,
  },
  flow: {
    outline: "transparent", outlineWidth: 0, width: 2, roundness: 9, style: "solid", direction: "forward",
    arrowShape: "triangle", arrowHeight: 8, arrowHeadWidth: 16, labelPosition: "above", shadowOffsetX: 4, shadowOffsetY: 5, shadowBlur: 6, shadowOpacity: 0.3, fontSize: 12, fontWeight: "normal", fontStyle: "normal",
    textDecoration: "none", textOutline: "transparent", textOutlineWidth: 0,
  },
  annotation: {
    fontSize: 12, fontWeight: "normal", fontStyle: "normal", textDecoration: "none",
    textOutline: "transparent", textOutlineWidth: 0,
  },
  graph: {
    labelPosition: "inside", align: "center", verticalAlign: "top", placement: "below", fill: "transparent", outline: "transparent",
    outlineStyle: "solid", outlineWidth: 1.5, padding: 24, xSpacing: 60, ySpacing: 40, shadowOffsetX: 4, shadowOffsetY: 5, shadowBlur: 6, shadowOpacity: 0.3, fontSize: 13,
    fontWeight: "600", fontStyle: "normal", textDecoration: "none", textOutline: "transparent", textOutlineWidth: 0,
  },
};

function sameValue(value, baseline) {
  if (baseline === null || baseline === undefined) return false;
  if (typeof value === "number" || typeof baseline === "number") {
    const left = Number(value);
    const right = Number(baseline);
    if (Number.isFinite(left) && Number.isFinite(right)) return left === right;
  }
  return String(value).trim() === String(baseline).trim();
}

/**
 * Return CSS declarations for the properties that differ from the relevant baseline.
 *
 * Presets therefore store overrides only; the effective style stays correct because loading a
 * preset merges it on top of the same category defaults used to compute the difference.
 */
export function reusableStyleDeclarations(kind, model = {}, baseline = undefined) {
  const fields = FIELD_MAPS[kind];
  if (!fields) throw new Error(`Unknown reusable style kind: ${kind}`);
  const reference = { ...BASELINES[kind], ...(baseline ?? {}) };
  const declarations = fields.flatMap(([property, key]) => {
    const value = model[key];
    if (value === null || value === undefined || value === "") return [];
    return sameValue(value, reference[key]) ? [] : [[property, String(value)]];
  });
  const offsetX = model.offsetX ?? 0;
  const offsetY = model.offsetY ?? 0;
  if (kind === "annotation" && (offsetX || offsetY) && !sameValue(`(${offsetX}, ${offsetY})`, reference.offset)) {
    declarations.push(["offset", `(${offsetX}, ${offsetY})`]);
  }
  return declarations;
}

/** Append a reusable style rule to a CSS document. */
export function appendReusableStyle(source, kind, name, declarations) {
  if (!FIELD_MAPS[kind]) throw new Error(`Unknown reusable style kind: ${kind}`);
  if (!/^[a-zA-Z][\w-]*$/.test(name)) throw new Error("Type name must start with a letter and contain only letters, numbers, underscores, or hyphens.");
  if (new RegExp(`^@(node|flow|graph|annotation)\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m").test(source)) {
    throw new Error(`A reusable type named ${name} already exists.`);
  }
  const body = declarations.map(([property, value]) => `  ${property}: ${value};`).join("\n");
  const rule = `@${kind} ${name} {\n${body}\n}`;
  return `${String(source).trimEnd()}${String(source).trim() ? "\n\n" : ""}${rule}\n`;
}
