const SVG_NS = "http://www.w3.org/2000/svg";

export function containsMath(text = "") {
  return /(^|[^\\])\$/.test(String(text));
}

export function mathTokens(text = "") {
  const tokens = [];
  const source = String(text);
  let plain = "";
  const pushPlain = () => {
    if (plain) tokens.push({ kind: "text", text: plain });
    plain = "";
  };
  for (let index = 0; index < source.length;) {
    if (source[index] === "\\" && source[index + 1] === "$") {
      plain += "$";
      index += 2;
      continue;
    }
    if (source[index] !== "$") {
      plain += source[index++];
      continue;
    }
    const display = source[index + 1] === "$";
    const delimiter = display ? "$$" : "$";
    const start = index + delimiter.length;
    const end = source.indexOf(delimiter, start);
    if (end < 0) {
      plain += delimiter;
      index = start;
      continue;
    }
    pushPlain();
    tokens.push({ kind: "math", text: source.slice(start, end).trim(), display });
    index = end + delimiter.length;
  }
  pushPlain();
  return tokens;
}

function pixels(value, fontSize) {
  const number = Number.parseFloat(value) || 0;
  if (String(value).endsWith("ex")) return number * fontSize * 0.5;
  if (String(value).endsWith("em")) return number * fontSize;
  return number;
}

const cache = new Map();

export function typesetMath(tex, fontSize = 16, display = false) {
  const key = `${fontSize}|${display ? 1 : 0}|${tex}`;
  if (cache.has(key)) return cache.get(key);
  if (!globalThis.MathJax?.tex2svg) throw new Error("The bundled math renderer has not finished loading.");
  const container = globalThis.MathJax.tex2svg(tex, { display });
  const source = container.querySelector("svg");
  const viewBox = source?.getAttribute("viewBox")?.split(/\s+/).map(Number);
  if (!source || viewBox?.length !== 4) throw new Error(`Could not typeset math: ${tex}`);
  let width = pixels(source.getAttribute("width"), fontSize);
  let height = pixels(source.getAttribute("height"), fontSize);
  if (!width || !height) {
    height = fontSize * (display ? 1.6 : 1.2);
    width = height * viewBox[2] / viewBox[3];
  }
  const result = { source, viewBox, width, height, tex, display };
  cache.set(key, result);
  return result;
}

function textPieces(text) {
  const pieces = [];
  String(text).split(/(\n|\s+)/).forEach((part) => {
    if (!part) return;
    if (part === "\n") pieces.push({ kind: "break" });
    else if (/^\s+$/.test(part)) pieces.push({ kind: "space", text: " " });
    else pieces.push({ kind: "text", text: part });
  });
  return pieces;
}

export function layoutRichText(text, { fontSize = 16, maxWidth = Infinity, measureText }) {
  const expanded = mathTokens(text).flatMap((token) => token.kind === "text" ? textPieces(token.text) : [token]);
  const lines = [];
  let runs = [];
  let width = 0;
  let pendingSpace = false;
  const normalHeight = Math.ceil(fontSize * 1.2);
  const flush = (force = false) => {
    if (runs.length || force) lines.push({ runs, width, height: Math.max(normalHeight, ...runs.map((run) => run.height ?? normalHeight)), display: runs.some((run) => run.display) });
    runs = [];
    width = 0;
    pendingSpace = false;
  };
  for (const token of expanded) {
    if (token.kind === "break") { flush(true); continue; }
    if (token.kind === "space") { pendingSpace = Boolean(runs.length); continue; }
    if (token.kind === "math" && token.display) {
      flush();
      const math = typesetMath(token.text, fontSize * 1.08, true);
      lines.push({ runs: [{ kind: "math", ...math }], width: math.width, height: math.height, display: true });
      continue;
    }
    const run = token.kind === "math"
      ? { kind: "math", ...typesetMath(token.text, fontSize, false) }
      : { kind: "text", text: token.text, width: measureText(token.text), height: normalHeight };
    const spaceWidth = pendingSpace ? measureText(" ") : 0;
    if (runs.length && width + spaceWidth + run.width > maxWidth) flush();
    if (pendingSpace && runs.length) {
      const space = { kind: "text", text: " ", width: measureText(" "), height: normalHeight };
      runs.push(space);
      width += space.width;
    }
    runs.push(run);
    width += run.width;
    pendingSpace = false;
  }
  flush(!lines.length);
  return { lines, width: Math.max(0, ...lines.map((line) => line.width)), height: lines.reduce((sum, line) => sum + line.height, 0) };
}

export function mathSvg(run, { x, y, color }) {
  const nested = document.createElementNS(SVG_NS, "svg");
  nested.setAttribute("x", String(x));
  nested.setAttribute("y", String(y));
  nested.setAttribute("width", String(run.width));
  nested.setAttribute("height", String(run.height));
  nested.setAttribute("viewBox", run.viewBox.join(" "));
  nested.setAttribute("preserveAspectRatio", "xMidYMid meet");
  nested.setAttribute("overflow", "visible");
  nested.setAttribute("color", color);
  nested.setAttribute("aria-hidden", "true");
  [...run.source.childNodes].forEach((child) => nested.append(child.cloneNode(true)));
  return nested;
}
